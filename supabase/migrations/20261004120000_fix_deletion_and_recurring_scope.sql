-- =============================================================================
-- Migration: 20261004120000_fix_deletion_and_recurring_scope.sql
-- MedCore: correcao da auditoria de 04/10/2026 (regressoes de 01-02/10).
--
--  1. treatment_evolutions: exclusao exigia apenas estar logado (USING true) e
--     delete_treatment_evolution() (SECURITY DEFINER) nao verificava nada.
--     Agora: acesso ao plano (clinica) + permissao followups.manage.
--  2. prescriptions: exclusao USING (true); a guarda records.edit valia para
--     qualquer clinica. Agora: records.edit na clinica do paciente.
--  3. recurring_transactions: sem clinica e aberta a qualquer usuario logado.
--     Agora: company_id (preenchido automaticamente) + permissao financeira.
--
-- Aplicar inteiro, de uma vez, no SQL Editor (homologacao primeiro).
-- =============================================================================

BEGIN;

-- 1. Evolucoes de acompanhamento ------------------------------------------------
DROP POLICY IF EXISTS treatment_evolution_delete ON public.treatment_evolutions;
CREATE POLICY treatment_evolution_delete ON public.treatment_evolutions
  FOR DELETE TO authenticated
  USING (
    public.can_access_treatment(treatment_id)
    AND (SELECT public.has_any_permission('followups.manage'))
  );

CREATE OR REPLACE FUNCTION public.delete_treatment_evolution(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_treatment uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Identificador da evolução obrigatório';
  END IF;

  SELECT treatment_id INTO v_treatment FROM public.treatment_evolutions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolução não encontrada';
  END IF;

  IF NOT public.can_access_treatment(v_treatment)
     OR NOT public.has_any_permission('followups.manage') THEN
    RAISE EXCEPTION 'Sem permissão para excluir esta evolução' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.treatment_evolutions WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_treatment_evolution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_treatment_evolution(uuid) TO authenticated;

-- 2. Prescricoes -----------------------------------------------------------------
DROP POLICY IF EXISTS prescriptions_delete ON public.prescriptions;
CREATE POLICY prescriptions_delete ON public.prescriptions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = prescriptions.patient_id
        AND CASE WHEN to_jsonb(p)->>'company_id' IS NULL
              THEN (SELECT public.has_any_permission('records.edit'))
              ELSE public.has_permission((to_jsonb(p)->>'company_id')::uuid, 'records.edit')
            END
    )
  );

-- 3. Custos fixos (recurring_transactions) ---------------------------------------
-- Cria a tabela caso 20261002100000 nao tenha sido aplicada.
CREATE TABLE IF NOT EXISTS public.recurring_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'despesa' CHECK (type IN ('receita', 'despesa')),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'Custos Fixos',
  account_id UUID,
  payment_method TEXT DEFAULT 'boleto',
  frequency TEXT NOT NULL DEFAULT 'mensal',
  day_of_month INTEGER NOT NULL DEFAULT 10,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  next_run DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_transactions TO authenticated;
GRANT ALL ON public.recurring_transactions TO service_role;
ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.recurring_transactions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
CREATE INDEX IF NOT EXISTS idx_recurring_transactions_company
  ON public.recurring_transactions(company_id);

-- Registros antigos: atribui a clinica quando existe apenas uma.
UPDATE public.recurring_transactions
SET company_id = (SELECT id FROM public.companies LIMIT 1)
WHERE company_id IS NULL AND (SELECT count(*) FROM public.companies) = 1;

-- O frontend nao envia company_id: usa a clinica ativa do usuario
-- (ou o unico vinculo ativo dele).
CREATE OR REPLACE FUNCTION public.recurring_transactions_set_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT pr.active_company_id INTO NEW.company_id
    FROM public.profiles pr
    WHERE pr.id = auth.uid() AND public.is_company_member(pr.active_company_id);
  END IF;
  IF NEW.company_id IS NULL THEN
    SELECT max(m.company_id::text)::uuid INTO NEW.company_id
    FROM public.company_members m
    WHERE m.user_id = auth.uid() AND m.status = 'active'
    HAVING count(*) = 1;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL
     AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'A clinica do custo fixo nao pode ser alterada' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.recurring_transactions_set_company() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recurring_transactions_set_company ON public.recurring_transactions;
CREATE TRIGGER trg_recurring_transactions_set_company
  BEFORE INSERT OR UPDATE ON public.recurring_transactions
  FOR EACH ROW EXECUTE FUNCTION public.recurring_transactions_set_company();

REVOKE ALL ON public.recurring_transactions FROM anon;
DROP POLICY IF EXISTS "recurring_transactions all authenticated" ON public.recurring_transactions;

DROP POLICY IF EXISTS recurring_transactions_select ON public.recurring_transactions;
CREATE POLICY recurring_transactions_select ON public.recurring_transactions
  FOR SELECT TO authenticated
  USING (public.finance_allowed(company_id, 'view'));

DROP POLICY IF EXISTS recurring_transactions_insert ON public.recurring_transactions;
CREATE POLICY recurring_transactions_insert ON public.recurring_transactions
  FOR INSERT TO authenticated
  WITH CHECK (company_id IS NOT NULL AND public.finance_allowed(company_id, 'pay'));

DROP POLICY IF EXISTS recurring_transactions_update ON public.recurring_transactions;
CREATE POLICY recurring_transactions_update ON public.recurring_transactions
  FOR UPDATE TO authenticated
  USING (public.finance_allowed(company_id, 'pay'))
  WITH CHECK (company_id IS NOT NULL AND public.finance_allowed(company_id, 'pay'));

DROP POLICY IF EXISTS recurring_transactions_delete ON public.recurring_transactions;
CREATE POLICY recurring_transactions_delete ON public.recurring_transactions
  FOR DELETE TO authenticated
  USING (public.finance_allowed(company_id, 'pay'));

COMMIT;

-- Conferencia (rodar apos aplicar): nenhuma politica deve aparecer com qual = 'true'.
-- SELECT tablename, policyname, cmd, qual FROM pg_policies
-- WHERE tablename IN ('treatment_evolutions','prescriptions','recurring_transactions');

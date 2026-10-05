-- =============================================================================
-- Migration: 20261004130000_browser_data_to_database.sql
-- MedCore: dados que ficavam apenas no navegador passam a ficar no banco.
--
--  1. ofx_batches: lotes de conferência de extrato (Financeiro > Conciliação).
--  2. clinic_settings.cities: cidades de atendimento (Configurações e Agenda).
--
-- Aplicar DEPOIS de 20261004120000_fix_deletion_and_recurring_scope.sql.
-- =============================================================================

BEGIN;

-- Clínica do usuário logado: a ativa no perfil ou, na falta dela, o único vínculo ativo.
CREATE OR REPLACE FUNCTION public.current_user_company()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT pr.active_company_id FROM public.profiles pr
      WHERE pr.id = auth.uid() AND public.is_company_member(pr.active_company_id)),
    (SELECT max(m.company_id::text)::uuid FROM public.company_members m
      WHERE m.user_id = auth.uid() AND m.status = 'active' HAVING count(*) = 1)
  );
$$;
REVOKE ALL ON FUNCTION public.current_user_company() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_company() TO authenticated;

-- 1. Lotes de conferência de extrato ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.ofx_batches (
  id text PRIMARY KEY,
  company_id uuid NOT NULL DEFAULT public.current_user_company() REFERENCES public.companies(id),
  data jsonb NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ofx_batches_company ON public.ofx_batches(company_id);

CREATE OR REPLACE FUNCTION public.ofx_batches_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'A clinica do lote nao pode ser alterada' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ofx_batches_touch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ofx_batches_touch ON public.ofx_batches;
CREATE TRIGGER trg_ofx_batches_touch BEFORE UPDATE ON public.ofx_batches
  FOR EACH ROW EXECUTE FUNCTION public.ofx_batches_touch();

REVOKE ALL ON public.ofx_batches FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofx_batches TO authenticated;
GRANT ALL ON public.ofx_batches TO service_role;
ALTER TABLE public.ofx_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofx_batches_select ON public.ofx_batches;
CREATE POLICY ofx_batches_select ON public.ofx_batches FOR SELECT TO authenticated
  USING (public.finance_allowed(company_id, 'view'));

DROP POLICY IF EXISTS ofx_batches_write ON public.ofx_batches;
CREATE POLICY ofx_batches_write ON public.ofx_batches FOR ALL TO authenticated
  USING (public.finance_allowed(company_id, 'receive') OR public.finance_allowed(company_id, 'pay'))
  WITH CHECK (public.finance_allowed(company_id, 'receive') OR public.finance_allowed(company_id, 'pay'));

-- 2. Cidades de atendimento -------------------------------------------------------
ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS cities text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.get_clinic_cities()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL OR NOT public.is_clinic_member() THEN '{}'::text[]
    ELSE COALESCE((SELECT cities FROM public.clinic_settings
                   ORDER BY created_at NULLS LAST LIMIT 1), '{}'::text[]) END;
$$;
REVOKE ALL ON FUNCTION public.get_clinic_cities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clinic_cities() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_clinic_cities(p_company_id uuid, p_cities text[])
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_clean text[];
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL
     OR NOT public.has_permission(p_company_id, 'settings.manage') THEN
    RAISE EXCEPTION 'Sem permissao para alterar as cidades' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(c ORDER BY ord), '{}') INTO v_clean
  FROM (
    SELECT DISTINCT ON (lower(btrim(x))) btrim(x) AS c, ord
    FROM unnest(COALESCE(p_cities, '{}')) WITH ORDINALITY AS u(x, ord)
    WHERE length(btrim(x)) > 0
    ORDER BY lower(btrim(x)), ord
  ) s;

  SELECT id INTO v_id FROM public.clinic_settings ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.clinic_settings (cities) VALUES (v_clean);
  ELSE
    UPDATE public.clinic_settings SET cities = v_clean WHERE id = v_id;
  END IF;
  RETURN v_clean;
END;
$$;
REVOKE ALL ON FUNCTION public.save_clinic_cities(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_clinic_cities(uuid, text[]) TO authenticated;

-- 3. Custos fixos: a tela lista "financial_accounts(name)", o que exige a chave estrangeira.
UPDATE public.recurring_transactions r SET account_id = NULL
WHERE account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id = r.account_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_transactions_account_id_fkey') THEN
    ALTER TABLE public.recurring_transactions
      ADD CONSTRAINT recurring_transactions_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

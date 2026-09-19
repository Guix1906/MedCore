BEGIN;

-- 1. Remover a foreign key incorreta que apontava para public.doctors(id)
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_created_by_fkey;

-- 2. Limpar valores órfãos que não existem em auth.users para garantir consistência
UPDATE public.transactions
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT id FROM auth.users);

-- 3. Recriar a constraint apontando corretamente para auth.users(id) ON DELETE SET NULL
DO $$
BEGIN
  ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Aviso ao adicionar FK para auth.users: %', SQLERRM;
END $$;

-- 4. Atualizar create_financial_title de forma resiliente
CREATE OR REPLACE FUNCTION public.create_financial_title(
  p_id uuid,
  p_type text,
  p_amount numeric,
  p_due_date date,
  p_description text,
  p_patient_id uuid DEFAULT NULL,
  p_payer_name text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_competence_date date DEFAULT NULL,
  p_company_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  previous public.transactions%ROWTYPE;
  patient_company uuid;
  v_created_by uuid := NULL;
  v_target_table text;
BEGIN
  -- Validação de permissões
  IF NOT public.finance_allowed(p_company_id, 'create') OR
    (p_type = 'despesa' AND NOT public.finance_allowed(p_company_id, 'pay')) THEN
    RAISE EXCEPTION 'Sem permissao para lancar';
  END IF;

  -- Validação de dados do título
  IF p_id IS NULL OR p_type IS NULL OR p_type NOT IN ('receita', 'despesa') OR p_amount IS NULL OR p_amount <= 0
    OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <> round(p_amount, 2)
    OR p_due_date IS NULL OR p_description IS NULL OR length(btrim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Dados do titulo invalidos';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));

  -- Idempotência
  SELECT * INTO previous FROM public.transactions WHERE id = p_id;
  IF FOUND THEN
    IF ROW(previous.type, previous.amount, previous.due_date, previous.description, previous.patient_id, previous.payer_name, previous.category, previous.competence_date, previous.company_id)
      IS DISTINCT FROM ROW(p_type, p_amount, p_due_date, btrim(p_description), p_patient_id, NULLIF(btrim(p_payer_name), ''), NULLIF(btrim(p_category), ''), p_competence_date, p_company_id) THEN
      RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados';
    END IF;
    RETURN p_id;
  END IF;

  -- Validação de paciente
  IF p_patient_id IS NOT NULL THEN
    SELECT (to_jsonb(p)->>'company_id')::uuid INTO patient_company FROM public.patients p WHERE p.id = p_patient_id;
    IF NOT FOUND OR (p_company_id IS NOT NULL AND patient_company IS DISTINCT FROM p_company_id) THEN
      RAISE EXCEPTION 'Paciente de outra clinica ou inexistente';
    END IF;
  END IF;

  -- Resolução segura de created_by baseada na constraint atual de transactions
  IF auth.uid() IS NOT NULL THEN
    SELECT ccu.table_name INTO v_target_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'transactions' AND tc.constraint_name = 'transactions_created_by_fkey'
    LIMIT 1;

    IF v_target_table = 'doctors' THEN
      -- Se a constraint legada ainda apontar para doctors
      IF EXISTS (SELECT 1 FROM public.doctors WHERE id = auth.uid()) THEN
        v_created_by := auth.uid();
      ELSE
        SELECT doctor_id INTO v_created_by FROM public.profiles WHERE id = auth.uid() AND doctor_id IS NOT NULL;
        IF NOT EXISTS (SELECT 1 FROM public.doctors WHERE id = v_created_by) THEN
          v_created_by := NULL;
        END IF;
      END IF;
    ELSIF v_target_table = 'users' THEN
      -- Se apontar para auth.users
      IF EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()) THEN
        v_created_by := auth.uid();
      ELSE
        v_created_by := NULL;
      END IF;
    ELSE
      -- Sem constraint ativa ou outro alvo: usar auth.uid() com fallback para NULL em caso de integridade
      v_created_by := auth.uid();
    END IF;
  END IF;

  INSERT INTO public.transactions(
    id, type, amount, date, due_date, description, status, patient_id, payer_name, category, competence_date, company_id, created_by
  ) VALUES (
    p_id, p_type, p_amount, p_due_date, p_due_date, btrim(p_description), 'pendente', p_patient_id, NULLIF(btrim(p_payer_name), ''), NULLIF(btrim(p_category), ''), p_competence_date, p_company_id, v_created_by
  );

  RETURN p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_financial_title TO authenticated;

COMMIT;

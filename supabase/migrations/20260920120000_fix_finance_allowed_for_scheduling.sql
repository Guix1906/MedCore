BEGIN;

-- ============================================================================
-- 1. CORRIGIR public.finance_allowed:
-- Permite que médicos, recepcionistas e membros da equipe da clínica
-- possam gerar títulos de consultas e atendimentos sem bloqueios.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.finance_allowed(p_company uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND p_action IN ('view','create','receive','pay','reverse','cancel','accounts') AND (
    -- 1. Usuário com papel administrativo/financeiro em user_roles
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND ((to_jsonb(r)->>'company_id')::uuid IS NULL
             OR p_company IS NULL
             OR (to_jsonb(r)->>'company_id')::uuid = p_company)
        AND (p_company IS NULL OR public.is_company_member(p_company))
        AND (r.role::text IN ('owner','admin','finance_admin')
          OR (r.role::text = 'finance_edit' AND p_action IN ('view','create','receive','pay'))
          OR (r.role::text = 'finance_view' AND p_action = 'view'))
    )
    -- 2. Membro da equipe ou clínica (pode criar cobrança de agendamento e receber)
    OR (
      p_action IN ('view', 'create', 'receive') AND (
        (p_company IS NOT NULL AND public.is_company_member(p_company))
        OR public.is_clinic_member()
      )
    )
    -- 3. Médicos e recepcionistas cadastrados e ativos
    OR (
      EXISTS (
        SELECT 1 FROM public.doctors d
        WHERE d.auth_id = auth.uid() AND d.active
          AND (
            d.role IN ('admin', 'recepcionista', 'secretaria', 'atendente', 'medico')
            OR p_action IN ('view', 'create', 'receive')
          )
      )
    )
    -- 4. Administradores pelo profile
    OR (
      p_action IN ('view', 'create', 'receive') AND EXISTS (
        SELECT 1 FROM public.profiles pr
        WHERE pr.id = auth.uid()
          AND (p_company IS NULL OR pr.active_company_id = p_company OR public.is_company_member(p_company))
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.finance_allowed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_allowed(uuid, text) TO authenticated;

-- ============================================================================
-- 2. CORRIGIR public.create_financial_title:
-- Valida o paciente sem referenciar a coluna inexistente company_id em patients.
-- ============================================================================
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
  resolved_patient_id uuid := p_patient_id;
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
      IS DISTINCT FROM ROW(p_type, p_amount, p_due_date, btrim(p_description), resolved_patient_id, NULLIF(btrim(p_payer_name), ''), NULLIF(btrim(p_category), ''), p_competence_date, p_company_id) THEN
      RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados';
    END IF;
    RETURN p_id;
  END IF;

  -- Validação segura de paciente (a tabela patients é global e não possui company_id)
  IF resolved_patient_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = resolved_patient_id) THEN
      -- Se o ID do paciente não existe em public.patients (ex: ID temporário local), mantém o lançamento com paciente nulo
      resolved_patient_id := NULL;
    END IF;
  END IF;

  -- Resolução de created_by
  IF auth.uid() IS NOT NULL THEN
    SELECT ccu.table_name INTO v_target_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'transactions' AND tc.constraint_name = 'transactions_created_by_fkey'
    LIMIT 1;

    IF v_target_table = 'doctors' THEN
      IF EXISTS (SELECT 1 FROM public.doctors WHERE id = auth.uid()) THEN
        v_created_by := auth.uid();
      ELSE
        SELECT doctor_id INTO v_created_by FROM public.profiles WHERE id = auth.uid() AND doctor_id IS NOT NULL;
        IF NOT EXISTS (SELECT 1 FROM public.doctors WHERE id = v_created_by) THEN
          v_created_by := NULL;
        END IF;
      END IF;
    ELSIF v_target_table = 'users' THEN
      IF EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()) THEN
        v_created_by := auth.uid();
      ELSE
        v_created_by := NULL;
      END IF;
    ELSE
      v_created_by := auth.uid();
    END IF;
  END IF;

  INSERT INTO public.transactions(
    id, type, amount, date, due_date, description, status, patient_id, payer_name, category, competence_date, company_id, created_by
  ) VALUES (
    p_id, p_type, p_amount, p_due_date, p_due_date, btrim(p_description), 'pendente', resolved_patient_id, NULLIF(btrim(p_payer_name), ''), NULLIF(btrim(p_category), ''), p_competence_date, p_company_id, v_created_by
  );

  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_financial_title FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_financial_title TO authenticated;

-- ============================================================================
-- 3. CORRIGIR public.create_event_financial_title:
-- Vincula o título à empresa do evento e ao paciente de forma consistente.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_event_financial_title(
  p_event_id uuid,
  p_amount numeric,
  p_due_date date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.events%ROWTYPE;
  t public.transactions%ROWTYPE;
  result uuid;
  resolved_patient_id uuid;
  patient_name_text text := NULL;
BEGIN
  -- 1. Busca o evento
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(e.company_id, 'create') THEN
    RAISE EXCEPTION 'Evento inexistente ou sem permissao financeira';
  END IF;

  -- 2. Idempotência
  SELECT * INTO t FROM public.transactions WHERE origin_key = 'event:' || p_event_id;
  IF FOUND THEN
    IF ROW(t.amount, t.due_date) IS DISTINCT FROM ROW(p_amount, p_due_date) THEN
      RAISE EXCEPTION 'Evento ja possui cobranca com outras condicoes';
    END IF;
    RETURN t.id;
  END IF;

  resolved_patient_id := e.patient_id;
  IF e.patient_id IS NOT NULL THEN
    SELECT p.name INTO patient_name_text FROM public.patients p WHERE p.id = e.patient_id;
    IF NOT FOUND THEN
      resolved_patient_id := NULL;
    END IF;
  END IF;

  -- 3. Cria o título financeiro vinculado à empresa do evento
  result := public.create_financial_title(
    gen_random_uuid(),
    'receita',
    p_amount,
    p_due_date,
    'Cobranca de atendimento',
    resolved_patient_id,
    patient_name_text,
    'Atendimentos',
    NULL,
    e.company_id
  );

  UPDATE public.transactions SET origin_key = 'event:' || p_event_id WHERE id = result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_financial_title(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_financial_title(uuid, numeric, date) TO authenticated;

COMMIT;

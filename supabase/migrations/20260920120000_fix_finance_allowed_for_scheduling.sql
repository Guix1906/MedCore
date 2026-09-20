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
-- Trata pacientes sem company_id como compatíveis e tolera IDs locais sem crash.
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
  patient_company uuid;
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

  -- Validação resiliente de paciente
  IF resolved_patient_id IS NOT NULL THEN
    SELECT (to_jsonb(p)->>'company_id')::uuid INTO patient_company FROM public.patients p WHERE p.id = resolved_patient_id;
    IF FOUND THEN
      -- Se o paciente pertence explicitamente a outra clínica diferente, bloqueia
      IF patient_company IS NOT NULL AND p_company_id IS NOT NULL AND patient_company <> p_company_id THEN
        RAISE EXCEPTION 'Paciente pertence a outra clinica';
      END IF;
      -- Se o paciente não tiver clínica associada, vincula à clínica atual
      IF patient_company IS NULL AND p_company_id IS NOT NULL THEN
        UPDATE public.patients SET company_id = p_company_id WHERE id = resolved_patient_id AND company_id IS NULL;
      END IF;
    ELSE
      -- ID de paciente não existe em public.patients (ex: ID local ou PHP offline)
      -- Mantém o lançamento financeiro com patient_id nulo para não abortar o agendamento
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
  finance_company uuid;
  patient_comp uuid;
  resolved_patient_id uuid;
  patient_name_text text := NULL;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(e.company_id, 'create') THEN
    RAISE EXCEPTION 'Evento inexistente ou sem permissao financeira';
  END IF;

  SELECT * INTO t FROM public.transactions WHERE origin_key = 'event:' || p_event_id;
  IF FOUND THEN
    IF ROW(t.amount, t.due_date) IS DISTINCT FROM ROW(p_amount, p_due_date) THEN
      RAISE EXCEPTION 'Evento ja possui cobranca com outras condicoes';
    END IF;
    RETURN t.id;
  END IF;

  finance_company := e.company_id;
  resolved_patient_id := e.patient_id;

  IF e.patient_id IS NOT NULL THEN
    SELECT (to_jsonb(p)->>'company_id')::uuid, p.name 
      INTO patient_comp, patient_name_text 
      FROM public.patients p WHERE p.id = e.patient_id;
    IF FOUND THEN
      IF patient_comp IS NOT NULL AND e.company_id IS NOT NULL AND patient_comp <> e.company_id THEN
        RAISE EXCEPTION 'Paciente do evento pertence a outra clinica';
      END IF;
      finance_company := COALESCE(e.company_id, patient_comp);
    ELSE
      resolved_patient_id := NULL;
    END IF;
  END IF;

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
    finance_company
  );

  UPDATE public.transactions SET origin_key = 'event:' || p_event_id WHERE id = result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_financial_title(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_financial_title(uuid, numeric, date) TO authenticated;

COMMIT;

-- =============================================================================
-- Migration: 20260929120000_security_hardening.sql
-- MedCore: correcao de seguranca apos a auditoria de 29/09/2026.
--
--  1. Remove reset_all_system_test_data(): apagava transacoes, pagamentos,
--     eventos e consultas de TODAS as clinicas e estava liberada para anon.
--  2. Restaura is_company_member() (vinculo ativo), anulada em 20260927200000.
--  3. Restaura as politicas de events/appointments por clinica/permissao.
--  4. Reescreve trg_prepare_event_row, save_agenda_event e get_agenda_events
--     com verificacao de vinculo e permissao; sem acesso anonimo.
--  5. delete_treatment e delete_patient exigem permissao e preservam o
--     prontuario (guarda minima de 20 anos: Lei 13.787/2018, CFM 1.821/2007);
--     as RPCs de cobranca da agenda passam a exigir permissao financeira.
--  6. Reatribui eventos gravados na clinica-placeholder pelo fallback antigo.
--
-- Aplicar inteiro, de uma vez, no SQL Editor (homologacao primeiro).
-- =============================================================================

BEGIN;

-- 1. Reset global ---------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reset_all_system_test_data();

-- 2. Vinculo ativo (mesma definicao de 20260925120000) --------------------------
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = _company_id AND cm.user_id = auth.uid() AND cm.status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;

-- 3. Politicas de events e appointments ------------------------------------------
-- As guardas RESTRICTIVE perm_guard_* (agenda.manage) de 20260925120000 continuam
-- valendo para escrita; aqui voltam as politicas permissivas por clinica.
DROP POLICY IF EXISTS "events_select_company" ON public.events;
CREATE POLICY "events_select_company" ON public.events
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "events_insert_company" ON public.events;
CREATE POLICY "events_insert_company" ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "events_update_company" ON public.events;
CREATE POLICY "events_update_company" ON public.events
  FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "events_delete_company" ON public.events;
CREATE POLICY "events_delete_company" ON public.events
  FOR DELETE TO authenticated
  USING (public.is_company_member(company_id));

REVOKE ALL ON public.events FROM anon;

DROP POLICY IF EXISTS "appointments_all_authenticated" ON public.appointments;
DROP POLICY IF EXISTS "appointments_clinic_all" ON public.appointments;
CREATE POLICY "appointments_clinic_all" ON public.appointments
  FOR ALL TO authenticated
  USING (public.is_clinic_member())
  WITH CHECK (public.is_clinic_member());

REVOKE ALL ON public.appointments FROM anon;

-- 4a. Preparacao de eventos: nunca atribui a uma clinica da qual o autor nao participa
CREATE OR REPLACE FUNCTION public.trg_prepare_event_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid;
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  IF NEW.company_id IS NULL THEN
    SELECT p.active_company_id INTO _company
      FROM public.profiles p
      JOIN public.company_members m
        ON m.company_id = p.active_company_id AND m.user_id = p.id AND m.status = 'active'
     WHERE p.id = auth.uid();
    IF _company IS NULL THEN
      SELECT m.company_id INTO _company
        FROM public.company_members m
       WHERE m.user_id = auth.uid() AND m.status = 'active'
       ORDER BY m.created_at
       LIMIT 1;
    END IF;
    IF _company IS NULL THEN
      RAISE EXCEPTION 'Usuario sem vinculo ativo com uma clinica' USING ERRCODE = '42501';
    END IF;
    NEW.company_id := _company;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_prepare_event_row() FROM PUBLIC, anon, authenticated;

-- 4b. Gravacao de evento via RPC: exige agenda.manage na clinica do evento
CREATE OR REPLACE FUNCTION public.save_agenda_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_company_id uuid;
  v_existing public.events%ROWTYPE;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_event_type public.event_type;
  v_result public.events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  v_id := COALESCE(NULLIF(p_event->>'id', '')::uuid, gen_random_uuid());
  v_starts_at := (p_event->>'starts_at')::timestamptz;
  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'Data de inicio obrigatoria';
  END IF;
  v_ends_at := COALESCE(NULLIF(p_event->>'ends_at', '')::timestamptz, v_starts_at + interval '30 minutes');

  BEGIN
    v_event_type := COALESCE(NULLIF(p_event->>'event_type', '')::public.event_type, 'meeting'::public.event_type);
  EXCEPTION WHEN OTHERS THEN
    v_event_type := 'meeting'::public.event_type;
  END;

  SELECT * INTO v_existing FROM public.events WHERE id = v_id FOR UPDATE;

  IF FOUND THEN
    IF NOT public.has_permission(v_existing.company_id, 'agenda.manage') THEN
      RAISE EXCEPTION 'Sem permissao para alterar este agendamento' USING ERRCODE = '42501', HINT = 'admin.forbidden';
    END IF;

    UPDATE public.events SET
      title = COALESCE(NULLIF(btrim(p_event->>'title'), ''), v_existing.title),
      description = p_event->>'description',
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      location = p_event->>'location',
      assigned_to = NULLIF(p_event->>'assigned_to', '')::uuid,
      patient_id = NULLIF(p_event->>'patient_id', '')::uuid,
      case_id = NULLIF(p_event->>'case_id', '')::uuid,
      updated_at = now()
    WHERE id = v_id
    RETURNING * INTO v_result;

    RETURN to_jsonb(v_result);
  END IF;

  v_company_id := NULLIF(p_event->>'company_id', '')::uuid;
  IF v_company_id IS NULL THEN
    SELECT m.company_id INTO v_company_id
      FROM public.company_members m
     WHERE m.user_id = v_uid AND m.status = 'active' AND 'agenda.manage' = ANY (m.effective_permissions)
     ORDER BY m.created_at
     LIMIT 1;
  END IF;

  IF v_company_id IS NULL OR NOT public.has_permission(v_company_id, 'agenda.manage') THEN
    RAISE EXCEPTION 'Sem permissao para agendar nesta clinica' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;

  INSERT INTO public.events (
    id, company_id, case_id, assigned_to, patient_id, title, description,
    event_type, location, starts_at, ends_at, created_by
  ) VALUES (
    v_id, v_company_id,
    NULLIF(p_event->>'case_id', '')::uuid,
    NULLIF(p_event->>'assigned_to', '')::uuid,
    NULLIF(p_event->>'patient_id', '')::uuid,
    COALESCE(NULLIF(btrim(p_event->>'title'), ''), 'Agendamento'),
    p_event->>'description',
    v_event_type, p_event->>'location', v_starts_at, v_ends_at, v_uid
  )
  RETURNING * INTO v_result;

  RETURN to_jsonb(v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.save_agenda_event(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_agenda_event(jsonb) TO authenticated;

-- 4c. Consulta de eventos: SECURITY INVOKER, a RLS decide o que cada um ve
CREATE OR REPLACE FUNCTION public.get_agenda_events(
  p_company_id uuid DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS SETOF public.events
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  SELECT * FROM public.events
  WHERE (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_start_date IS NULL OR starts_at >= p_start_date)
    AND (p_end_date IS NULL OR starts_at <= p_end_date)
  ORDER BY starts_at ASC;
$$;
REVOKE ALL ON FUNCTION public.get_agenda_events(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agenda_events(uuid, timestamptz, timestamptz) TO authenticated;

-- 5a. Registros clinicos de um paciente (usado pelas guardas de exclusao)
CREATE OR REPLACE FUNCTION public.patient_has_clinical_records(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  found_any boolean := false;
BEGIN
  FOREACH t IN ARRAY ARRAY['medical_records', 'prescriptions', 'exam_orders', 'vital_signs', 'attachments'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'patient_id'
    ) THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE patient_id = $1)', t) INTO found_any USING p_id;
      IF found_any THEN
        RETURN true;
      END IF;
    END IF;
  END LOOP;

  IF to_regclass('public.treatments') IS NOT NULL THEN
    IF to_regclass('public.treatment_evolutions') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.treatment_evolutions e JOIN public.treatments tr ON tr.id = e.treatment_id
        WHERE tr.patient_id = p_id
      ) INTO found_any;
      IF found_any THEN RETURN true; END IF;
    END IF;
    IF to_regclass('public.treatment_photos') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.treatment_photos ph JOIN public.treatments tr ON tr.id = ph.treatment_id
        WHERE tr.patient_id = p_id
      ) INTO found_any;
      IF found_any THEN RETURN true; END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.patient_has_clinical_records(uuid) FROM PUBLIC, anon, authenticated;

-- 5b. Exclusao de acompanhamento: permissao obrigatoria e preservacao clinica
-- Mantem o corpo existente (limpeza e desvinculo financeiro) sob outro nome, sem
-- acesso direto, e antepoe as guardas. Reaplicavel: so renomeia na primeira vez.
DO $$
BEGIN
  IF to_regprocedure('public.delete_treatment_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.delete_treatment(uuid) RENAME TO delete_treatment_unchecked;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.delete_treatment_unchecked(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_treatment(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'ID do tratamento obrigatorio';
  END IF;
  IF NOT public.has_any_permission('followups.manage') THEN
    RAISE EXCEPTION 'Sem permissao para excluir acompanhamentos' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  IF NOT public.can_access_treatment(p_id) THEN
    RAISE EXCEPTION 'Acompanhamento nao encontrado' USING ERRCODE = '42501';
  END IF;
  IF (to_regclass('public.treatment_evolutions') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.treatment_evolutions WHERE treatment_id = p_id))
     OR (to_regclass('public.treatment_photos') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.treatment_photos WHERE treatment_id = p_id)) THEN
    RAISE EXCEPTION 'Acompanhamento com evolucoes ou fotos clinicas nao pode ser excluido; encerre ou cancele o acompanhamento.'
      USING ERRCODE = '42501', HINT = 'clinical.retention';
  END IF;

  RETURN public.delete_treatment_unchecked(p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_treatment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_treatment(uuid) TO authenticated;

-- 5c. Exclusao de paciente: somente patients.manage e somente sem prontuario
CREATE OR REPLACE FUNCTION public.delete_patient(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient public.patients%ROWTYPE;
  v_company uuid;
  v_tr RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ID do paciente obrigatorio');
  END IF;

  SELECT * INTO v_patient FROM public.patients WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'message', 'Paciente nao encontrado ou ja excluido');
  END IF;

  v_company := NULLIF(to_jsonb(v_patient)->>'company_id', '')::uuid;
  IF NOT (
    (v_company IS NULL AND public.has_any_permission('patients.manage'))
    OR (v_company IS NOT NULL AND public.has_permission(v_company, 'patients.manage'))
  ) THEN
    RAISE EXCEPTION 'Sem permissao para excluir este paciente' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;

  IF public.patient_has_clinical_records(p_id) THEN
    RAISE EXCEPTION 'Paciente com prontuario nao pode ser excluido: a guarda do prontuario e obrigatoria por 20 anos. Desative o cadastro.'
      USING ERRCODE = '42501', HINT = 'clinical.retention';
  END IF;

  IF to_regclass('public.treatments') IS NOT NULL THEN
    FOR v_tr IN SELECT id FROM public.treatments WHERE patient_id = p_id LOOP
      PERFORM public.delete_treatment_unchecked(v_tr.id);
    END LOOP;
  END IF;

  -- Financeiro: preserva historico com nome do pagador, remove apenas pendencias sem baixa.
  UPDATE public.transactions
     SET payer_name = COALESCE(NULLIF(btrim(payer_name), ''), v_patient.name, 'Paciente')
   WHERE patient_id = p_id;
  DELETE FROM public.transactions
   WHERE patient_id = p_id
     AND (paid_amount IS NULL OR paid_amount = 0)
     AND status NOT IN ('pago', 'concluido', 'completed')
     AND NOT EXISTS (SELECT 1 FROM public.transaction_payments tp WHERE tp.transaction_id = transactions.id);
  UPDATE public.transactions
     SET patient_id = NULL, treatment_id = NULL, installment_id = NULL
   WHERE patient_id = p_id;

  DELETE FROM public.appointments WHERE patient_id = p_id;
  DELETE FROM public.events WHERE patient_id = p_id;
  DELETE FROM public.tasks WHERE patient_id = p_id;

  IF to_regclass('public.patient_tags') IS NOT NULL THEN
    DELETE FROM public.patient_tags WHERE patient_id = p_id;
  END IF;
  IF to_regclass('public.patient_pipeline_history') IS NOT NULL THEN
    DELETE FROM public.patient_pipeline_history WHERE patient_id = p_id;
  END IF;
  IF to_regclass('public.waitlist') IS NOT NULL THEN
    DELETE FROM public.waitlist WHERE patient_id = p_id;
  END IF;
  UPDATE public.cases SET patient_id = NULL WHERE patient_id = p_id;

  DELETE FROM public.patients WHERE id = p_id;

  RETURN jsonb_build_object('success', true, 'message', 'Paciente excluido com sucesso');
END;
$$;
REVOKE ALL ON FUNCTION public.delete_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_patient(uuid) TO authenticated;

-- 5d. Cobranca da agenda (20260926150000/20260926210000): as tres RPCs rodavam como
-- definer sem nenhuma verificacao. O corpo original e mantido sob *_unchecked (sem acesso
-- direto) e as versoes publicas passam a exigir vinculo e permissao na clinica do evento.
DO $$
BEGIN
  IF to_regprocedure('public.schedule_appointment_finance_unchecked(uuid,numeric,numeric,text,date)') IS NULL THEN
    ALTER FUNCTION public.schedule_appointment_finance(uuid, numeric, numeric, text, date)
      RENAME TO schedule_appointment_finance_unchecked;
  END IF;
  IF to_regprocedure('public.settle_appointment_remaining_unchecked(uuid,numeric,text,uuid)') IS NULL THEN
    ALTER FUNCTION public.settle_appointment_remaining(uuid, numeric, text, uuid)
      RENAME TO settle_appointment_remaining_unchecked;
  END IF;
  IF to_regprocedure('public.cancel_appointment_finance_unchecked(uuid,text,text)') IS NULL THEN
    ALTER FUNCTION public.cancel_appointment_finance(uuid, text, text)
      RENAME TO cancel_appointment_finance_unchecked;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.schedule_appointment_finance_unchecked(uuid, numeric, numeric, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_appointment_remaining_unchecked(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_appointment_finance_unchecked(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.schedule_appointment_finance(
  p_event_id uuid,
  p_amount numeric,
  p_sinal numeric,
  p_sinal_method text,
  p_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_company FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR NOT public.finance_allowed(v_company, 'create') THEN
    RAISE EXCEPTION 'Sem permissao para gerar a cobranca deste agendamento' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  IF COALESCE(p_sinal, 0) > 0 AND NOT public.finance_allowed(v_company, 'receive') THEN
    RAISE EXCEPTION 'Sem permissao para registrar recebimento de sinal' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  RETURN public.schedule_appointment_finance_unchecked(p_event_id, p_amount, p_sinal, p_sinal_method, p_due_date);
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_appointment_finance(uuid, numeric, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_appointment_finance(uuid, numeric, numeric, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_appointment_remaining(
  p_event_id uuid,
  p_amount numeric,
  p_method text,
  p_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_company FROM public.transactions WHERE origin_key = 'event:' || p_event_id;
  IF NOT FOUND OR NOT public.finance_allowed(v_company, 'receive') THEN
    RAISE EXCEPTION 'Sem permissao para registrar este recebimento' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.financial_accounts a
     WHERE a.id = p_account_id AND (a.company_id IS NULL OR a.company_id IS NOT DISTINCT FROM v_company)
  ) THEN
    RAISE EXCEPTION 'Conta financeira de outra clinica' USING ERRCODE = '42501';
  END IF;
  RETURN public.settle_appointment_remaining_unchecked(p_event_id, p_amount, p_method, p_account_id);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_appointment_remaining(uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_appointment_remaining(uuid, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_appointment_finance(
  p_event_id uuid,
  p_action text DEFAULT 'retain',
  p_reason text DEFAULT 'Cancelamento da consulta'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_company FROM public.transactions WHERE origin_key = 'event:' || p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'action', 'none');
  END IF;
  IF NOT public.finance_allowed(v_company, CASE WHEN p_action = 'refund' THEN 'reverse' ELSE 'cancel' END)
     AND NOT (p_action <> 'refund' AND public.has_permission(v_company, 'agenda.manage')) THEN
    RAISE EXCEPTION 'Sem permissao para cancelar a cobranca deste agendamento' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  RETURN public.cancel_appointment_finance_unchecked(p_event_id, p_action, p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_appointment_finance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_finance(uuid, text, text) TO authenticated;

-- 6. Eventos gravados na clinica-placeholder pelo fallback de 20260927200000 -----
-- Voltam para a clinica ativa do autor; sem autor com vinculo ativo, permanecem
-- (listados ao final para conferencia administrativa).
UPDATE public.events e
   SET company_id = (
     SELECT cm.company_id
       FROM public.company_members cm
      WHERE cm.user_id = e.created_by AND cm.status = 'active'
        AND cm.company_id <> '00000000-0000-0000-0000-0000000c1111'::uuid
      ORDER BY cm.created_at
      LIMIT 1
   )
 WHERE e.company_id = '00000000-0000-0000-0000-0000000c1111'::uuid
   AND EXISTS (
     SELECT 1 FROM public.company_members cm
      WHERE cm.user_id = e.created_by AND cm.status = 'active'
        AND cm.company_id <> '00000000-0000-0000-0000-0000000c1111'::uuid
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.company_members a
      WHERE a.company_id = '00000000-0000-0000-0000-0000000c1111'::uuid AND a.status = 'active'
   );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferencia: nenhuma linha deve mostrar anon_pode = true.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'execute') AS anon_pode,
       has_function_privilege('authenticated', p.oid, 'execute') AS logado_pode
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('save_agenda_event', 'get_agenda_events', 'delete_treatment', 'delete_patient',
                     'is_company_member', 'reset_all_system_test_data', 'schedule_appointment_finance',
                     'settle_appointment_remaining', 'cancel_appointment_finance',
                     'delete_treatment_unchecked', 'schedule_appointment_finance_unchecked',
                     'settle_appointment_remaining_unchecked', 'cancel_appointment_finance_unchecked');

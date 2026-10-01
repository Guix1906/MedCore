BEGIN;

-- ============================================================================
-- Excluir paciente/acompanhamento ainda falhava com
--   "Preserve o titulo e seu historico; pagamentos exigem fluxo de devolucao"
-- quando o paciente tinha título CANCELADO com histórico de pagamentos (ex.: título
-- excluído no financeiro, que fica cancelado com os recebimentos estornados).
-- O UPDATE que grava payer_name nesses títulos caía na trava de guard_financial_title.
--
-- Correção: as duas funções de exclusão ligam a flag local medcore.title_delete
-- (a mesma usada por delete_financial_title), que libera as travas de título e de
-- parcela apenas dentro desta transação. Os títulos com pagamentos continuam
-- preservados (só são desvinculados); só pendências sem baixa são apagadas.
-- Corpo igual ao de 20260929120000_security_hardening.sql, mais a flag.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_treatment(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ok boolean;
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

  PERFORM set_config('medcore.title_delete', 'on', true);
  ok := public.delete_treatment_unchecked(p_id);
  PERFORM set_config('medcore.title_delete', 'off', true);
  RETURN ok;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_treatment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_treatment(uuid) TO authenticated;

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

  PERFORM set_config('medcore.title_delete', 'on', true);

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

  PERFORM set_config('medcore.title_delete', 'off', true);

  RETURN jsonb_build_object('success', true, 'message', 'Paciente excluido com sucesso');
END;
$$;
REVOKE ALL ON FUNCTION public.delete_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_patient(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

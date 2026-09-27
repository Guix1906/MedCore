BEGIN;

-- ============================================================================
-- Migration: 20260927190000_safe_patient_deletion.sql
-- Permite a exclusão segura de pacientes, protegendo integridade contábil/financeira
-- e histórico de atendimentos, sem violação de chaves estrangeiras ou RLS.
-- ============================================================================

-- 1. Garante que referências de tratamentos na tabela transactions tenham ON DELETE SET NULL
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND cl.relname = 'transactions'
      AND c.confrelid = 'public.treatments'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND cl.relname = 'transactions'
      AND c.confrelid = 'public.treatment_installments'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_installment_id_fkey
  FOREIGN KEY (installment_id) REFERENCES public.treatment_installments(id) ON DELETE SET NULL;

-- 2. Atualiza guard_financial_title para permitir desvincular o paciente ao excluir,
-- preservando automaticamente o nome do pagador em payer_name sem perder o histórico contábil.
CREATE OR REPLACE FUNCTION public.guard_financial_title()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  paid numeric;
  has_history boolean;
  reversed_fee boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.transaction_payments WHERE transaction_id = OLD.id) THEN
      RAISE EXCEPTION 'Titulo com historico financeiro nao pode ser excluido';
    END IF;
    RETURN OLD;
  END IF;

  SELECT COALESCE(sum(amount) FILTER (WHERE reversed_at IS NULL), 0), count(*) > 0
    INTO paid, has_history
    FROM public.transaction_payments
    WHERE transaction_id = NEW.id;

  reversed_fee := paid = 0 AND EXISTS (
    SELECT 1 FROM public.card_settlements WHERE fee_title_id = NEW.id AND reversed_at IS NOT NULL
  );

  -- Se o paciente foi desvinculado (exclusão de paciente), preenche payer_name com o nome anterior caso vazio
  IF TG_OP = 'UPDATE' AND OLD.patient_id IS NOT NULL AND NEW.patient_id IS NULL AND (NEW.payer_name IS NULL OR btrim(NEW.payer_name) = '') THEN
    SELECT name INTO NEW.payer_name FROM public.patients WHERE id = OLD.patient_id;
  END IF;

  IF TG_OP = 'UPDATE' AND has_history AND (
    ROW(NEW.amount, NEW.type, NEW.company_id, NEW.treatment_id, NEW.installment_id, NEW.deleted_at)
      IS DISTINCT FROM ROW(OLD.amount, OLD.type, OLD.company_id, OLD.treatment_id, OLD.installment_id, OLD.deleted_at)
    OR (NEW.patient_id IS NOT NULL AND NEW.patient_id IS DISTINCT FROM OLD.patient_id)
    OR (NEW.status = 'cancelado' AND NOT reversed_fee)
  ) THEN
    RAISE EXCEPTION 'Preserve o titulo e seu historico; pagamentos exigem fluxo de devolucao';
  END IF;

  IF NEW.type IN ('receita', 'despesa', 'income', 'expense') AND (
    (NEW.status IN ('pago', 'concluido', 'completed') AND paid <> NEW.amount)
    OR paid > NEW.amount
  ) THEN
    RAISE EXCEPTION 'Registre a baixa no financeiro; status nao substitui pagamento';
  END IF;

  NEW.paid_amount := paid;
  RETURN NEW;
END;
$$;

-- 3. Função RPC delete_patient: orquestra a exclusão completa e segura do paciente
CREATE OR REPLACE FUNCTION public.delete_patient(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient public.patients%ROWTYPE;
  v_tr RECORD;
BEGIN
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ID do paciente obrigatório');
  END IF;

  -- 1. Localiza o paciente
  SELECT * INTO v_patient FROM public.patients WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'message', 'Paciente não encontrado ou já excluído');
  END IF;

  -- 2. Verificação de permissões do usuário
  IF auth.uid() IS NOT NULL AND NOT (
    public.has_any_permission('patients.manage')
    OR public.is_clinic_member()
    OR (to_jsonb(v_patient)->>'company_id' IS NOT NULL AND public.has_permission((to_jsonb(v_patient)->>'company_id')::uuid, 'patients.manage'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para excluir este paciente' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;

  -- 3. Validação de acompanhamentos (treatments) com títulos já pagos
  IF EXISTS (
    SELECT 1
    FROM public.transactions tx
    JOIN public.treatments tr ON tr.id = tx.treatment_id
    WHERE tr.patient_id = p_id
      AND (tx.paid_amount > 0 OR tx.status IN ('pago', 'concluido', 'completed'))
      AND tx.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Não é possível excluir o paciente: existem acompanhamentos com pagamentos já realizados no Financeiro. Estorne os pagamentos ou inative o cadastro do paciente.';
  END IF;

  -- 4. Exclusão segura dos acompanhamentos
  IF to_regclass('public.treatments') IS NOT NULL THEN
    FOR v_tr IN SELECT id FROM public.treatments WHERE patient_id = p_id LOOP
      PERFORM public.delete_treatment(v_tr.id);
    END LOOP;
  END IF;

  -- 5. Tratamento de transações financeiras vinculadas diretamente ao paciente
  IF to_regclass('public.transactions') IS NOT NULL THEN
    -- Preserva nome do paciente como texto no payer_name para histórico contábil
    UPDATE public.transactions
    SET payer_name = COALESCE(NULLIF(btrim(payer_name), ''), v_patient.name, 'Paciente')
    WHERE patient_id = p_id;

    -- Remove lançamentos que estão pendentes e não têm nenhum pagamento efetuado
    DELETE FROM public.transactions
    WHERE patient_id = p_id
      AND (paid_amount IS NULL OR paid_amount = 0)
      AND status NOT IN ('pago', 'concluido', 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.transaction_payments tp WHERE tp.transaction_id = transactions.id);

    -- Para títulos com pagamentos históricos, desvincula o ID mantendo o payer_name
    UPDATE public.transactions
    SET patient_id = NULL
    WHERE patient_id = p_id;
  END IF;

  -- 6. Consultas (appointments) e eventos de agenda (events)
  IF to_regclass('public.appointments') IS NOT NULL THEN
    DELETE FROM public.appointments WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.events') IS NOT NULL THEN
    DELETE FROM public.events WHERE patient_id = p_id;
  END IF;

  -- 7. Tarefas da agenda (tasks)
  IF to_regclass('public.tasks') IS NOT NULL THEN
    DELETE FROM public.tasks WHERE patient_id = p_id;
  END IF;

  -- 8. Registros clínicos e anexos
  IF to_regclass('public.attachments') IS NOT NULL THEN
    IF to_regclass('public.document_comments') IS NOT NULL THEN
      DELETE FROM public.document_comments
      WHERE attachment_id IN (SELECT id FROM public.attachments WHERE patient_id = p_id);
    END IF;
    DELETE FROM public.attachments WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.prescriptions') IS NOT NULL THEN
    DELETE FROM public.prescriptions WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.exam_orders') IS NOT NULL THEN
    DELETE FROM public.exam_orders WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.vital_signs') IS NOT NULL THEN
    DELETE FROM public.vital_signs WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.medical_records') IS NOT NULL THEN
    DELETE FROM public.medical_records WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.patient_tags') IS NOT NULL THEN
    DELETE FROM public.patient_tags WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.patient_pipeline_history') IS NOT NULL THEN
    DELETE FROM public.patient_pipeline_history WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.waitlist') IS NOT NULL THEN
    DELETE FROM public.waitlist WHERE patient_id = p_id;
  END IF;

  -- 9. Desvincula casos e prazos se existirem
  IF to_regclass('public.cases') IS NOT NULL THEN
    UPDATE public.cases SET patient_id = NULL WHERE patient_id = p_id;
  END IF;

  IF to_regclass('public.deadlines') IS NOT NULL THEN
    UPDATE public.deadlines SET patient_id = NULL WHERE patient_id = p_id;
  END IF;

  -- 10. Exclui o paciente da tabela principal
  DELETE FROM public.patients WHERE id = p_id;

  RETURN jsonb_build_object('success', true, 'message', 'Paciente excluído com sucesso');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_patient(uuid) TO authenticated;

-- Garante privilégios explícitos na tabela patients
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

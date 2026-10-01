BEGIN;

-- ============================================================================
-- Exclusão liberada a pedido da clínica:
--  1. Prontuários (inclusive finalizados e assinados) e seus adendos.
--     ATENÇÃO: a guarda de 20 anos (CFM 1.821/2007, Lei 13.787/2018) passa a ser
--     responsabilidade da clínica. Uma cópia do registro excluído continua em
--     medical_record_versions (action = 'delete'), como já acontecia antes.
--  2. Títulos financeiros (honorários, recebimentos, contas) sem justificativa,
--     mesmo com recebimentos ou vinculados a plano de tratamento. Os recebimentos
--     ativos são estornados antes, para o caixa e os relatórios continuarem corretos.
--
-- As travas continuam valendo para alterações comuns; só as funções abaixo as
-- liberam, por meio de uma flag local da transação.
-- ============================================================================

-- 1. Prontuários --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.medical_records_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Mantém uma cópia do que foi excluído
    INSERT INTO public.medical_record_versions (record_id, patient_id, action, data, changed_by)
      VALUES (OLD.id, OLD.patient_id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;

  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Prontuario assinado nao pode ser alterado. Registre um adendo.'
      USING ERRCODE = '42501', HINT = 'clinical.signed';
  END IF;

  INSERT INTO public.medical_record_versions (record_id, patient_id, action, data, changed_by)
    VALUES (OLD.id, OLD.patient_id, 'update', to_jsonb(OLD), auth.uid());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.medical_records_guard() FROM PUBLIC, anon, authenticated;

-- Adendos continuam imutáveis, exceto quando o prontuário inteiro é excluído
CREATE OR REPLACE FUNCTION public.medical_record_addenda_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('medcore.record_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Adendos nao podem ser alterados ou excluidos.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.medical_record_addenda_immutable() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_medical_record(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Prontuario obrigatorio'; END IF;
  IF NOT public.has_any_permission('records.edit') THEN
    RAISE EXCEPTION 'Sem permissao para excluir prontuarios.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('medcore.record_delete', 'on', true);
  DELETE FROM public.medical_record_addenda WHERE record_id = p_id;
  DELETE FROM public.medical_records WHERE id = p_id;
  PERFORM set_config('medcore.record_delete', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_medical_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_medical_record(uuid) TO authenticated;

-- 2. Títulos financeiros ------------------------------------------------------
-- Mesma regra da versão anterior (20260927190000), com a liberação da flag no início.
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
  IF current_setting('medcore.title_delete', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    SELECT COALESCE(sum(amount) FILTER (WHERE reversed_at IS NULL), 0) INTO paid
      FROM public.transaction_payments WHERE transaction_id = NEW.id;
    NEW.paid_amount := paid;
    RETURN NEW;
  END IF;

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

  IF TG_OP = 'UPDATE' AND OLD.patient_id IS NOT NULL AND NEW.patient_id IS NULL AND (NEW.payer_name IS NULL OR btrim(NEW.payer_name) = '') THEN
    SELECT name INTO NEW.payer_name FROM public.patients WHERE id = OLD.patient_id;
  END IF;

  IF TG_OP = 'UPDATE' AND has_history AND (
    ROW(NEW.amount, NEW.type, NEW.company_id, NEW.deleted_at)
      IS DISTINCT FROM ROW(OLD.amount, OLD.type, OLD.company_id, OLD.deleted_at)
    OR (NEW.status = 'cancelado' AND NOT reversed_fee AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id)
  ) THEN
    IF (OLD.patient_id IS NOT NULL AND NEW.patient_id IS NULL)
       OR (OLD.treatment_id IS NOT NULL AND NEW.treatment_id IS NULL)
       OR (OLD.installment_id IS NOT NULL AND NEW.installment_id IS NULL) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Preserve o titulo e seu historico; pagamentos exigem fluxo de devolucao';
    END IF;
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

CREATE OR REPLACE FUNCTION public.guard_financial_installment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE company uuid;
BEGIN
  IF current_setting('medcore.title_delete', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT (to_jsonb(t)->>'company_id')::uuid INTO company FROM public.treatments t WHERE t.id=COALESCE(NEW.treatment_id,OLD.treatment_id);
  IF auth.uid() IS NOT NULL AND NOT public.finance_allowed(company,'create') THEN RAISE EXCEPTION 'Sem permissao financeira para alterar parcelas'; END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND EXISTS (
    SELECT 1 FROM public.transaction_payments p JOIN public.transactions t ON t.id=p.transaction_id WHERE t.installment_id=OLD.id
  ) THEN
    IF TG_OP='DELETE' OR NEW.status IN ('cancelado','renegociado') OR
      ROW(NEW.amount,NEW.due_date,NEW.treatment_id,NEW.number) IS DISTINCT FROM ROW(OLD.amount,OLD.due_date,OLD.treatment_id,OLD.number) THEN
      RAISE EXCEPTION 'Plano com historico financeiro: regeneracao bloqueada';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_financial_title(), public.guard_financial_installment() FROM PUBLIC, anon, authenticated;

-- Excluir título: sem justificativa e sem restrição.
--  - Sem nenhum recebimento: apaga de vez.
--  - Com recebimentos: estorna os ativos e marca como cancelado (vai para "Excluídos"
--    no fluxo de caixa). Apagar de vez quebraria comissões, cartões e o caixa.
CREATE OR REPLACE FUNCTION public.delete_financial_title(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.transactions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF NOT public.finance_allowed(t.company_id, 'cancel') THEN
    RAISE EXCEPTION 'Sem permissao para excluir' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('medcore.title_delete', 'on', true);

  IF t.installment_id IS NOT NULL THEN
    UPDATE public.treatment_installments SET status = 'cancelado', paid_date = NULL WHERE id = t.installment_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.transaction_payments WHERE transaction_id = p_id) THEN
    DELETE FROM public.transactions WHERE id = p_id;
    PERFORM set_config('medcore.title_delete', 'off', true);
    RETURN 'deleted';
  END IF;

  UPDATE public.transaction_payments
    SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = 'Titulo excluido'
    WHERE transaction_id = p_id AND reversed_at IS NULL;
  UPDATE public.transactions
    SET status = 'cancelado', paid_at = NULL,
        notes = concat_ws(E'\n', notes, 'Excluido em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'))
    WHERE id = p_id;

  PERFORM set_config('medcore.title_delete', 'off', true);
  RETURN 'cancelled';
END;
$$;
REVOKE ALL ON FUNCTION public.delete_financial_title(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_financial_title(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

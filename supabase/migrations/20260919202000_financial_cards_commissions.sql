BEGIN;

CREATE OR REPLACE FUNCTION public.settle_financial_card(p_id uuid,p_payment uuid,p_bank uuid,p_fee numeric,p_date date,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.transaction_payments%ROWTYPE; t public.transactions%ROWTYPE; a public.financial_accounts%ROWTYPE; b public.financial_accounts%ROWTYPE;
  previous public.card_settlements%ROWTYPE; x public.account_transfers%ROWTYPE; fee_title uuid; fee_payment uuid;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatorio'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO p FROM public.transaction_payments WHERE id=p_payment FOR UPDATE;
  SELECT * INTO t FROM public.transactions WHERE id=p.transaction_id;
  IF t.id IS NULL OR NOT public.finance_allowed(t.company_id,'accounts') THEN RAISE EXCEPTION 'Sem permissao para liquidar cartao'; END IF;
  SELECT * INTO previous FROM public.card_settlements WHERE id=p_id;
  IF FOUND THEN
    SELECT * INTO x FROM public.account_transfers WHERE id=previous.transfer_id;
    IF ROW(previous.payment_id,x.to_account_id,previous.fee,x.date,previous.reference,previous.created_by)
      IS DISTINCT FROM ROW(p_payment,p_bank,p_fee,p_date,btrim(p_reference),auth.uid()) THEN RAISE EXCEPTION 'Solicitacao reutilizada com outros dados'; END IF;
    RETURN p_id;
  END IF;
  PERFORM 1 FROM public.financial_accounts WHERE id IN (p.account_id,p_bank) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.financial_accounts WHERE id=p.account_id;
  SELECT * INTO b FROM public.financial_accounts WHERE id=p_bank;
  IF p.reversed_at IS NOT NULL OR t.type NOT IN ('receita','income') OR p.payment_method IS NULL OR p.payment_method NOT IN ('cartao_credito','cartao_debito')
    OR a.id IS NULL OR b.id IS NULL OR a.company_id IS DISTINCT FROM b.company_id OR a.company_id IS DISTINCT FROM t.company_id
    OR a.balance_kind IS DISTINCT FROM 'receivable' OR b.balance_kind IS DISTINCT FROM 'available' OR b.type='caixa'
    OR NOT a.is_active OR NOT b.is_active OR a.opening_date IS NULL OR b.opening_date IS NULL
    OR p_date IS NULL OR NOT isfinite(p_date) OR p_date>CURRENT_DATE OR p_date<p.paid_on OR p_date<a.opening_date OR p_date<b.opening_date
    OR p_fee IS NULL OR p_fee<0 OR p_fee>=p.amount OR p_fee<>round(p_fee,2) OR p_fee::text IN ('NaN','Infinity','-Infinity')
    OR p_reference IS NULL OR length(btrim(p_reference))<5 THEN RAISE EXCEPTION 'Confira recebivel, banco, data, taxa e referencia da adquirente'; END IF;
  IF EXISTS (SELECT 1 FROM public.card_settlements WHERE payment_id=p.id AND reversed_at IS NULL) THEN RAISE EXCEPTION 'Recebimento ja liquidado'; END IF;
  INSERT INTO public.account_transfers(id,from_account_id,to_account_id,amount,date,description,responsible)
    VALUES(p_id,a.id,b.id,p.amount,p_date,'Liquidacao de cartao: '||btrim(p_reference),auth.uid());
  IF p_fee>0 THEN
    fee_title:=gen_random_uuid(); fee_payment:=gen_random_uuid();
    PERFORM public.create_financial_title(fee_title,'despesa',p_fee,p_date,'Taxa de cartao: '||btrim(p_reference),NULL,'Adquirente','Taxas de cartao',p_date,t.company_id);
    PERFORM public.classify_financial_title(fee_title,p_date,'financial_expense','operating','Taxa confirmada na liquidacao de cartao');
    PERFORM public.record_financial_payment(fee_payment,fee_title,p_fee,p_date,'transferencia',b.id,'Adquirente');
  END IF;
  INSERT INTO public.card_settlements(id,payment_id,transfer_id,fee_title_id,fee_payment_id,fee,reference,created_by)
    VALUES(p_id,p.id,p_id,fee_title,fee_payment,p_fee,btrim(p_reference),auth.uid());
  RETURN p_id;
END $$;

-- A reversed system-generated fee can be cancelled without deleting its reversed payment.
CREATE OR REPLACE FUNCTION public.guard_financial_title()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE paid numeric; has_history boolean; reversed_fee boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.transaction_payments WHERE transaction_id=OLD.id) THEN RAISE EXCEPTION 'Titulo com historico financeiro nao pode ser excluido'; END IF;
    RETURN OLD;
  END IF;
  SELECT COALESCE(sum(amount) FILTER (WHERE reversed_at IS NULL),0),count(*)>0 INTO paid,has_history FROM public.transaction_payments WHERE transaction_id=NEW.id;
  reversed_fee:=paid=0 AND EXISTS (SELECT 1 FROM public.card_settlements WHERE fee_title_id=NEW.id AND reversed_at IS NOT NULL);
  IF TG_OP='UPDATE' AND has_history AND (
    ROW(NEW.amount,NEW.type,NEW.patient_id,NEW.company_id,NEW.treatment_id,NEW.installment_id,NEW.deleted_at)
      IS DISTINCT FROM ROW(OLD.amount,OLD.type,OLD.patient_id,OLD.company_id,OLD.treatment_id,OLD.installment_id,OLD.deleted_at)
    OR (NEW.status='cancelado' AND NOT reversed_fee)) THEN RAISE EXCEPTION 'Preserve o titulo e seu historico; pagamentos exigem fluxo de devolucao'; END IF;
  IF NEW.type IN ('receita','despesa','income','expense') AND (
    (NEW.status IN ('pago','concluido','completed') AND paid<>NEW.amount) OR paid>NEW.amount) THEN RAISE EXCEPTION 'Registre a baixa no financeiro; status nao substitui pagamento'; END IF;
  NEW.paid_amount:=paid;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.reverse_financial_card(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.card_settlements%ROWTYPE; company uuid;
BEGIN
  SELECT * INTO c FROM public.card_settlements WHERE id=p_id FOR UPDATE;
  SELECT t.company_id INTO company FROM public.transactions t JOIN public.transaction_payments p ON p.transaction_id=t.id WHERE p.id=c.payment_id;
  IF c.id IS NULL OR NOT public.finance_allowed(company,'accounts') THEN RAISE EXCEPTION 'Sem permissao para corrigir liquidacao'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Justificativa obrigatoria'; END IF;
  IF c.reversed_at IS NOT NULL THEN
    IF c.reversal_reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Liquidacao ja corrigida com outro motivo'; END IF;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_reconciliations WHERE source_kind='card' AND source_id=c.id AND reversed_at IS NULL) THEN RAISE EXCEPTION 'Desfaca a conciliacao antes de corrigir a liquidacao'; END IF;
  UPDATE public.card_settlements SET reversed_at=now(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason) WHERE id=c.id;
  IF c.fee_payment_id IS NOT NULL THEN
    PERFORM public.reverse_financial_payment(c.fee_payment_id,p_reason);
    UPDATE public.transactions SET status='cancelado' WHERE id=c.fee_title_id;
  END IF;
  PERFORM public.reverse_account_transfer(c.transfer_id,p_reason);
END $$;

CREATE OR REPLACE FUNCTION public.approve_financial_commission(p_id uuid,p_payment uuid,p_doctor uuid,p_percent numeric,p_due date,p_competence date,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.transaction_payments%ROWTYPE; t public.transactions%ROWTYPE; d public.doctors%ROWTYPE;
  previous public.commission_allocations%ROWTYPE; payable public.transactions%ROWTYPE; amount numeric; allocated numeric;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatorio'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO p FROM public.transaction_payments WHERE id=p_payment FOR UPDATE;
  SELECT * INTO t FROM public.transactions WHERE id=p.transaction_id;
  IF t.id IS NULL OR NOT public.finance_allowed(t.company_id,'accounts') THEN RAISE EXCEPTION 'Sem permissao para aprovar repasse'; END IF;
  SELECT * INTO previous FROM public.commission_allocations WHERE id=p_id;
  IF FOUND THEN
    SELECT * INTO payable FROM public.transactions WHERE id=previous.title_id;
    IF ROW(previous.payment_id,previous.doctor_id,previous.percent,payable.due_date,payable.competence_date,previous.reason,previous.created_by)
      IS DISTINCT FROM ROW(p_payment,p_doctor,p_percent,p_due,p_competence,btrim(p_reason),auth.uid()) THEN RAISE EXCEPTION 'Solicitacao reutilizada com outros dados'; END IF;
    RETURN p_id;
  END IF;
  SELECT * INTO d FROM public.doctors WHERE id=p_doctor;
  IF d.id IS NULL OR NOT d.active OR (to_jsonb(d)->>'company_id')::uuid IS DISTINCT FROM t.company_id
    OR p.reversed_at IS NOT NULL OR t.type NOT IN ('receita','income') OR p_percent IS NULL OR p_percent<=0 OR p_percent>100
    OR p_percent<>round(p_percent,2) OR p_percent::text IN ('NaN','Infinity','-Infinity') OR p_due IS NULL OR NOT isfinite(p_due)
    OR p_competence IS NULL OR NOT isfinite(p_competence) OR p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Confira recebimento, profissional, percentual, datas e regra aprovada'; END IF;
  IF EXISTS (SELECT 1 FROM public.commission_allocations WHERE payment_id=p.id AND doctor_id=d.id) THEN RAISE EXCEPTION 'Ja existe repasse deste recebimento para o profissional; confira o historico'; END IF;
  amount:=round(p.amount*p_percent/100,2);
  SELECT COALESCE(sum(c.amount),0) INTO allocated FROM public.commission_allocations c JOIN public.transactions x ON x.id=c.title_id WHERE c.payment_id=p.id AND x.status<>'cancelado';
  IF amount<=0 OR amount+allocated>p.amount THEN RAISE EXCEPTION 'Repasse nulo ou superior ao valor recebido disponivel'; END IF;
  PERFORM public.create_financial_title(p_id,'despesa',amount,p_due,'Repasse aprovado: '||d.name,NULL,d.name,'Repasses profissionais',p_competence,t.company_id);
  PERFORM public.classify_financial_title(p_id,p_competence,'costs','operating',p_reason);
  INSERT INTO public.commission_payouts(id,doctor_id,period_start,period_end,total_amount,status,notes)
    VALUES(p_id,d.id,p.paid_on,p.paid_on,amount,'pendente',btrim(p_reason));
  INSERT INTO public.commission_allocations(id,payment_id,doctor_id,payout_id,title_id,percent,amount,reason,created_by)
    VALUES(p_id,p.id,d.id,p_id,p_id,p_percent,amount,btrim(p_reason),auth.uid());
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.sync_financial_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.commission_payouts SET status=CASE WHEN NEW.status='cancelado' THEN 'cancelado' WHEN NEW.paid_amount=NEW.amount THEN 'pago' ELSE 'pendente' END,
    paid_at=NEW.paid_at,updated_at=now() WHERE id IN (SELECT payout_id FROM public.commission_allocations WHERE title_id=NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_financial_commission ON public.transactions;
CREATE TRIGGER sync_financial_commission AFTER UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.sync_financial_commission();

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
    'settle_financial_card','reverse_financial_card','approve_financial_commission','sync_financial_commission') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    IF f.proname<>'sync_financial_commission' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
  END LOOP;
END $$;

COMMIT;

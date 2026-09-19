BEGIN;

-- Classification metadata must not prevent regenerating an unpaid treatment plan.
ALTER TABLE public.financial_classifications DROP CONSTRAINT IF EXISTS financial_classifications_transaction_id_fkey;
ALTER TABLE public.financial_classifications ADD CONSTRAINT financial_classifications_transaction_id_fkey
  FOREIGN KEY(transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;
ALTER TABLE public.commission_allocations ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.commission_allocations DROP CONSTRAINT IF EXISTS commission_allocations_payment_id_doctor_id_key;
DROP INDEX IF EXISTS public.commission_one_active_professional;
CREATE UNIQUE INDEX IF NOT EXISTS commission_one_active_professional ON public.commission_allocations(payment_id,doctor_id) WHERE cancelled_at IS NULL;

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
  IF COALESCE((to_jsonb(t)->>'commission_amount')::numeric,0)>0 OR to_jsonb(t)->>'commission_payout_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Titulo tem apuracao de repasse legada; concilie antes de aprovar novos repasses'; END IF;
  IF EXISTS (SELECT 1 FROM public.commission_allocations WHERE payment_id=p.id AND doctor_id=d.id AND cancelled_at IS NULL) THEN RAISE EXCEPTION 'Ja existe repasse ativo deste recebimento para o profissional'; END IF;
  amount:=round(p.amount*p_percent/100,2);
  SELECT COALESCE(sum(c.amount),0) INTO allocated FROM public.commission_allocations c WHERE c.payment_id=p.id AND c.cancelled_at IS NULL;
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
  IF NEW.status='cancelado' THEN
    UPDATE public.commission_allocations SET cancelled_at=now() WHERE title_id=NEW.id AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_card_receivable_direction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.payment_method IN ('cartao_credito','cartao_debito') AND EXISTS (
    SELECT 1 FROM public.transactions WHERE id=NEW.transaction_id AND type IN ('despesa','expense')
  ) THEN RAISE EXCEPTION 'Recebiveis de cartao nao representam faturas a pagar; registre a saida bancaria efetiva da despesa'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_card_receivable_direction ON public.transaction_payments;
CREATE TRIGGER guard_card_receivable_direction BEFORE INSERT ON public.transaction_payments FOR EACH ROW EXECUTE FUNCTION public.guard_card_receivable_direction();

REVOKE ALL ON FUNCTION public.guard_card_receivable_direction() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_financial_commission() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_financial_commission(uuid,uuid,uuid,numeric,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_financial_commission(uuid,uuid,uuid,numeric,date,date,text) TO authenticated;

COMMIT;

-- Homologation only, after all 20260919 migrations; run with ON_ERROR_STOP.
BEGIN;
DO $$
DECLARE actor uuid:=gen_random_uuid(); doctor uuid:=gen_random_uuid(); bank uuid:=gen_random_uuid();
  cards uuid:=gen_random_uuid(); source uuid:=gen_random_uuid(); payment uuid:=gen_random_uuid();
  expense uuid:=gen_random_uuid(); first_payout uuid:=gen_random_uuid(); second_payout uuid:=gen_random_uuid();
  denied boolean;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@example.invalid');
  INSERT INTO public.doctors(id,auth_id,name,email,role,active)
    VALUES(doctor,actor,'Guard fixture',actor::text||'@example.invalid','admin',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  PERFORM public.create_financial_account(bank,'Guard bank','corrente');
  PERFORM public.create_financial_account(cards,'Guard cards','corrente');
  PERFORM public.confirm_financial_opening(bank,0,CURRENT_DATE,'available','Bank opening fixture');
  PERFORM public.confirm_financial_opening(cards,0,CURRENT_DATE,'receivable','Cards opening fixture');
  PERFORM public.create_financial_title(source,'receita',100,CURRENT_DATE,'Guard revenue fixture');
  PERFORM public.record_financial_payment(payment,source,100,CURRENT_DATE,'pix',bank);
  PERFORM public.approve_financial_commission(first_payout,payment,doctor,20,CURRENT_DATE,CURRENT_DATE,'First contract approval');
  PERFORM public.cancel_financial_title(first_payout,'Wrong contractual percentage');
  IF (SELECT cancelled_at FROM public.commission_allocations WHERE id=first_payout) IS NULL THEN RAISE EXCEPTION 'Cancellation not reflected in allocation'; END IF;
  PERFORM public.approve_financial_commission(second_payout,payment,doctor,25,CURRENT_DATE,CURRENT_DATE,'Corrected contract approval');
  IF (SELECT count(*) FROM public.commission_allocations WHERE payment_id=payment)<>2 THEN RAISE EXCEPTION 'Correction erased allocation history'; END IF;
  IF (SELECT sum(amount) FROM public.commission_allocations WHERE payment_id=payment AND cancelled_at IS NULL)<>25 THEN RAISE EXCEPTION 'Cancelled allocation still consumes receipt'; END IF;
  PERFORM public.record_financial_payment(gen_random_uuid(),second_payout,10,CURRENT_DATE,'pix',bank);
  IF (SELECT status FROM public.commission_payouts WHERE id=second_payout)<>'pendente' THEN RAISE EXCEPTION 'Partial commission marked paid'; END IF;
  PERFORM public.record_financial_payment(gen_random_uuid(),second_payout,15,CURRENT_DATE,'pix',bank);
  IF (SELECT status FROM public.commission_payouts WHERE id=second_payout)<>'pago' THEN RAISE EXCEPTION 'Commission payout not synchronized'; END IF;
  PERFORM public.create_financial_title(expense,'despesa',10,CURRENT_DATE,'Card expense fixture');
  denied:=false;
  BEGIN PERFORM public.record_financial_payment(gen_random_uuid(),expense,10,CURRENT_DATE,'cartao_credito',cards);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Corporate card expense contaminated receivables'; END IF;
  IF (SELECT paid_amount FROM public.transactions WHERE id=expense)<>0 THEN RAISE EXCEPTION 'Rejected card expense modified title'; END IF;
END $$;
ROLLBACK;

-- Homologation only, after 20260920220000. Use ON_ERROR_STOP.
BEGIN;
DO $$
DECLARE
  actor uuid:=gen_random_uuid(); doctor uuid:=gen_random_uuid();
  account uuid:=gen_random_uuid(); shift uuid:=gen_random_uuid(); title uuid:=gen_random_uuid();
  payment uuid:=gen_random_uuid(); denied boolean;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@example.invalid');
  INSERT INTO public.doctors(id,auth_id,name,email,role,active)
    VALUES(doctor,actor,'Simplified cash fixture',actor::text||'@example.invalid','admin',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  PERFORM public.create_financial_account(account,'Simplified cash fixture','caixa');
  PERFORM public.confirm_financial_opening(account,50,CURRENT_DATE-1,'available','Confirmed fixture opening');
  PERFORM public.open_financial_shift(shift,account,50,'Confirmed fixture shift');
  denied:=false;
  BEGIN PERFORM public.retire_financial_shift_control(account,-1,'Invalid negative physical count');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied OR (SELECT closed_at IS NOT NULL FROM public.cash_register_sessions WHERE id=shift)
    OR NOT (SELECT shift_control FROM public.financial_accounts WHERE id=account) THEN
    RAISE EXCEPTION 'Invalid retirement changed the account or shift';
  END IF;
  PERFORM public.retire_financial_shift_control(account,49,'Retiring legacy daily control');
  IF (SELECT shift_control FROM public.financial_accounts WHERE id=account) THEN RAISE EXCEPTION 'Shift control not retired'; END IF;
  IF (SELECT difference FROM public.cash_register_sessions WHERE id=shift) <> -1 THEN RAISE EXCEPTION 'Physical difference lost'; END IF;
  PERFORM public.retire_financial_shift_control(account,49,'Retiring legacy daily control');
  IF (SELECT count(*) FROM public.financial_audit_log WHERE entity_id=account AND action='retire_shift_control') <> 1 THEN RAISE EXCEPTION 'Retirement audit duplicated or absent'; END IF;
  IF EXISTS (SELECT 1 FROM public.transaction_payments WHERE account_id=account) THEN RAISE EXCEPTION 'Physical count created a cash movement'; END IF;
  PERFORM public.create_financial_title(title,'receita',100,CURRENT_DATE,'Cash without daily shift');
  PERFORM public.record_financial_payment(payment,title,20,CURRENT_DATE,'dinheiro',account);
  IF (SELECT cash_session_id FROM public.transaction_payments WHERE id=payment) IS NOT NULL THEN RAISE EXCEPTION 'New payment linked to retired shift'; END IF;
  IF (SELECT paid_amount FROM public.transactions WHERE id=title) <> 20 THEN RAISE EXCEPTION 'Payment did not reduce debt'; END IF;
  UPDATE public.doctors SET role='recepcionista' WHERE id=doctor;
  DELETE FROM public.user_roles WHERE user_id=actor;
  denied:=false;
  BEGIN PERFORM public.retire_financial_shift_control(account,0,'Unauthorized retirement attempt');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Reception retired cash control'; END IF;
  IF has_function_privilege('anon','public.retire_financial_shift_control(uuid,numeric,text)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous retirement privilege'; END IF;
END $$;
ROLLBACK;

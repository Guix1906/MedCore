-- Run only in a disposable/homologation database after the financial migration.
-- Fixtures are rolled back. Two-session concurrency still requires a separate integration run.
BEGIN;
DO $$
<<financial_settlements>>
DECLARE
  user_id uuid := gen_random_uuid();
  doctor_id uuid := gen_random_uuid();
  account_id uuid := gen_random_uuid();
  title_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  patient_id uuid := gen_random_uuid();
  plan_id uuid := gen_random_uuid();
  plan_tx uuid;
  denied boolean;
  paid numeric;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(user_id,user_id::text||'@example.invalid');
  INSERT INTO public.doctors(id,auth_id,name,email,role,active)
    VALUES(doctor_id,user_id,'Finance fixture',user_id::text||'@example.invalid','admin',true)
    ON CONFLICT (email) DO UPDATE SET role='admin',active=true,auth_id=user_id;
  PERFORM set_config('request.jwt.claim.sub',user_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true);
  PERFORM public.create_financial_account(account_id,'Fixture account','caixa',NULL);
  PERFORM public.create_financial_title(title_id,'receita',600,CURRENT_DATE,'Fixture title');
  PERFORM public.record_financial_payment(first_id,title_id,200,CURRENT_DATE,'pix',account_id,'Fixture payer');
  PERFORM public.record_financial_payment(first_id,title_id,200,CURRENT_DATE,'pix',account_id,'Fixture payer');
  IF (SELECT count(*) FROM public.transaction_payments WHERE transaction_id=title_id)<>1 THEN RAISE EXCEPTION 'Duplicate request created two payments'; END IF;
  PERFORM public.record_financial_payment(second_id,title_id,100,CURRENT_DATE,'dinheiro',account_id,'Fixture payer');
  SELECT paid_amount INTO paid FROM public.transactions WHERE id=title_id;
  IF paid<>300 THEN RAISE EXCEPTION 'Expected paid 300, got %',paid; END IF;

  denied:=false;
  BEGIN PERFORM public.record_financial_payment(gen_random_uuid(),title_id,300.01,CURRENT_DATE,'pix',account_id);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Overpayment accepted'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_financial_payment(first_id,title_id,201,CURRENT_DATE,'pix',account_id,'Fixture payer');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Changed retry accepted'; END IF;
  denied:=false;
  BEGIN UPDATE public.transactions SET amount=700 WHERE id=title_id;
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Historical amount was editable'; END IF;
  denied:=false;
  BEGIN DELETE FROM public.transactions WHERE id=title_id;
  EXCEPTION WHEN raise_exception OR foreign_key_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Historical title was deleted'; END IF;

  PERFORM public.reverse_financial_payment(first_id,'Fixture correction');
  PERFORM public.reverse_financial_payment(first_id,'Fixture correction');
  IF (SELECT paid_amount FROM public.transactions WHERE id=title_id)<>100 THEN RAISE EXCEPTION 'Reversal not reflected'; END IF;
  IF (SELECT count(*) FROM public.transaction_payments WHERE transaction_id=title_id)<>2 THEN RAISE EXCEPTION 'Reversal erased history'; END IF;
  PERFORM public.record_financial_payment(gen_random_uuid(),title_id,500,CURRENT_DATE,'pix',account_id);
  IF (SELECT status FROM public.transactions WHERE id=title_id)<>'pago' THEN RAISE EXCEPTION 'Full payment not reflected'; END IF;

  INSERT INTO public.patients(id,name) VALUES(patient_id,'Fixture patient');
  INSERT INTO public.treatments(id,patient_id,title,total_value) VALUES(plan_id,patient_id,'Fixture plan',100);
  PERFORM public.configure_treatment_payment(plan_id,100,0,0,'parcelado',NULL,'pix',3,NULL,CURRENT_DATE);
  IF (SELECT sum(amount) FROM public.treatment_installments WHERE treatment_id=plan_id)<>100 THEN RAISE EXCEPTION 'Installments do not close in cents'; END IF;
  SELECT id INTO plan_tx FROM public.transactions WHERE treatment_id=plan_id ORDER BY due_date,id LIMIT 1;
  PERFORM public.record_financial_payment(gen_random_uuid(),plan_tx,10,CURRENT_DATE,'pix',account_id);
  denied:=false;
  BEGIN PERFORM public.configure_treatment_payment(plan_id,100,0,0,'parcelado',NULL,'pix',3,NULL,CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Partial payment history was regenerated'; END IF;

  -- Legacy reception can receive but cannot pay expenses or reverse payments.
  UPDATE public.doctors SET role='recepcionista' WHERE auth_id=user_id;
  DELETE FROM public.user_roles WHERE user_roles.user_id=financial_settlements.user_id;
  IF NOT public.finance_allowed(NULL,'receive') OR public.finance_allowed(NULL,'pay') OR public.finance_allowed(NULL,'reverse') THEN
    RAISE EXCEPTION 'Reception permission matrix is incorrect';
  END IF;
  denied:=false;
  BEGIN PERFORM public.reverse_financial_payment(second_id,'Unauthorized correction');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Reception reversed a payment'; END IF;
  denied:=false;
  BEGIN PERFORM public.create_financial_title(gen_random_uuid(),'despesa',10,CURRENT_DATE,'Unauthorized expense');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Reception created a payable'; END IF;
  IF public.finance_allowed(gen_random_uuid(),'view') THEN RAISE EXCEPTION 'Foreign company access granted'; END IF;
  IF has_table_privilege('authenticated','public.transactions','UPDATE')
    OR has_table_privilege('authenticated','public.transaction_payments','INSERT') THEN
    RAISE EXCEPTION 'Direct writes bypass the financial procedures';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  IF public.finance_allowed(NULL,'view') THEN RAISE EXCEPTION 'Anonymous access granted'; END IF;
END;
$$;
ROLLBACK;

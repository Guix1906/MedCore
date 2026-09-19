-- Homologation only, after all three 20260919 migrations. No production data is retained.
-- Run with ON_ERROR_STOP. Concurrent transfer retries require two separate sessions.
BEGIN;
DO $$
<<cash_flow_fixture>>
DECLARE
  actor uuid := gen_random_uuid();
  cash uuid := gen_random_uuid();
  bank uuid := gen_random_uuid();
  cards uuid := gen_random_uuid();
  pending uuid := gen_random_uuid();
  transfer_id uuid := gen_random_uuid();
  title_id uuid := gen_random_uuid();
  denied boolean;
  snapshot jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@example.invalid');
  INSERT INTO public.doctors(id,auth_id,name,email,role,active)
    VALUES(gen_random_uuid(),actor,'Cash flow fixture',actor::text||'@example.invalid','admin',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  PERFORM public.create_financial_account(cash,'Cash fixture','caixa');
  PERFORM public.create_financial_account(bank,'Bank fixture','corrente');
  PERFORM public.create_financial_account(cards,'Cards fixture','corrente');
  PERFORM public.create_financial_account(pending,'Pending fixture','corrente');
  PERFORM public.confirm_financial_opening(cash,100,CURRENT_DATE-10,'available','Opening cash fixture');
  PERFORM public.confirm_financial_opening(cash,100,CURRENT_DATE-10,'available','Opening cash fixture');
  PERFORM public.confirm_financial_opening(bank,500,CURRENT_DATE-10,'available','Opening bank fixture');
  PERFORM public.confirm_financial_opening(cards,0,CURRENT_DATE-10,'receivable','Opening cards fixture');
  denied:=false;
  BEGIN PERFORM public.confirm_financial_opening(cash,101,CURRENT_DATE-10,'available','Opening cash fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Opening overwritten by changed retry'; END IF;
  denied:=false;
  BEGIN UPDATE public.financial_accounts SET initial_balance=1000 WHERE id=cash;
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Opening history directly overwritten'; END IF;

  PERFORM public.record_account_transfer(transfer_id,cash,bank,80,CURRENT_DATE,'Cash deposit fixture');
  PERFORM public.record_account_transfer(transfer_id,cash,bank,80,CURRENT_DATE,'Cash deposit fixture');
  IF (SELECT count(*) FROM public.account_transfers WHERE id=transfer_id)<>1 THEN RAISE EXCEPTION 'Transfer retry duplicated'; END IF;
  IF (SELECT count(*) FROM public.transactions WHERE id=transfer_id)<>0 THEN RAISE EXCEPTION 'Transfer created operational revenue'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(transfer_id,cash,bank,81,CURRENT_DATE,'Cash deposit fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Changed transfer retry accepted'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(gen_random_uuid(),cash,cash,1,CURRENT_DATE,'Self transfer fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Self transfer accepted'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(gen_random_uuid(),cash,bank,0.001,CURRENT_DATE,'Fractional fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Fractional cent accepted'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(gen_random_uuid(),cash,bank,1,CURRENT_DATE-11,'Before opening fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Transfer before opening accepted'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(gen_random_uuid(),cash,bank,1,CURRENT_DATE+1,'Future fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Future transfer accepted'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(gen_random_uuid(),cards,bank,1,CURRENT_DATE,'Card settlement fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Transfer masqueraded as card settlement'; END IF;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(gen_random_uuid(),cash,pending,1,CURRENT_DATE,'Unconfirmed fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Unconfirmed account transfer accepted'; END IF;

  PERFORM public.create_financial_title(title_id,'receita',300,CURRENT_DATE,'Cash flow title fixture');
  denied:=false;
  BEGIN PERFORM public.record_financial_payment(gen_random_uuid(),title_id,100,CURRENT_DATE,'cartao_credito',bank);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Card was treated as available cash'; END IF;
  IF (SELECT paid_amount FROM public.transactions WHERE id=title_id)<>0 THEN RAISE EXCEPTION 'Rejected card payment modified title'; END IF;
  PERFORM public.record_financial_payment(gen_random_uuid(),title_id,100,CURRENT_DATE,'cartao_credito',cards);
  PERFORM public.record_financial_payment(gen_random_uuid(),title_id,100,CURRENT_DATE,'pix',bank);
  denied:=false;
  BEGIN PERFORM public.record_financial_payment(gen_random_uuid(),title_id,100,CURRENT_DATE,'pix',cards);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Pix was treated as card receivable'; END IF;
  PERFORM public.record_financial_payment(gen_random_uuid(),title_id,50,CURRENT_DATE,'cartao_debito',pending);
  denied:=false;
  BEGIN PERFORM public.confirm_financial_opening(pending,0,CURRENT_DATE-1,'available','Mixed account fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Opening silently classified card payment as cash'; END IF;

  PERFORM public.reverse_account_transfer(transfer_id,'Incorrect fixture entry');
  PERFORM public.reverse_account_transfer(transfer_id,'Incorrect fixture entry');
  IF (SELECT reversed_at FROM public.account_transfers WHERE id=transfer_id) IS NULL THEN RAISE EXCEPTION 'Transfer correction absent'; END IF;
  IF (SELECT count(*) FROM public.account_transfers WHERE id=transfer_id)<>1 THEN RAISE EXCEPTION 'Correction erased transfer'; END IF;
  IF (SELECT count(*) FROM public.financial_audit_log WHERE entity_type='account_transfer' AND entity_id=transfer_id)<>2 THEN RAISE EXCEPTION 'Audit missing or duplicated'; END IF;
  snapshot:=public.get_cash_flow_snapshot(NULL);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'accounts') a WHERE a->>'id'=pending::text AND a->'opening_amount'='null'::jsonb) THEN
    RAISE EXCEPTION 'Unconfirmed balance was presented as official';
  END IF;
  denied:=false;
  BEGIN PERFORM public.get_cash_flow_snapshot(gen_random_uuid());
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Unauthorized company was readable'; END IF;

  UPDATE public.doctors SET role='recepcionista' WHERE auth_id=actor;
  DELETE FROM public.user_roles WHERE user_id=actor;
  denied:=false;
  BEGIN PERFORM public.record_account_transfer(gen_random_uuid(),cash,bank,1,CURRENT_DATE,'Unauthorized fixture');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Reception registered a transfer'; END IF;
  denied:=false;
  BEGIN PERFORM public.confirm_financial_opening(pending,0,CURRENT_DATE,'available','Unauthorized opening');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Reception confirmed an opening'; END IF;
  denied:=false;
  BEGIN PERFORM public.reverse_account_transfer(transfer_id,'Incorrect fixture entry');
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Unauthorized reversal retry succeeded'; END IF;
  IF has_table_privilege('authenticated','public.financial_accounts','UPDATE')
    OR has_table_privilege('authenticated','public.account_transfers','INSERT')
    OR has_table_privilege('authenticated','public.account_transfers','UPDATE')
    OR has_table_privilege('authenticated','public.account_transfers','DELETE') THEN RAISE EXCEPTION 'Direct writes bypass financial procedures'; END IF;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  denied:=false;
  BEGIN PERFORM public.get_cash_flow_snapshot(NULL);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Anonymous cash flow access'; END IF;
END $$;
ROLLBACK;

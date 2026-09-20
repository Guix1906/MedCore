BEGIN;

CREATE OR REPLACE FUNCTION public.retire_financial_shift_control(p_account uuid, p_amount numeric, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE; s public.cash_register_sessions%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(a.company_id,'accounts') OR a.type <> 'caixa' THEN
    RAISE EXCEPTION 'Sem permissao para desativar o controle desta conta';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))<5 OR p_amount IS NULL OR p_amount<0
    OR p_amount>999999999999.99 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<>round(p_amount,2) THEN
    RAISE EXCEPTION 'Informe contagem valida e justificativa';
  END IF;
  IF NOT a.shift_control THEN RETURN; END IF;
  FOR s IN SELECT * FROM public.cash_register_sessions WHERE account_id=a.id AND closed_at IS NULL ORDER BY id FOR UPDATE LOOP
    IF NOT s.managed THEN RAISE EXCEPTION 'Sessao legada sem controle estruturado: confira administrativamente antes de desativar'; END IF;
    PERFORM public.close_financial_shift(s.id,p_amount,btrim(p_reason));
  END LOOP;
  UPDATE public.financial_accounts SET shift_control=false WHERE id=a.id;
  INSERT INTO public.financial_audit_log(entity_type,entity_id,action,actor_id,old_data,new_data,reason)
    VALUES('financial_account',a.id,'retire_shift_control',auth.uid(),to_jsonb(a),
      to_jsonb(a)||jsonb_build_object('shift_control',false),btrim(p_reason));
END $$;

REVOKE ALL ON FUNCTION public.retire_financial_shift_control(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.retire_financial_shift_control(uuid,numeric,text) TO authenticated;

COMMIT;

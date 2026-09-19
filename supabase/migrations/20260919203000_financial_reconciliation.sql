BEGIN;

CREATE OR REPLACE FUNCTION public.financial_bank_entries(p_company uuid)
RETURNS TABLE(source_kind text,source_id uuid,account_id uuid,date date,amount numeric,description text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'payment',p.id,p.account_id,p.paid_on,CASE WHEN t.type IN ('receita','income') THEN p.amount ELSE -p.amount END,t.description
  FROM public.transaction_payments p JOIN public.transactions t ON t.id=p.transaction_id JOIN public.financial_accounts a ON a.id=p.account_id
  WHERE t.company_id IS NOT DISTINCT FROM p_company AND a.balance_kind='available' AND p.reversed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.card_settlements c WHERE c.fee_payment_id=p.id AND c.reversed_at IS NULL)
  UNION ALL
  SELECT 'transfer_in',x.id,x.to_account_id,x.date,x.amount,x.description FROM public.account_transfers x JOIN public.financial_accounts a ON a.id=x.to_account_id
  WHERE a.company_id IS NOT DISTINCT FROM p_company AND a.balance_kind='available' AND x.reversed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.card_settlements c WHERE c.transfer_id=x.id AND c.reversed_at IS NULL)
  UNION ALL
  SELECT 'transfer_out',x.id,x.from_account_id,x.date,-x.amount,x.description FROM public.account_transfers x JOIN public.financial_accounts a ON a.id=x.from_account_id
  WHERE a.company_id IS NOT DISTINCT FROM p_company AND a.balance_kind='available' AND x.reversed_at IS NULL
  UNION ALL
  SELECT 'card',c.id,x.to_account_id,x.date,x.amount-c.fee,'Cartao: '||c.reference FROM public.card_settlements c JOIN public.account_transfers x ON x.id=c.transfer_id
  JOIN public.financial_accounts a ON a.id=x.to_account_id WHERE a.company_id IS NOT DISTINCT FROM p_company AND c.reversed_at IS NULL;
$$;
CREATE OR REPLACE FUNCTION public.import_financial_statement(p_account uuid,p_lines jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE; item jsonb; old public.bank_statement_lines%ROWTYPE; value numeric; day date; total integer:=0;
BEGIN
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(a.company_id,'accounts') OR a.balance_kind IS DISTINCT FROM 'available' THEN RAISE EXCEPTION 'Selecione uma conta de disponibilidade autorizada'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'Extrato deve ser uma lista'; END IF;
  IF jsonb_array_length(p_lines)<1 OR jsonb_array_length(p_lines)>1000 THEN RAISE EXCEPTION 'Importe de 1 a 1000 linhas por arquivo'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    value:=(item->>'amount')::numeric; day:=(item->>'date')::date;
    IF value IS NULL OR value=0 OR abs(value)>999999999999.99 OR value::text IN ('NaN','Infinity','-Infinity') OR value<>round(value,2)
      OR day IS NULL OR NOT isfinite(day) OR day>CURRENT_DATE OR NULLIF(btrim(item->>'external_id'),'') IS NULL
      OR length(item->>'external_id')>200 OR item->>'description' IS NULL THEN RAISE EXCEPTION 'Linha do extrato invalida'; END IF;
    SELECT * INTO old FROM public.bank_statement_lines WHERE account_id=a.id AND external_id=btrim(item->>'external_id');
    IF FOUND THEN
      IF ROW(old.date,old.amount,old.description) IS DISTINCT FROM ROW(day,value,item->>'description') THEN RAISE EXCEPTION 'Identificador bancario ja importado com outros dados'; END IF;
    ELSE
      INSERT INTO public.bank_statement_lines(account_id,external_id,date,amount,description,imported_by)
        VALUES(a.id,btrim(item->>'external_id'),day,value,item->>'description',auth.uid());
      total:=total+1;
    END IF;
  END LOOP;
  RETURN total;
END $$;
CREATE OR REPLACE FUNCTION public.reconcile_financial_entry(p_id uuid,p_line uuid,p_kind text,p_source uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.bank_statement_lines%ROWTYPE; company uuid; entry record; previous public.bank_reconciliations%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatorio'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO l FROM public.bank_statement_lines WHERE id=p_line FOR UPDATE;
  SELECT company_id INTO company FROM public.financial_accounts WHERE id=l.account_id;
  IF l.id IS NULL OR NOT public.finance_allowed(company,'accounts') THEN RAISE EXCEPTION 'Sem permissao para conciliar'; END IF;
  SELECT * INTO previous FROM public.bank_reconciliations WHERE id=p_id;
  IF FOUND THEN
    IF ROW(previous.line_id,previous.source_kind,previous.source_id,previous.reason,previous.created_by)
      IS DISTINCT FROM ROW(p_line,p_kind,p_source,btrim(p_reason),auth.uid()) THEN RAISE EXCEPTION 'Solicitacao reutilizada com outros dados'; END IF;
    RETURN p_id;
  END IF;
  IF p_kind='payment' THEN PERFORM 1 FROM public.transaction_payments WHERE id=p_source FOR UPDATE;
  ELSIF p_kind IN ('transfer_in','transfer_out') THEN PERFORM 1 FROM public.account_transfers WHERE id=p_source FOR UPDATE;
  ELSIF p_kind='card' THEN PERFORM 1 FROM public.card_settlements WHERE id=p_source FOR UPDATE;
  ELSE RAISE EXCEPTION 'Origem de conciliacao invalida'; END IF;
  SELECT * INTO entry FROM public.financial_bank_entries(company) WHERE source_kind=p_kind AND source_id=p_source;
  IF NOT FOUND OR entry.account_id<>l.account_id OR entry.amount<>l.amount OR entry.date<>l.date
    OR p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Conta, data e valor devem coincidir; informe referencia de conferencia'; END IF;
  INSERT INTO public.bank_reconciliations(id,line_id,source_kind,source_id,reason,created_by)
    VALUES(p_id,l.id,p_kind,p_source,btrim(p_reason),auth.uid());
  RETURN p_id;
END $$;
CREATE OR REPLACE FUNCTION public.reverse_financial_reconciliation(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.bank_reconciliations%ROWTYPE; company uuid;
BEGIN
  SELECT * INTO r FROM public.bank_reconciliations WHERE id=p_id FOR UPDATE;
  SELECT a.company_id INTO company FROM public.financial_accounts a JOIN public.bank_statement_lines l ON l.account_id=a.id WHERE l.id=r.line_id;
  IF r.id IS NULL OR NOT public.finance_allowed(company,'accounts') THEN RAISE EXCEPTION 'Sem permissao para desfazer conciliacao'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Justificativa obrigatoria'; END IF;
  IF r.reversed_at IS NOT NULL THEN
    IF r.reversal_reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Conciliacao ja desfeita com outro motivo'; END IF;
    RETURN;
  END IF;
  UPDATE public.bank_reconciliations SET reversed_at=now(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason) WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_financial_operations(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.finance_allowed(p_company,'view') THEN RAISE EXCEPTION 'Sem permissao para consultar operacoes'; END IF;
  RETURN jsonb_build_object(
    'can_manage',public.finance_allowed(p_company,'accounts'),
    'can_receive',public.finance_allowed(p_company,'receive'),
    'user_id',auth.uid(),
    'business_date',CURRENT_DATE,
    'classifications',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.financial_classifications c JOIN public.transactions t ON t.id=c.transaction_id WHERE t.company_id IS NOT DISTINCT FROM p_company),'[]'::jsonb),
    'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('current_expected',CASE WHEN s.managed THEN public.financial_shift_expected(s.id) END) ORDER BY s.opened_at DESC)
      FROM public.cash_register_sessions s JOIN public.financial_accounts a ON a.id=s.account_id WHERE a.company_id IS NOT DISTINCT FROM p_company),'[]'::jsonb),
    'cards',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC) FROM public.card_settlements c JOIN public.transaction_payments p ON p.id=c.payment_id JOIN public.transactions t ON t.id=p.transaction_id WHERE t.company_id IS NOT DISTINCT FROM p_company),'[]'::jsonb),
    'commissions',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC) FROM public.commission_allocations c JOIN public.transactions t ON t.id=c.title_id WHERE t.company_id IS NOT DISTINCT FROM p_company),'[]'::jsonb),
    'doctors',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name)) FROM public.doctors d WHERE d.active AND (to_jsonb(d)->>'company_id')::uuid IS NOT DISTINCT FROM p_company),'[]'::jsonb),
    'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date,l.id) FROM public.bank_statement_lines l JOIN public.financial_accounts a ON a.id=l.account_id WHERE a.company_id IS NOT DISTINCT FROM p_company),'[]'::jsonb),
    'matches',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.bank_reconciliations r JOIN public.bank_statement_lines l ON l.id=r.line_id JOIN public.financial_accounts a ON a.id=l.account_id WHERE a.company_id IS NOT DISTINCT FROM p_company),'[]'::jsonb),
    'entries',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM public.financial_bank_entries(p_company) e),'[]'::jsonb)
  );
END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
    'financial_bank_entries','import_financial_statement','reconcile_financial_entry','reverse_financial_reconciliation','get_financial_operations') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    IF f.proname<>'financial_bank_entries' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
  END LOOP;
END $$;
COMMIT;

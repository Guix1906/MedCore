BEGIN;

ALTER TABLE public.cash_register_sessions ADD COLUMN IF NOT EXISTS opening_reference text;

CREATE OR REPLACE FUNCTION public.open_financial_shift(p_id uuid,p_account uuid,p_amount numeric,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE; s public.cash_register_sessions%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatorio'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(a.company_id,'receive') THEN RAISE EXCEPTION 'Sem permissao para abrir caixa'; END IF;
  SELECT * INTO s FROM public.cash_register_sessions WHERE id=p_id;
  IF FOUND THEN
    IF NOT s.managed OR ROW(s.account_id,s.opening_amount,s.opening_reference,s.opened_by) IS DISTINCT FROM ROW(p_account,p_amount,btrim(p_reason),auth.uid()) THEN RAISE EXCEPTION 'Solicitacao reutilizada com outros dados'; END IF;
    RETURN p_id;
  END IF;
  IF a.type<>'caixa' OR a.balance_kind IS DISTINCT FROM 'available' OR a.opening_date IS NULL OR NOT a.is_active
    OR p_amount IS NULL OR p_amount<0 OR p_amount>999999999999.99 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<>round(p_amount,2)
    OR p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Confira conta caixa, abertura, contagem e referencia'; END IF;
  IF NOT a.shift_control AND NOT public.finance_allowed(a.company_id,'accounts') THEN RAISE EXCEPTION 'A primeira abertura exige administrador para ativar o controle por turno'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_register_sessions WHERE account_id=a.id AND closed_at IS NULL) THEN RAISE EXCEPTION 'Ja existe turno aberto, inclusive legado; confira antes de abrir outro'; END IF;
  UPDATE public.financial_accounts SET shift_control=true WHERE id=a.id;
  INSERT INTO public.cash_register_sessions(id,account_id,company_id,business_date,managed,opened_by,opening_amount,opening_reference)
    VALUES(p_id,a.id,a.company_id,CURRENT_DATE,true,auth.uid(),p_amount,btrim(p_reason));
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.guard_shift_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE; s public.cash_register_sessions%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.financial_accounts WHERE id=NEW.account_id FOR SHARE;
  IF TG_OP='INSERT' AND a.shift_control THEN
    SELECT * INTO s FROM public.cash_register_sessions WHERE account_id=a.id AND managed AND closed_at IS NULL FOR UPDATE;
    IF s.id IS NULL OR s.opened_by<>auth.uid() OR NEW.payment_method IS DISTINCT FROM 'dinheiro' OR NEW.paid_on<>s.business_date THEN
      RAISE EXCEPTION 'Caixa controlado exige turno aberto do operador, dinheiro e data do turno; use conta bancaria para Pix'; END IF;
    NEW.cash_session_id:=s.id;
  ELSIF TG_OP='UPDATE' AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at AND OLD.cash_session_id IS NOT NULL THEN
    SELECT * INTO s FROM public.cash_register_sessions WHERE id=OLD.cash_session_id FOR UPDATE;
    IF s.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Turno fechado: nao altere o historico; registre a correcao no turno atual'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
    IF EXISTS (SELECT 1 FROM public.card_settlements WHERE (payment_id=OLD.id OR fee_payment_id=OLD.id) AND reversed_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.commission_allocations c JOIN public.transactions t ON t.id=c.title_id WHERE c.payment_id=OLD.id AND t.status<>'cancelado')
      OR EXISTS (SELECT 1 FROM public.bank_reconciliations WHERE source_kind='payment' AND source_id=OLD.id AND reversed_at IS NULL)
    THEN RAISE EXCEPTION 'Desfaca a conciliacao, liquidacao ou repasse dependente antes de estornar'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_shift_payment ON public.transaction_payments;
CREATE TRIGGER guard_shift_payment BEFORE INSERT OR UPDATE ON public.transaction_payments FOR EACH ROW EXECUTE FUNCTION public.guard_shift_payment();

CREATE OR REPLACE FUNCTION public.guard_shift_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE; s public.cash_register_sessions%ROWTYPE;
BEGIN
  FOR a IN SELECT * FROM public.financial_accounts WHERE id IN (NEW.from_account_id,NEW.to_account_id) ORDER BY id FOR SHARE LOOP
    IF TG_OP='INSERT' AND a.shift_control THEN
      SELECT * INTO s FROM public.cash_register_sessions WHERE account_id=a.id AND managed AND closed_at IS NULL FOR UPDATE;
      IF s.id IS NULL OR NEW.date<>s.business_date THEN RAISE EXCEPTION 'Sangria/suprimento exige turno aberto e data do turno'; END IF;
      IF a.id=NEW.from_account_id THEN NEW.from_session_id:=s.id; ELSE NEW.to_session_id:=s.id; END IF;
    END IF;
  END LOOP;
  IF TG_OP='UPDATE' AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
    PERFORM 1 FROM public.cash_register_sessions WHERE id IN (OLD.from_session_id,OLD.to_session_id) ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.cash_register_sessions WHERE id IN (OLD.from_session_id,OLD.to_session_id) AND closed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.card_settlements WHERE transfer_id=OLD.id AND reversed_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.bank_reconciliations WHERE source_kind IN ('transfer_in','transfer_out') AND source_id=OLD.id AND reversed_at IS NULL)
    THEN RAISE EXCEPTION 'Transferencia vinculada a turno fechado, cartao ou conciliacao; corrija a origem primeiro'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_shift_transfer ON public.account_transfers;
CREATE TRIGGER guard_shift_transfer BEFORE INSERT OR UPDATE ON public.account_transfers FOR EACH ROW EXECUTE FUNCTION public.guard_shift_transfer();

CREATE OR REPLACE FUNCTION public.financial_shift_expected(p_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT s.opening_amount
    +COALESCE((SELECT sum(CASE WHEN t.type IN ('receita','income') THEN p.amount ELSE -p.amount END)
      FROM public.transaction_payments p JOIN public.transactions t ON t.id=p.transaction_id WHERE p.cash_session_id=s.id AND p.reversed_at IS NULL),0)
    +COALESCE((SELECT sum(CASE WHEN x.to_session_id=s.id THEN x.amount ELSE 0 END)-sum(CASE WHEN x.from_session_id=s.id THEN x.amount ELSE 0 END)
      FROM public.account_transfers x WHERE (x.from_session_id=s.id OR x.to_session_id=s.id) AND x.reversed_at IS NULL),0)
  FROM public.cash_register_sessions s WHERE s.id=p_id;
$$;

CREATE OR REPLACE FUNCTION public.close_financial_shift(p_id uuid,p_amount numeric,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.cash_register_sessions%ROWTYPE; expected numeric;
BEGIN
  SELECT * INTO s FROM public.cash_register_sessions WHERE id=p_id;
  IF NOT FOUND OR NOT s.managed OR NOT public.finance_allowed(s.company_id,'receive')
    OR (s.opened_by<>auth.uid() AND NOT public.finance_allowed(s.company_id,'accounts')) THEN RAISE EXCEPTION 'Sem permissao para fechar este turno'; END IF;
  PERFORM 1 FROM public.financial_accounts WHERE id=s.account_id FOR UPDATE;
  SELECT * INTO s FROM public.cash_register_sessions WHERE id=p_id FOR UPDATE;
  IF s.closed_at IS NOT NULL THEN
    IF s.physical_amount IS DISTINCT FROM p_amount OR s.notes IS DISTINCT FROM btrim(p_reason) OR s.closed_by<>auth.uid() THEN RAISE EXCEPTION 'Turno ja fechado com outra contagem'; END IF;
    RETURN;
  END IF;
  IF p_amount IS NULL OR p_amount<0 OR p_amount>999999999999.99 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<>round(p_amount,2)
    OR p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Contagem e justificativa obrigatorias'; END IF;
  expected:=public.financial_shift_expected(p_id);
  UPDATE public.cash_register_sessions SET status='fechado',closed_at=now(),closed_by=auth.uid(),expected_amount=expected,
    physical_amount=p_amount,difference=p_amount-expected,notes=btrim(p_reason) WHERE id=p_id;
END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
    'open_financial_shift','close_financial_shift','guard_shift_payment','guard_shift_transfer','financial_shift_expected') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    IF f.proname IN ('open_financial_shift','close_financial_shift') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
  END LOOP;
END $$;

COMMIT;

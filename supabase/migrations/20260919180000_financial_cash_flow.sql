BEGIN;

-- 1. Financial Accounts Columns
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_confirmed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS opening_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS opening_reference text,
  ADD COLUMN IF NOT EXISTS balance_kind text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_accounts_balance_kind_check'
  ) THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_balance_kind_check
      CHECK (balance_kind IN ('available','receivable'));
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.financial_accounts FROM authenticated, anon;
GRANT SELECT ON public.financial_accounts TO authenticated;
GRANT ALL ON public.financial_accounts TO service_role;

-- 2. Create account_transfers table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID NOT NULL REFERENCES public.financial_accounts(id),
  to_account_id UUID NOT NULL REFERENCES public.financial_accounts(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  responsible UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES auth.users(id),
  reversal_reason TEXT
);

ALTER TABLE public.account_transfers
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE INDEX IF NOT EXISTS account_transfers_from_date ON public.account_transfers(from_account_id,date);
CREATE INDEX IF NOT EXISTS account_transfers_to_date ON public.account_transfers(to_account_id,date);

ALTER TABLE public.account_transfers ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.account_transfers FROM authenticated, anon;
GRANT SELECT ON public.account_transfers TO authenticated;
GRANT ALL ON public.account_transfers TO service_role;

-- 3. Create financial_audit_log table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.financial_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  actor_id UUID,
  old_data JSONB,
  new_data JSONB,
  diff JSONB,
  reason TEXT,
  ip TEXT,
  device TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_entity ON public.financial_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_financial_audit_created ON public.financial_audit_log(created_at DESC);
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.financial_audit_log TO authenticated;
GRANT ALL ON public.financial_audit_log TO service_role;

-- 4. Check for invalid legacy transfers before enforcing rules
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.account_transfers t
    JOIN public.financial_accounts f ON f.id=t.from_account_id
    JOIN public.financial_accounts d ON d.id=t.to_account_id
    WHERE f.company_id IS DISTINCT FROM d.company_id OR f.id=d.id
      OR t.amount::text IN ('NaN','Infinity','-Infinity') OR t.amount<=0
  ) THEN RAISE EXCEPTION 'Concilie transferencias legadas invalidas antes de aplicar esta migracao'; END IF;
END $$;

-- 5. Row Level Security Policies
DROP POLICY IF EXISTS "account_transfers_select_auth" ON public.account_transfers;
CREATE POLICY "account_transfers_select_auth" ON public.account_transfers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS transfers_finance_boundary ON public.account_transfers;
CREATE POLICY transfers_finance_boundary ON public.account_transfers AS RESTRICTIVE
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id=from_account_id AND public.finance_allowed(a.company_id,'view'))
  AND EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id=to_account_id AND public.finance_allowed(a.company_id,'view'))
);

DROP POLICY IF EXISTS "financial_audit_log_select_auth" ON public.financial_audit_log;
CREATE POLICY "financial_audit_log_select_auth" ON public.financial_audit_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "financial_audit_log_insert_auth" ON public.financial_audit_log;
CREATE POLICY "financial_audit_log_insert_auth" ON public.financial_audit_log FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS cash_audit_scope ON public.financial_audit_log;
CREATE POLICY cash_audit_scope ON public.financial_audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING (
  entity_type NOT IN ('financial_account','account_transfer')
  OR (entity_type='financial_account' AND EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id=entity_id AND public.finance_allowed(a.company_id,'view')))
  OR (entity_type='account_transfer' AND EXISTS (SELECT 1 FROM public.account_transfers t JOIN public.financial_accounts a ON a.id=t.from_account_id JOIN public.financial_accounts b ON b.id=t.to_account_id WHERE t.id=entity_id AND public.finance_allowed(a.company_id,'view') AND public.finance_allowed(b.company_id,'view')))
);

DROP POLICY IF EXISTS cash_audit_no_direct_insert ON public.financial_audit_log;
CREATE POLICY cash_audit_no_direct_insert ON public.financial_audit_log AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (entity_type NOT IN ('financial_account','account_transfer'));

-- 6. Trigger to protect financial account opening & scope changes
CREATE OR REPLACE FUNCTION public.guard_financial_account_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id AND (
    OLD.opening_date IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.transaction_payments WHERE account_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.account_transfers WHERE from_account_id=OLD.id OR to_account_id=OLD.id)
  ) THEN RAISE EXCEPTION 'Conta com historico nao pode mudar de clinica'; END IF;
  IF OLD.opening_date IS NOT NULL AND ROW(NEW.initial_balance,NEW.opening_date,NEW.balance_kind,NEW.opening_reference,NEW.opening_confirmed_by,NEW.opening_confirmed_at)
    IS DISTINCT FROM ROW(OLD.initial_balance,OLD.opening_date,OLD.balance_kind,OLD.opening_reference,OLD.opening_confirmed_by,OLD.opening_confirmed_at)
  THEN RAISE EXCEPTION 'Abertura confirmada e imutavel; correcao exige conciliacao administrativa auditada'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_financial_account_scope ON public.financial_accounts;
CREATE TRIGGER guard_financial_account_scope BEFORE UPDATE ON public.financial_accounts
FOR EACH ROW EXECUTE FUNCTION public.guard_financial_account_scope();

-- 7. confirm_financial_opening RPC
CREATE OR REPLACE FUNCTION public.confirm_financial_opening(
  p_account_id uuid,p_amount numeric,p_date date,p_kind text,p_reference text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(a.company_id,'accounts') THEN RAISE EXCEPTION 'Sem permissao para confirmar abertura'; END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR abs(p_amount)>999999999999.99 OR p_amount<>round(p_amount,2)
    OR p_date IS NULL OR p_date>CURRENT_DATE OR NOT isfinite(p_date)
    OR p_kind IS NULL OR p_kind NOT IN ('available','receivable') OR p_reference IS NULL OR length(btrim(p_reference))<5
  THEN RAISE EXCEPTION 'Informe saldo, data, natureza e referencia de conferencia validos'; END IF;
  IF a.opening_date IS NOT NULL THEN
    IF ROW(a.initial_balance,a.opening_date,a.balance_kind,a.opening_reference,a.opening_confirmed_by)
      IS DISTINCT FROM ROW(p_amount,p_date,p_kind,btrim(p_reference),auth.uid())
    THEN RAISE EXCEPTION 'Esta conta ja tem uma abertura confirmada com outros dados'; END IF;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transaction_payments p WHERE p.account_id=a.id AND p.reversed_at IS NULL AND p.paid_on>=p_date
    AND ((p.payment_method IN ('cartao_credito','cartao_debito') AND p_kind='available')
      OR (p.payment_method IS NOT NULL AND p.payment_method NOT IN ('cartao_credito','cartao_debito') AND p_kind='receivable')))
  THEN RAISE EXCEPTION 'Conta mistura caixa e recebiveis de cartao; concilie as baixas antes da abertura'; END IF;
  UPDATE public.financial_accounts SET initial_balance=p_amount,opening_date=p_date,balance_kind=p_kind,
    opening_reference=btrim(p_reference),opening_confirmed_by=auth.uid(),opening_confirmed_at=now() WHERE id=a.id;
  INSERT INTO public.financial_audit_log(entity_type,entity_id,action,actor_id,old_data,new_data,reason)
    VALUES('financial_account',a.id,'update',auth.uid(),to_jsonb(a),jsonb_build_object('initial_balance',p_amount,'opening_date',p_date,'balance_kind',p_kind),btrim(p_reference));
END $$;

-- 8. Trigger to check payment account kind
CREATE OR REPLACE FUNCTION public.guard_payment_account_kind()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE;
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO a FROM public.financial_accounts WHERE id=NEW.account_id FOR SHARE;
  IF a.id IS NOT NULL THEN
    IF a.balance_kind='available' AND NEW.payment_method IN ('cartao_credito','cartao_debito') THEN
      RAISE EXCEPTION 'Cartao exige conta de recebiveis, nao conta de dinheiro disponivel';
    END IF;
    IF a.balance_kind='receivable' AND NEW.payment_method NOT IN ('cartao_credito','cartao_debito') THEN
      RAISE EXCEPTION 'Conta de recebiveis exclusiva para cartoes';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_payment_account_kind ON public.transaction_payments;
CREATE TRIGGER guard_payment_account_kind BEFORE INSERT ON public.transaction_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_account_kind();

-- 9. record_account_transfer RPC
CREATE OR REPLACE FUNCTION public.record_account_transfer(
  p_id uuid,p_from uuid,p_to uuid,p_amount numeric,p_date date,p_description text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%ROWTYPE; b public.financial_accounts%ROWTYPE; previous public.account_transfers%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Informe a identificacao da solicitacao'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  -- Deterministic lock order serializes opposite-direction transfers and opening confirmation.
  PERFORM 1 FROM public.financial_accounts WHERE id IN (p_from,p_to) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_from;
  SELECT * INTO b FROM public.financial_accounts WHERE id=p_to;
  IF a.id IS NULL OR b.id IS NULL OR a.company_id IS DISTINCT FROM b.company_id
    OR NOT public.finance_allowed(a.company_id,'accounts') THEN RAISE EXCEPTION 'Selecione duas contas autorizadas da mesma clinica'; END IF;
  SELECT * INTO previous FROM public.account_transfers WHERE id=p_id;
  IF FOUND THEN
    IF ROW(previous.from_account_id,previous.to_account_id,previous.amount,previous.date,previous.description,previous.responsible)
      IS DISTINCT FROM ROW(p_from,p_to,p_amount,p_date,btrim(p_description),auth.uid())
    THEN RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados'; END IF;
    RETURN previous.id;
  END IF;
  IF p_from=p_to OR p_amount IS NULL OR p_amount<=0 OR p_amount>999999999999.99 OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount<>round(p_amount,2) OR p_date IS NULL OR p_date>CURRENT_DATE OR NOT isfinite(p_date)
    OR p_description IS NULL OR length(btrim(p_description))<5 THEN RAISE EXCEPTION 'Dados da transferencia invalidos'; END IF;
  IF a.opening_date IS NULL OR b.opening_date IS NULL OR p_date<a.opening_date OR p_date<b.opening_date
    OR a.balance_kind<>'available' OR b.balance_kind<>'available'
    OR NOT a.is_active OR NOT b.is_active THEN
    RAISE EXCEPTION 'Transferencias exigem contas ativas de disponibilidade com abertura confirmada anterior ou igual a data; recebiveis exigem liquidacao propria';
  END IF;
  INSERT INTO public.account_transfers(id,from_account_id,to_account_id,amount,date,description,responsible)
    VALUES(p_id,p_from,p_to,p_amount,p_date,btrim(p_description),auth.uid());
  INSERT INTO public.financial_audit_log(entity_type,entity_id,action,actor_id,new_data)
    VALUES('account_transfer',p_id,'insert',auth.uid(),jsonb_build_object('from',p_from,'to',p_to,'amount',p_amount,'date',p_date));
  RETURN p_id;
END $$;

-- 10. reverse_account_transfer RPC
CREATE OR REPLACE FUNCTION public.reverse_account_transfer(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.account_transfers%ROWTYPE; company uuid; other_company uuid;
BEGIN
  SELECT * INTO t FROM public.account_transfers WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transferencia inexistente ou sem permissao'; END IF;
  SELECT company_id INTO company FROM public.financial_accounts WHERE id=t.from_account_id;
  SELECT company_id INTO other_company FROM public.financial_accounts WHERE id=t.to_account_id;
  IF company IS DISTINCT FROM other_company OR NOT public.finance_allowed(company,'accounts') THEN RAISE EXCEPTION 'Sem permissao para corrigir transferencia'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Informe justificativa com pelo menos 5 caracteres'; END IF;
  IF t.reversed_at IS NOT NULL THEN
    IF t.reversal_reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Transferencia ja corrigida com outra justificativa'; END IF;
    RETURN;
  END IF;
  UPDATE public.account_transfers SET reversed_at=now(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason) WHERE id=p_id;
  INSERT INTO public.financial_audit_log(entity_type,entity_id,action,actor_id,old_data,new_data,reason)
    VALUES('account_transfer',p_id,'update',auth.uid(),to_jsonb(t),jsonb_build_object('reversed_at',now()),btrim(p_reason));
END $$;

-- 11. get_cash_flow_snapshot RPC
CREATE OR REPLACE FUNCTION public.get_cash_flow_snapshot(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.finance_allowed(p_company_id,'view') THEN RAISE EXCEPTION 'Sem permissao para consultar fluxo de caixa'; END IF;
  RETURN jsonb_build_object(
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'active',COALESCE((to_jsonb(a)->>'active')::boolean,(to_jsonb(a)->>'is_active')::boolean,false),'kind',a.balance_kind,
      'opening_date',a.opening_date,'opening_amount',CASE WHEN a.opening_date IS NOT NULL THEN a.initial_balance END,
      'opening_reference',a.opening_reference,'opening_confirmed_at',a.opening_confirmed_at
    ) ORDER BY a.name,a.id) FROM public.financial_accounts a WHERE a.company_id IS NOT DISTINCT FROM p_company_id),'[]'::jsonb),
    'payments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',p.id,'account_id',p.account_id,'date',p.paid_on,'amount',p.amount,
      'type',CASE WHEN t.type IN ('receita','income') THEN 'receita' ELSE 'despesa' END,
      'legacy',p.legacy,'reversed_at',p.reversed_at
    ) ORDER BY p.paid_on,p.id) FROM public.transaction_payments p JOIN public.transactions t ON t.id=p.transaction_id
      WHERE t.company_id IS NOT DISTINCT FROM p_company_id),'[]'::jsonb),
    'transfers',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date,t.id) FROM public.account_transfers t
      JOIN public.financial_accounts a ON a.id=t.from_account_id JOIN public.financial_accounts b ON b.id=t.to_account_id
      WHERE a.company_id IS NOT DISTINCT FROM p_company_id AND b.company_id IS NOT DISTINCT FROM p_company_id),'[]'::jsonb)
  );
END $$;

-- 12. get_financial_snapshot update
CREATE OR REPLACE FUNCTION public.get_financial_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH titles AS (
    SELECT t.*, p.name AS patient_name,
      public.finance_allowed(t.company_id,CASE WHEN t.type IN ('receita','income') THEN 'receive' ELSE 'pay' END) AS can_settle,
      public.finance_allowed(t.company_id,'reverse') AS can_reverse,
      public.finance_allowed(t.company_id,'cancel') AS can_cancel
    FROM public.transactions t LEFT JOIN public.patients p ON p.id=t.patient_id
    WHERE public.finance_allowed(t.company_id,'view') AND t.type IN ('receita','despesa','income','expense') AND t.deleted_at IS NULL
  ) SELECT jsonb_build_object(
    'titles',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'type',CASE WHEN type IN ('receita','income') THEN 'receita' ELSE 'despesa' END,
      'amount',amount,'paid_amount',paid_amount,'due_date',COALESCE(due_date,date),'date',date,'status',status,
      'description',description,'category',category,'patient_id',patient_id,'patient_name',patient_name,'payer_name',payer_name,
      'company_id',company_id,'treatment_id',treatment_id,'installment_id',installment_id,'competence_date',competence_date,
      'can_settle',can_settle,'can_reverse',can_reverse,'can_cancel',can_cancel
    ) ORDER BY COALESCE(due_date,date),id) FROM titles),'[]'::jsonb),
    'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.paid_on,p.id) FROM public.transaction_payments p JOIN titles t ON t.id=p.transaction_id),'[]'::jsonb),
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'type',a.type,'company_id',a.company_id,
      'balance_kind',a.balance_kind,'active',COALESCE((to_jsonb(a)->>'active')::boolean,(to_jsonb(a)->>'is_active')::boolean,false)))
      FROM public.financial_accounts a WHERE public.finance_allowed(a.company_id,'view')),'[]'::jsonb),
    'scopes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,
      'can_create',public.finance_allowed(s.id,'create'),'can_pay',public.finance_allowed(s.id,'pay'),'can_accounts',public.finance_allowed(s.id,'accounts')))
      FROM (SELECT NULL::uuid AS id,'Clinica (cadastro legado)'::text AS name UNION ALL SELECT id,name FROM public.companies) s
      WHERE public.finance_allowed(s.id,'view')),'[]'::jsonb),
    'patients',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'company_id',(to_jsonb(p)->>'company_id')::uuid) ORDER BY p.name)
      FROM public.patients p WHERE public.finance_allowed((to_jsonb(p)->>'company_id')::uuid,'view')),'[]'::jsonb)
  );
$$;

-- 13. Grants & Revokes
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('confirm_financial_opening','record_account_transfer','reverse_account_transfer','get_cash_flow_snapshot','get_financial_snapshot') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.guard_payment_account_kind() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_financial_account_scope() FROM PUBLIC,anon,authenticated;

COMMIT;

BEGIN;

-- 1. Ensure cash_register_sessions and cash_register_movements tables exist
CREATE TABLE IF NOT EXISTS public.cash_register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  opened_by UUID,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_by UUID,
  closed_at TIMESTAMPTZ,
  expected_amount NUMERIC(14,2),
  physical_amount NUMERIC(14,2),
  difference NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado','reaberto')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_register_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.cash_register_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('suprimento','sangria','ajuste')),
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT,
  responsible UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissive policies for read so RESTRICTIVE policies don't lock everyone out:
ALTER TABLE public.cash_register_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_register_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cash_register_sessions_select_auth" ON public.cash_register_sessions;
CREATE POLICY "cash_register_sessions_select_auth" ON public.cash_register_sessions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cash_register_movements_select_auth" ON public.cash_register_movements;
CREATE POLICY "cash_register_movements_select_auth" ON public.cash_register_movements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "commission_payouts_select_auth" ON public.commission_payouts;
CREATE POLICY "commission_payouts_select_auth" ON public.commission_payouts FOR SELECT TO authenticated USING (true);

-- 2. Alter existing tables
ALTER TABLE public.financial_accounts ADD COLUMN IF NOT EXISTS shift_control boolean NOT NULL DEFAULT false;
ALTER TABLE public.cash_register_sessions
  ADD COLUMN IF NOT EXISTS business_date date,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_reference text;
ALTER TABLE public.transaction_payments ADD COLUMN IF NOT EXISTS cash_session_id uuid REFERENCES public.cash_register_sessions(id);
ALTER TABLE public.account_transfers
  ADD COLUMN IF NOT EXISTS from_session_id uuid REFERENCES public.cash_register_sessions(id),
  ADD COLUMN IF NOT EXISTS to_session_id uuid REFERENCES public.cash_register_sessions(id);
CREATE UNIQUE INDEX IF NOT EXISTS cash_one_managed_open ON public.cash_register_sessions(account_id) WHERE managed AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_cash_session ON public.transaction_payments(cash_session_id);

-- 3. Operations tables
CREATE TABLE IF NOT EXISTS public.financial_classifications (
  transaction_id uuid PRIMARY KEY REFERENCES public.transactions(id) ON DELETE RESTRICT,
  dre_group text NOT NULL CHECK (dre_group IN ('revenue','deductions','costs','operating','financial_income','financial_expense','taxes','excluded')),
  dfc_group text NOT NULL CHECK (dfc_group IN ('operating','investing','financing')),
  reason text NOT NULL CHECK (length(btrim(reason))>=5),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.card_settlements (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES public.transaction_payments(id),
  transfer_id uuid NOT NULL UNIQUE REFERENCES public.account_transfers(id),
  fee_title_id uuid UNIQUE REFERENCES public.transactions(id),
  fee_payment_id uuid UNIQUE REFERENCES public.transaction_payments(id),
  fee numeric(14,2) NOT NULL CHECK (fee>=0 AND fee::text NOT IN ('NaN','Infinity','-Infinity')),
  reference text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversal_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS card_one_active_settlement ON public.card_settlements(payment_id) WHERE reversed_at IS NULL;
CREATE TABLE IF NOT EXISTS public.commission_allocations (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES public.transaction_payments(id),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  payout_id uuid NOT NULL UNIQUE REFERENCES public.commission_payouts(id),
  title_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id),
  percent numeric(5,2) NOT NULL CHECK (percent>0 AND percent<=100),
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_id,doctor_id)
);
CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
  external_id text NOT NULL CHECK (length(btrim(external_id)) BETWEEN 1 AND 200),
  date date NOT NULL CHECK (isfinite(date)),
  amount numeric(14,2) NOT NULL CHECK (amount<>0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),
  description text NOT NULL,
  imported_by uuid NOT NULL REFERENCES auth.users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,external_id)
);
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id uuid PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES public.bank_statement_lines(id),
  source_kind text NOT NULL CHECK (source_kind IN ('payment','transfer_in','transfer_out','card')),
  source_id uuid NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversal_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_line_active ON public.bank_reconciliations(line_id) WHERE reversed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_source_active ON public.bank_reconciliations(source_kind,source_id) WHERE reversed_at IS NULL;

-- 4. Permissions and RLS
REVOKE INSERT,UPDATE,DELETE ON public.cash_register_sessions,public.cash_register_movements,public.commission_payouts FROM authenticated,anon;
GRANT SELECT ON public.cash_register_sessions,public.cash_register_movements,public.commission_payouts TO authenticated;
GRANT ALL ON public.cash_register_sessions,public.cash_register_movements,public.commission_payouts TO service_role;

DROP POLICY IF EXISTS managed_sessions_boundary ON public.cash_register_sessions;
CREATE POLICY managed_sessions_boundary ON public.cash_register_sessions AS RESTRICTIVE FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id=account_id AND public.finance_allowed(a.company_id,'view'))
);
DROP POLICY IF EXISTS managed_movements_boundary ON public.cash_register_movements;
CREATE POLICY managed_movements_boundary ON public.cash_register_movements AS RESTRICTIVE FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.cash_register_sessions s JOIN public.financial_accounts a ON a.id=s.account_id WHERE s.id=session_id AND public.finance_allowed(a.company_id,'view'))
);
DROP POLICY IF EXISTS payout_boundary ON public.commission_payouts;
CREATE POLICY payout_boundary ON public.commission_payouts AS RESTRICTIVE FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.doctors d WHERE d.id=doctor_id AND public.finance_allowed((to_jsonb(d)->>'company_id')::uuid,'view'))
);
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['financial_classifications','card_settlements','commission_allocations','bank_statement_lines','bank_reconciliations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
  END LOOP;
END $$;
DROP POLICY IF EXISTS classification_read ON public.financial_classifications;
CREATE POLICY classification_read ON public.financial_classifications FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.transactions t WHERE t.id=transaction_id AND public.finance_allowed(t.company_id,'view'))
);
DROP POLICY IF EXISTS card_read ON public.card_settlements;
CREATE POLICY card_read ON public.card_settlements FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.transaction_payments p JOIN public.transactions t ON t.id=p.transaction_id WHERE p.id=payment_id AND public.finance_allowed(t.company_id,'view'))
);
DROP POLICY IF EXISTS commission_read ON public.commission_allocations;
CREATE POLICY commission_read ON public.commission_allocations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.transactions t WHERE t.id=title_id AND public.finance_allowed(t.company_id,'view'))
);
DROP POLICY IF EXISTS statement_read ON public.bank_statement_lines;
CREATE POLICY statement_read ON public.bank_statement_lines FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id=account_id AND public.finance_allowed(a.company_id,'view'))
);
DROP POLICY IF EXISTS reconciliation_read ON public.bank_reconciliations;
CREATE POLICY reconciliation_read ON public.bank_reconciliations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.bank_statement_lines l JOIN public.financial_accounts a ON a.id=l.account_id WHERE l.id=line_id AND public.finance_allowed(a.company_id,'view'))
);

-- 5. Audit triggers
CREATE OR REPLACE FUNCTION public.audit_financial_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company uuid; entity uuid;
BEGIN
  entity:=COALESCE((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(NEW)->>'transaction_id')::uuid);
  IF TG_TABLE_NAME='financial_classifications' THEN
    SELECT company_id INTO company FROM public.transactions WHERE id=NEW.transaction_id;
  ELSIF TG_TABLE_NAME='card_settlements' THEN
    SELECT t.company_id INTO company FROM public.transactions t JOIN public.transaction_payments p ON p.transaction_id=t.id WHERE p.id=NEW.payment_id;
  ELSIF TG_TABLE_NAME='commission_allocations' THEN
    SELECT company_id INTO company FROM public.transactions WHERE id=NEW.title_id;
  ELSIF TG_TABLE_NAME='bank_reconciliations' THEN
    SELECT a.company_id INTO company FROM public.financial_accounts a JOIN public.bank_statement_lines l ON l.account_id=a.id WHERE l.id=NEW.line_id;
  ELSE
    SELECT company_id INTO company FROM public.financial_accounts WHERE id=NEW.account_id;
  END IF;
  INSERT INTO public.financial_audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
  VALUES('operation:'||TG_TABLE_NAME,entity,lower(TG_OP),auth.uid(),
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW)||jsonb_build_object('company_id',company));
  RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['financial_classifications','card_settlements','commission_allocations','bank_statement_lines','bank_reconciliations','cash_register_sessions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_operation ON public.%I',tab);
    EXECUTE format('CREATE TRIGGER audit_operation AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_financial_operation()',tab);
  END LOOP;
END $$;
DROP POLICY IF EXISTS operations_audit_boundary ON public.financial_audit_log;
CREATE POLICY operations_audit_boundary ON public.financial_audit_log AS RESTRICTIVE FOR SELECT TO authenticated
USING (entity_type NOT LIKE 'operation:%' OR public.finance_allowed((new_data->>'company_id')::uuid,'view'));
DROP POLICY IF EXISTS operations_audit_insert_boundary ON public.financial_audit_log;
CREATE POLICY operations_audit_insert_boundary ON public.financial_audit_log AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (entity_type NOT LIKE 'operation:%');

-- 6. Title Classification RPC
CREATE OR REPLACE FUNCTION public.classify_financial_title(p_id uuid,p_competence date,p_dre text,p_dfc text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(t.company_id,'accounts') THEN RAISE EXCEPTION 'Sem permissao para classificar'; END IF;
  IF p_competence IS NULL OR NOT isfinite(p_competence) OR p_dre IS NULL OR p_dfc IS NULL OR p_reason IS NULL OR length(btrim(p_reason))<5
    OR p_dre NOT IN ('revenue','deductions','costs','operating','financial_income','financial_expense','taxes','excluded')
    OR p_dfc NOT IN ('operating','investing','financing') THEN RAISE EXCEPTION 'Classificacao, competencia e justificativa obrigatorias'; END IF;
  IF (t.type IN ('receita','income') AND p_dre NOT IN ('revenue','financial_income','excluded'))
    OR (t.type IN ('despesa','expense') AND p_dre IN ('revenue','financial_income')) THEN RAISE EXCEPTION 'Grupo DRE incompativel com o tipo do titulo'; END IF;
  UPDATE public.transactions SET competence_date=p_competence WHERE id=p_id;
  INSERT INTO public.financial_classifications(transaction_id,dre_group,dfc_group,reason,updated_by)
    VALUES(p_id,p_dre,p_dfc,btrim(p_reason),auth.uid())
    ON CONFLICT(transaction_id) DO UPDATE SET dre_group=EXCLUDED.dre_group,dfc_group=EXCLUDED.dfc_group,
      reason=EXCLUDED.reason,updated_by=auth.uid(),updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.audit_financial_operation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.classify_financial_title(uuid,date,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.classify_financial_title(uuid,date,text,text,text) TO authenticated;

COMMIT;

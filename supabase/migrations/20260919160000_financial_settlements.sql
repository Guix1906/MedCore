BEGIN;

-- Reuse titles and accounts. Official cash movements are separate immutable events.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.financial_accounts(id),
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS competence_date date,
  ADD COLUMN IF NOT EXISTS payer_name text,
  ADD COLUMN IF NOT EXISTS origin_key text,
  ADD COLUMN IF NOT EXISTS installment_id uuid REFERENCES public.treatment_installments(id),
  ADD COLUMN IF NOT EXISTS treatment_id uuid REFERENCES public.treatments(id);
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_origin_key_unique ON public.transactions(origin_key) WHERE origin_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finance_allowed(p_company uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND p_action IN ('view','create','receive','pay','reverse','cancel','accounts') AND (
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND (to_jsonb(r)->>'company_id')::uuid IS NOT DISTINCT FROM p_company
        AND (p_company IS NULL OR public.is_company_member(p_company))
        AND (r.role::text IN ('owner','admin','finance_admin')
          OR (r.role::text = 'finance_edit' AND p_action IN ('view','create','receive','pay'))
          OR (r.role::text = 'finance_view' AND p_action = 'view'))
    ) OR (p_company IS NULL AND EXISTS (
      SELECT 1 FROM public.doctors d WHERE d.auth_id = auth.uid() AND d.active
        AND (d.role = 'admin' OR (d.role = 'recepcionista' AND p_action IN ('view','create','receive')))
    ))
  );
$$;
REVOKE ALL ON FUNCTION public.finance_allowed(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_allowed(uuid,text) TO authenticated;

-- Older installs may contain only the reverse installment -> title link.
UPDATE public.transactions tx SET installment_id=i.id,treatment_id=i.treatment_id,due_date=i.due_date
FROM public.treatment_installments i
WHERE tx.id=(to_jsonb(i)->>'transaction_id')::uuid AND tx.installment_id IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.treatment_installments i JOIN public.transactions t ON t.installment_id=i.id
    WHERE t.amount<>i.amount OR t.treatment_id IS DISTINCT FROM i.treatment_id
      OR (i.status='pago' AND t.status NOT IN ('pago','concluido','completed'))
      OR (t.status IN ('pago','concluido','completed') AND i.status<>'pago')) THEN
    RAISE EXCEPTION 'Parcelas e titulos legados divergentes: concilie vinculos, valores e status antes da migracao';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_installment_unique ON public.transactions(installment_id) WHERE installment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.transaction_payments (
  id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),
  paid_on date NOT NULL,
  payment_method text,
  account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  payer_name text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  legacy boolean NOT NULL DEFAULT false,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversal_reason text,
  CHECK (legacy OR (account_id IS NOT NULL AND created_by IS NOT NULL AND payment_method IS NOT NULL AND payment_method IN
    ('pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia'))),
  CHECK ((reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL AND length(btrim(reversal_reason)) >= 5))
);
CREATE INDEX IF NOT EXISTS transaction_payments_title ON public.transaction_payments(transaction_id);
CREATE INDEX IF NOT EXISTS transaction_payments_date ON public.transaction_payments(paid_on) WHERE reversed_at IS NULL;
ALTER TABLE public.transaction_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_payments FROM authenticated,anon;
GRANT SELECT ON public.transaction_payments TO authenticated;
DROP POLICY IF EXISTS payments_finance_read ON public.transaction_payments;
CREATE POLICY payments_finance_read ON public.transaction_payments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id AND public.finance_allowed(t.company_id,'view'))
);

-- Do not guess partial-payment dates, accounts, or authors missing from the legacy data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.transactions WHERE COALESCE(paid_amount,0) > 0
    AND status NOT IN ('pago','concluido','completed')) THEN
    RAISE EXCEPTION 'Existem baixas parciais legadas sem historico. Concilie valores e datas antes desta migracao.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE status IN ('pago','concluido','completed')
    AND (amount <= 0 OR amount::text IN ('NaN','Infinity','-Infinity') OR (paid_amount IS NOT NULL AND paid_amount <> 0 AND paid_amount <> amount))) THEN
    RAISE EXCEPTION 'Existem titulos pagos com valores inconsistentes. Corrija antes da migracao.';
  END IF;
END $$;
INSERT INTO public.transaction_payments(id,transaction_id,amount,paid_on,payment_method,account_id,created_by,legacy)
SELECT gen_random_uuid(), id, amount, COALESCE(paid_at::date,date), payment_method, account_id, created_by, true
FROM public.transactions WHERE status IN ('pago','concluido','completed') AND type IN ('receita','despesa','income','expense');
UPDATE public.transactions t SET paid_amount = COALESCE((SELECT sum(p.amount) FROM public.transaction_payments p WHERE p.transaction_id=t.id),0)
WHERE type IN ('receita','despesa','income','expense');

CREATE OR REPLACE FUNCTION public.guard_financial_title()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE paid numeric; has_history boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.transaction_payments WHERE transaction_id=OLD.id) THEN
      RAISE EXCEPTION 'Titulo com historico financeiro nao pode ser excluido';
    END IF;
    RETURN OLD;
  END IF;
  SELECT COALESCE(sum(amount) FILTER (WHERE reversed_at IS NULL),0), count(*) > 0 INTO paid,has_history
    FROM public.transaction_payments WHERE transaction_id=NEW.id;
  IF TG_OP = 'UPDATE' AND has_history AND (
    ROW(NEW.amount,NEW.type,NEW.patient_id,NEW.company_id,NEW.treatment_id,NEW.installment_id,NEW.deleted_at)
      IS DISTINCT FROM ROW(OLD.amount,OLD.type,OLD.patient_id,OLD.company_id,OLD.treatment_id,OLD.installment_id,OLD.deleted_at)
    OR NEW.status = 'cancelado') THEN
    RAISE EXCEPTION 'Preserve o titulo e seu historico. Cancelamento com pagamentos exige fluxo de devolucao';
  END IF;
  IF NEW.type IN ('receita','despesa','income','expense') AND (
    (NEW.status IN ('pago','concluido','completed') AND paid <> NEW.amount)
    OR (paid > 0 AND paid > NEW.amount)) THEN
    RAISE EXCEPTION 'Registre a baixa no financeiro; status nao substitui pagamento';
  END IF;
  NEW.paid_amount := paid;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_financial_title ON public.transactions;
CREATE TRIGGER guard_financial_title BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_financial_title();
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM authenticated, anon;
DROP POLICY IF EXISTS transactions_finance_boundary ON public.transactions;
CREATE POLICY transactions_finance_boundary ON public.transactions AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.finance_allowed(company_id,'view'));
DROP POLICY IF EXISTS accounts_finance_boundary ON public.financial_accounts;
CREATE POLICY accounts_finance_boundary ON public.financial_accounts AS RESTRICTIVE FOR ALL TO authenticated
USING (public.finance_allowed(company_id,'view')) WITH CHECK (public.finance_allowed(company_id,'accounts'));

CREATE OR REPLACE FUNCTION public.record_financial_payment(
  p_id uuid, p_transaction_id uuid, p_amount numeric, p_paid_on date,
  p_method text, p_account_id uuid, p_payer_name text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transactions%ROWTYPE; previous public.transaction_payments%ROWTYPE; paid numeric; account public.financial_accounts%ROWTYPE;
BEGIN
  -- Serialize retries globally before locking the title; plan locks match configuration order.
  IF p_id IS NULL THEN RAISE EXCEPTION 'Informe a identificacao da solicitacao'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id;
  IF NOT FOUND OR NOT public.finance_allowed(t.company_id,CASE WHEN t.type IN ('receita','income') THEN 'receive' ELSE 'pay' END) THEN
    RAISE EXCEPTION 'Sem permissao para esta baixa';
  END IF;
  IF t.treatment_id IS NOT NULL THEN PERFORM 1 FROM public.treatments WHERE id=t.treatment_id FOR UPDATE; END IF;
  SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Titulo alterado; atualize a tela'; END IF;
  SELECT * INTO previous FROM public.transaction_payments WHERE id=p_id;
  IF FOUND THEN
    IF ROW(previous.transaction_id,previous.amount,previous.paid_on,previous.payment_method,previous.account_id,previous.payer_name,previous.created_by)
      IS DISTINCT FROM ROW(p_transaction_id,p_amount,p_paid_on,p_method,p_account_id,NULLIF(btrim(p_payer_name),''),auth.uid()) THEN
      RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados';
    END IF;
    RETURN previous.id;
  END IF;
  IF t.type NOT IN ('receita','despesa','income','expense') OR t.status NOT IN ('pendente','vencido','pending','overdue') OR t.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Titulo indisponivel para baixa';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount <> round(p_amount,2)
    OR p_paid_on IS NULL OR p_paid_on > CURRENT_DATE OR p_method IS NULL
    OR p_method NOT IN ('pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia') THEN
    RAISE EXCEPTION 'Valor, data ou forma de pagamento invalida';
  END IF;
  SELECT * INTO account FROM public.financial_accounts WHERE id=p_account_id FOR SHARE;
  IF NOT FOUND OR account.company_id IS DISTINCT FROM t.company_id
    OR NOT COALESCE((to_jsonb(account)->>'active')::boolean,(to_jsonb(account)->>'is_active')::boolean,false) THEN
    RAISE EXCEPTION 'Selecione uma conta ativa da mesma clinica';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO paid FROM public.transaction_payments WHERE transaction_id=t.id AND reversed_at IS NULL;
  IF p_amount > t.amount - paid THEN RAISE EXCEPTION 'Valor superior ao saldo em aberto'; END IF;
  INSERT INTO public.transaction_payments(id,transaction_id,amount,paid_on,payment_method,account_id,payer_name,created_by)
    VALUES(p_id,t.id,p_amount,p_paid_on,p_method,p_account_id,NULLIF(btrim(p_payer_name),''),auth.uid());
  paid := paid + p_amount;
  IF t.installment_id IS NOT NULL THEN
    UPDATE public.treatment_installments SET status=CASE WHEN paid=t.amount THEN 'pago' ELSE 'pendente' END,
      paid_date=CASE WHEN paid=t.amount THEN p_paid_on ELSE NULL END WHERE id=t.installment_id;
  END IF;
  UPDATE public.transactions SET paid_amount=paid, status=CASE WHEN paid=amount THEN 'pago' ELSE 'pendente' END,
    paid_at=CASE WHEN paid=amount THEN (SELECT max(paid_on)::timestamptz FROM public.transaction_payments WHERE transaction_id=t.id AND reversed_at IS NULL) ELSE NULL END
    WHERE id=t.id;
  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_financial_payment(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.transaction_payments%ROWTYPE; t public.transactions%ROWTYPE; paid numeric;
BEGIN
  SELECT * INTO p FROM public.transaction_payments WHERE id=p_id;
  SELECT * INTO t FROM public.transactions WHERE id=p.transaction_id;
  IF t.id IS NULL OR NOT public.finance_allowed(t.company_id,'reverse') THEN RAISE EXCEPTION 'Sem permissao para estornar'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN RAISE EXCEPTION 'Informe uma justificativa com pelo menos 5 caracteres'; END IF;
  IF t.treatment_id IS NOT NULL THEN PERFORM 1 FROM public.treatments WHERE id=t.treatment_id FOR UPDATE; END IF;
  PERFORM 1 FROM public.transactions WHERE id=t.id FOR UPDATE;
  SELECT * INTO p FROM public.transaction_payments WHERE id=p_id FOR UPDATE;
  IF p.reversed_at IS NOT NULL THEN
    IF p.reversal_reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Baixa ja estornada com outra justificativa'; END IF;
    RETURN;
  END IF;
  UPDATE public.transaction_payments SET reversed_at=now(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason) WHERE id=p_id;
  SELECT COALESCE(sum(amount),0) INTO paid FROM public.transaction_payments WHERE transaction_id=t.id AND reversed_at IS NULL;
  IF t.installment_id IS NOT NULL THEN
    UPDATE public.treatment_installments SET status='pendente',paid_date=NULL WHERE id=t.installment_id;
  END IF;
  UPDATE public.transactions SET paid_amount=paid,status='pendente',paid_at=NULL WHERE id=t.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_financial_title(
  p_id uuid,p_type text,p_amount numeric,p_due_date date,p_description text,
  p_patient_id uuid DEFAULT NULL,p_payer_name text DEFAULT NULL,p_category text DEFAULT NULL,
  p_competence_date date DEFAULT NULL,p_company_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE previous public.transactions%ROWTYPE; patient_company uuid;
BEGIN
  IF NOT public.finance_allowed(p_company_id,'create') OR
    (p_type='despesa' AND NOT public.finance_allowed(p_company_id,'pay')) THEN RAISE EXCEPTION 'Sem permissao para lancar'; END IF;
  IF p_id IS NULL OR p_type IS NULL OR p_type NOT IN ('receita','despesa') OR p_amount IS NULL OR p_amount <= 0
    OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount <> round(p_amount,2)
    OR p_due_date IS NULL OR p_description IS NULL OR length(btrim(p_description))=0 THEN RAISE EXCEPTION 'Dados do titulo invalidos'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO previous FROM public.transactions WHERE id=p_id;
  IF FOUND THEN
    IF ROW(previous.type,previous.amount,previous.due_date,previous.description,previous.patient_id,previous.payer_name,previous.category,previous.competence_date,previous.company_id,previous.created_by)
      IS DISTINCT FROM ROW(p_type,p_amount,p_due_date,btrim(p_description),p_patient_id,NULLIF(btrim(p_payer_name),''),NULLIF(btrim(p_category),''),p_competence_date,p_company_id,auth.uid()) THEN
      RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados';
    END IF;
    RETURN p_id;
  END IF;
  IF p_patient_id IS NOT NULL THEN
    SELECT (to_jsonb(p)->>'company_id')::uuid INTO patient_company FROM public.patients p WHERE p.id=p_patient_id;
    IF NOT FOUND OR patient_company IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'Paciente de outra clinica ou inexistente'; END IF;
  END IF;
  INSERT INTO public.transactions(id,type,amount,date,due_date,description,status,patient_id,payer_name,category,competence_date,company_id,created_by)
    VALUES(p_id,p_type,p_amount,p_due_date,p_due_date,btrim(p_description),'pendente',p_patient_id,NULLIF(btrim(p_payer_name),''),NULLIF(btrim(p_category),''),p_competence_date,p_company_id,auth.uid());
  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_financial_title(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(t.company_id,'cancel') THEN RAISE EXCEPTION 'Sem permissao para cancelar'; END IF;
  IF t.treatment_id IS NOT NULL THEN RAISE EXCEPTION 'Cancele o plano na origem, preservando as parcelas'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))<5 THEN RAISE EXCEPTION 'Informe a justificativa'; END IF;
  IF EXISTS (SELECT 1 FROM public.transaction_payments WHERE transaction_id=p_id) THEN RAISE EXCEPTION 'Titulo com historico nao pode ser cancelado'; END IF;
  UPDATE public.transactions SET status='cancelado',notes=concat_ws(E'\n',notes,'Cancelamento: '||btrim(p_reason)) WHERE id=p_id AND status<>'cancelado';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_financial_account(p_id uuid,p_name text,p_type text,p_company_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.financial_accounts%ROWTYPE;
BEGIN
  IF NOT public.finance_allowed(p_company_id,'accounts') THEN RAISE EXCEPTION 'Sem permissao para cadastrar contas'; END IF;
  IF p_id IS NULL OR p_name IS NULL OR length(btrim(p_name))=0 OR p_type IS NULL OR p_type NOT IN ('corrente','caixa') THEN RAISE EXCEPTION 'Conta invalida'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_id;
  IF FOUND THEN
    IF ROW(a.name,a.type,a.company_id) IS DISTINCT FROM ROW(btrim(p_name),p_type,p_company_id) THEN RAISE EXCEPTION 'Solicitacao reutilizada'; END IF;
    RETURN p_id;
  END IF;
  INSERT INTO public.financial_accounts(id,name,type,company_id) VALUES(p_id,btrim(p_name),p_type,p_company_id);
  RETURN p_id;
END;
$$;

-- Agenda uses the event as its explicit origin, not an inferred appointment foreign key.
CREATE OR REPLACE FUNCTION public.create_event_financial_title(p_event_id uuid,p_amount numeric,p_due_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.events%ROWTYPE; t public.transactions%ROWTYPE; result uuid; finance_company uuid;
BEGIN
  SELECT * INTO e FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(e.company_id,'create') THEN RAISE EXCEPTION 'Evento inexistente ou sem permissao financeira'; END IF;
  SELECT * INTO t FROM public.transactions WHERE origin_key='event:'||p_event_id;
  IF FOUND THEN
    IF ROW(t.amount,t.due_date) IS DISTINCT FROM ROW(p_amount,p_due_date) THEN RAISE EXCEPTION 'Evento ja possui cobranca com outras condicoes'; END IF;
    RETURN t.id;
  END IF;
  finance_company := e.company_id;
  IF e.patient_id IS NOT NULL THEN
    SELECT (to_jsonb(p)->>'company_id')::uuid INTO finance_company FROM public.patients p WHERE p.id=e.patient_id;
    IF NOT FOUND OR (finance_company IS NOT NULL AND finance_company<>e.company_id) THEN RAISE EXCEPTION 'Paciente do evento pertence a outra clinica'; END IF;
  END IF;
  result := public.create_financial_title(gen_random_uuid(),'receita',p_amount,p_due_date,'Cobranca de atendimento',e.patient_id,NULL,'Atendimentos',NULL,finance_company);
  UPDATE public.transactions SET origin_key='event:'||p_event_id WHERE id=result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_treatment_installment(p_id uuid,p_paid_date date,p_method text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Use o financeiro para registrar valor, conta e identificacao unica de cada recebimento';
END;
$$;

-- Even after all payments are reversed, regeneration cannot erase history.
CREATE OR REPLACE FUNCTION public.guard_financial_installment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE company uuid;
BEGIN
  SELECT (to_jsonb(t)->>'company_id')::uuid INTO company FROM public.treatments t WHERE t.id=COALESCE(NEW.treatment_id,OLD.treatment_id);
  IF auth.uid() IS NOT NULL AND NOT public.finance_allowed(company,'create') THEN RAISE EXCEPTION 'Sem permissao financeira para alterar parcelas'; END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND EXISTS (
    SELECT 1 FROM public.transaction_payments p JOIN public.transactions t ON t.id=p.transaction_id WHERE t.installment_id=OLD.id
  ) THEN
    IF TG_OP='DELETE' OR NEW.status IN ('cancelado','renegociado') OR
      ROW(NEW.amount,NEW.due_date,NEW.treatment_id,NEW.number) IS DISTINCT FROM ROW(OLD.amount,OLD.due_date,OLD.treatment_id,OLD.number) THEN
      RAISE EXCEPTION 'Plano com historico financeiro: regeneracao bloqueada';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_financial_installment ON public.treatment_installments;
CREATE TRIGGER guard_financial_installment BEFORE INSERT OR UPDATE OR DELETE ON public.treatment_installments
FOR EACH ROW EXECUTE FUNCTION public.guard_financial_installment();

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
      'active',COALESCE((to_jsonb(a)->>'active')::boolean,(to_jsonb(a)->>'is_active')::boolean,false)))
      FROM public.financial_accounts a WHERE public.finance_allowed(a.company_id,'view')),'[]'::jsonb),
    'scopes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,
      'can_create',public.finance_allowed(s.id,'create'),'can_pay',public.finance_allowed(s.id,'pay'),'can_accounts',public.finance_allowed(s.id,'accounts')))
      FROM (SELECT NULL::uuid AS id,'Clinica (cadastro legado)'::text AS name UNION ALL SELECT id,name FROM public.companies) s
      WHERE public.finance_allowed(s.id,'view')),'[]'::jsonb),
    'patients',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'company_id',(to_jsonb(p)->>'company_id')::uuid) ORDER BY p.name)
      FROM public.patients p WHERE public.finance_allowed((to_jsonb(p)->>'company_id')::uuid,'view')),'[]'::jsonb)
  );
$$;

-- New procedures are callable only by authenticated users; each checks scope and action.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('record_financial_payment','reverse_financial_payment','create_financial_title',
      'cancel_financial_title','create_financial_account','create_event_financial_title','get_financial_snapshot') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.guard_financial_title(),public.guard_financial_installment() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.configure_treatment_payment(
  p_treatment_id uuid, p_total numeric, p_discount numeric, p_down numeric,
  p_type text, p_down_method text, p_method text, p_count integer,
  p_down_due date, p_first_due date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.treatments%ROWTYPE; balance_cents bigint; each_cents bigint; remainder_cents bigint; i integer;
  methods text[] := ARRAY['pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treatments t WHERE t.id=p_treatment_id AND public.finance_allowed((to_jsonb(t)->>'company_id')::uuid,'create')) THEN RAISE EXCEPTION 'Sem permissao financeira'; END IF;
  SELECT * INTO t FROM public.treatments WHERE id = p_treatment_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.transaction_payments p JOIN public.transactions tx ON tx.id=p.transaction_id WHERE tx.treatment_id=t.id) OR EXISTS (SELECT 1 FROM public.treatment_installments WHERE treatment_id=t.id AND status='pago') THEN
    RAISE EXCEPTION 'Plano com recebimentos: preserve as parcelas pagas; nao e permitida a regeneracao';
  END IF;
  IF p_total::text IN ('NaN','Infinity','-Infinity') OR p_discount::text IN ('NaN','Infinity','-Infinity') OR p_down::text IN ('NaN','Infinity','-Infinity') OR p_total IS NULL OR p_discount IS NULL OR p_down IS NULL OR p_total <= 0 OR p_discount < 0 OR p_down < 0
     OR p_discount + p_down > p_total OR p_total <> round(p_total,2) OR p_down <> round(p_down,2) OR p_discount <> round(p_discount,2) THEN
    RAISE EXCEPTION 'Valores invalidos: confira total, desconto e entrada';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('a_vista','parcelado','financiado') OR p_count IS NULL OR p_count < 1 OR p_count > 120
     OR (p_type = 'a_vista' AND p_count <> 1) THEN RAISE EXCEPTION 'Tipo ou numero de parcelas invalido'; END IF;
  balance_cents := round((p_total - p_discount - p_down) * 100);
  IF p_down > 0 AND (p_down_method IS NULL OR NOT p_down_method = ANY(methods) OR p_down_due IS NULL) THEN RAISE EXCEPTION 'Informe forma e vencimento da entrada'; END IF;
  IF balance_cents > 0 AND (p_method IS NULL OR NOT p_method = ANY(methods) OR p_first_due IS NULL OR balance_cents < p_count) THEN
    RAISE EXCEPTION 'Informe forma, vencimento e parcelas validas para o saldo';
  END IF;
  UPDATE public.treatment_installments SET status = 'cancelado' WHERE treatment_id = t.id;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'treatment_installments' AND column_name = 'transaction_id') THEN
    EXECUTE 'UPDATE public.treatment_installments SET transaction_id = NULL WHERE treatment_id = $1 AND transaction_id IS NOT NULL' USING t.id;
  END IF;
  DELETE FROM public.transactions WHERE treatment_id = t.id AND installment_id IN
    (SELECT id FROM public.treatment_installments WHERE treatment_id = t.id);
  DELETE FROM public.treatment_installments WHERE treatment_id = t.id;
  UPDATE public.treatments SET total_value = p_total, discount = p_discount, down_payment = p_down,
    payment_type = p_type, down_payment_method = p_down_method, payment_method = p_method,
    installments_count = p_count, down_payment_due_date = p_down_due, first_due_date = p_first_due
    WHERE id = t.id;
  IF p_down > 0 THEN
    INSERT INTO public.treatment_installments(treatment_id, number, amount, due_date, payment_method)
      VALUES(t.id, 0, p_down, p_down_due, p_down_method);
  END IF;
  IF balance_cents > 0 THEN
    each_cents := balance_cents / p_count;
    remainder_cents := balance_cents % p_count;
    FOR i IN 1..p_count LOOP
      INSERT INTO public.treatment_installments(treatment_id, number, amount, due_date, payment_method)
        VALUES(t.id, i, (each_cents + CASE WHEN i <= remainder_cents THEN 1 ELSE 0 END)::numeric / 100,
          (p_first_due + make_interval(months => i - 1))::date, p_method);
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.configure_treatment_payment(uuid,numeric,numeric,numeric,text,text,text,integer,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_treatment_payment(uuid,numeric,numeric,numeric,text,text,text,integer,date,date) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_treatment_alerts()
RETURNS TABLE(id text, treatment_id uuid, patient_name text, title text, kind text, target_date date, amount numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT 'return:' || t.id || ':' || t.next_return_date, t.id, p.name, t.title, 'retorno', t.next_return_date, NULL::numeric
  FROM public.treatments t JOIN public.patients p ON p.id = t.patient_id
  WHERE public.can_access_treatment(t.id) AND t.status = 'em_andamento' AND t.next_return_date <= CURRENT_DATE + 7
  UNION ALL
  SELECT 'protocol:' || t.id || ':' || t.end_date, t.id, p.name, t.title, 'protocolo', t.end_date, NULL::numeric
  FROM public.treatments t JOIN public.patients p ON p.id = t.patient_id
  WHERE public.can_access_treatment(t.id) AND t.status IN ('em_andamento','pausado') AND t.end_date <= CURRENT_DATE + 7
  UNION ALL
  SELECT 'completed:' || t.id, t.id, p.name, t.title, 'concluido', t.end_date, NULL::numeric
  FROM public.treatments t JOIN public.patients p ON p.id = t.patient_id
  WHERE public.can_access_treatment(t.id) AND t.status = 'finalizado'
  UNION ALL
  SELECT 'payment:' || i.id, t.id, p.name, t.title, 'pagamento', i.due_date, i.amount - COALESCE((SELECT sum(pay.amount) FROM public.transaction_payments pay JOIN public.transactions tx ON tx.id=pay.transaction_id WHERE tx.installment_id=i.id AND pay.reversed_at IS NULL),0)
  FROM public.treatment_installments i JOIN public.treatments t ON t.id = i.treatment_id JOIN public.patients p ON p.id = t.patient_id
  WHERE public.finance_allowed((to_jsonb(t)->>'company_id')::uuid,'view') AND i.status IN ('pendente','atrasado') AND i.due_date <= CURRENT_DATE + 7;
$$;
REVOKE ALL ON FUNCTION public.get_treatment_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_treatment_alerts() TO authenticated;


CREATE OR REPLACE FUNCTION public.get_financial_plans()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'patient_name',p.name,'total_value',t.total_value,'discount',t.discount,
    'down_payment',t.down_payment,'payment_type',t.payment_type,'down_payment_method',t.down_payment_method,
    'payment_method',t.payment_method,'installments_count',t.installments_count,'down_payment_due_date',t.down_payment_due_date,
    'first_due_date',t.first_due_date,'can_configure',public.finance_allowed((to_jsonb(t)->>'company_id')::uuid,'create'),
    'installments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'amount',i.amount,'due_date',i.due_date,
      'payment_method',i.payment_method,'status',i.status) ORDER BY i.number) FROM public.treatment_installments i WHERE i.treatment_id=t.id),'[]'::jsonb)
  ) ORDER BY t.created_at DESC,t.id),'[]'::jsonb)
  FROM public.treatments t LEFT JOIN public.patients p ON p.id=t.patient_id
  WHERE public.finance_allowed((to_jsonb(t)->>'company_id')::uuid,'view');
$$;
REVOKE ALL ON FUNCTION public.get_financial_plans() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_financial_plans() TO authenticated;

CREATE OR REPLACE VIEW public.v_dashboard_cashflow WITH (security_invoker=on) AS
WITH rows AS (
  SELECT p.paid_on AS date,t.type,p.amount,'pago'::text AS status FROM public.transaction_payments p
    JOIN public.transactions t ON t.id=p.transaction_id WHERE p.reversed_at IS NULL AND t.deleted_at IS NULL
  UNION ALL
  SELECT COALESCE(due_date,date),type,amount-COALESCE(paid_amount,0),'pendente' FROM public.transactions
    WHERE status NOT IN ('cancelado','pago','concluido','completed') AND deleted_at IS NULL
)
SELECT date AS day,
  sum(CASE WHEN type IN ('receita','income') AND status='pago' THEN amount ELSE 0 END) AS entradas,
  sum(CASE WHEN type IN ('receita','income') AND status='pendente' THEN amount ELSE 0 END) AS entradas_prev,
  sum(CASE WHEN type IN ('despesa','expense') AND status='pago' THEN amount ELSE 0 END) AS saidas,
  sum(CASE WHEN type IN ('despesa','expense') AND status='pendente' THEN amount ELSE 0 END) AS saidas_prev
FROM rows GROUP BY date;
CREATE OR REPLACE VIEW public.v_dashboard_kpis WITH (security_invoker=on) AS
SELECT sum(entradas) AS receita_paga,sum(entradas_prev) AS receita_prevista,
  sum(saidas) AS despesa_paga,sum(saidas_prev) AS despesa_prevista,
  sum(entradas-saidas) AS saldo_atual,sum(entradas+entradas_prev-saidas-saidas_prev) AS saldo_previsto
FROM public.v_dashboard_cashflow;

CREATE OR REPLACE FUNCTION public.guard_financial_account_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id AND EXISTS (SELECT 1 FROM public.transaction_payments WHERE account_id=OLD.id) THEN
    RAISE EXCEPTION 'Conta com historico nao pode mudar de clinica';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_financial_account_scope ON public.financial_accounts;
CREATE TRIGGER guard_financial_account_scope BEFORE UPDATE ON public.financial_accounts
FOR EACH ROW EXECUTE FUNCTION public.guard_financial_account_scope();
REVOKE ALL ON FUNCTION public.guard_financial_account_scope() FROM PUBLIC,anon,authenticated;

COMMIT;

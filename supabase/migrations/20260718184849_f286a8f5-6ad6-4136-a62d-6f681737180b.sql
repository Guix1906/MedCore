
-- =========================================================
-- FASE 1: Fundação do ERP Financeiro
-- =========================================================

-- Roles / permissões
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'finance_admin', 'finance_edit', 'finance_view', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_roles readable by authenticated" ON public.user_roles;
CREATE POLICY "user_roles readable by authenticated" ON public.user_roles
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- =========================================================
-- Contas financeiras
-- =========================================================
CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('corrente','digital','carteira','caixa','cofre','pix','aplicacao')),
  bank_name TEXT,
  agency TEXT,
  account_number TEXT,
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#8B47FF',
  icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_accounts TO authenticated;
GRANT ALL ON public.financial_accounts TO service_role;
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "financial_accounts all authenticated" ON public.financial_accounts;
CREATE POLICY "financial_accounts all authenticated" ON public.financial_accounts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- Centros de custo (com hierarquia)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  parent_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  responsible_id UUID,
  color TEXT DEFAULT '#8B47FF',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON public.cost_centers(parent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_centers TO authenticated;
GRANT ALL ON public.cost_centers TO service_role;
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cost_centers all authenticated" ON public.cost_centers;
CREATE POLICY "cost_centers all authenticated" ON public.cost_centers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- Fornecedores
-- =========================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  document TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  category TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suppliers all authenticated" ON public.suppliers;
CREATE POLICY "suppliers all authenticated" ON public.suppliers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- Métodos de pagamento (configuração)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.payment_methods_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  fee_percent NUMERIC(6,3) NOT NULL DEFAULT 0,
  fee_fixed NUMERIC(10,2) NOT NULL DEFAULT 0,
  settlement_days INTEGER NOT NULL DEFAULT 0,
  allows_installments BOOLEAN NOT NULL DEFAULT false,
  max_installments INTEGER DEFAULT 1,
  brand TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  icon TEXT,
  color TEXT DEFAULT '#8B47FF',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods_config TO authenticated;
GRANT ALL ON public.payment_methods_config TO service_role;
ALTER TABLE public.payment_methods_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_methods_config all authenticated" ON public.payment_methods_config;
CREATE POLICY "payment_methods_config all authenticated" ON public.payment_methods_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed dos métodos padrão
INSERT INTO public.payment_methods_config (code, name, allows_installments, max_installments, sort_order) VALUES
  ('dinheiro','Dinheiro', false, 1, 1),
  ('pix','Pix', false, 1, 2),
  ('cartao_credito','Cartão de crédito', true, 12, 3),
  ('cartao_debito','Cartão de débito', false, 1, 4),
  ('transferencia','Transferência', false, 1, 5),
  ('boleto','Boleto', true, 12, 6),
  ('convenio','Convênio', false, 1, 7),
  ('cheque','Cheque', true, 12, 8),
  ('link_pagamento','Link de pagamento', true, 12, 9),
  ('carteira_digital','Carteira digital', false, 1, 10),
  ('crediario','Crediário', true, 24, 11)
ON CONFLICT (code) DO NOTHING;

-- =========================================================
-- Sessões de caixa
-- =========================================================
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_register_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_register_movements TO authenticated;
GRANT ALL ON public.cash_register_sessions TO service_role;
GRANT ALL ON public.cash_register_movements TO service_role;
ALTER TABLE public.cash_register_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_register_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cash_register_sessions all authenticated" ON public.cash_register_sessions;
CREATE POLICY "cash_register_sessions all authenticated" ON public.cash_register_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cash_register_movements all authenticated" ON public.cash_register_movements;
CREATE POLICY "cash_register_movements all authenticated" ON public.cash_register_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- Transferências entre contas
-- =========================================================
CREATE TABLE IF NOT EXISTS public.account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID NOT NULL REFERENCES public.financial_accounts(id),
  to_account_id UUID NOT NULL REFERENCES public.financial_accounts(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  responsible UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_transfers TO authenticated;
GRANT ALL ON public.account_transfers TO service_role;
ALTER TABLE public.account_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_transfers all authenticated" ON public.account_transfers;
CREATE POLICY "account_transfers all authenticated" ON public.account_transfers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- Anexos de transações
-- =========================================================
CREATE TABLE IF NOT EXISTS public.transaction_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  category TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transaction_attachments_tx ON public.transaction_attachments(transaction_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_attachments TO authenticated;
GRANT ALL ON public.transaction_attachments TO service_role;
ALTER TABLE public.transaction_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transaction_attachments all authenticated" ON public.transaction_attachments;
CREATE POLICY "transaction_attachments all authenticated" ON public.transaction_attachments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- Recorrências
-- =========================================================
CREATE TABLE IF NOT EXISTS public.recurring_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('receita','despesa')),
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  category TEXT,
  cost_center_id UUID REFERENCES public.cost_centers(id),
  account_id UUID REFERENCES public.financial_accounts(id),
  supplier_id UUID REFERENCES public.suppliers(id),
  patient_id UUID,
  payment_method TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('diario','semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','personalizado')),
  interval_days INTEGER,
  day_of_month INTEGER,
  start_date DATE NOT NULL,
  end_date DATE,
  next_run DATE NOT NULL,
  occurrences_limit INTEGER,
  occurrences_done INTEGER NOT NULL DEFAULT 0,
  auto_pay BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_transactions TO authenticated;
GRANT ALL ON public.recurring_transactions TO service_role;
ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recurring_transactions all authenticated" ON public.recurring_transactions;
CREATE POLICY "recurring_transactions all authenticated" ON public.recurring_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- Auditoria financeira
-- =========================================================
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
GRANT SELECT, INSERT ON public.financial_audit_log TO authenticated;
GRANT ALL ON public.financial_audit_log TO service_role;
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "financial_audit_log read authenticated" ON public.financial_audit_log;
CREATE POLICY "financial_audit_log read authenticated" ON public.financial_audit_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "financial_audit_log insert authenticated" ON public.financial_audit_log;
CREATE POLICY "financial_audit_log insert authenticated" ON public.financial_audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- =========================================================
-- Evolução de transactions (colunas novas, nada quebrado)
-- =========================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS document_number TEXT,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_id UUID REFERENCES public.recurring_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installment_number INTEGER,
  ADD COLUMN IF NOT EXISTS installment_total INTEGER,
  ADD COLUMN IF NOT EXISTS competence_date DATE,
  ADD COLUMN IF NOT EXISTS tags TEXT[];

CREATE INDEX IF NOT EXISTS idx_transactions_account ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_cost_center ON public.transactions(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_transactions_supplier ON public.transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_transactions_due_date ON public.transactions(due_date);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(type);

-- =========================================================
-- Evolução de finance_categories
-- =========================================================
ALTER TABLE public.finance_categories
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#8B47FF',
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.finance_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_type TEXT;

-- =========================================================
-- Trigger de auditoria automática em transactions
-- =========================================================
CREATE OR REPLACE FUNCTION public.audit_transactions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.financial_audit_log(entity_type, entity_id, action, actor_id, new_data)
      VALUES ('transaction', NEW.id, 'insert', v_actor, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.financial_audit_log(entity_type, entity_id, action, actor_id, old_data, new_data)
      VALUES ('transaction', NEW.id, 'update', v_actor, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.financial_audit_log(entity_type, entity_id, action, actor_id, old_data)
      VALUES ('transaction', OLD.id, 'delete', v_actor, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_transactions ON public.transactions;
CREATE TRIGGER trg_audit_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_transactions();

-- =========================================================
-- Triggers de updated_at
-- =========================================================
DROP TRIGGER IF EXISTS trg_upd_financial_accounts ON public.financial_accounts;
CREATE TRIGGER trg_upd_financial_accounts BEFORE UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_upd_cost_centers ON public.cost_centers;
CREATE TRIGGER trg_upd_cost_centers BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_upd_suppliers ON public.suppliers;
CREATE TRIGGER trg_upd_suppliers BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_upd_payment_methods_config ON public.payment_methods_config;
CREATE TRIGGER trg_upd_payment_methods_config BEFORE UPDATE ON public.payment_methods_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_upd_cash_register_sessions ON public.cash_register_sessions;
CREATE TRIGGER trg_upd_cash_register_sessions BEFORE UPDATE ON public.cash_register_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_upd_recurring_transactions ON public.recurring_transactions;
CREATE TRIGGER trg_upd_recurring_transactions BEFORE UPDATE ON public.recurring_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

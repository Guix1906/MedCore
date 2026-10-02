-- ============================================================================
-- Migração: Criação resiliente de public.recurring_transactions para Custos Fixos
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recurring_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'despesa' CHECK (type IN ('receita', 'despesa')),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'Custos Fixos',
  account_id UUID,
  payment_method TEXT DEFAULT 'boleto',
  frequency TEXT NOT NULL DEFAULT 'mensal',
  day_of_month INTEGER NOT NULL DEFAULT 10,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  next_run DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissões RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_transactions TO authenticated;
GRANT ALL ON public.recurring_transactions TO service_role;

ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recurring_transactions all authenticated" ON public.recurring_transactions;
CREATE POLICY "recurring_transactions all authenticated" ON public.recurring_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

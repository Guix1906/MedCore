-- =========================================================
-- Fase 1: Normalização de status + Views para performance
-- =========================================================

-- Adicionar status "vencido" e normalizar "concluido" → "pago"
DO $$
BEGIN
  -- Atualizar constraint para incluir pago e vencido
  ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_status_check
    CHECK (status IN ('pendente','pago','vencido','cancelado'));

  -- Migrar dados antigos: concluido → pago
  UPDATE public.transactions SET status = 'pago' WHERE status = 'concluido';
END $$;

-- =========================================================
-- View materializada para performance do Dashboard
-- =========================================================
CREATE OR REPLACE VIEW public.v_dashboard_cashflow AS
SELECT
  date_trunc('day', date)::date AS day,
  SUM(CASE WHEN type = 'receita' AND status IN ('pago') THEN amount ELSE 0 END) AS entradas,
  SUM(CASE WHEN type = 'receita' AND status IN ('pendente','vencido') THEN amount ELSE 0 END) AS entradas_prev,
  SUM(CASE WHEN type = 'despesa' AND status IN ('pago') THEN amount ELSE 0 END) AS saidas,
  SUM(CASE WHEN type = 'despesa' AND status IN ('pendente','vencido') THEN amount ELSE 0 END) AS saidas_prev
FROM public.transactions
WHERE status <> 'cancelado'
GROUP BY 1;

CREATE OR REPLACE VIEW public.v_dashboard_kpis AS
SELECT
  SUM(CASE WHEN type = 'receita' AND status = 'pago' THEN amount ELSE 0 END) AS receita_paga,
  SUM(CASE WHEN type = 'receita' AND status IN ('pendente','vencido') THEN amount ELSE 0 END) AS receita_prevista,
  SUM(CASE WHEN type = 'despesa' AND status = 'pago' THEN amount ELSE 0 END) AS despesa_paga,
  SUM(CASE WHEN type = 'despesa' AND status IN ('pendente','vencido') THEN amount ELSE 0 END) AS despesa_prevista,
  SUM(CASE WHEN type = 'receita' AND status IN ('pago') THEN amount ELSE 0 END) -
  SUM(CASE WHEN type = 'despesa' AND status IN ('pago') THEN amount ELSE 0 END) AS saldo_atual,
  SUM(CASE WHEN type = 'receita' AND status IN ('pago','pendente','vencido') THEN amount ELSE 0 END) -
  SUM(CASE WHEN type = 'despesa' AND status IN ('pago','pendente','vencido') THEN amount ELSE 0 END) AS saldo_previsto
FROM public.transactions
WHERE status <> 'cancelado';

-- Índices adicionais para performance
CREATE INDEX IF NOT EXISTS idx_transactions_date_status ON public.transactions(date, status);
CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON public.transactions(type, status);
CREATE INDEX IF NOT EXISTS idx_transactions_due_date_status ON public.transactions(due_date, status);

GRANT SELECT ON public.v_dashboard_cashflow TO authenticated;
GRANT SELECT ON public.v_dashboard_kpis TO authenticated;
GRANT ALL ON public.v_dashboard_cashflow TO service_role;
GRANT ALL ON public.v_dashboard_kpis TO service_role;

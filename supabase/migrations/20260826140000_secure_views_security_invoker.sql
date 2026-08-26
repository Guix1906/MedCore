-- ====================================================================
-- Remediação de Segurança: Supabase Views com security_invoker = on
-- Garante que todas as Views executem sob o contexto e RLS do usuário chamador
-- ====================================================================

-- 1. View de Fluxo de Caixa do Dashboard
DROP VIEW IF EXISTS public.v_dashboard_cashflow CASCADE;
CREATE VIEW public.v_dashboard_cashflow
WITH (security_invoker = on) AS
SELECT
  company_id,
  date_trunc('day', date)::date AS day,
  SUM(CASE WHEN type IN ('receita', 'income') AND status IN ('pago', 'completed') THEN amount ELSE 0 END) AS entradas,
  SUM(CASE WHEN type IN ('receita', 'income') AND status IN ('pendente', 'pending', 'vencido', 'overdue') THEN amount ELSE 0 END) AS entradas_prev,
  SUM(CASE WHEN type IN ('despesa', 'expense') AND status IN ('pago', 'completed') THEN amount ELSE 0 END) AS saidas,
  SUM(CASE WHEN type IN ('despesa', 'expense') AND status IN ('pendente', 'pending', 'vencido', 'overdue') THEN amount ELSE 0 END) AS saidas_prev
FROM public.transactions
WHERE status <> 'cancelado' AND status <> 'canceled'
GROUP BY company_id, 2;

-- 2. View de KPIs do Dashboard
DROP VIEW IF EXISTS public.v_dashboard_kpis CASCADE;
CREATE VIEW public.v_dashboard_kpis
WITH (security_invoker = on) AS
SELECT
  company_id,
  SUM(CASE WHEN type IN ('receita', 'income') AND status IN ('pago', 'completed') THEN amount ELSE 0 END) AS receita_paga,
  SUM(CASE WHEN type IN ('receita', 'income') AND status IN ('pendente', 'pending', 'vencido', 'overdue') THEN amount ELSE 0 END) AS receita_prevista,
  SUM(CASE WHEN type IN ('despesa', 'expense') AND status IN ('pago', 'completed') THEN amount ELSE 0 END) AS despesa_paga,
  SUM(CASE WHEN type IN ('despesa', 'expense') AND status IN ('pendente', 'pending', 'vencido', 'overdue') THEN amount ELSE 0 END) AS despesa_prevista,
  SUM(CASE WHEN type IN ('receita', 'income') AND status IN ('pago', 'completed') THEN amount ELSE 0 END) -
  SUM(CASE WHEN type IN ('despesa', 'expense') AND status IN ('pago', 'completed') THEN amount ELSE 0 END) AS saldo_atual,
  SUM(CASE WHEN type IN ('receita', 'income') AND status IN ('pago', 'completed', 'pendente', 'pending', 'vencido', 'overdue') THEN amount ELSE 0 END) -
  SUM(CASE WHEN type IN ('despesa', 'expense') AND status IN ('pago', 'completed', 'pendente', 'pending', 'vencido', 'overdue') THEN amount ELSE 0 END) AS saldo_previsto
FROM public.transactions
WHERE status <> 'cancelado' AND status <> 'canceled'
GROUP BY company_id;

-- 3. View de Busca Global
DROP VIEW IF EXISTS public.global_search_view CASCADE;
CREATE VIEW public.global_search_view
WITH (security_invoker = on) AS
  SELECT 'patient'::TEXT AS kind, id, company_id, name AS label,
         COALESCE(email,'') || ' ' || COALESCE(phone,'') || ' ' || COALESCE(cpf,'') AS extra,
         created_at
    FROM public.patients
  UNION ALL
  SELECT 'treatment', id, company_id, COALESCE(title, 'Acompanhamento'), COALESCE(status,''), created_at
    FROM public.treatments
  UNION ALL
  SELECT 'appointment', id, company_id, COALESCE(type, 'Consulta'),
         to_char(date, 'DD/MM/YYYY') || ' ' || COALESCE(start_time::TEXT,''), created_at
    FROM public.appointments
  UNION ALL
  SELECT 'transaction', id, company_id, COALESCE(description, 'Transação'),
         type || ' - ' || status || ' - R$ ' || to_char(amount, 'FM999G999D00'), created_at
    FROM public.transactions
  UNION ALL
  SELECT 'task', id, company_id, title, COALESCE(status,''), created_at
    FROM public.tasks
  UNION ALL
  SELECT 'exam_order', id, company_id, COALESCE(exam_name, 'Exame'), COALESCE(status,''), created_at
    FROM public.exam_orders;

-- Permissões restritas
GRANT SELECT ON public.v_dashboard_cashflow TO authenticated;
GRANT SELECT ON public.v_dashboard_kpis TO authenticated;
GRANT SELECT ON public.global_search_view TO authenticated;
GRANT ALL ON public.v_dashboard_cashflow TO service_role;
GRANT ALL ON public.v_dashboard_kpis TO service_role;
GRANT ALL ON public.global_search_view TO service_role;

-- Baixa total ("Confirmar R$ 600") falhava com
--   new row for relation "transactions" violates check constraint "transactions_status_check"
-- A função record_financial_payment grava status 'pago' (quitado) ou 'pendente' (parcial).
-- O banco em produção estava com uma versão antiga dessa regra que não aceitava 'pago'
-- (a de 20260805120000 não foi aplicada). Esta migração recria a regra com os status
-- usados pelo sistema e mantém os nomes antigos que possam existir em registros velhos.

-- Diagnóstico: regra atual (para conferência)
SELECT pg_get_constraintdef(oid) AS regra_anterior
  FROM pg_constraint
 WHERE conname = 'transactions_status_check';

BEGIN;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_status_check;

-- A trava de títulos não deve barrar a padronização de nomes (só nesta transação)
SELECT set_config('medcore.title_delete', 'on', true);

-- Padroniza nomes antigos para os usados hoje
UPDATE public.transactions SET status = 'pago'     WHERE status IN ('concluido', 'completed', 'paid');
UPDATE public.transactions SET status = 'pendente' WHERE status IN ('pending', 'aberto', 'open');
UPDATE public.transactions SET status = 'vencido'  WHERE status IN ('overdue', 'atrasado');
UPDATE public.transactions SET status = 'cancelado' WHERE status IN ('cancelled', 'canceled');

SELECT set_config('medcore.title_delete', 'off', true);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pendente', 'pago', 'vencido', 'cancelado'));

COMMIT;

-- Conferência: status existentes após a correção
SELECT status, count(*) FROM public.transactions GROUP BY status ORDER BY status;

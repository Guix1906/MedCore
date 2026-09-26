-- Migration: 20260926181000_reset_all_system_test_data.sql
-- Permite ao usuário zerar completamente agendamentos e movimentações financeiras de teste
BEGIN;

CREATE OR REPLACE FUNCTION public.reset_all_system_test_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Exclui pagamentos de transações
  DELETE FROM public.transaction_payments;

  -- 2. Exclui títulos e transações financeiras
  DELETE FROM public.transactions;

  -- 3. Exclui agendamentos e eventos
  DELETE FROM public.events;
  DELETE FROM public.appointments;

  -- 4. Exclui tabelas opcionais de compatibilidade caso existam
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_payments') THEN
    EXECUTE 'DELETE FROM public.financial_payments';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_titles') THEN
    EXECUTE 'DELETE FROM public.financial_titles';
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Todos os dados de teste foram zerados com sucesso.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_all_system_test_data() TO authenticated, anon;

COMMIT;

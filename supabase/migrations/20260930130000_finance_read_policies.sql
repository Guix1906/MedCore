-- =============================================================================
-- Migration: 20260930130000_finance_read_policies.sql
-- Politicas "USING (true)" que deixavam qualquer usuario logado (inclusive cadastro
-- pendente) ler transferencias, caixa, comissoes e a auditoria financeira, e inserir
-- linhas na auditoria. Passam a exigir permissao financeira (finance_allowed).
-- Aplicar depois de 20260930120000. Reaplicavel.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  p record;
BEGIN
  -- Remove as politicas abertas conhecidas (nomes de 20260919180000 e 20260919200000)
  FOR p IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('account_transfers', 'financial_audit_log', 'cash_register_sessions',
                               'cash_register_movements', 'commission_payouts')
             AND permissive = 'PERMISSIVE'
             AND (qual = 'true' OR with_check = 'true') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_transfers', 'cash_register_sessions', 'cash_register_movements', 'commission_payouts'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_finance', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.finance_allowed(NULL, ''view'')))',
      t || '_select_finance', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.financial_audit_log') IS NULL THEN RETURN; END IF;

  DROP POLICY IF EXISTS financial_audit_log_select_finance ON public.financial_audit_log;
  CREATE POLICY financial_audit_log_select_finance ON public.financial_audit_log
    FOR SELECT TO authenticated USING ((SELECT public.finance_allowed(NULL, 'view')));

  -- Insercao: somente quem executa operacoes financeiras (a auditoria e gerada pelas RPCs/gatilhos)
  DROP POLICY IF EXISTS financial_audit_log_insert_finance ON public.financial_audit_log;
  CREATE POLICY financial_audit_log_insert_finance ON public.financial_audit_log
    FOR INSERT TO authenticated
    WITH CHECK (
      (SELECT public.finance_allowed(NULL, 'create'))
      OR (SELECT public.finance_allowed(NULL, 'receive'))
      OR (SELECT public.finance_allowed(NULL, 'pay'))
      OR (SELECT public.finance_allowed(NULL, 'reverse'))
      OR (SELECT public.finance_allowed(NULL, 'accounts'))
    );
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferencia: deve restar apenas permission_catalog (lista publica de permissoes).
SELECT tablename, policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND (qual = 'true' OR with_check = 'true');

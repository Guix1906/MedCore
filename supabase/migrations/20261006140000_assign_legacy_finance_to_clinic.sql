-- =============================================================================
-- Migration: 20261006140000_assign_legacy_finance_to_clinic.sql
-- MedCore: dados financeiros sem clinica ("cadastro legado").
--
-- Em 06/10/2026: 39 de 49 titulos e a unica conta ativa (Banco do Brasil) estavam
-- com company_id vazio, enquanto a clinica real (Clinica Vitta) so tinha uma conta
-- inativa. Efeitos: o filtro por clinica do Fluxo de Caixa nao separava nada, o saldo
-- da clinica nao era calculado ("Baixa vinculada a conta de outra clinica") e novos
-- lancamentos abriam em "Clinica (cadastro legado)".
--
-- Atribui os registros sem clinica a clinica existente. So age quando ha EXATAMENTE
-- uma clinica cadastrada; com mais de uma, nao altera nada (decisao manual).
-- Aplicar inteiro no SQL Editor. Reaplicavel.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_company uuid;
  v_titles int := 0;
  v_accounts int := 0;
  v_recurring int := 0;
BEGIN
  IF (SELECT count(*) FROM public.companies) <> 1 THEN
    RAISE NOTICE 'Mais de uma clinica cadastrada: nada foi alterado.';
    RETURN;
  END IF;
  SELECT id INTO v_company FROM public.companies;

  -- A trava de titulos impede trocar a clinica de titulo com pagamentos; libera so aqui.
  PERFORM set_config('medcore.title_delete', 'on', true);

  -- guard_financial_account_scope bloqueia troca de clinica de conta com historico.
  -- Aqui e sem clinica -> unica clinica (nao ha outra clinica envolvida): suspende so neste UPDATE.
  ALTER TABLE public.financial_accounts DISABLE TRIGGER guard_financial_account_scope;
  UPDATE public.financial_accounts SET company_id = v_company WHERE company_id IS NULL;
  GET DIAGNOSTICS v_accounts = ROW_COUNT;
  ALTER TABLE public.financial_accounts ENABLE TRIGGER guard_financial_account_scope;

  UPDATE public.transactions SET company_id = v_company WHERE company_id IS NULL;
  GET DIAGNOSTICS v_titles = ROW_COUNT;

  IF to_regclass('public.recurring_transactions') IS NOT NULL THEN
    UPDATE public.recurring_transactions SET company_id = v_company WHERE company_id IS NULL;
    GET DIAGNOSTICS v_recurring = ROW_COUNT;
  END IF;

  PERFORM set_config('medcore.title_delete', 'off', true);

  RAISE NOTICE 'Clinica %: % conta(s), % titulo(s), % custo(s) fixo(s) atribuidos.',
    v_company, v_accounts, v_titles, v_recurring;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferencia: todas as linhas devem mostrar sem_clinica = 0.
SELECT 'transactions' AS tabela, count(*) FILTER (WHERE company_id IS NULL) AS sem_clinica, count(*) AS total FROM public.transactions
UNION ALL
SELECT 'financial_accounts', count(*) FILTER (WHERE company_id IS NULL), count(*) FROM public.financial_accounts;

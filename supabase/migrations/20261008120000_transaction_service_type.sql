-- Tipo de serviço de cada receita (aba Financeiro > Serviços). Opcional: quando vazio, o
-- sistema deduz pelo vínculo (plano, agendamento e serviço escolhido nele) e pelo texto.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS service_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_service_type_check') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_service_type_check
      CHECK (service_type IS NULL OR service_type IN
        ('consultas', 'planos', 'implantes', 'medicacoes', 'procedimentos', 'exames', 'outros'));
  END IF;
END $$;

COMMENT ON COLUMN public.transactions.service_type IS
  'Tipo de serviço da receita: consultas, planos, implantes, medicacoes, procedimentos, exames, outros';

-- Define o tipo de serviço de um lançamento, com a mesma permissão de quem cria lançamentos
CREATE OR REPLACE FUNCTION public.set_title_service_type(p_id uuid, p_service_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.transactions WHERE id = p_id;
  IF NOT FOUND OR NOT public.finance_allowed(t.company_id, 'create') THEN
    RAISE EXCEPTION 'Lancamento inexistente ou sem permissao financeira';
  END IF;
  IF p_service_type IS NOT NULL AND p_service_type NOT IN
    ('consultas', 'planos', 'implantes', 'medicacoes', 'procedimentos', 'exames', 'outros') THEN
    RAISE EXCEPTION 'Tipo de servico invalido';
  END IF;
  UPDATE public.transactions SET service_type = p_service_type WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_title_service_type(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_title_service_type(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

BEGIN;

-- ============================================================================
-- Rótulo "Saldo Livre": o app renomeava o título do saldo com UPDATE direto em
-- transactions, mas UPDATE foi revogado de authenticated em 20260919160000.
-- O erro era ignorado e o título ficava sem o rótulo/categoria "Saldo Livre".
-- Esta função faz a mesma alteração (só descrição e categoria) com checagem de
-- permissão financeira.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.label_free_balance_title(p_treatment_id uuid, p_title text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t public.transactions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF p_treatment_id IS NULL THEN RAISE EXCEPTION 'Plano obrigatorio'; END IF;

  -- Mesmo critério do app: título do plano que não é a entrada (parcela 0)
  SELECT tx.* INTO t
    FROM public.transactions tx
    LEFT JOIN public.treatment_installments i ON i.id = tx.installment_id
   WHERE tx.treatment_id = p_treatment_id
     AND COALESCE(i.number, -1) <> 0
     AND COALESCE(tx.description, '') NOT LIKE '%Entrada%'
     AND tx.status <> 'cancelado'
   ORDER BY i.number NULLS LAST, tx.due_date
   LIMIT 1
   FOR UPDATE OF tx;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT public.finance_allowed(t.company_id, 'create') THEN
    RAISE EXCEPTION 'Sem permissao financeira' USING ERRCODE = '42501';
  END IF;

  UPDATE public.transactions
     SET description = 'Acompanhamento: ' || btrim(COALESCE(p_title, '')) || ' - Saldo Livre (Sem vencimento definido)',
         category = 'Saldo Livre'
   WHERE id = t.id;
  RETURN t.id;
END;
$$;
REVOKE ALL ON FUNCTION public.label_free_balance_title(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.label_free_balance_title(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

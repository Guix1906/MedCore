BEGIN;

-- ============================================================================
-- Repactuar o saldo em aberto de um plano de tratamento em N parcelas.
-- Antes só existia para "saldo livre"; um plano parcelado com recebimentos ficava
-- travado (ex.: entrada paga + saldo de R$ 7.000 em 1 parcela não podia virar 7x).
--
-- Regras:
--  - Parcela sem nenhum pagamento -> marcada 'renegociado' (a cobrança vira cancelada).
--  - Parcela paga em parte       -> fica quitada no valor já pago; o restante entra no novo saldo.
--  - Parcela quitada             -> não é alterada.
--  - Novas parcelas: numeradas após a maior existente, vencimentos mensais.
--  As cobranças (transactions) são criadas/atualizadas pelo gatilho sync_installment_transaction.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repactuate_treatment_balance(
  p_treatment_id uuid,
  p_count integer,
  p_first_due date,
  p_method text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.treatments%ROWTYPE;
  inst record;
  v_paid numeric;
  v_balance_cents bigint := 0;
  v_each bigint;
  v_rest bigint;
  v_max integer;
  i integer;
BEGIN
  SELECT * INTO v_plan FROM public.treatments WHERE id = p_treatment_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed((to_jsonb(v_plan)->>'company_id')::uuid, 'create') THEN
    RAISE EXCEPTION 'Sem permissao financeira para este plano' USING ERRCODE = '42501';
  END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 120 THEN
    RAISE EXCEPTION 'Numero de parcelas invalido (1 a 120)';
  END IF;
  IF p_first_due IS NULL THEN
    RAISE EXCEPTION 'Informe o primeiro vencimento';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia','convenio') THEN
    RAISE EXCEPTION 'Forma de pagamento invalida';
  END IF;

  -- Libera as travas de título/parcela só nesta transação
  PERFORM set_config('medcore.title_delete', 'on', true);

  FOR inst IN
    SELECT ti.* FROM public.treatment_installments ti
     WHERE ti.treatment_id = v_plan.id
       AND ti.status NOT IN ('pago', 'cancelado', 'renegociado')
     ORDER BY ti.number
  LOOP
    SELECT COALESCE(sum(p.amount), 0) INTO v_paid
      FROM public.transaction_payments p
      JOIN public.transactions tx ON tx.id = p.transaction_id
     WHERE tx.installment_id = inst.id AND p.reversed_at IS NULL;

    IF v_paid >= inst.amount THEN
      CONTINUE; -- já quitada (status desatualizado): não mexe
    END IF;

    v_balance_cents := v_balance_cents + round((inst.amount - v_paid) * 100);

    IF v_paid > 0 THEN
      UPDATE public.treatment_installments
         SET amount = v_paid, status = 'pago', paid_date = CURRENT_DATE
       WHERE id = inst.id;
    ELSE
      UPDATE public.treatment_installments SET status = 'renegociado' WHERE id = inst.id;
    END IF;
  END LOOP;

  IF v_balance_cents <= 0 THEN
    PERFORM set_config('medcore.title_delete', 'off', true);
    RAISE EXCEPTION 'Este plano nao tem saldo em aberto para repactuar';
  END IF;
  IF v_balance_cents < p_count THEN
    PERFORM set_config('medcore.title_delete', 'off', true);
    RAISE EXCEPTION 'Saldo pequeno demais para esse numero de parcelas';
  END IF;

  SELECT COALESCE(max(number), 0) INTO v_max FROM public.treatment_installments WHERE treatment_id = v_plan.id;
  v_each := v_balance_cents / p_count;
  v_rest := v_balance_cents % p_count;

  FOR i IN 1..p_count LOOP
    INSERT INTO public.treatment_installments (treatment_id, number, amount, due_date, payment_method)
    VALUES (
      v_plan.id,
      v_max + i,
      (v_each + CASE WHEN i <= v_rest THEN 1 ELSE 0 END)::numeric / 100,
      (p_first_due + make_interval(months => i - 1))::date,
      p_method
    );
  END LOOP;

  UPDATE public.treatments
     SET payment_type = 'parcelado', payment_method = p_method, installments_count = p_count
   WHERE id = v_plan.id;

  PERFORM set_config('medcore.title_delete', 'off', true);

  RETURN jsonb_build_object('saldo', v_balance_cents::numeric / 100, 'parcelas', p_count);
END;
$$;
REVOKE ALL ON FUNCTION public.repactuate_treatment_balance(uuid, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repactuate_treatment_balance(uuid, integer, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

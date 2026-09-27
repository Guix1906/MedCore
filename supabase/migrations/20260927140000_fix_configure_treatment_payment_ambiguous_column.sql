BEGIN;

-- ============================================================================
-- Correção do erro: column reference "t.id" is ambiguous
-- Na função configure_treatment_payment, a variável local chamava-se 't'
-- ao mesmo tempo em que a tabela treatments era apelidada como 't' em subqueries,
-- gerando colisão de identificadores no parser do PL/pgSQL do PostgreSQL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.configure_treatment_payment(
  p_treatment_id uuid, p_total numeric, p_discount numeric, p_down numeric,
  p_type text, p_down_method text, p_method text, p_count integer,
  p_down_due date, p_first_due date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.treatments%ROWTYPE;
  balance_cents bigint;
  each_cents bigint;
  remainder_cents bigint;
  i integer;
  methods text[] := ARRAY['pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia','convenio'];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.treatments tr
    WHERE tr.id = p_treatment_id
      AND public.finance_allowed((to_jsonb(tr)->>'company_id')::uuid, 'create')
  ) THEN
    RAISE EXCEPTION 'Sem permissao financeira';
  END IF;

  SELECT * INTO v_plan FROM public.treatments WHERE id = p_treatment_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.transaction_payments p
    JOIN public.transactions tx ON tx.id = p.transaction_id
    WHERE tx.treatment_id = v_plan.id AND p.reversed_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.treatment_installments inst
    WHERE inst.treatment_id = v_plan.id AND inst.status = 'pago'
  ) THEN
    RAISE EXCEPTION 'Plano com recebimentos: preserve as parcelas pagas; nao e permitida a regeneracao';
  END IF;

  IF p_total::text IN ('NaN','Infinity','-Infinity') OR p_discount::text IN ('NaN','Infinity','-Infinity') OR p_down::text IN ('NaN','Infinity','-Infinity')
     OR p_total IS NULL OR p_discount IS NULL OR p_down IS NULL OR p_total <= 0 OR p_discount < 0 OR p_down < 0
     OR p_discount + p_down > p_total OR p_total <> round(p_total,2) OR p_down <> round(p_down,2) OR p_discount <> round(p_discount,2) THEN
    RAISE EXCEPTION 'Valores invalidos: confira total, desconto e entrada';
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('a_vista','parcelado','financiado') OR p_count IS NULL OR p_count < 1 OR p_count > 120
     OR (p_type = 'a_vista' AND p_count <> 1) THEN
    RAISE EXCEPTION 'Tipo ou numero de parcelas invalido';
  END IF;

  balance_cents := round((p_total - p_discount - p_down) * 100);

  IF p_down > 0 AND (p_down_method IS NULL OR NOT p_down_method = ANY(methods) OR p_down_due IS NULL) THEN
    RAISE EXCEPTION 'Informe forma e vencimento da entrada';
  END IF;

  IF balance_cents > 0 AND (p_method IS NULL OR NOT p_method = ANY(methods) OR p_first_due IS NULL OR balance_cents < p_count) THEN
    RAISE EXCEPTION 'Informe forma, vencimento e parcelas validas para o saldo';
  END IF;

  UPDATE public.treatment_installments SET status = 'cancelado' WHERE treatment_id = v_plan.id;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'treatment_installments' AND column_name = 'transaction_id'
  ) THEN
    EXECUTE 'UPDATE public.treatment_installments SET transaction_id = NULL WHERE treatment_id = $1 AND transaction_id IS NOT NULL'
      USING v_plan.id;
  END IF;

  DELETE FROM public.transactions WHERE treatment_id = v_plan.id AND installment_id IN
    (SELECT inst_del.id FROM public.treatment_installments inst_del WHERE inst_del.treatment_id = v_plan.id);

  DELETE FROM public.treatment_installments WHERE treatment_id = v_plan.id;

  UPDATE public.treatments SET
    total_value = p_total,
    discount = p_discount,
    down_payment = p_down,
    payment_type = p_type,
    down_payment_method = p_down_method,
    payment_method = p_method,
    installments_count = p_count,
    down_payment_due_date = p_down_due,
    first_due_date = p_first_due
  WHERE id = v_plan.id;

  IF p_down > 0 THEN
    INSERT INTO public.treatment_installments(treatment_id, number, amount, due_date, payment_method)
      VALUES(v_plan.id, 0, p_down, p_down_due, p_down_method);
  END IF;

  IF balance_cents > 0 THEN
    each_cents := balance_cents / p_count;
    remainder_cents := balance_cents % p_count;
    FOR i IN 1..p_count LOOP
      INSERT INTO public.treatment_installments(treatment_id, number, amount, due_date, payment_method)
        VALUES(
          v_plan.id,
          i,
          (each_cents + CASE WHEN i <= remainder_cents THEN 1 ELSE 0 END)::numeric / 100,
          (p_first_due + make_interval(months => i - 1))::date,
          p_method
        );
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_treatment_payment(uuid,numeric,numeric,numeric,text,text,text,integer,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_treatment_payment(uuid,numeric,numeric,numeric,text,text,text,integer,date,date) TO authenticated;

-- Atualiza generate_treatment_installments com identificadores não ambíguos
CREATE OR REPLACE FUNCTION public.generate_treatment_installments(p_treatment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_plan public.treatments%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.treatments WHERE id = p_treatment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano nao encontrado'; END IF;
  PERFORM public.configure_treatment_payment(
    v_plan.id,
    v_plan.total_value,
    v_plan.discount,
    v_plan.down_payment,
    v_plan.payment_type,
    COALESCE(v_plan.down_payment_method, v_plan.payment_method),
    v_plan.payment_method,
    v_plan.installments_count,
    COALESCE(v_plan.down_payment_due_date, v_plan.start_date),
    COALESCE(v_plan.first_due_date, v_plan.start_date)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_treatment_installments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_treatment_installments(uuid) TO authenticated;

COMMIT;

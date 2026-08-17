
CREATE OR REPLACE FUNCTION public.generate_treatment_installments(p_treatment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total NUMERIC;
  v_down NUMERIC;
  v_discount NUMERIC;
  v_count INTEGER;
  v_start DATE;
  v_method TEXT;
  v_patient UUID;
  v_doctor UUID;
  v_title TEXT;
  v_installment_value NUMERIC;
  v_due DATE;
  v_new_id UUID;
  i INTEGER;
BEGIN
  SELECT total_value, down_payment, discount, installments_count, start_date, payment_method,
         patient_id, doctor_id, title
    INTO v_total, v_down, v_discount, v_count, v_start, v_method, v_patient, v_doctor, v_title
    FROM public.treatments WHERE id = p_treatment_id;

  -- Limpa parcelas pendentes e as transações previstas ainda não pagas
  DELETE FROM public.transactions
    WHERE treatment_id = p_treatment_id
      AND installment_id IN (SELECT id FROM public.treatment_installments
                              WHERE treatment_id = p_treatment_id AND status = 'pendente')
      AND status = 'pendente';

  DELETE FROM public.treatment_installments
    WHERE treatment_id = p_treatment_id AND status = 'pendente';

  -- Lança a entrada (down payment) como receita paga, se houver
  IF COALESCE(v_down,0) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.transactions
      WHERE treatment_id = p_treatment_id
        AND installment_id IS NULL
        AND description LIKE 'Acompanhamento: %— Entrada%'
    ) THEN
      INSERT INTO public.transactions
        (type, amount, date, status, description, payment_method, patient_id, doctor_id, treatment_id)
      VALUES
        ('receita', v_down, v_start, 'pago',
         'Acompanhamento: ' || COALESCE(v_title,'') || ' — Entrada',
         COALESCE(v_method,'dinheiro'), v_patient, v_doctor, p_treatment_id);
    END IF;
  END IF;

  IF v_count IS NULL OR v_count < 1 THEN v_count := 1; END IF;
  v_installment_value := ROUND(((v_total - COALESCE(v_down,0) - COALESCE(v_discount,0)) / v_count)::numeric, 2);

  FOR i IN 1..v_count LOOP
    v_due := (v_start + (i * INTERVAL '1 month'))::DATE;
    INSERT INTO public.treatment_installments
      (treatment_id, number, amount, due_date, payment_method, status)
    VALUES
      (p_treatment_id, i, v_installment_value, v_due, v_method, 'pendente')
    RETURNING id INTO v_new_id;

    -- Lança a parcela pendente como receita prevista
    INSERT INTO public.transactions
      (type, amount, date, status, description, payment_method, patient_id, doctor_id, treatment_id, installment_id)
    VALUES
      ('receita', v_installment_value, v_due, 'pendente',
       'Acompanhamento: ' || COALESCE(v_title,'') || ' — Parcela ' || i,
       COALESCE(v_method,'dinheiro'), v_patient, v_doctor, p_treatment_id, v_new_id);
  END LOOP;
END;
$function$;

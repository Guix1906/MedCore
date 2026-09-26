-- =============================================================================
-- MedCore: Fluxo Financeiro de Agendamento, Sinal e Baixa Rápida de Consultas
-- =============================================================================
BEGIN;

-- 1. Garantir contas financeiras padrão com UUIDs reais no banco
INSERT INTO public.financial_accounts (id, name, type, is_active, balance_kind, company_id)
VALUES 
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Banco Principal / PIX', 'corrente', true, 'available', NULL),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'Caixa Geral / Dinheiro', 'caixa', true, 'available', NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = true,
  balance_kind = EXCLUDED.balance_kind;

-- Criar contas para clínicas existentes que não possuam conta bancária ativa
INSERT INTO public.financial_accounts (id, name, type, is_active, balance_kind, company_id)
SELECT 
  gen_random_uuid(), 'Banco Principal / PIX', 'corrente', true, 'available', c.id
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.financial_accounts a WHERE a.company_id = c.id AND a.is_active = true
);

INSERT INTO public.financial_accounts (id, name, type, is_active, balance_kind, company_id)
SELECT 
  gen_random_uuid(), 'Caixa da Clínica', 'caixa', true, 'available', c.id
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.financial_accounts a WHERE a.company_id = c.id AND a.type = 'caixa' AND a.is_active = true
);

-- 2. Agendamento com Título e Sinal Atômico
CREATE OR REPLACE FUNCTION public.schedule_appointment_finance(
  p_event_id uuid,
  p_amount numeric,
  p_sinal numeric,
  p_sinal_method text,
  p_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.events%ROWTYPE;
  t public.transactions%ROWTYPE;
  title_id uuid;
  pay_id uuid;
  resolved_patient_id uuid;
  patient_name_text text := NULL;
  resolved_account_id uuid;
  sinal_method_clean text;
  sinal_val numeric := COALESCE(p_sinal, 0);
  total_val numeric := COALESCE(p_amount, 0);
  due_dt date := COALESCE(p_due_date, CURRENT_DATE);
BEGIN
  -- 1. Busca o evento
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  -- 2. Resolver paciente
  resolved_patient_id := e.patient_id;
  IF e.patient_id IS NOT NULL THEN
    SELECT p.name INTO patient_name_text FROM public.patients p WHERE p.id = e.patient_id;
    IF NOT FOUND THEN resolved_patient_id := NULL; END IF;
  END IF;

  -- 3. Localizar ou criar o título financeiro (idempotente)
  SELECT * INTO t FROM public.transactions WHERE origin_key = 'event:' || p_event_id FOR UPDATE;
  IF FOUND THEN
    title_id := t.id;
    UPDATE public.transactions
    SET amount = total_val,
        due_date = due_dt,
        patient_id = COALESCE(resolved_patient_id, patient_id),
        payer_name = COALESCE(patient_name_text, payer_name),
        updated_at = now()
    WHERE id = title_id;
  ELSE
    title_id := gen_random_uuid();
    INSERT INTO public.transactions (
      id, type, amount, date, due_date, description, status,
      patient_id, payer_name, category, competence_date, company_id,
      origin_key, created_by, paid_amount
    ) VALUES (
      title_id, 'receita', total_val, due_dt, due_dt,
      COALESCE(e.title, 'Atendimento - ' || COALESCE(patient_name_text, 'Paciente')),
      'pendente', resolved_patient_id, patient_name_text, 'Atendimentos',
      date_trunc('month', due_dt)::date, e.company_id,
      'event:' || p_event_id, auth.uid(), 0
    );
  END IF;

  -- 4. Registrar Sinal se houver e ainda não tiver sido quitado
  IF sinal_val > 0 THEN
    sinal_method_clean := lower(btrim(COALESCE(p_sinal_method, 'pix')));
    IF sinal_method_clean NOT IN ('pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia') THEN
      sinal_method_clean := 'pix';
    END IF;

    -- Verificar se já existe pagamento registrado para este título
    IF NOT EXISTS (
      SELECT 1 FROM public.transaction_payments
      WHERE transaction_id = title_id AND reversed_at IS NULL
    ) THEN
      -- Resolver conta bancária ativa da clínica
      SELECT id INTO resolved_account_id
      FROM public.financial_accounts
      WHERE (company_id IS NOT DISTINCT FROM e.company_id OR company_id IS NULL)
        AND is_active = true
        AND (
          (sinal_method_clean = 'dinheiro' AND type = 'caixa')
          OR (sinal_method_clean <> 'dinheiro' AND type <> 'caixa')
        )
      ORDER BY CASE WHEN company_id = e.company_id THEN 0 ELSE 1 END, created_at
      LIMIT 1;

      IF resolved_account_id IS NULL THEN
        SELECT id INTO resolved_account_id
        FROM public.financial_accounts
        WHERE (company_id IS NOT DISTINCT FROM e.company_id OR company_id IS NULL)
          AND is_active = true
        ORDER BY CASE WHEN company_id = e.company_id THEN 0 ELSE 1 END, created_at
        LIMIT 1;
      END IF;

      IF resolved_account_id IS NULL THEN
        resolved_account_id := '00000000-0000-0000-0000-000000000001'::uuid;
      END IF;

      pay_id := gen_random_uuid();
      INSERT INTO public.transaction_payments (
        id, transaction_id, amount, paid_on, payment_method, account_id, payer_name, created_by
      ) VALUES (
        pay_id, title_id, sinal_val, CURRENT_DATE, sinal_method_clean, resolved_account_id, patient_name_text, auth.uid()
      );

      UPDATE public.transactions
      SET paid_amount = sinal_val,
          status = CASE WHEN sinal_val >= total_val AND total_val > 0 THEN 'pago' ELSE 'pendente' END,
          paid_at = CASE WHEN sinal_val >= total_val AND total_val > 0 THEN now() ELSE NULL END
      WHERE id = title_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'title_id', title_id,
    'payment_id', pay_id,
    'amount', total_val,
    'sinal', sinal_val,
    'remaining', GREATEST(0, total_val - sinal_val),
    'status', CASE WHEN sinal_val >= total_val AND total_val > 0 THEN 'pago' ELSE 'pendente' END
  );
END;
$$;

-- 3. Baixa Rápida de Saldo Restante da Consulta
CREATE OR REPLACE FUNCTION public.settle_appointment_remaining(
  p_event_id uuid,
  p_amount numeric,
  p_method text,
  p_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.transactions%ROWTYPE;
  paid_so_far numeric := 0;
  rem numeric := 0;
  pay_id uuid;
  resolved_account_id uuid := p_account_id;
  method_clean text;
  settle_val numeric := p_amount;
BEGIN
  -- 1. Localizar transação vinculada ao evento
  SELECT * INTO t FROM public.transactions WHERE origin_key = 'event:' || p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança deste agendamento não foi encontrada no Financeiro';
  END IF;

  -- 2. Calcular saldo restante
  SELECT COALESCE(sum(amount), 0) INTO paid_so_far
  FROM public.transaction_payments
  WHERE transaction_id = t.id AND reversed_at IS NULL;

  rem := GREATEST(0, t.amount - paid_so_far);
  IF rem <= 0 THEN
    RAISE EXCEPTION 'Este agendamento já está totalmente quitado';
  END IF;

  IF settle_val IS NULL OR settle_val <= 0 THEN
    settle_val := rem;
  END IF;

  IF settle_val > rem THEN
    RAISE EXCEPTION 'O valor informado (R$ %) é superior ao saldo restante em aberto (R$ %)', settle_val, rem;
  END IF;

  method_clean := lower(btrim(COALESCE(p_method, 'pix')));
  IF method_clean NOT IN ('pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia') THEN
    method_clean := 'pix';
  END IF;

  -- 3. Resolver conta
  IF resolved_account_id IS NULL THEN
    SELECT id INTO resolved_account_id
    FROM public.financial_accounts
    WHERE (company_id IS NOT DISTINCT FROM t.company_id OR company_id IS NULL)
      AND is_active = true
      AND (
        (method_clean = 'dinheiro' AND type = 'caixa')
        OR (method_clean <> 'dinheiro' AND type <> 'caixa')
      )
    ORDER BY CASE WHEN company_id = t.company_id THEN 0 ELSE 1 END, created_at
    LIMIT 1;

    IF resolved_account_id IS NULL THEN
      SELECT id INTO resolved_account_id
      FROM public.financial_accounts
      WHERE (company_id IS NOT DISTINCT FROM t.company_id OR company_id IS NULL)
        AND is_active = true
      ORDER BY CASE WHEN company_id = t.company_id THEN 0 ELSE 1 END, created_at
      LIMIT 1;
    END IF;
  END IF;

  IF resolved_account_id IS NULL THEN
    resolved_account_id := '00000000-0000-0000-0000-000000000001'::uuid;
  END IF;

  -- 4. Registrar o pagamento da baixa
  pay_id := gen_random_uuid();
  INSERT INTO public.transaction_payments (
    id, transaction_id, amount, paid_on, payment_method, account_id, payer_name, created_by
  ) VALUES (
    pay_id, t.id, settle_val, CURRENT_DATE, method_clean, resolved_account_id, t.payer_name, auth.uid()
  );

  paid_so_far := paid_so_far + settle_val;
  UPDATE public.transactions
  SET paid_amount = paid_so_far,
      status = CASE WHEN paid_so_far >= amount THEN 'pago' ELSE 'pendente' END,
      paid_at = CASE WHEN paid_so_far >= amount THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = t.id;

  RETURN jsonb_build_object(
    'title_id', t.id,
    'payment_id', pay_id,
    'settled_amount', settle_val,
    'new_paid_total', paid_so_far,
    'remaining', GREATEST(0, t.amount - paid_so_far),
    'status', CASE WHEN paid_so_far >= t.amount THEN 'pago' ELSE 'pendente' END
  );
END;
$$;

-- 4. Cancelamento ou Retenção de Sinal de Consulta
CREATE OR REPLACE FUNCTION public.cancel_appointment_finance(
  p_event_id uuid,
  p_action text DEFAULT 'retain', -- 'retain' (reter sinal), 'refund' (estornar), 'cancel_unpaid' (cancelar sem custo)
  p_reason text DEFAULT 'Cancelamento da consulta'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.transactions%ROWTYPE;
  paid_so_far numeric := 0;
  pm public.transaction_payments%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.transactions WHERE origin_key = 'event:' || p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'action', 'none');
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO paid_so_far
  FROM public.transaction_payments
  WHERE transaction_id = t.id AND reversed_at IS NULL;

  IF p_action = 'refund' THEN
    -- Estorna todos os pagamentos realizados
    FOR pm IN SELECT * FROM public.transaction_payments WHERE transaction_id = t.id AND reversed_at IS NULL LOOP
      UPDATE public.transaction_payments
      SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason
      WHERE id = pm.id;
    END LOOP;
    UPDATE public.transactions
    SET status = 'cancelado', paid_amount = 0, notes = concat_ws(E'\n', notes, 'Cancelado com estorno: ' || p_reason)
    WHERE id = t.id;
    RETURN jsonb_build_object('success', true, 'action', 'refunded', 'title_id', t.id);

  ELSIF p_action = 'retain' AND paid_so_far > 0 THEN
    -- Mantém o sinal como receita realizada de cancelamento e zera o saldo restante
    UPDATE public.transactions
    SET amount = paid_so_far, status = 'pago',
        description = description || ' (Sinal retido por cancelamento)',
        notes = concat_ws(E'\n', notes, 'Sinal retido: ' || p_reason)
    WHERE id = t.id;
    RETURN jsonb_build_object('success', true, 'action', 'retained', 'title_id', t.id, 'retained_amount', paid_so_far);

  ELSE
    -- Sem pagamentos realizados: cancela o título
    UPDATE public.transactions
    SET status = 'cancelado', notes = concat_ws(E'\n', notes, 'Cancelado: ' || p_reason)
    WHERE id = t.id;
    RETURN jsonb_build_object('success', true, 'action', 'canceled', 'title_id', t.id);
  END IF;
END;
$$;

-- 5. Privilégios das funções
REVOKE ALL ON FUNCTION public.schedule_appointment_finance(uuid, numeric, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_appointment_finance(uuid, numeric, numeric, text, date) TO authenticated;

REVOKE ALL ON FUNCTION public.settle_appointment_remaining(uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_appointment_remaining(uuid, numeric, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_appointment_finance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_finance(uuid, text, text) TO authenticated;

COMMIT;

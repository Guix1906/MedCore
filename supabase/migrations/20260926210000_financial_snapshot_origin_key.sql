-- =============================================================================
-- Migration: 20260926210000_financial_snapshot_origin_key.sql
-- Inclui origin_key no snapshot financeiro e garante idempotência total
-- no lançamento de sinal e títulos de agendamento.
-- =============================================================================
BEGIN;

-- 1. get_financial_snapshot: projeta origin_key explicitamente no JSON de titles
CREATE OR REPLACE FUNCTION public.get_financial_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH titles AS (
    SELECT t.*, p.name AS patient_name,
      public.finance_allowed(t.company_id,CASE WHEN t.type IN ('receita','income') THEN 'receive' ELSE 'pay' END) AS can_settle,
      public.finance_allowed(t.company_id,'reverse') AS can_reverse,
      public.finance_allowed(t.company_id,'cancel') AS can_cancel
    FROM public.transactions t LEFT JOIN public.patients p ON p.id=t.patient_id
    WHERE public.finance_allowed(t.company_id,'view') AND t.type IN ('receita','despesa','income','expense') AND t.deleted_at IS NULL
  ) SELECT jsonb_build_object(
    'titles',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'type',CASE WHEN type IN ('receita','income') THEN 'receita' ELSE 'despesa' END,
      'amount',amount,'paid_amount',paid_amount,'due_date',COALESCE(due_date,date),'date',date,'status',status,
      'description',description,'category',category,'patient_id',patient_id,'patient_name',patient_name,'payer_name',payer_name,
      'company_id',company_id,'treatment_id',treatment_id,'installment_id',installment_id,'competence_date',competence_date,
      'origin_key',origin_key,
      'can_settle',can_settle,'can_reverse',can_reverse,'can_cancel',can_cancel
    ) ORDER BY COALESCE(due_date,date),id) FROM titles),'[]'::jsonb),
    'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.paid_on,p.id) FROM public.transaction_payments p JOIN titles t ON t.id=p.transaction_id),'[]'::jsonb),
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'type',a.type,'company_id',a.company_id,
      'balance_kind',a.balance_kind,'active',COALESCE((to_jsonb(a)->>'active')::boolean,(to_jsonb(a)->>'is_active')::boolean,false)))
      FROM public.financial_accounts a WHERE public.finance_allowed(a.company_id,'view')),'[]'::jsonb),
    'scopes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,
      'can_create',public.finance_allowed(s.id,'create'),'can_pay',public.finance_allowed(s.id,'pay'),'can_accounts',public.finance_allowed(s.id,'accounts')))
      FROM (SELECT NULL::uuid AS id,'Clinica (cadastro legado)'::text AS name UNION ALL SELECT id,name FROM public.companies) s
      WHERE public.finance_allowed(s.id,'view')),'[]'::jsonb),
    'patients',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'company_id',(to_jsonb(p)->>'company_id')::uuid) ORDER BY p.name)
      FROM public.patients p WHERE public.finance_allowed((to_jsonb(p)->>'company_id')::uuid,'view')),'[]'::jsonb)
  );
$$;

-- 2. schedule_appointment_finance: garante data de emissão como CURRENT_DATE e pagamento único de sinal
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
  existing_pay_id uuid;
BEGIN
  -- 1. Localiza o evento
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  -- 2. Resolve paciente
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
        date = CURRENT_DATE,
        patient_id = COALESCE(resolved_patient_id, patient_id),
        payer_name = COALESCE(patient_name_text, payer_name),
        origin_key = 'event:' || p_event_id,
        updated_at = now()
    WHERE id = title_id;
  ELSE
    title_id := gen_random_uuid();
    INSERT INTO public.transactions (
      id, type, amount, date, due_date, description, status,
      patient_id, payer_name, category, competence_date, company_id,
      origin_key, created_by, paid_amount
    ) VALUES (
      title_id, 'receita', total_val, CURRENT_DATE, due_dt,
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
    SELECT id INTO existing_pay_id FROM public.transaction_payments
    WHERE transaction_id = title_id AND reversed_at IS NULL
    LIMIT 1;

    IF existing_pay_id IS NOT NULL THEN
      pay_id := existing_pay_id;
      UPDATE public.transaction_payments
      SET amount = sinal_val, paid_on = CURRENT_DATE, payment_method = sinal_method_clean
      WHERE id = pay_id;
    ELSE
      -- Resolver conta bancária ativa da clínica
      SELECT id INTO resolved_account_id
      FROM public.financial_accounts
      WHERE (company_id IS NOT DISTINCT FROM e.company_id OR company_id IS NULL)
        AND (COALESCE(active, true) = true OR COALESCE(is_active, true) = true)
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
          AND (COALESCE(active, true) = true OR COALESCE(is_active, true) = true)
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
    END IF;

    UPDATE public.transactions
    SET paid_amount = sinal_val,
        status = CASE WHEN sinal_val >= total_val AND total_val > 0 THEN 'pago' ELSE 'pendente' END,
        paid_at = CASE WHEN sinal_val >= total_val AND total_val > 0 THEN now() ELSE NULL END
    WHERE id = title_id;
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

GRANT EXECUTE ON FUNCTION public.get_financial_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_appointment_finance(uuid, numeric, numeric, text, date) TO authenticated;

COMMIT;

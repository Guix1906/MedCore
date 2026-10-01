BEGIN;

-- ============================================================================
-- Cobranças presas na clínica provisória (00000000-0000-0000-0000-0000000c1111).
-- Os eventos já foram movidos para a clínica real em 20260929120000, mas as cobranças
-- (transactions) ficaram na provisória. Resultado: ao dar baixa, nenhuma conta
-- financeira "da mesma clínica" era encontrada ("Selecione uma conta ativa da mesma clínica").
-- ============================================================================

-- A trava de títulos impede mudar a clínica de título com pagamentos; libera só nesta transação.
SELECT set_config('medcore.title_delete', 'on', true);

-- 1. Cobrança de agendamento: vai para a clínica do próprio evento
UPDATE public.transactions t
   SET company_id = e.company_id
  FROM public.events e
 WHERE t.origin_key = 'event:' || e.id::text
   AND t.company_id = '00000000-0000-0000-0000-0000000c1111'::uuid
   AND e.company_id IS NOT NULL
   AND e.company_id <> '00000000-0000-0000-0000-0000000c1111'::uuid;

-- 2. Demais: clínica ativa de quem criou o lançamento
UPDATE public.transactions t
   SET company_id = (
     SELECT cm.company_id
       FROM public.company_members cm
      WHERE cm.user_id = t.created_by AND cm.status = 'active'
        AND cm.company_id <> '00000000-0000-0000-0000-0000000c1111'::uuid
      ORDER BY cm.created_at
      LIMIT 1
   )
 WHERE t.company_id = '00000000-0000-0000-0000-0000000c1111'::uuid
   AND EXISTS (
     SELECT 1 FROM public.company_members cm
      WHERE cm.user_id = t.created_by AND cm.status = 'active'
        AND cm.company_id <> '00000000-0000-0000-0000-0000000c1111'::uuid
   );

-- 3. Eventos que ainda estejam na provisória seguem a mesma regra
UPDATE public.events e
   SET company_id = (
     SELECT cm.company_id
       FROM public.company_members cm
      WHERE cm.user_id = e.created_by AND cm.status = 'active'
        AND cm.company_id <> '00000000-0000-0000-0000-0000000c1111'::uuid
      ORDER BY cm.created_at
      LIMIT 1
   )
 WHERE e.company_id = '00000000-0000-0000-0000-0000000c1111'::uuid
   AND EXISTS (
     SELECT 1 FROM public.company_members cm
      WHERE cm.user_id = e.created_by AND cm.status = 'active'
        AND cm.company_id <> '00000000-0000-0000-0000-0000000c1111'::uuid
   );

SELECT set_config('medcore.title_delete', 'off', true);

-- 4. Baixa aceita conta "legado" (sem clínica), como settle_appointment_remaining já aceita.
--    Igual à versão de 20260919160000, mudando só a checagem da conta.
CREATE OR REPLACE FUNCTION public.record_financial_payment(
  p_id uuid, p_transaction_id uuid, p_amount numeric, p_paid_on date,
  p_method text, p_account_id uuid, p_payer_name text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transactions%ROWTYPE; previous public.transaction_payments%ROWTYPE; paid numeric; account public.financial_accounts%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Informe a identificacao da solicitacao'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id;
  IF NOT FOUND OR NOT public.finance_allowed(t.company_id,CASE WHEN t.type IN ('receita','income') THEN 'receive' ELSE 'pay' END) THEN
    RAISE EXCEPTION 'Sem permissao para esta baixa';
  END IF;
  IF t.treatment_id IS NOT NULL THEN PERFORM 1 FROM public.treatments WHERE id=t.treatment_id FOR UPDATE; END IF;
  SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Titulo alterado; atualize a tela'; END IF;
  SELECT * INTO previous FROM public.transaction_payments WHERE id=p_id;
  IF FOUND THEN
    IF ROW(previous.transaction_id,previous.amount,previous.paid_on,previous.payment_method,previous.account_id,previous.payer_name,previous.created_by)
      IS DISTINCT FROM ROW(p_transaction_id,p_amount,p_paid_on,p_method,p_account_id,NULLIF(btrim(p_payer_name),''),auth.uid()) THEN
      RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados';
    END IF;
    RETURN previous.id;
  END IF;
  IF t.type NOT IN ('receita','despesa','income','expense') OR t.status NOT IN ('pendente','vencido','pending','overdue') OR t.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Titulo indisponivel para baixa';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount <> round(p_amount,2)
    OR p_paid_on IS NULL OR p_paid_on > CURRENT_DATE OR p_method IS NULL
    OR p_method NOT IN ('pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia') THEN
    RAISE EXCEPTION 'Valor, data ou forma de pagamento invalida';
  END IF;
  SELECT * INTO account FROM public.financial_accounts WHERE id=p_account_id FOR SHARE;
  IF NOT FOUND
    OR (account.company_id IS NOT NULL AND account.company_id IS DISTINCT FROM t.company_id)
    OR NOT COALESCE((to_jsonb(account)->>'active')::boolean,(to_jsonb(account)->>'is_active')::boolean,false) THEN
    RAISE EXCEPTION 'Selecione uma conta ativa da mesma clinica';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO paid FROM public.transaction_payments WHERE transaction_id=t.id AND reversed_at IS NULL;
  IF p_amount > t.amount - paid THEN RAISE EXCEPTION 'Valor superior ao saldo em aberto'; END IF;
  INSERT INTO public.transaction_payments(id,transaction_id,amount,paid_on,payment_method,account_id,payer_name,created_by)
    VALUES(p_id,t.id,p_amount,p_paid_on,p_method,p_account_id,NULLIF(btrim(p_payer_name),''),auth.uid());
  paid := paid + p_amount;
  IF t.installment_id IS NOT NULL THEN
    UPDATE public.treatment_installments SET status=CASE WHEN paid=t.amount THEN 'pago' ELSE 'pendente' END,
      paid_date=CASE WHEN paid=t.amount THEN p_paid_on ELSE NULL END WHERE id=t.installment_id;
  END IF;
  UPDATE public.transactions SET paid_amount=paid, status=CASE WHEN paid=amount THEN 'pago' ELSE 'pendente' END,
    paid_at=CASE WHEN paid=amount THEN (SELECT max(paid_on)::timestamptz FROM public.transaction_payments WHERE transaction_id=t.id AND reversed_at IS NULL) ELSE NULL END
    WHERE id=t.id;
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_financial_payment(uuid,uuid,numeric,date,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_financial_payment(uuid,uuid,numeric,date,text,uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Conferência: deve voltar 0 (ou listar o que ficou sem clínica identificável)
SELECT count(*) AS cobrancas_ainda_na_clinica_provisoria
  FROM public.transactions
 WHERE company_id = '00000000-0000-0000-0000-0000000c1111'::uuid;

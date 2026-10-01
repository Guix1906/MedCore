BEGIN;

-- Excluir evento da agenda sempre funciona.
-- Antes: o app chamava cancel_appointment_finance('retain'), que com sinal pago tenta
-- reduzir o valor do título; a trava guard_financial_title recusa alterar valor de
-- título com histórico e a exclusão inteira falhava.
-- Agora: a cobrança do evento sem pagamento é apagada; com pagamento, os recebimentos
-- são estornados e o título cancelado (caixa coerente). Depois o evento é apagado.
-- Requer a migração 20261001120000 (liberação medcore.title_delete na trava).
CREATE OR REPLACE FUNCTION public.delete_agenda_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_title uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  SELECT company_id INTO v_company FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT (public.is_company_member(v_company) OR public.has_permission(v_company, 'agenda.manage')) THEN
    RAISE EXCEPTION 'Sem permissao para excluir este agendamento' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('medcore.title_delete', 'on', true);
  FOR v_title IN SELECT id FROM public.transactions WHERE origin_key = 'event:' || p_event_id FOR UPDATE LOOP
    IF NOT EXISTS (SELECT 1 FROM public.transaction_payments WHERE transaction_id = v_title) THEN
      DELETE FROM public.transactions WHERE id = v_title;
    ELSE
      UPDATE public.transaction_payments
        SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = 'Agendamento excluido'
        WHERE transaction_id = v_title AND reversed_at IS NULL;
      UPDATE public.transactions
        SET status = 'cancelado', paid_at = NULL, origin_key = NULL,
            notes = concat_ws(E'\n', notes, 'Agendamento excluido em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'))
        WHERE id = v_title;
    END IF;
  END LOOP;
  PERFORM set_config('medcore.title_delete', 'off', true);

  DELETE FROM public.events WHERE id = p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_agenda_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_agenda_event(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

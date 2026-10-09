-- =============================================================================
-- MedCore: retornos do acompanhamento com data escolhida.
--
--  1. O próximo retorno pode ser definido com uma data (antes era sempre calculado como
--     último retorno + intervalo, sem como ajustar). O cálculo automático continua quando
--     o retorno é registrado sem data escolhida, ou muda o intervalo / início do plano.
--  2. schedule_treatment_return: registra que o paciente compareceu (vira evolução de
--     retorno no histórico) e/ou marca a data do próximo retorno, numa chamada só.
--
-- Aplicar inteiro, de uma vez, no SQL Editor. Reaplicável.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.treatment_followup_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_auto date;
BEGIN
  IF NEW.return_days IS NULL THEN NEW.return_days := 30; END IF;
  IF NEW.return_days < 1 OR NEW.return_days > 365 THEN
    RAISE EXCEPTION 'Intervalo de retorno deve estar entre 1 e 365 dias';
  END IF;
  IF NEW.end_date < NEW.start_date THEN RAISE EXCEPTION 'Fim do protocolo anterior ao inicio'; END IF;

  v_auto := COALESCE(NEW.last_return_date, NEW.start_date) + NEW.return_days;
  IF NEW.status IN ('finalizado', 'cancelado') THEN
    NEW.next_return_date := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.next_return_date := COALESCE(NEW.next_return_date, v_auto);
  ELSIF NEW.next_return_date IS NOT NULL AND NEW.next_return_date IS DISTINCT FROM OLD.next_return_date THEN
    NULL; -- data escolhida pela clínica: mantém
  ELSIF OLD.next_return_date IS NULL
     OR NEW.last_return_date IS DISTINCT FROM OLD.last_return_date
     OR NEW.return_days IS DISTINCT FROM OLD.return_days
     OR NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    NEW.next_return_date := v_auto;
  ELSE
    NEW.next_return_date := OLD.next_return_date;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.uid() IS NULL OR NOT public.can_access_treatment(OLD.id) THEN
      RAISE EXCEPTION 'Acesso negado';
    END IF;
    IF NULLIF(btrim(NEW.status_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Informe a justificativa da mudanca de status';
    END IF;
    INSERT INTO public.treatment_status_history(treatment_id, previous_status, status, justification)
      VALUES (NEW.id, OLD.status, NEW.status, NEW.status_reason);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.treatment_followup_dates() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.schedule_treatment_return(
  p_treatment_id uuid, p_next_date date, p_returned_on date DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.treatments%ROWTYPE;
  v_last date;
BEGIN
  IF NOT public.can_access_treatment(p_treatment_id) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT * INTO t FROM public.treatments WHERE id = p_treatment_id FOR UPDATE;
  IF t.status <> 'em_andamento' THEN
    RAISE EXCEPTION 'Retorno só pode ser marcado em plano em andamento';
  END IF;
  IF p_next_date IS NULL THEN RAISE EXCEPTION 'Informe a data do próximo retorno'; END IF;
  IF p_next_date < CURRENT_DATE THEN RAISE EXCEPTION 'O próximo retorno não pode ser no passado'; END IF;

  v_last := t.last_return_date;
  IF p_returned_on IS NOT NULL THEN
    IF p_returned_on > CURRENT_DATE OR p_returned_on < t.start_date THEN
      RAISE EXCEPTION 'Data do retorno deve estar entre o início do plano e hoje';
    END IF;
    IF p_next_date <= p_returned_on THEN
      RAISE EXCEPTION 'O próximo retorno deve ser depois do retorno realizado';
    END IF;
    INSERT INTO public.treatment_evolutions(treatment_id, occurred_on, notes, is_return)
    VALUES (p_treatment_id, p_returned_on,
            COALESCE(NULLIF(btrim(p_notes), ''), 'Retorno realizado'), true);
    v_last := GREATEST(COALESCE(v_last, p_returned_on), p_returned_on);
  END IF;

  UPDATE public.treatments
     SET last_return_date = v_last, next_return_date = p_next_date
   WHERE id = p_treatment_id;
  RETURN jsonb_build_object('next_return_date', p_next_date, 'last_return_date', v_last);
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_treatment_return(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_treatment_return(uuid, date, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

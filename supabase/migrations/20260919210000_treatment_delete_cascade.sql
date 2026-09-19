BEGIN;

-- 1. Cascade child records on delete
ALTER TABLE public.treatment_status_history
  DROP CONSTRAINT IF EXISTS treatment_status_history_treatment_id_fkey,
  ADD CONSTRAINT treatment_status_history_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_evolutions
  DROP CONSTRAINT IF EXISTS treatment_evolutions_treatment_id_fkey,
  ADD CONSTRAINT treatment_evolutions_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_photos
  DROP CONSTRAINT IF EXISTS treatment_photos_treatment_id_fkey,
  ADD CONSTRAINT treatment_photos_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_medication_uses
  DROP CONSTRAINT IF EXISTS treatment_medication_uses_treatment_id_fkey,
  ADD CONSTRAINT treatment_medication_uses_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE CASCADE;

-- 2. Safe delete RPC
CREATE OR REPLACE FUNCTION public.delete_treatment(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'ID do tratamento obrigatorio';
  END IF;

  IF NOT public.can_access_treatment(p_id) THEN
    RAISE EXCEPTION 'Acesso negado para excluir este tratamento';
  END IF;

  -- Block deletion if there are paid financial titles
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE treatment_id = p_id
      AND (paid_amount > 0 OR status = 'pago')
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Nao e possivel excluir acompanhamento com titulos ja pagos no Financeiro. Estorne os pagamentos antes de excluir.';
  END IF;

  -- Remove unpaid generated financial titles
  DELETE FROM public.transactions
  WHERE treatment_id = p_id
    AND (paid_amount IS NULL OR paid_amount = 0);

  -- Cascade cleanup child records
  DELETE FROM public.treatment_status_history WHERE treatment_id = p_id;
  DELETE FROM public.treatment_evolutions WHERE treatment_id = p_id;
  DELETE FROM public.treatment_photos WHERE treatment_id = p_id;
  DELETE FROM public.treatment_medication_uses WHERE treatment_id = p_id;
  DELETE FROM public.treatment_medications WHERE treatment_id = p_id;
  DELETE FROM public.treatment_installments WHERE treatment_id = p_id;
  DELETE FROM public.treatment_phases WHERE treatment_id = p_id;
  DELETE FROM public.treatment_reminders WHERE treatment_id = p_id;
  DELETE FROM public.tasks WHERE treatment_id = p_id;
  UPDATE public.appointments SET treatment_id = NULL WHERE treatment_id = p_id;

  -- Delete treatment
  DELETE FROM public.treatments WHERE id = p_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_treatment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_treatment(uuid) TO authenticated;

COMMIT;

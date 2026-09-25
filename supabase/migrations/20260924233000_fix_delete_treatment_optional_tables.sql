BEGIN;

-- Keep treatment deletion compatible with installations that do not have the
-- optional legacy treatment_phases table.
CREATE OR REPLACE FUNCTION public.delete_treatment(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'ID do tratamento obrigatorio';
  END IF;

  IF NOT public.can_access_treatment(p_id) THEN
    RAISE EXCEPTION 'Acesso negado para excluir este tratamento';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.transactions
    WHERE treatment_id = p_id
      AND (paid_amount > 0 OR status = 'pago')
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Nao e possivel excluir acompanhamento com titulos ja pagos no Financeiro. Estorne os pagamentos antes de excluir.';
  END IF;

  DELETE FROM public.transactions
  WHERE treatment_id = p_id
    AND (paid_amount IS NULL OR paid_amount = 0);

  IF to_regclass('public.treatment_status_history') IS NOT NULL THEN
    DELETE FROM public.treatment_status_history WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.treatment_evolutions') IS NOT NULL THEN
    DELETE FROM public.treatment_evolutions WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.treatment_photos') IS NOT NULL THEN
    DELETE FROM public.treatment_photos WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.treatment_medication_uses') IS NOT NULL THEN
    DELETE FROM public.treatment_medication_uses WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.treatment_medications') IS NOT NULL THEN
    DELETE FROM public.treatment_medications WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.treatment_installments') IS NOT NULL THEN
    DELETE FROM public.treatment_installments WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.treatment_phases') IS NOT NULL THEN
    DELETE FROM public.treatment_phases WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.treatment_reminders') IS NOT NULL THEN
    DELETE FROM public.treatment_reminders WHERE treatment_id = p_id;
  END IF;
  IF to_regclass('public.tasks') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tasks'
         AND column_name = 'treatment_id'
     ) THEN
    EXECUTE 'DELETE FROM public.tasks WHERE treatment_id = $1' USING p_id;
  END IF;
  IF to_regclass('public.appointments') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'appointments'
         AND column_name = 'treatment_id'
     ) THEN
    EXECUTE 'UPDATE public.appointments SET treatment_id = NULL WHERE treatment_id = $1' USING p_id;
  END IF;

  DELETE FROM public.treatments WHERE id = p_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_treatment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_treatment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

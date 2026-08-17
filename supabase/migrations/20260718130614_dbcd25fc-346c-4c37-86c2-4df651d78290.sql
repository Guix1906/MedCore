
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatments TO authenticated;
GRANT ALL ON public.treatments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_medications TO authenticated;
GRANT ALL ON public.treatment_medications TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_installments TO authenticated;
GRANT ALL ON public.treatment_installments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_reminders TO authenticated;
GRANT ALL ON public.treatment_reminders TO service_role;

GRANT EXECUTE ON FUNCTION public.generate_treatment_installments(uuid) TO authenticated;

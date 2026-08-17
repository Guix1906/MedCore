-- Trigger-only functions: no direct API access needed
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_default_company() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.treatment_installment_to_transaction() FROM PUBLIC, anon, authenticated;

-- Helper functions used by RLS policies: signed-in users only
REVOKE ALL ON FUNCTION public.get_allowed_doctor_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_doctor_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_clinic_member() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_allowed_doctor_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_doctor_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_clinic_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;

-- RPC called by the app: signed-in users only
REVOKE ALL ON FUNCTION public.generate_treatment_installments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_treatment_installments(uuid) TO authenticated;

-- Drop and recreate policies allowing both anon and authenticated (matches patients/transactions)
DROP POLICY IF EXISTS "auth all treatments" ON public.treatments;
DROP POLICY IF EXISTS "auth all tmed" ON public.treatment_medications;
DROP POLICY IF EXISTS "auth all tinst" ON public.treatment_installments;
DROP POLICY IF EXISTS "auth all trem" ON public.treatment_reminders;

CREATE POLICY "allow_all_treatments" ON public.treatments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_treatment_medications" ON public.treatment_medications FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_treatment_installments" ON public.treatment_installments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_treatment_reminders" ON public.treatment_reminders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_medications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_installments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_reminders TO anon;

GRANT EXECUTE ON FUNCTION public.generate_treatment_installments(uuid) TO anon;

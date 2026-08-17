
-- =========================================================================
-- PROFILES TABLE
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- HARDEN RLS: require authenticated user on every clinical/business table
-- =========================================================================

-- Helper: replace open policies with staff-only
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop all existing "always true" policies on business tables
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'account_transfers','appointments','attachments','cash_register_movements',
        'cash_register_sessions','clinic_settings','cost_centers','doctors',
        'document_comments','exam_orders','finance_categories','financial_accounts',
        'inventory_items','inventory_movements','medical_records','notifications',
        'patient_pipeline_history','patient_pipeline_stages','patient_tags',
        'patients','payment_methods_config','prescriptions','recurring_transactions',
        'service_types','suppliers','tasks','transaction_attachments','transactions',
        'treatment_installments','treatment_medications','treatment_reminders',
        'treatments','vital_signs','waitlist','activity_log','financial_audit_log'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Recreate as "any authenticated staff member" (single-tenant clinic model)
DO $$
DECLARE
  t TEXT;
  business_tables TEXT[] := ARRAY[
    'account_transfers','appointments','attachments','cash_register_movements',
    'cash_register_sessions','clinic_settings','cost_centers','doctors',
    'document_comments','exam_orders','finance_categories','financial_accounts',
    'inventory_items','inventory_movements','medical_records','notifications',
    'patient_pipeline_history','patient_pipeline_stages','patient_tags',
    'patients','payment_methods_config','prescriptions','recurring_transactions',
    'service_types','suppliers','tasks','transaction_attachments','transactions',
    'treatment_installments','treatment_medications','treatment_reminders',
    'treatments','vital_signs','waitlist'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    EXECUTE format($f$
      CREATE POLICY "staff_read_%1$s" ON public.%1$I
        FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
      CREATE POLICY "staff_write_%1$s" ON public.%1$I
        FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
      CREATE POLICY "staff_update_%1$s" ON public.%1$I
        FOR UPDATE TO authenticated
        USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
      CREATE POLICY "staff_delete_%1$s" ON public.%1$I
        FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
    $f$, t);
  END LOOP;
END $$;

-- Audit logs: read for authenticated, admin only for direct writes; triggers use SECURITY DEFINER
CREATE POLICY "activity_log_read_auth" ON public.activity_log
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "activity_log_insert_auth" ON public.activity_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "financial_audit_log_read_auth" ON public.financial_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "financial_audit_log_insert_auth" ON public.financial_audit_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Revoke any lingering anon grants on sensitive tables
REVOKE ALL ON public.patients, public.medical_records, public.prescriptions,
             public.transactions, public.treatments, public.treatment_installments,
             public.treatment_medications, public.exam_orders, public.vital_signs,
             public.attachments, public.appointments, public.doctors, public.profiles
  FROM anon;

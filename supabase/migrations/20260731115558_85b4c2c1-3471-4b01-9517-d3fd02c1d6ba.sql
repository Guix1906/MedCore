-- ============================================================
-- 1. VINCULAR EQUIPE EXISTENTE ÀS CONTAS DE LOGIN (por e-mail)
-- ============================================================
UPDATE public.doctors d
   SET auth_id = u.id
  FROM auth.users u
 WHERE d.auth_id IS NULL
   AND lower(d.email) = lower(u.email);

-- ============================================================
-- 2. VÍNCULO AUTOMÁTICO EM NOVOS CADASTROS
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.doctors
     SET auth_id = NEW.id
   WHERE auth_id IS NULL
     AND lower(email) = lower(NEW.email);

  INSERT INTO public.profiles (id, full_name, doctor_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    (SELECT id FROM public.doctors WHERE auth_id = NEW.id LIMIT 1)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill de profiles para usuários já existentes
INSERT INTO public.profiles (id, full_name, doctor_id)
SELECT u.id, COALESCE(d.name, u.email), d.id
  FROM auth.users u
  LEFT JOIN public.doctors d ON d.auth_id = u.id
 ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. FUNÇÃO DE PERMISSÃO (search_path fixo)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_clinic_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.doctors
     WHERE auth_id = auth.uid() AND active = TRUE
  );
$$;

-- ============================================================
-- 4. SUBSTITUIR TODAS AS POLÍTICAS "allow_all" POR ACESSO DE EQUIPE
-- ============================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'activity_log','appointments','clinic_settings','commission_payouts','doctors',
    'finance_categories','financial_accounts','financial_categories','insurance_billings',
    'inventory_items','inventory_movements','medical_records','notifications',
    'patient_pipeline_stages','patient_tags','patients','prescription_models','prescriptions',
    'secretary_doctors','service_types','tasks','transactions','treatment_installments',
    'treatment_medications','treatments','waitlist'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'allow_all_' || t, t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.is_clinic_member()) WITH CHECK (public.is_clinic_member())',
      t || '_clinic_all', t
    );

    -- acesso anônimo removido; equipe e serviços internos mantidos
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- profiles: mantém acesso apenas ao próprio registro, sem anon
REVOKE ALL ON public.profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
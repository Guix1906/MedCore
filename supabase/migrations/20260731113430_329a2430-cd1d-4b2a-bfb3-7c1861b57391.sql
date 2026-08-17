
-- =============== PROFILES ===============
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  avatar_url text,
  phone text,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============== TREATMENTS ===============
CREATE TABLE IF NOT EXISTS public.treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  title text NOT NULL,
  objective text,
  status text NOT NULL DEFAULT 'em_andamento',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  total_value numeric NOT NULL DEFAULT 0,
  down_payment numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  installments_count integer NOT NULL DEFAULT 1,
  payment_method text DEFAULT 'pix',
  return_days integer,
  color text DEFAULT '#6C4CF7',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatments TO anon, authenticated;
GRANT ALL ON public.treatments TO service_role;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_treatments" ON public.treatments FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER treatments_updated_at BEFORE UPDATE ON public.treatments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.treatment_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  name text NOT NULL,
  dose text,
  unit text,
  route text,
  frequency text,
  period text,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'ativo',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_medications TO anon, authenticated;
GRANT ALL ON public.treatment_medications TO service_role;
ALTER TABLE public.treatment_medications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_treatment_medications" ON public.treatment_medications FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER treatment_medications_updated_at BEFORE UPDATE ON public.treatment_medications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.treatment_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  number integer NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  paid_date date,
  status text NOT NULL DEFAULT 'pendente',
  payment_method text,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (treatment_id, number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_installments TO anon, authenticated;
GRANT ALL ON public.treatment_installments TO service_role;
ALTER TABLE public.treatment_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_treatment_installments" ON public.treatment_installments FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER treatment_installments_updated_at BEFORE UPDATE ON public.treatment_installments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.generate_treatment_installments(p_treatment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.treatments%ROWTYPE;
  v_base numeric;
  v_each numeric;
  i integer;
BEGIN
  SELECT * INTO t FROM public.treatments WHERE id = p_treatment_id;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM public.treatment_installments
   WHERE treatment_id = p_treatment_id AND status <> 'pago';

  v_base := GREATEST(COALESCE(t.total_value,0) - COALESCE(t.discount,0) - COALESCE(t.down_payment,0), 0);
  IF COALESCE(t.installments_count,0) < 1 OR v_base <= 0 THEN RETURN; END IF;

  v_each := ROUND(v_base / t.installments_count, 2);

  FOR i IN 1..t.installments_count LOOP
    INSERT INTO public.treatment_installments (treatment_id, number, amount, due_date, payment_method)
    VALUES (
      p_treatment_id,
      i,
      CASE WHEN i = t.installments_count THEN v_base - (v_each * (t.installments_count - 1)) ELSE v_each END,
      (t.start_date + ((i - 1) || ' month')::interval)::date,
      t.payment_method
    )
    ON CONFLICT (treatment_id, number) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.treatment_installment_to_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.treatments%ROWTYPE;
  v_tx uuid;
BEGIN
  IF NEW.status = 'pago' AND COALESCE(OLD.status,'') <> 'pago' AND NEW.transaction_id IS NULL THEN
    SELECT * INTO t FROM public.treatments WHERE id = NEW.treatment_id;
    INSERT INTO public.transactions (type, amount, category, description, date, status, patient_id, doctor_id, payment_method, paid_at)
    VALUES ('receita', NEW.amount, 'Acompanhamento',
            COALESCE(t.title,'Acompanhamento') || ' — parcela ' || NEW.number,
            COALESCE(NEW.paid_date, CURRENT_DATE), 'pago', t.patient_id, t.doctor_id,
            COALESCE(NEW.payment_method, t.payment_method), now())
    RETURNING id INTO v_tx;
    NEW.transaction_id := v_tx;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER treatment_installment_paid
BEFORE UPDATE ON public.treatment_installments
FOR EACH ROW EXECUTE FUNCTION public.treatment_installment_to_transaction();

-- =============== TASKS ===============
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pendente',
  priority text NOT NULL DEFAULT 'normal',
  due_date date,
  origin text,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO anon, authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_tasks" ON public.tasks FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============== ACTIVITY LOG ===============
CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_log TO anon, authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_activity_log" ON public.activity_log FOR ALL USING (true) WITH CHECK (true);

-- =============== PIPELINE ===============
CREATE TABLE IF NOT EXISTS public.patient_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text DEFAULT '#6C4CF7',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_pipeline_stages TO anon, authenticated;
GRANT ALL ON public.patient_pipeline_stages TO service_role;
ALTER TABLE public.patient_pipeline_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_patient_pipeline_stages" ON public.patient_pipeline_stages FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.patient_pipeline_stages (name, color, sort_order) VALUES
  ('Lead', '#9CA3AF', 1),
  ('Primeira consulta', '#6C4CF7', 2),
  ('Em tratamento', '#10B981', 3),
  ('Acompanhamento', '#3B82F6', 4),
  ('Inativo', '#EF4444', 5);

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS pipeline_stage_id uuid REFERENCES public.patient_pipeline_stages(id) ON DELETE SET NULL;

-- =============== SETTINGS / SERVICES / CATEGORIES ===============
CREATE TABLE IF NOT EXISTS public.clinic_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name text,
  cnpj text,
  phone text,
  email text,
  address text,
  opening_hours text,
  primary_color text DEFAULT '#8B47FF',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_settings TO anon, authenticated;
GRANT ALL ON public.clinic_settings TO service_role;
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_clinic_settings" ON public.clinic_settings FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER clinic_settings_updated_at BEFORE UPDATE ON public.clinic_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric,
  duration_minutes integer,
  commission_percent numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_types TO anon, authenticated;
GRANT ALL ON public.service_types TO service_role;
ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_service_types" ON public.service_types FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER service_types_updated_at BEFORE UPDATE ON public.service_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'receita',
  color text DEFAULT '#6B7280',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_categories TO anon, authenticated;
GRANT ALL ON public.finance_categories TO service_role;
ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_finance_categories" ON public.finance_categories FOR ALL USING (true) WITH CHECK (true);

-- =============== NOTIFICATIONS EXTRA COLUMNS ===============
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- =============== GLOBAL SEARCH VIEW ===============
CREATE OR REPLACE VIEW public.global_search_view
WITH (security_invoker = true) AS
  SELECT 'patient'::text AS kind, p.id, p.name AS label,
         COALESCE(p.phone, p.email, p.cpf) AS extra, p.created_at
    FROM public.patients p
  UNION ALL
  SELECT 'treatment', t.id, t.title, t.status, t.created_at FROM public.treatments t
  UNION ALL
  SELECT 'transaction', tr.id, COALESCE(tr.description, tr.category, 'Transação'),
         tr.type || ' · ' || tr.amount::text, tr.created_at
    FROM public.transactions tr
  UNION ALL
  SELECT 'medical_record', mr.id, COALESCE(mr.diagnosis, mr.complaint, 'Prontuário'),
         mr.diagnosis_code, mr.created_at
    FROM public.medical_records mr
  UNION ALL
  SELECT 'task', tk.id, tk.title, tk.status, tk.created_at FROM public.tasks tk
  UNION ALL
  SELECT 'appointment', a.id, COALESCE(a.type, 'Consulta'),
         a.date::text || ' ' || a.start_time::text, a.created_at
    FROM public.appointments a;

GRANT SELECT ON public.global_search_view TO anon, authenticated;
GRANT ALL ON public.global_search_view TO service_role;

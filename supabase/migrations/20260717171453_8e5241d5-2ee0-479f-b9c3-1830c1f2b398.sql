
CREATE TABLE IF NOT EXISTS public.vital_signs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  blood_pressure TEXT,
  heart_rate INT,
  temperature NUMERIC(4,1),
  oxygen_saturation INT,
  respiratory_rate INT,
  weight NUMERIC(6,2),
  height NUMERIC(5,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vital_signs TO authenticated, anon;
GRANT ALL ON public.vital_signs TO service_role;
ALTER TABLE public.vital_signs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open vital_signs" ON public.vital_signs FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attachments TO authenticated, anon;
GRANT ALL ON public.attachments TO service_role;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open attachments" ON public.attachments FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.exam_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES public.doctors(id),
  exam_name TEXT NOT NULL,
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_orders TO authenticated, anon;
GRANT ALL ON public.exam_orders TO service_role;
ALTER TABLE public.exam_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open exam_orders" ON public.exam_orders FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_exam_orders_upd BEFORE UPDATE ON public.exam_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.clinic_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name TEXT,
  cnpj TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  opening_hours TEXT,
  primary_color TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_settings TO authenticated, anon;
GRANT ALL ON public.clinic_settings TO service_role;
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open clinic_settings" ON public.clinic_settings FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_clinic_settings_upd BEFORE UPDATE ON public.clinic_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(10,2),
  duration_minutes INT,
  commission_percent NUMERIC(5,2),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_types TO authenticated, anon;
GRANT ALL ON public.service_types TO service_role;
ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open service_types" ON public.service_types FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_service_types_upd BEFORE UPDATE ON public.service_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.finance_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_categories TO authenticated, anon;
GRANT ALL ON public.finance_categories TO service_role;
ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open finance_categories" ON public.finance_categories FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.finance_categories (name, type) VALUES
  ('Consulta','income'),('Exame','income'),('Procedimento','income'),
  ('Aluguel','expense'),('Salários','expense'),('Insumos','expense'),('Impostos','expense');

INSERT INTO public.service_types (name, price, duration_minutes, commission_percent) VALUES
  ('Consulta',150,30,50),('Retorno',0,20,0),('Procedimento',300,60,40);


-- ============================================================
-- FASE 1: Acompanhamentos (Treatments) — Fundação de Dados
-- ============================================================

-- 1. TREATMENTS -----------------------------------------------
CREATE TABLE public.treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  objective TEXT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'em_andamento'
    CHECK (status IN ('em_andamento','pausado','finalizado','cancelado')),
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  down_payment NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  installments_count INTEGER NOT NULL DEFAULT 1,
  payment_method TEXT,
  color TEXT NOT NULL DEFAULT '#8B47FF',
  return_days INTEGER,
  next_return_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatments TO authenticated;
GRANT ALL ON public.treatments TO service_role;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all treatments" ON public.treatments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_treatments_updated BEFORE UPDATE ON public.treatments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE INDEX idx_treatments_patient ON public.treatments(patient_id);
CREATE INDEX idx_treatments_doctor ON public.treatments(doctor_id);
CREATE INDEX idx_treatments_status ON public.treatments(status);

-- 2. TREATMENT_MEDICATIONS ------------------------------------
CREATE TABLE public.treatment_medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id UUID NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,
  unit TEXT,
  route TEXT,
  frequency TEXT,
  period TEXT CHECK (period IN ('manha','tarde','noite','diario','semanal','mensal') OR period IS NULL),
  schedule_times JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_date DATE,
  end_date DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo','suspenso','finalizado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_medications TO authenticated;
GRANT ALL ON public.treatment_medications TO service_role;
ALTER TABLE public.treatment_medications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all tmed" ON public.treatment_medications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_tmed_updated BEFORE UPDATE ON public.treatment_medications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE INDEX idx_tmed_treatment ON public.treatment_medications(treatment_id);

-- 3. TREATMENT_INSTALLMENTS -----------------------------------
CREATE TABLE public.treatment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id UUID NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  due_date DATE NOT NULL,
  paid_date DATE,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pago','pendente','atrasado','cancelado','renegociado')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_installments TO authenticated;
GRANT ALL ON public.treatment_installments TO service_role;
ALTER TABLE public.treatment_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all tinst" ON public.treatment_installments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_tinst_updated BEFORE UPDATE ON public.treatment_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE INDEX idx_tinst_treatment ON public.treatment_installments(treatment_id);
CREATE INDEX idx_tinst_status ON public.treatment_installments(status);
CREATE INDEX idx_tinst_due ON public.treatment_installments(due_date);

-- 4. TREATMENT_REMINDERS --------------------------------------
CREATE TABLE public.treatment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id UUID NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('7d','3d','day','overdue')),
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','whatsapp','email')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','lido','cancelado')),
  sent_at TIMESTAMPTZ,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_reminders TO authenticated;
GRANT ALL ON public.treatment_reminders TO service_role;
ALTER TABLE public.treatment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all trem" ON public.treatment_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_trem_updated BEFORE UPDATE ON public.treatment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE INDEX idx_trem_treatment ON public.treatment_reminders(treatment_id);
CREATE INDEX idx_trem_date ON public.treatment_reminders(target_date);

-- 5. Extensão em TRANSACTIONS para fonte única -----------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS treatment_id UUID REFERENCES public.treatments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installment_id UUID REFERENCES public.treatment_installments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_treatment ON public.transactions(treatment_id);
CREATE INDEX IF NOT EXISTS idx_transactions_installment ON public.transactions(installment_id);

-- 6. TRIGGER: sincroniza parcela → transactions (fonte única) --
CREATE OR REPLACE FUNCTION public.sync_installment_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient_id UUID;
  v_doctor_id UUID;
  v_treatment_title TEXT;
BEGIN
  SELECT patient_id, doctor_id, title
    INTO v_patient_id, v_doctor_id, v_treatment_title
    FROM public.treatments WHERE id = NEW.treatment_id;

  IF NEW.status = 'pago' AND NEW.paid_date IS NOT NULL THEN
    -- Upsert transaction linked to this installment
    IF EXISTS (SELECT 1 FROM public.transactions WHERE installment_id = NEW.id) THEN
      UPDATE public.transactions
        SET amount = NEW.amount,
            date = NEW.paid_date,
            status = 'pago',
            payment_method = COALESCE(NEW.payment_method, payment_method),
            description = 'Acompanhamento: ' || COALESCE(v_treatment_title,'') || ' — Parcela ' || NEW.number,
            updated_at = now()
        WHERE installment_id = NEW.id;
    ELSE
      INSERT INTO public.transactions
        (type, amount, date, status, description, payment_method, patient_id, doctor_id, treatment_id, installment_id)
      VALUES
        ('receita', NEW.amount, NEW.paid_date, 'pago',
         'Acompanhamento: ' || COALESCE(v_treatment_title,'') || ' — Parcela ' || NEW.number,
         COALESCE(NEW.payment_method,'dinheiro'), v_patient_id, v_doctor_id, NEW.treatment_id, NEW.id);
    END IF;
  ELSIF NEW.status IN ('cancelado') THEN
    UPDATE public.transactions SET status = 'cancelado', updated_at = now()
      WHERE installment_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_installment_sync
  AFTER INSERT OR UPDATE OF status, paid_date, amount ON public.treatment_installments
  FOR EACH ROW EXECUTE FUNCTION public.sync_installment_transaction();

-- 7. FUNCTION: gera parcelas automaticamente --------------------
CREATE OR REPLACE FUNCTION public.generate_treatment_installments(
  p_treatment_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
  v_down NUMERIC;
  v_discount NUMERIC;
  v_count INTEGER;
  v_start DATE;
  v_method TEXT;
  v_installment_value NUMERIC;
  i INTEGER;
BEGIN
  SELECT total_value, down_payment, discount, installments_count, start_date, payment_method
    INTO v_total, v_down, v_discount, v_count, v_start, v_method
    FROM public.treatments WHERE id = p_treatment_id;

  DELETE FROM public.treatment_installments
    WHERE treatment_id = p_treatment_id AND status = 'pendente';

  IF v_count IS NULL OR v_count < 1 THEN v_count := 1; END IF;
  v_installment_value := ROUND(((v_total - COALESCE(v_down,0) - COALESCE(v_discount,0)) / v_count)::numeric, 2);

  FOR i IN 1..v_count LOOP
    INSERT INTO public.treatment_installments
      (treatment_id, number, amount, due_date, payment_method, status)
    VALUES
      (p_treatment_id, i, v_installment_value,
       (v_start + (i * INTERVAL '1 month'))::DATE,
       v_method, 'pendente');
  END LOOP;
END;
$$;

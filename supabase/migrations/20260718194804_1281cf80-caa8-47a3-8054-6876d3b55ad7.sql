
-- ============ FASE 1: Fundação de integração + auditoria universal (v2) ============

-- 1) TASKS
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  treatment_id UUID REFERENCES public.treatments(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  exam_order_id UUID REFERENCES public.exam_orders(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  assigned_to UUID,
  origin TEXT NOT NULL DEFAULT 'manual',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.tasks TO anon, authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_all" ON public.tasks;
CREATE POLICY "tasks_all" ON public.tasks FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_patient ON public.tasks(patient_id);
CREATE INDEX IF NOT EXISTS idx_tasks_treatment ON public.tasks(treatment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON public.tasks(assigned_to);
DROP TRIGGER IF EXISTS trg_tasks_updated ON public.tasks;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2) NOTIFICATIONS +
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS action_url TEXT,
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delegated_to UUID;
CREATE INDEX IF NOT EXISTS idx_notif_archived ON public.notifications(archived);
CREATE INDEX IF NOT EXISTS idx_notif_category ON public.notifications(category);

-- 3) ACTIVITY LOG
CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  actor_id UUID,
  ip TEXT,
  user_agent TEXT,
  old_data JSONB,
  new_data JSONB,
  changed_fields TEXT[],
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.activity_log TO anon, authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity_log_read" ON public.activity_log;
DROP POLICY IF EXISTS "activity_log_insert" ON public.activity_log;
CREATE POLICY "activity_log_read" ON public.activity_log FOR SELECT USING (true);
CREATE POLICY "activity_log_insert" ON public.activity_log FOR INSERT WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON public.activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON public.activity_log(created_at DESC);

-- 4) ATTACHMENTS + document_comments
ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_attachment_id UUID REFERENCES public.attachments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[],
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS treatment_id UUID REFERENCES public.treatments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_favorite ON public.attachments(is_favorite);
CREATE INDEX IF NOT EXISTS idx_attachments_tags ON public.attachments USING GIN(tags);

CREATE TABLE IF NOT EXISTS public.document_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES public.attachments(id) ON DELETE CASCADE,
  author_id UUID,
  author_name TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.document_comments TO anon, authenticated;
GRANT ALL ON public.document_comments TO service_role;
ALTER TABLE public.document_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "document_comments_all" ON public.document_comments;
CREATE POLICY "document_comments_all" ON public.document_comments FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_doc_comments_attachment ON public.document_comments(attachment_id);

-- 5) PIPELINE
CREATE TABLE IF NOT EXISTS public.patient_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#8B47FF',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_terminal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.patient_pipeline_stages TO anon, authenticated;
GRANT ALL ON public.patient_pipeline_stages TO service_role;
ALTER TABLE public.patient_pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_stages_all" ON public.patient_pipeline_stages;
CREATE POLICY "pipeline_stages_all" ON public.patient_pipeline_stages FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.patient_pipeline_stages (name, color, sort_order, is_terminal)
SELECT * FROM (VALUES
  ('Lead', '#94A3B8', 1, false),
  ('Contato', '#3B82F6', 2, false),
  ('Consulta Agendada', '#8B47FF', 3, false),
  ('Em Tratamento', '#22C55E', 4, false),
  ('Ativo', '#10B981', 5, false),
  ('Alta / Inativo', '#64748B', 6, true)
) AS v(name, color, sort_order, is_terminal)
WHERE NOT EXISTS (SELECT 1 FROM public.patient_pipeline_stages);

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID REFERENCES public.patient_pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS public.patient_pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES public.patient_pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID REFERENCES public.patient_pipeline_stages(id) ON DELETE SET NULL,
  moved_by UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.patient_pipeline_history TO anon, authenticated;
GRANT ALL ON public.patient_pipeline_history TO service_role;
ALTER TABLE public.patient_pipeline_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_history_all" ON public.patient_pipeline_history;
CREATE POLICY "pipeline_history_all" ON public.patient_pipeline_history FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_patient ON public.patient_pipeline_history(patient_id);

-- 6) AUDITORIA GENÉRICA
CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_changed TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log(entity_type, entity_id, action, actor_id, new_data)
      VALUES (TG_TABLE_NAME, NEW.id, 'insert', v_actor, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF to_jsonb(NEW)->v_key IS DISTINCT FROM to_jsonb(OLD)->v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF array_length(v_changed,1) > 0 THEN
      INSERT INTO public.activity_log(entity_type, entity_id, action, actor_id, old_data, new_data, changed_fields)
        VALUES (TG_TABLE_NAME, NEW.id, 'update', v_actor, to_jsonb(OLD), to_jsonb(NEW), v_changed);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.activity_log(entity_type, entity_id, action, actor_id, old_data)
      VALUES (TG_TABLE_NAME, OLD.id, 'delete', v_actor, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_patients ON public.patients;
CREATE TRIGGER trg_audit_patients AFTER INSERT OR UPDATE OR DELETE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_audit_treatments ON public.treatments;
CREATE TRIGGER trg_audit_treatments AFTER INSERT OR UPDATE OR DELETE ON public.treatments
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_audit_appointments ON public.appointments;
CREATE TRIGGER trg_audit_appointments AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_audit_medical_records ON public.medical_records;
CREATE TRIGGER trg_audit_medical_records AFTER INSERT OR UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_audit_prescriptions ON public.prescriptions;
CREATE TRIGGER trg_audit_prescriptions AFTER INSERT OR UPDATE OR DELETE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_audit_exam_orders ON public.exam_orders;
CREATE TRIGGER trg_audit_exam_orders AFTER INSERT OR UPDATE OR DELETE ON public.exam_orders
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_audit_tasks ON public.tasks;
CREATE TRIGGER trg_audit_tasks AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- 7) AUTOMAÇÃO: paciente novo
CREATE OR REPLACE FUNCTION public.on_patient_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage UUID;
BEGIN
  SELECT id INTO v_stage FROM public.patient_pipeline_stages ORDER BY sort_order ASC LIMIT 1;
  IF v_stage IS NOT NULL AND NEW.pipeline_stage_id IS NULL THEN
    UPDATE public.patients SET pipeline_stage_id = v_stage WHERE id = NEW.id;
    INSERT INTO public.patient_pipeline_history(patient_id, to_stage_id, reason)
      VALUES (NEW.id, v_stage, 'Criação automática');
  END IF;

  INSERT INTO public.tasks (title, description, patient_id, priority, origin, status, due_date)
    VALUES ('Primeira consulta',
            'Agendar primeira consulta com ' || COALESCE(NEW.name, 'paciente'),
            NEW.id, 'alta', 'auto_paciente', 'pendente',
            now() + INTERVAL '3 days');

  INSERT INTO public.notifications(title, message, type, category, entity_type, entity_id, priority)
    VALUES ('Novo paciente cadastrado',
            COALESCE(NEW.name, 'Paciente') || ' foi adicionado ao sistema',
            'info', 'sistema', 'patient', NEW.id, 'normal');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_patient_created ON public.patients;
CREATE TRIGGER trg_on_patient_created AFTER INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.on_patient_created();

-- 8) AUTOMAÇÃO: acompanhamento novo
CREATE OR REPLACE FUNCTION public.on_treatment_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tasks (title, patient_id, treatment_id, priority, origin, status, due_date) VALUES
    ('Anamnese inicial do acompanhamento', NEW.patient_id, NEW.id, 'alta', 'auto_acompanhamento', 'pendente', now() + INTERVAL '1 day'),
    ('Definir plano terapêutico', NEW.patient_id, NEW.id, 'alta', 'auto_acompanhamento', 'pendente', now() + INTERVAL '2 days'),
    ('Primeira prescrição', NEW.patient_id, NEW.id, 'normal', 'auto_acompanhamento', 'pendente', now() + INTERVAL '3 days'),
    ('Agendar primeiro retorno', NEW.patient_id, NEW.id, 'normal', 'auto_acompanhamento', 'pendente', now() + INTERVAL '7 days');

  INSERT INTO public.notifications(title, message, type, category, entity_type, entity_id, priority)
    VALUES ('Novo acompanhamento iniciado', COALESCE(NEW.title, 'Acompanhamento') || ' criado',
            'success', 'sistema', 'treatment', NEW.id, 'normal');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_treatment_created ON public.treatments;
CREATE TRIGGER trg_on_treatment_created AFTER INSERT ON public.treatments
  FOR EACH ROW EXECUTE FUNCTION public.on_treatment_created();

-- 9) AUTOMAÇÃO: consulta agendada (usa date + start_time reais)
CREATE OR REPLACE FUNCTION public.on_appointment_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_when TIMESTAMPTZ;
BEGIN
  v_when := (NEW.date::TIMESTAMP + COALESCE(NEW.start_time, '09:00'::TIME))::TIMESTAMPTZ;

  INSERT INTO public.notifications(title, message, type, category, entity_type, entity_id, priority, action_url)
    VALUES ('Nova consulta agendada',
            'Consulta em ' || to_char(v_when, 'DD/MM/YYYY HH24:MI'),
            'info', 'agenda', 'appointment', NEW.id, 'normal', '/agenda');

  INSERT INTO public.notifications(title, message, type, category, entity_type, entity_id, priority, snoozed_until)
    VALUES ('Lembrete: consulta amanhã',
            'Consulta em ' || to_char(v_when, 'DD/MM/YYYY HH24:MI'),
            'warning', 'agenda', 'appointment', NEW.id, 'alta',
            v_when - INTERVAL '24 hours');

  INSERT INTO public.tasks (title, patient_id, appointment_id, priority, origin, status, due_date)
    VALUES ('Preparar consulta', NEW.patient_id, NEW.id, 'normal', 'auto_consulta', 'pendente',
            v_when - INTERVAL '2 hours');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_appointment_created ON public.appointments;
CREATE TRIGGER trg_on_appointment_created AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.on_appointment_created();

-- 10) AUTOMAÇÃO: exame criado
CREATE OR REPLACE FUNCTION public.on_exam_order_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tasks (title, patient_id, exam_order_id, priority, origin, status, due_date)
    VALUES ('Acompanhar resultado: ' || COALESCE(NEW.exam_name,'exame'),
            NEW.patient_id, NEW.id, 'normal', 'auto_exame', 'pendente',
            now() + INTERVAL '7 days');

  INSERT INTO public.notifications(title, message, type, category, entity_type, entity_id, priority)
    VALUES ('Novo exame solicitado', COALESCE(NEW.exam_name,'Exame') || ' registrado',
            'info', 'exame', 'exam_order', NEW.id, 'normal');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_exam_order_created ON public.exam_orders;
CREATE TRIGGER trg_on_exam_order_created AFTER INSERT ON public.exam_orders
  FOR EACH ROW EXECUTE FUNCTION public.on_exam_order_created();

-- 11) AUTOMAÇÃO: parcela paga
CREATE OR REPLACE FUNCTION public.on_installment_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pago' AND (OLD.status IS DISTINCT FROM 'pago') THEN
    INSERT INTO public.notifications(title, message, type, category, entity_type, entity_id, priority)
      VALUES ('Pagamento recebido',
              'Parcela ' || NEW.number || ' — R$ ' || to_char(NEW.amount, 'FM999G999D00'),
              'success', 'financeiro', 'installment', NEW.id, 'normal');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_installment_paid ON public.treatment_installments;
CREATE TRIGGER trg_on_installment_paid AFTER UPDATE ON public.treatment_installments
  FOR EACH ROW EXECUTE FUNCTION public.on_installment_paid();

-- 12) BUSCA GLOBAL (colunas reais)
CREATE OR REPLACE VIEW public.global_search_view AS
  SELECT 'patient'::TEXT AS kind, id, name AS label,
         COALESCE(email,'') || ' ' || COALESCE(phone,'') || ' ' || COALESCE(cpf,'') AS extra,
         created_at
    FROM public.patients
  UNION ALL
  SELECT 'treatment', id, COALESCE(title, 'Acompanhamento'), COALESCE(status,''), created_at
    FROM public.treatments
  UNION ALL
  SELECT 'appointment', id, COALESCE(type, 'Consulta'),
         to_char(date, 'DD/MM/YYYY') || ' ' || COALESCE(start_time::TEXT,''), created_at
    FROM public.appointments
  UNION ALL
  SELECT 'transaction', id, COALESCE(description, 'Transação'),
         type || ' - ' || status || ' - R$ ' || to_char(amount, 'FM999G999D00'), created_at
    FROM public.transactions
  UNION ALL
  SELECT 'task', id, title, COALESCE(status,''), created_at
    FROM public.tasks
  UNION ALL
  SELECT 'exam_order', id, COALESCE(exam_name, 'Exame'), COALESCE(status,''), created_at
    FROM public.exam_orders;

GRANT SELECT ON public.global_search_view TO anon, authenticated;

-- 13) REALTIME (ignora se já publicado)
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.treatments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.patients; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

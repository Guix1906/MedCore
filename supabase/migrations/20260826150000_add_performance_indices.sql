-- =========================================================
-- ÍNDICES DE ALTA PERFORMANCE E ISOLAMENTO MULTI-TENANT
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_patients_company ON public.patients(company_id);
CREATE INDEX IF NOT EXISTS idx_patients_cpf ON public.patients(cpf);
CREATE INDEX IF NOT EXISTS idx_patients_name ON public.patients(company_id, name);

CREATE INDEX IF NOT EXISTS idx_appointments_company ON public.appointments(company_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date_time ON public.appointments(company_id, date, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON public.appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON public.appointments(doctor_id);

CREATE INDEX IF NOT EXISTS idx_medical_records_company ON public.medical_records(company_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON public.medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_record ON public.prescriptions(medical_record_id);

CREATE INDEX IF NOT EXISTS idx_treatments_company ON public.treatments(company_id);
CREATE INDEX IF NOT EXISTS idx_treatments_patient ON public.treatments(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatment_installments_treatment ON public.treatment_installments(treatment_id);

CREATE INDEX IF NOT EXISTS idx_transactions_company ON public.transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_status ON public.transactions(company_id, date, status);
CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON public.transactions(company_id, type, status);

CREATE INDEX IF NOT EXISTS idx_tasks_company_due ON public.tasks(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read);

-- =============================================================================
-- Migration: 20260930120000_clinical_records_hardening.sql
-- MedCore: prontuario com valor legal, acesso anonimo e LGPD (auditoria de 30/09/2026).
--
--  1. Revoga todo acesso de "anon" as tabelas e views de public e remove politicas
--     abertas (USING true) destinadas a public/anon. Antes, sinais vitais, pedidos de
--     exame, anexos, comentarios e historico de funil aceitavam acesso anonimo.
--  2. Tabelas clinicas voltam a exigir equipe da clinica (is_clinic_member).
--  3. Prontuario:
--       - cada alteracao guarda a versao anterior (medical_record_versions);
--       - prontuario finalizado nao pode ser excluido;
--       - prontuario assinado (signed_at) nao pode ser alterado: so adendos;
--       - colunas para assinatura digital (ICP-Brasil), preenchidas pelo provedor.
--  4. Adendos (medical_record_addenda) para complementar prontuarios assinados.
--  5. Registro de acesso ao prontuario (record_access_log + log_record_access).
--  6. Consentimento LGPD do paciente (patient_consents + register_patient_consent).
--
-- Aplicar depois de 20260929120000_security_hardening.sql, inteiro, em homologacao
-- primeiro. Reaplicavel.
-- =============================================================================

BEGIN;

-- 1. Acesso anonimo --------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p') LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
  END LOOP;

  -- Politicas permissivas "true" abertas a public/anon
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
             AND (roles && ARRAY['public', 'anon']::name[])
             AND (qual = 'true' OR with_check = 'true') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 2. Equipe da clinica nas tabelas clinicas que ficaram sem politica -------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vital_signs', 'attachments', 'exam_orders', 'document_comments', 'patient_pipeline_history'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_clinic_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING ((SELECT public.is_clinic_member())) WITH CHECK ((SELECT public.is_clinic_member()))',
      t || '_clinic_all', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- 3. Prontuario: versoes, finalizacao e assinatura -------------------------------
ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS signature_provider text,
  ADD COLUMN IF NOT EXISTS signature_hash text,
  ADD COLUMN IF NOT EXISTS signature_document_url text;

CREATE TABLE IF NOT EXISTS public.medical_record_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('update', 'delete')),
  data jsonb NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medical_record_versions_record_idx
  ON public.medical_record_versions (record_id, id DESC);
ALTER TABLE public.medical_record_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medical_record_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.medical_record_versions TO authenticated;
GRANT ALL ON public.medical_record_versions TO service_role;
DROP POLICY IF EXISTS medical_record_versions_read ON public.medical_record_versions;
CREATE POLICY medical_record_versions_read ON public.medical_record_versions
  FOR SELECT TO authenticated USING ((SELECT public.has_any_permission('records.view')));

CREATE OR REPLACE FUNCTION public.medical_records_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.finished_at IS NOT NULL OR OLD.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Prontuario finalizado nao pode ser excluido (guarda obrigatoria de 20 anos).'
        USING ERRCODE = '42501', HINT = 'clinical.retention';
    END IF;
    INSERT INTO public.medical_record_versions (record_id, patient_id, action, data, changed_by)
      VALUES (OLD.id, OLD.patient_id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;

  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Prontuario assinado nao pode ser alterado. Registre um adendo.'
      USING ERRCODE = '42501', HINT = 'clinical.signed';
  END IF;

  INSERT INTO public.medical_record_versions (record_id, patient_id, action, data, changed_by)
    VALUES (OLD.id, OLD.patient_id, 'update', to_jsonb(OLD), auth.uid());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.medical_records_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS medical_records_guard ON public.medical_records;
CREATE TRIGGER medical_records_guard
  BEFORE UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.medical_records_guard();

-- 4. Adendos ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medical_record_addenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.medical_records(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  content text NOT NULL CHECK (length(btrim(content)) >= 3),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medical_record_addenda_record_idx
  ON public.medical_record_addenda (record_id, created_at);
ALTER TABLE public.medical_record_addenda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medical_record_addenda FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.medical_record_addenda TO authenticated;
GRANT ALL ON public.medical_record_addenda TO service_role;
DROP POLICY IF EXISTS medical_record_addenda_read ON public.medical_record_addenda;
CREATE POLICY medical_record_addenda_read ON public.medical_record_addenda
  FOR SELECT TO authenticated USING ((SELECT public.has_any_permission('records.view')));
DROP POLICY IF EXISTS medical_record_addenda_insert ON public.medical_record_addenda;
CREATE POLICY medical_record_addenda_insert ON public.medical_record_addenda
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_any_permission('records.edit')) AND author_id = auth.uid());

-- Adendos nao podem ser alterados nem apagados
CREATE OR REPLACE FUNCTION public.medical_record_addenda_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Adendos nao podem ser alterados ou excluidos.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.medical_record_addenda_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS medical_record_addenda_immutable ON public.medical_record_addenda;
CREATE TRIGGER medical_record_addenda_immutable
  BEFORE UPDATE OR DELETE ON public.medical_record_addenda
  FOR EACH ROW EXECUTE FUNCTION public.medical_record_addenda_immutable();

-- 5. Registro de acesso ao prontuario -----------------------------------------
CREATE TABLE IF NOT EXISTS public.record_access_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'view' CHECK (action IN ('view', 'export', 'print')),
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_access_log_patient_idx
  ON public.record_access_log (patient_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS record_access_log_user_idx
  ON public.record_access_log (user_id, accessed_at DESC);
ALTER TABLE public.record_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.record_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.record_access_log TO authenticated;
GRANT ALL ON public.record_access_log TO service_role;
DROP POLICY IF EXISTS record_access_log_read ON public.record_access_log;
CREATE POLICY record_access_log_read ON public.record_access_log
  FOR SELECT TO authenticated USING ((SELECT public.has_any_permission('audit.view')));

CREATE OR REPLACE FUNCTION public.log_record_access(p_patient_id uuid, p_action text DEFAULT 'view')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_permission('records.view') THEN
    RETURN;
  END IF;
  -- Evita uma linha por recarga: no maximo uma por usuario/paciente/acao a cada 10 minutos
  IF EXISTS (
    SELECT 1 FROM public.record_access_log
     WHERE user_id = auth.uid() AND patient_id = p_patient_id AND action = p_action
       AND accessed_at > now() - interval '10 minutes'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.record_access_log (user_id, patient_id, action)
    VALUES (auth.uid(), p_patient_id, p_action);
END;
$$;
REVOKE ALL ON FUNCTION public.log_record_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_record_access(uuid, text) TO authenticated;

-- 6. Consentimento LGPD -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'tratamento_dados_saude',
  term_version text NOT NULL DEFAULT '1.0',
  channel text NOT NULL DEFAULT 'presencial',
  given_at timestamptz NOT NULL DEFAULT now(),
  registered_by uuid NOT NULL DEFAULT auth.uid(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS patient_consents_patient_idx ON public.patient_consents (patient_id);
ALTER TABLE public.patient_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.patient_consents TO authenticated;
GRANT ALL ON public.patient_consents TO service_role;
DROP POLICY IF EXISTS patient_consents_read ON public.patient_consents;
CREATE POLICY patient_consents_read ON public.patient_consents
  FOR SELECT TO authenticated USING ((SELECT public.has_any_permission('patients.view')));

CREATE OR REPLACE FUNCTION public.register_patient_consent(
  p_patient_id uuid,
  p_term_version text DEFAULT '1.0',
  p_channel text DEFAULT 'presencial'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_permission('patients.manage') THEN
    RAISE EXCEPTION 'Sem permissao para registrar consentimento' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id) THEN
    RAISE EXCEPTION 'Paciente nao encontrado';
  END IF;
  INSERT INTO public.patient_consents (patient_id, term_version, channel)
    VALUES (p_patient_id, COALESCE(NULLIF(btrim(p_term_version), ''), '1.0'),
            COALESCE(NULLIF(btrim(p_channel), ''), 'presencial'))
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_patient_consent(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_patient_consent(uuid, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferencia 1: nao pode restar nenhuma linha.
SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'anon' AND table_schema = 'public';

-- Conferencia 2: funcoes de public ainda executaveis por anon (revisar uma a uma).
SELECT p.oid::regprocedure AS funcao
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   AND has_function_privilege('anon', p.oid, 'execute')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

-- Conferencia 3: politicas ainda abertas (true) para usuarios logados, a revisar.
SELECT tablename, policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND (qual = 'true' OR with_check = 'true');

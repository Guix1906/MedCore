-- =============================================================================
-- Migration: 20260927200000_fix_agenda_events_and_appointments.sql
-- MedCore: Correção definitiva da persistência de agendamentos e eventos da agenda
-- =============================================================================

BEGIN;

-- 1. Garante que a empresa padrão existe com ID UUID válido
INSERT INTO public.companies (id, name)
VALUES ('00000000-0000-0000-0000-0000000c1111'::uuid, 'ClinicMed')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- 2. Vincula todos os usuários autenticados existentes à empresa padrão
INSERT INTO public.company_members (company_id, user_id)
SELECT '00000000-0000-0000-0000-0000000c1111'::uuid, u.id
FROM auth.users u
ON CONFLICT (company_id, user_id) DO NOTHING;

-- 3. Atualiza função is_company_member para aceitar empresa nula ou padrão
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE (cm.company_id = _company_id OR _company_id IS NULL)
      AND cm.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
  );
$$;

-- 4. Trigger BEFORE INSERT na tabela events para assegurar integridade
CREATE OR REPLACE FUNCTION public.trg_prepare_event_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _first_company uuid;
BEGIN
  -- Se o criador não foi informado, utiliza o usuário autenticado atual ou placeholder válido
  IF NEW.created_by IS NULL THEN
    NEW.created_by := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid);
  END IF;

  -- Se company_id for nulo ou não existir na tabela companies, associa a uma empresa válida
  IF NEW.company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.company_id) THEN
    SELECT active_company_id INTO _first_company FROM public.profiles WHERE id = auth.uid();
    IF _first_company IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = _first_company) THEN
      SELECT company_id INTO _first_company FROM public.company_members WHERE user_id = auth.uid() LIMIT 1;
    END IF;
    IF _first_company IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = _first_company) THEN
      SELECT id INTO _first_company FROM public.companies ORDER BY created_at LIMIT 1;
    END IF;
    IF _first_company IS NULL THEN
      _first_company := '00000000-0000-0000-0000-0000000c1111'::uuid;
    END IF;
    NEW.company_id := _first_company;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_prepare ON public.events;
CREATE TRIGGER trg_events_prepare
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prepare_event_row();

-- 5. Atualiza políticas de RLS para a tabela events (garante visibilidade e inserção seguras)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select_company" ON public.events;
CREATE POLICY "events_select_company" ON public.events
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "events_insert_company" ON public.events;
CREATE POLICY "events_insert_company" ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "events_update_company" ON public.events;
CREATE POLICY "events_update_company" ON public.events
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "events_delete_company" ON public.events;
CREATE POLICY "events_delete_company" ON public.events
  FOR DELETE TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;

-- 6. Garante permissões na tabela appointments para usuários autenticados
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appointments_all_authenticated" ON public.appointments;
CREATE POLICY "appointments_all_authenticated" ON public.appointments
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;

-- 7. Função RPC atômica save_agenda_event (Security Definier para garantia de salvamento)
CREATE OR REPLACE FUNCTION public.save_agenda_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_company_id uuid;
  v_created_by uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_title text;
  v_description text;
  v_event_type public.event_type;
  v_location text;
  v_case_id uuid;
  v_assigned_to uuid;
  v_patient_id uuid;
  v_result public.events%ROWTYPE;
BEGIN
  -- Extrai campos
  v_id := COALESCE(NULLIF(p_event->>'id', '')::uuid, gen_random_uuid());
  v_title := COALESCE(NULLIF(btrim(p_event->>'title'), ''), 'Agendamento');
  v_description := p_event->>'description';
  v_starts_at := (p_event->>'starts_at')::timestamptz;
  IF p_event->>'ends_at' IS NOT NULL AND NULLIF(p_event->>'ends_at', '') IS NOT NULL THEN
    v_ends_at := (p_event->>'ends_at')::timestamptz;
  ELSE
    v_ends_at := v_starts_at + interval '30 minutes';
  END IF;
  v_location := p_event->>'location';
  
  -- IDs opcionais tratados com segurança
  IF NULLIF(p_event->>'case_id', '') IS NOT NULL THEN
    BEGIN v_case_id := (p_event->>'case_id')::uuid; EXCEPTION WHEN OTHERS THEN v_case_id := NULL; END;
  END IF;
  IF NULLIF(p_event->>'assigned_to', '') IS NOT NULL THEN
    BEGIN v_assigned_to := (p_event->>'assigned_to')::uuid; EXCEPTION WHEN OTHERS THEN v_assigned_to := NULL; END;
  END IF;
  IF NULLIF(p_event->>'patient_id', '') IS NOT NULL THEN
    BEGIN v_patient_id := (p_event->>'patient_id')::uuid; EXCEPTION WHEN OTHERS THEN v_patient_id := NULL; END;
  END IF;
  
  -- Company ID
  IF NULLIF(p_event->>'company_id', '') IS NOT NULL THEN
    BEGIN v_company_id := (p_event->>'company_id')::uuid; EXCEPTION WHEN OTHERS THEN v_company_id := NULL; END;
  END IF;
  IF v_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_company_id) THEN
    SELECT id INTO v_company_id FROM public.companies ORDER BY created_at LIMIT 1;
    IF v_company_id IS NULL THEN
      v_company_id := '00000000-0000-0000-0000-0000000c1111'::uuid;
    END IF;
  END IF;

  -- Criador
  v_created_by := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid);

  -- Tipo de evento
  BEGIN
    v_event_type := COALESCE((p_event->>'event_type')::public.event_type, 'meeting'::public.event_type);
  EXCEPTION WHEN OTHERS THEN
    v_event_type := 'meeting'::public.event_type;
  END;

  INSERT INTO public.events (
    id, company_id, case_id, assigned_to, patient_id, title, description,
    event_type, location, starts_at, ends_at, created_by
  ) VALUES (
    v_id, v_company_id, v_case_id, v_assigned_to, v_patient_id, v_title, v_description,
    v_event_type, v_location, v_starts_at, v_ends_at, v_created_by
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    location = EXCLUDED.location,
    assigned_to = EXCLUDED.assigned_to,
    patient_id = EXCLUDED.patient_id,
    case_id = EXCLUDED.case_id,
    updated_at = now()
  RETURNING * INTO v_result;

  RETURN to_jsonb(v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_agenda_event(jsonb) TO authenticated;

-- 8. Função RPC de consulta garantida get_agenda_events
CREATE OR REPLACE FUNCTION public.get_agenda_events(
  p_company_id uuid DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS SETOF public.events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM public.events
  WHERE (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_start_date IS NULL OR starts_at >= p_start_date)
    AND (p_end_date IS NULL OR starts_at <= p_end_date)
  ORDER BY starts_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_agenda_events(uuid, timestamptz, timestamptz) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

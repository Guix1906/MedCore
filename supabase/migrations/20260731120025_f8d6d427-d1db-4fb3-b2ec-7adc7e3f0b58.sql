CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO authenticated, anon, service_role;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.get_my_doctor_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM public.doctors WHERE auth_id = auth.uid() LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.get_allowed_doctor_ids()
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_doctor_id uuid; v_role text;
BEGIN
  SELECT id, role INTO v_doctor_id, v_role FROM public.doctors WHERE auth_id = auth.uid() LIMIT 1;
  IF v_doctor_id IS NULL THEN RETURN; END IF;
  IF v_role IN ('admin','medico','recepcionista','enfermeiro') THEN
    RETURN QUERY SELECT id FROM public.doctors WHERE active = true;
  ELSE
    RETURN QUERY SELECT doctor_id FROM public.secretary_doctors WHERE secretary_id = v_doctor_id;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
BEGIN;

-- Orçamentos do paciente (aba Orçamento dentro do prontuário).
CREATE TABLE IF NOT EXISTS public.patient_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  -- [{ "descricao": text, "quantidade": number, "valor_unitario": number }]
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'recusado')),
  valid_until date,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_quotes_patient_idx
  ON public.patient_quotes (patient_id, created_at DESC);

ALTER TABLE public.patient_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_quotes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_quotes TO authenticated;

DROP POLICY IF EXISTS patient_quotes_read ON public.patient_quotes;
CREATE POLICY patient_quotes_read ON public.patient_quotes
  FOR SELECT TO authenticated USING ((SELECT public.has_any_permission('records.view')));

DROP POLICY IF EXISTS patient_quotes_write ON public.patient_quotes;
CREATE POLICY patient_quotes_write ON public.patient_quotes
  FOR ALL TO authenticated
  USING ((SELECT public.has_any_permission('records.edit')))
  WITH CHECK ((SELECT public.has_any_permission('records.edit')));

CREATE OR REPLACE FUNCTION public.patient_quotes_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS patient_quotes_touch ON public.patient_quotes;
CREATE TRIGGER patient_quotes_touch BEFORE UPDATE ON public.patient_quotes
  FOR EACH ROW EXECUTE FUNCTION public.patient_quotes_touch();

NOTIFY pgrst, 'reload schema';

COMMIT;

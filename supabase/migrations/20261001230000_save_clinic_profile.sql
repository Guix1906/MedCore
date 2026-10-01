BEGIN;

-- ============================================================================
-- "Dados da clínica" passa a valer em todo o sistema.
-- O nome exibido no menu, no Financeiro e nos comprovantes vem de companies.name
-- (a clínica padrão foi criada como "ClinicMed"), mas a tela salvava só em
-- clinic_settings. Esta função grava nos dois lugares.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_clinic_profile(p_company_id uuid, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(p_settings->>'clinic_name'), '');
  v_id uuid;
  v_row public.clinic_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR NOT public.has_permission(p_company_id, 'settings.manage') THEN
    RAISE EXCEPTION 'Sem permissao para alterar os dados da clinica' USING ERRCODE = '42501';
  END IF;

  -- Nome exibido no sistema
  IF v_name IS NOT NULL THEN
    UPDATE public.companies SET name = v_name WHERE id = p_company_id;
  END IF;

  -- Dados completos (tabela de configuração: um registro)
  SELECT id INTO v_id FROM public.clinic_settings ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.clinic_settings (clinic_name, cnpj, phone, email, address, opening_hours, primary_color)
    VALUES (
      v_name,
      NULLIF(btrim(p_settings->>'cnpj'), ''),
      NULLIF(btrim(p_settings->>'phone'), ''),
      NULLIF(btrim(p_settings->>'email'), ''),
      NULLIF(btrim(p_settings->>'address'), ''),
      NULLIF(btrim(p_settings->>'opening_hours'), ''),
      NULLIF(btrim(p_settings->>'primary_color'), '')
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.clinic_settings SET
      clinic_name = v_name,
      cnpj = NULLIF(btrim(p_settings->>'cnpj'), ''),
      phone = NULLIF(btrim(p_settings->>'phone'), ''),
      email = NULLIF(btrim(p_settings->>'email'), ''),
      address = NULLIF(btrim(p_settings->>'address'), ''),
      opening_hours = NULLIF(btrim(p_settings->>'opening_hours'), ''),
      primary_color = NULLIF(btrim(p_settings->>'primary_color'), '')
    WHERE id = v_id
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.save_clinic_profile(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_clinic_profile(uuid, jsonb) TO authenticated;

-- Se o nome já foi salvo em "Dados da clínica", aplica agora no lugar de "ClinicMed"
UPDATE public.companies c
   SET name = s.clinic_name
  FROM (
    SELECT clinic_name FROM public.clinic_settings
     WHERE NULLIF(btrim(clinic_name), '') IS NOT NULL
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1
  ) s
 WHERE c.id = '00000000-0000-0000-0000-0000000c1111'::uuid
   AND c.name = 'ClinicMed';

NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT id, name FROM public.companies ORDER BY name;

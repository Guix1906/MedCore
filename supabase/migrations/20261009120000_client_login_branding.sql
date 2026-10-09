-- =============================================================================
-- MedCore: tela de login com a identidade visual de cada cliente.
--
--  1. companies ganha o endereço do login (slug: meedcore.vercel.app/<slug>), a logo,
--     duas cores e a frase do painel da marca.
--  2. Bucket público "client-branding" para as logos; só a plataforma envia/apaga.
--  3. get_login_branding(slug): leitura pública (antes do login) só da identidade visual.
--  4. platform_save_client_branding: a plataforma grava a identidade de um cliente.
--  5. platform_list_clients devolve também a identidade visual.
--
-- Aplicar inteiro, de uma vez, no SQL Editor, DEPOIS de 20261008200000. Reaplicável.
-- =============================================================================

BEGIN;

-- 1. Identidade visual ---------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS brand_logo_url text,
  ADD COLUMN IF NOT EXISTS brand_logo_white boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS brand_primary text,
  ADD COLUMN IF NOT EXISTS brand_secondary text,
  ADD COLUMN IF NOT EXISTS brand_tagline text;

CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_key ON public.companies (slug) WHERE slug IS NOT NULL;

-- 2. Logos ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('client-branding', 'client-branding', true, 2097152,
        ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS client_branding_insert ON storage.objects;
CREATE POLICY client_branding_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-branding' AND public.is_platform_admin());
DROP POLICY IF EXISTS client_branding_update ON storage.objects;
CREATE POLICY client_branding_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-branding' AND public.is_platform_admin());
DROP POLICY IF EXISTS client_branding_delete ON storage.objects;
CREATE POLICY client_branding_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-branding' AND public.is_platform_admin());

-- 3. Leitura pública da identidade (só o que aparece na tela de login) ----------------
CREATE OR REPLACE FUNCTION public.get_login_branding(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'slug', c.slug, 'name', c.name, 'logo_url', c.brand_logo_url,
    'logo_white', c.brand_logo_white, 'primary', c.brand_primary,
    'secondary', c.brand_secondary, 'tagline', c.brand_tagline)
  FROM public.companies c
  WHERE c.slug = lower(btrim(p_slug)) AND c.status <> 'cancelled'
  LIMIT 1;
$$;

-- 4. Gravar a identidade de um cliente ------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_save_client_branding(p_company_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slug text := NULLIF(lower(btrim(COALESCE(p_data->>'slug', ''))), '');
  v_primary text := NULLIF(lower(btrim(COALESCE(p_data->>'primary', ''))), '');
  v_secondary text := NULLIF(lower(btrim(COALESCE(p_data->>'secondary', ''))), '');
  v_logo text := NULLIF(btrim(COALESCE(p_data->>'logo_url', '')), '');
  v_tagline text := NULLIF(btrim(COALESCE(p_data->>'tagline', '')), '');
BEGIN
  PERFORM public.platform_require();
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado' USING HINT = 'admin.not_found';
  END IF;
  IF v_slug IS NOT NULL THEN
    IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' THEN
      RAISE EXCEPTION 'Endereço do login: use de 3 a 50 letras minúsculas, números ou hífen (sem acento nem espaço)'
        USING HINT = 'admin.invalid_request';
    END IF;
    -- Nomes já usados pelas páginas do sistema
    IF v_slug = ANY (ARRAY['auth','login','admin','api','assets','dashboard','agenda','pacientes',
        'prontuario','acompanhamentos','financeiro','estoque','operacional','relatorios',
        'configuracoes','visao-geral','medcore','app','www','static','public']) THEN
      RAISE EXCEPTION 'O endereço "%" é reservado pelo sistema. Escolha outro.', v_slug
        USING HINT = 'admin.invalid_request';
    END IF;
    IF EXISTS (SELECT 1 FROM public.companies WHERE slug = v_slug AND id <> p_company_id) THEN
      RAISE EXCEPTION 'O endereço "%" já é de outro cliente. Escolha outro.', v_slug
        USING HINT = 'admin.invalid_request';
    END IF;
  END IF;
  IF (v_primary IS NOT NULL AND v_primary !~ '^#[0-9a-f]{6}$')
     OR (v_secondary IS NOT NULL AND v_secondary !~ '^#[0-9a-f]{6}$') THEN
    RAISE EXCEPTION 'Cor inválida: use o formato #RRGGBB' USING HINT = 'admin.invalid_request';
  END IF;
  IF length(COALESCE(v_logo, '')) > 1000 OR length(COALESCE(v_tagline, '')) > 200 THEN
    RAISE EXCEPTION 'Logo ou frase muito longa' USING HINT = 'admin.invalid_request';
  END IF;

  UPDATE public.companies SET
    slug = v_slug, brand_logo_url = v_logo, brand_primary = v_primary,
    brand_secondary = v_secondary, brand_tagline = v_tagline,
    brand_logo_white = COALESCE((p_data->>'logo_white')::boolean, true),
    updated_at = now()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('slug', v_slug);
END $$;

-- 5. Lista de clientes com a identidade visual ----------------------------------------
CREATE OR REPLACE FUNCTION public.platform_list_clients()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.platform_require();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'legal_name', c.legal_name, 'document', c.document,
      'contact_name', c.contact_name, 'phone', c.phone, 'email', c.email, 'address', c.address,
      'city', c.city, 'state', c.state, 'notes', c.notes, 'status', c.status,
      'status_reason', c.status_reason, 'status_changed_at', c.status_changed_at,
      'created_at', c.created_at,
      'slug', c.slug, 'brand_logo_url', c.brand_logo_url, 'brand_logo_white', c.brand_logo_white,
      'brand_primary', c.brand_primary, 'brand_secondary', c.brand_secondary,
      'brand_tagline', c.brand_tagline,
      'users', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'member_id', m.id, 'user_id', m.user_id, 'email', u.email,
          'full_name', COALESCE(NULLIF(btrim(p.full_name), ''), u.email),
          'status', m.status, 'status_reason', m.status_reason,
          'role', r.name, 'role_id', m.role_id,
          'is_owner', COALESCE(r.is_system AND r.key = 'owner', false),
          'is_platform_admin', EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = m.user_id),
          'last_sign_in_at', u.last_sign_in_at
        ) ORDER BY m.created_at)
        FROM public.company_members m
        LEFT JOIN auth.users u ON u.id = m.user_id
        LEFT JOIN public.profiles p ON p.id = m.user_id
        LEFT JOIN public.company_roles r ON r.id = m.role_id
        WHERE m.company_id = c.id AND m.status <> 'removed'), '[]'::jsonb),
      'roles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'key', r.key,
                                            'is_owner', r.is_system AND r.key = 'owner')
                         ORDER BY r.sort_order, lower(r.name))
        FROM public.company_roles r
        WHERE r.archived_at IS NULL AND (r.company_id IS NULL OR r.company_id = c.id)), '[]'::jsonb)
    ) ORDER BY c.created_at)
    FROM public.companies c), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.get_login_branding(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_save_client_branding(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_list_clients() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_login_branding(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_client_branding(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_clients() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

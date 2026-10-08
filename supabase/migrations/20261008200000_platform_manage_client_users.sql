-- =============================================================================
-- MedCore: administração da plataforma gerencia os usuários de cada cliente.
--
-- Na aba Clientes, o administrador da plataforma passa a:
--   * criar usuário em qualquer cliente escolhendo o perfil (antes: só Proprietário);
--   * editar nome e perfil, suspender, reativar e remover usuários de qualquer cliente;
--   * redefinir a senha de usuários dos clientes.
-- Tudo fica na auditoria do próprio cliente. Nenhum dado clínico é exposto.
--
-- Aplicar inteiro, de uma vez, no SQL Editor, DEPOIS de 20261008180000. Reaplicável.
-- =============================================================================

BEGIN;

-- Perfil válido para um cliente: perfil padrão do sistema ou criado pelo próprio cliente
CREATE OR REPLACE FUNCTION public.platform_valid_role(p_company_id uuid, p_role_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_roles r
                  WHERE r.id = p_role_id AND r.archived_at IS NULL
                    AND (r.company_id IS NULL OR r.company_id = p_company_id));
$$;

-- Lista de clientes: inclui perfil de cada usuário e perfis disponíveis do cliente
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

-- Criar usuário em um cliente, com o perfil escolhido (sem perfil = Proprietário)
DROP FUNCTION IF EXISTS public.platform_create_client_user(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.platform_create_client_user(
  p_company_id uuid, p_email text, p_password text, p_full_name text, p_role_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_name text := NULLIF(btrim(COALESCE(p_full_name, '')), '');
  v_role uuid;
  v_user uuid;
  v_used boolean := false;
  v_member uuid;
  v_existing boolean := false;
  v_is_platform boolean := false;
  v_removed jsonb := '[]'::jsonb;
  o public.company_members%ROWTYPE;
  v_before jsonb;
BEGIN
  PERFORM public.platform_require();
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado' USING HINT = 'admin.not_found';
  END IF;
  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido' USING HINT = 'admin.invalid_email';
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'A senha deve ter no mínimo 8 caracteres' USING HINT = 'admin.password_too_short';
  END IF;

  IF p_role_id IS NULL THEN
    SELECT id INTO v_role FROM public.company_roles WHERE is_system AND key = 'owner' LIMIT 1;
  ELSIF public.platform_valid_role(p_company_id, p_role_id) THEN
    v_role := p_role_id;
  END IF;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Escolha um perfil de acesso válido' USING HINT = 'admin.invalid_role';
  END IF;

  SELECT id, (email_confirmed_at IS NOT NULL OR last_sign_in_at IS NOT NULL)
    INTO v_user, v_used FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_email, crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', COALESCE(v_name, split_part(v_email, '@', 1))),
      now(), now(), '', '', '', ''
    );
    BEGIN
      INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id,
                                   last_sign_in_at, created_at, updated_at)
      VALUES (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', v_email),
              'email', v_email, now(), now(), now())
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO auth.identities (id, user_id, identity_data, provider,
                                     last_sign_in_at, created_at, updated_at)
        VALUES (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', v_email),
                'email', now(), now(), now())
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  ELSIF NOT v_used THEN
    -- Conta criada e nunca usada: recebe a senha informada
    UPDATE auth.users
       SET encrypted_password = crypt(p_password, gen_salt('bf')),
           email_confirmed_at = now(),
           raw_user_meta_data = raw_user_meta_data || jsonb_build_object('full_name', COALESCE(v_name, split_part(v_email, '@', 1))),
           updated_at = now()
     WHERE id = v_user;
  ELSE
    -- Conta já usada por alguém: só vincula; a senha continua a do dono da conta
    v_existing := true;
  END IF;

  v_is_platform := EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_user);

  -- Usuário de cliente pertence só ao próprio cliente: sai das outras clínicas
  IF NOT v_is_platform THEN
    FOR o IN
      SELECT * FROM public.company_members
       WHERE user_id = v_user AND company_id <> p_company_id AND status <> 'removed'
       FOR UPDATE
    LOOP
      IF o.status = 'active' AND public.company_role_is_owner(o.role_id)
         AND public.company_active_owner_count(o.company_id) <= 1 THEN
        RAISE EXCEPTION 'Este e-mail é o único proprietário de %. Use outro e-mail para o cliente novo.',
          (SELECT name FROM public.companies WHERE id = o.company_id)
          USING HINT = 'admin.last_owner';
      END IF;
      v_before := public.company_member_snapshot(o);
      UPDATE public.company_members
         SET status = 'removed',
             status_reason = 'Movido para outro cliente pela administração da plataforma',
             platform_paused = false, status_changed_at = now(), status_changed_by = auth.uid()
       WHERE id = o.id
       RETURNING * INTO o;
      PERFORM public.company_member_sync_legacy(o.id);
      PERFORM public.company_member_audit_write(o.company_id, 'member.remove', o.user_id, o.id, NULL,
        o.role_id, 'Movido para outro cliente pela administração da plataforma',
        v_before, public.company_member_snapshot(o));
      v_removed := v_removed || to_jsonb((SELECT name FROM public.companies WHERE id = o.company_id));
    END LOOP;
  END IF;

  -- Clínica aberta = este cliente (administrador da plataforma mantém a que estava usando)
  INSERT INTO public.profiles (id, full_name, active_company_id)
  VALUES (v_user, COALESCE(v_name, split_part(v_email, '@', 1)), p_company_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(btrim(public.profiles.full_name), ''), EXCLUDED.full_name),
    active_company_id = CASE WHEN v_is_platform THEN COALESCE(public.profiles.active_company_id, EXCLUDED.active_company_id)
                             ELSE EXCLUDED.active_company_id END;

  INSERT INTO public.company_members (company_id, user_id, role_id, status, agenda_scope,
                                      agenda_professional_ids, status_changed_at, status_changed_by)
  VALUES (p_company_id, v_user, v_role, 'active', 'all', '{}', now(), auth.uid())
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role_id = EXCLUDED.role_id, extra_permissions = '{}', revoked_permissions = '{}',
    status = 'active', status_reason = NULL,
    platform_paused = false, status_changed_at = now(), status_changed_by = auth.uid()
  RETURNING id INTO v_member;
  PERFORM public.company_member_sync_legacy(v_member);

  INSERT INTO public.company_member_audit (company_id, actor_id, target_user_id, member_id, role_id,
                                           action, reason, data_after)
  VALUES (p_company_id, auth.uid(), v_user, v_member, v_role, 'member.create',
          'Usuário do cliente criado pela administração da plataforma',
          jsonb_build_object('email', v_email, 'full_name', v_name, 'existing_account', v_existing,
                             'removed_from', v_removed));

  RETURN jsonb_build_object('user_id', v_user, 'member_id', v_member, 'email', v_email,
                            'existing_account', v_existing, 'removed_from', v_removed);
END $$;

-- Editar usuário de um cliente: nome, perfil e situação (ativo / suspenso / removido)
CREATE OR REPLACE FUNCTION public.platform_update_client_user(
  p_member_id uuid, p_full_name text, p_role_id uuid, p_status text, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.company_members%ROWTYPE;
  v_before jsonb;
  v_name text := NULLIF(btrim(COALESCE(p_full_name, '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_role uuid;
  v_action text;
  v_was_owner boolean;
  v_will_owner boolean;
BEGIN
  PERFORM public.platform_require();
  SELECT * INTO m FROM public.company_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR m.status = 'removed' THEN
    RAISE EXCEPTION 'Usuário não encontrado' USING HINT = 'admin.not_found';
  END IF;
  IF p_status NOT IN ('active', 'suspended', 'removed') THEN
    RAISE EXCEPTION 'Situação inválida' USING HINT = 'admin.invalid_status';
  END IF;
  IF p_status <> 'active' AND (v_reason IS NULL OR length(v_reason) < 5) THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 5 caracteres' USING HINT = 'admin.reason_required';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 120 THEN
    RAISE EXCEPTION 'Nome muito longo' USING HINT = 'admin.invalid_request';
  END IF;

  v_role := COALESCE(p_role_id, m.role_id);
  IF NOT public.platform_valid_role(m.company_id, v_role) THEN
    RAISE EXCEPTION 'Escolha um perfil de acesso válido' USING HINT = 'admin.invalid_role';
  END IF;

  -- O cliente precisa continuar com pelo menos um proprietário ativo
  v_was_owner := m.status = 'active' AND public.company_role_is_owner(m.role_id);
  v_will_owner := p_status = 'active' AND public.company_role_is_owner(v_role);
  IF v_was_owner AND NOT v_will_owner AND public.company_active_owner_count(m.company_id) <= 1 THEN
    RAISE EXCEPTION 'O cliente precisa de pelo menos um Proprietário ativo. Crie ou promova outro antes.'
      USING HINT = 'admin.last_owner';
  END IF;

  v_action := CASE
    WHEN p_status = 'removed' THEN 'member.remove'
    WHEN p_status = 'suspended' AND m.status <> 'suspended' THEN 'member.suspend'
    WHEN p_status = 'active' AND m.status <> 'active' THEN 'member.reactivate'
    ELSE 'member.update'
  END;

  v_before := public.company_member_snapshot(m);
  UPDATE public.company_members SET
    role_id = v_role,
    extra_permissions = CASE WHEN v_role IS DISTINCT FROM m.role_id THEN '{}'::text[] ELSE extra_permissions END,
    revoked_permissions = CASE WHEN v_role IS DISTINCT FROM m.role_id THEN '{}'::text[] ELSE revoked_permissions END,
    status = p_status,
    status_reason = CASE WHEN p_status = 'active' THEN NULL ELSE v_reason END,
    platform_paused = false,
    status_changed_at = CASE WHEN p_status IS DISTINCT FROM m.status THEN now() ELSE status_changed_at END,
    status_changed_by = CASE WHEN p_status IS DISTINCT FROM m.status THEN auth.uid() ELSE status_changed_by END
  WHERE id = m.id
  RETURNING * INTO m;
  PERFORM public.company_member_sync_legacy(m.id);

  IF v_name IS NOT NULL THEN
    UPDATE public.profiles SET full_name = v_name WHERE id = m.user_id;
  END IF;

  PERFORM public.company_member_audit_write(m.company_id, v_action, m.user_id, m.id, NULL, m.role_id,
    COALESCE(v_reason, 'Alterado pela administração da plataforma'),
    v_before, public.company_member_snapshot(m));

  RETURN jsonb_build_object('member_id', m.id, 'status', m.status, 'role_id', m.role_id);
END $$;

-- Redefinir a senha de um usuário de cliente
CREATE OR REPLACE FUNCTION public.platform_set_client_user_password(p_member_id uuid, p_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE m public.company_members%ROWTYPE;
BEGIN
  PERFORM public.platform_require();
  SELECT * INTO m FROM public.company_members WHERE id = p_member_id;
  IF NOT FOUND OR m.status = 'removed' THEN
    RAISE EXCEPTION 'Usuário não encontrado' USING HINT = 'admin.not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = m.user_id) THEN
    RAISE EXCEPTION 'A senha de administradores da plataforma só é trocada pelo próprio dono da conta'
      USING ERRCODE = '42501', HINT = 'admin.self';
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'A nova senha deve ter no mínimo 8 caracteres' USING HINT = 'admin.password_too_short';
  END IF;

  UPDATE auth.users
     SET encrypted_password = crypt(p_password, gen_salt('bf')),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at = now()
   WHERE id = m.user_id;

  INSERT INTO public.company_member_audit (company_id, actor_id, target_user_id, member_id, role_id,
                                           action, reason)
  VALUES (m.company_id, auth.uid(), m.user_id, m.id, m.role_id, 'member.password_change',
          'Senha redefinida pela administração da plataforma');
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.platform_valid_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_list_clients() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_create_client_user(uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_update_client_user(uuid, text, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_set_client_user_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_clients() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_create_client_user(uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_update_client_user(uuid, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_client_user_password(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

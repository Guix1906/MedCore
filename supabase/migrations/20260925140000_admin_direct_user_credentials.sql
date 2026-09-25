-- =============================================================================
-- Cadastro direto de usuários com e-mail e senha pelo administrador (/admin)
-- e redefinição de senha de usuários existentes
-- =============================================================================
BEGIN;

-- 1. Cadastro direto de usuário com e-mail, senha e perfil
CREATE OR REPLACE FUNCTION public.admin_create_direct_user(
  p_company_id uuid,
  p_email text,
  p_password text,
  p_full_name text,
  p_role_id uuid,
  p_doctor_id uuid DEFAULT NULL,
  p_agenda_scope text DEFAULT 'all',
  p_agenda_professional_ids uuid[] DEFAULT '{}',
  p_confirm_sensitive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  actor_owner boolean;
  role_row public.company_roles%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_name text := NULLIF(btrim(COALESCE(p_full_name, '')), '');
  v_agenda uuid[];
  v_user_id uuid;
  v_member_id uuid;
  member_status text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Clínica não informada' USING HINT = 'admin.invalid_request';
  END IF;

  PERFORM 1 FROM public.companies WHERE id = p_company_id FOR UPDATE;
  actor := public.admin_actor(p_company_id);
  PERFORM public.admin_require(actor, 'users.manage');

  -- Validações de entrada
  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido' USING HINT = 'admin.invalid_email';
  END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'A senha deve ter no mínimo 6 caracteres' USING HINT = 'admin.password_too_short';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 120 THEN
    RAISE EXCEPTION 'O nome pode ter no máximo 120 caracteres' USING HINT = 'admin.invalid_name';
  END IF;

  -- Perfil de acesso
  SELECT * INTO role_row FROM public.company_roles
  WHERE id = p_role_id AND archived_at IS NULL AND (company_id IS NULL OR company_id = p_company_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escolha um perfil de acesso válido' USING HINT = 'admin.invalid_role';
  END IF;

  actor_owner := public.company_role_is_owner(actor.role_id);
  IF role_row.is_system AND role_row.key = 'owner' THEN
    IF NOT actor_owner THEN
      RAISE EXCEPTION 'Apenas proprietários podem gerenciar proprietários' USING ERRCODE = '42501', HINT = 'admin.owner_only';
    END IF;
  ELSE
    IF NOT actor_owner AND NOT (role_row.permissions <@ actor.effective_permissions) THEN
      RAISE EXCEPTION 'Você só pode conceder permissões que também possui' USING ERRCODE = '42501', HINT = 'admin.escalation';
    END IF;
  END IF;

  IF NOT COALESCE(p_confirm_sensitive, false) AND public.permission_grants_sensitive(role_row.permissions, role_row.permissions) THEN
    RAISE EXCEPTION 'Confirme o acesso ao prontuário' USING HINT = 'admin.confirm_sensitive';
  END IF;

  -- Agenda e profissional vinculado
  v_agenda := public.admin_agenda_ids(p_agenda_scope, p_agenda_professional_ids);
  PERFORM public.admin_assert_doctor_available(p_doctor_id,
    (SELECT u.id FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1));

  -- Verificar se já é membro ativo desta clínica
  SELECT m.status INTO member_status
  FROM public.company_members m JOIN auth.users u ON u.id = m.user_id
  WHERE m.company_id = p_company_id AND lower(u.email) = v_email
  LIMIT 1;
  IF member_status = 'active' THEN
    RAISE EXCEPTION 'Este e-mail já tem acesso ativo a esta clínica' USING HINT = 'admin.already_member';
  END IF;

  -- Criar ou atualizar usuário em auth.users com a senha criptografada via bcrypt
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_email, crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', COALESCE(v_name, split_part(v_email, '@', 1))),
      now(), now()
    );

    BEGIN
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) VALUES (
        v_user_id::text, v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email),
        'email', v_email, now(), now(), now()
      ) ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
        ) VALUES (
          v_user_id::text, v_user_id,
          jsonb_build_object('sub', v_user_id::text, 'email', v_email),
          'email', now(), now(), now()
        ) ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  ELSE
    -- Usuário já existe no Auth: atualiza a senha e confirma o e-mail
    UPDATE auth.users
    SET encrypted_password = crypt(p_password, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_user_meta_data = raw_user_meta_data || jsonb_build_object('full_name', COALESCE(v_name, split_part(v_email, '@', 1))),
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- Perfil público
  INSERT INTO public.profiles (id, full_name, active_company_id)
  VALUES (v_user_id, COALESCE(v_name, split_part(v_email, '@', 1)), p_company_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    active_company_id = COALESCE(public.profiles.active_company_id, EXCLUDED.active_company_id);

  -- Vínculo de membro na clínica ativo
  INSERT INTO public.company_members (
    company_id, user_id, role_id, status, doctor_id, agenda_scope, agenda_professional_ids,
    status_changed_at, status_changed_by
  ) VALUES (
    p_company_id, v_user_id, p_role_id, 'active', p_doctor_id, p_agenda_scope, v_agenda,
    now(), actor.user_id
  )
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role_id = EXCLUDED.role_id,
    status = 'active',
    doctor_id = EXCLUDED.doctor_id,
    agenda_scope = EXCLUDED.agenda_scope,
    agenda_professional_ids = EXCLUDED.agenda_professional_ids,
    status_reason = NULL,
    status_changed_at = now(),
    status_changed_by = actor.user_id
  RETURNING id INTO v_member_id;

  -- Se profissional vinculado informado, associa
  IF p_doctor_id IS NOT NULL THEN
    UPDATE public.doctors SET auth_id = v_user_id WHERE id = p_doctor_id;
  END IF;

  -- Fecha convites pendentes que existiam para este e-mail
  UPDATE public.company_invitations
  SET status = 'accepted', responded_at = now(), responded_by = v_user_id, version = version + 1
  WHERE company_id = p_company_id AND email = v_email AND status = 'pending';

  -- Auditoria
  INSERT INTO public.company_member_audit (
    company_id, actor_id, target_user_id, member_id, role_id, action, reason, data_after
  ) VALUES (
    p_company_id, actor.user_id, v_user_id, v_member_id, p_role_id, 'member.create',
    'Cadastro de usuário com e-mail e senha pelo administrador',
    jsonb_build_object('email', v_email, 'full_name', v_name, 'status', 'active', 'role_id', p_role_id)
  );

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'member_id', v_member_id,
    'email', v_email,
    'status', 'active'
  );
END;
$$;

-- 2. Redefinição de senha de usuário pelo administrador
CREATE OR REPLACE FUNCTION public.admin_set_user_password(
  p_company_id uuid,
  p_target_user_id uuid,
  p_new_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  actor_owner boolean;
  target_member public.company_members%ROWTYPE;
  target_owner boolean;
BEGIN
  IF p_company_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos' USING HINT = 'admin.invalid_request';
  END IF;

  actor := public.admin_actor(p_company_id);
  PERFORM public.admin_require(actor, 'users.manage');

  IF actor.user_id = p_target_user_id THEN
    RAISE EXCEPTION 'Você não pode alterar a própria senha pela administração' USING HINT = 'admin.self';
  END IF;

  SELECT * INTO target_member FROM public.company_members
  WHERE company_id = p_company_id AND user_id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado nesta clínica' USING HINT = 'admin.not_found';
  END IF;

  actor_owner := public.company_role_is_owner(actor.role_id);
  target_owner := public.company_role_is_owner(target_member.role_id);

  IF target_owner AND NOT actor_owner THEN
    RAISE EXCEPTION 'Apenas proprietários podem gerenciar proprietários' USING ERRCODE = '42501', HINT = 'admin.owner_only';
  END IF;

  IF NOT actor_owner AND NOT (target_member.effective_permissions <@ actor.effective_permissions) THEN
    RAISE EXCEPTION 'Este usuário tem permissões que você não possui' USING ERRCODE = '42501', HINT = 'admin.containment';
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'A nova senha deve ter no mínimo 6 caracteres' USING HINT = 'admin.password_too_short';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = p_target_user_id;

  INSERT INTO public.company_member_audit (
    company_id, actor_id, target_user_id, member_id, role_id, action, reason
  ) VALUES (
    p_company_id, actor.user_id, p_target_user_id, target_member.id, target_member.role_id,
    'member.password_change', 'Senha redefinida pelo administrador'
  );

  RETURN true;
END;
$$;

-- 3. Privilégios das funções
REVOKE ALL ON FUNCTION public.admin_create_direct_user(uuid, text, text, text, uuid, uuid, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_direct_user(uuid, text, text, text, uuid, uuid, text, uuid[], boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, uuid, text) TO authenticated;

COMMIT;

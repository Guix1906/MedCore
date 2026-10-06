-- =============================================================================
-- Migration: 20261006120000_audit_account_takeover_and_record_scope.sql
-- MedCore: correcao da auditoria de 06/10/2026.
--
--  1. admin_create_direct_user trocava a senha de QUALQUER conta existente com o
--     e-mail informado (ex-membros, membros de outra clinica), permitindo tomar a
--     conta. Agora: conta que ja foi usada (e-mail confirmado ou login feito) e
--     apenas vinculada; a senha so e definida para conta nova ou nunca usada.
--  2. admin_set_user_password: recusa usuario que tambem tem vinculo com outra
--     clinica (a senha e global; o admin de uma clinica nao pode abrir a outra).
--  3. Senha minima passa de 6 para 8 caracteres (igual ao cadastro).
--  4. delete_medical_record: exigia records.edit em qualquer clinica; agora exige
--     na clinica do paciente e registra o autor na copia de seguranca.
--
-- Aplicar inteiro, de uma vez, no SQL Editor (homologacao primeiro). Reaplicavel.
-- =============================================================================

BEGIN;

-- 1. Cadastro direto -------------------------------------------------------------
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
  v_existing boolean := false;
  v_used boolean := false;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Clínica não informada' USING HINT = 'admin.invalid_request';
  END IF;

  PERFORM 1 FROM public.companies WHERE id = p_company_id FOR UPDATE;
  actor := public.admin_actor(p_company_id);
  PERFORM public.admin_require(actor, 'users.manage');

  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido' USING HINT = 'admin.invalid_email';
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'A senha deve ter no mínimo 8 caracteres' USING HINT = 'admin.password_too_short';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 120 THEN
    RAISE EXCEPTION 'O nome pode ter no máximo 120 caracteres' USING HINT = 'admin.invalid_name';
  END IF;

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

  v_agenda := public.admin_agenda_ids(p_agenda_scope, p_agenda_professional_ids);
  PERFORM public.admin_assert_doctor_available(p_doctor_id,
    (SELECT u.id FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1));

  SELECT m.status INTO member_status
  FROM public.company_members m JOIN auth.users u ON u.id = m.user_id
  WHERE m.company_id = p_company_id AND lower(u.email) = v_email
  LIMIT 1;
  IF member_status = 'active' THEN
    RAISE EXCEPTION 'Este e-mail já tem acesso ativo a esta clínica' USING HINT = 'admin.already_member';
  END IF;

  SELECT id, (email_confirmed_at IS NOT NULL OR last_sign_in_at IS NOT NULL)
    INTO v_user_id, v_used
    FROM auth.users WHERE lower(email) = v_email LIMIT 1;

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
  ELSIF NOT v_used THEN
    -- Conta criada e nunca usada (sem confirmacao nem login): pode receber a senha.
    UPDATE auth.users
    SET encrypted_password = crypt(p_password, gen_salt('bf')),
        email_confirmed_at = now(),
        raw_user_meta_data = raw_user_meta_data || jsonb_build_object('full_name', COALESCE(v_name, split_part(v_email, '@', 1))),
        updated_at = now()
    WHERE id = v_user_id;
  ELSE
    -- Conta em uso por alguem: so vincula. A senha continua sendo a do dono.
    v_existing := true;
  END IF;

  INSERT INTO public.profiles (id, full_name, active_company_id)
  VALUES (v_user_id, COALESCE(v_name, split_part(v_email, '@', 1)), p_company_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
    active_company_id = COALESCE(public.profiles.active_company_id, EXCLUDED.active_company_id);

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

  IF p_doctor_id IS NOT NULL THEN
    UPDATE public.doctors SET auth_id = v_user_id WHERE id = p_doctor_id;
  END IF;

  UPDATE public.company_invitations
  SET status = 'accepted', responded_at = now(), responded_by = v_user_id, version = version + 1
  WHERE company_id = p_company_id AND email = v_email AND status = 'pending';

  INSERT INTO public.company_member_audit (
    company_id, actor_id, target_user_id, member_id, role_id, action, reason, data_after
  ) VALUES (
    p_company_id, actor.user_id, v_user_id, v_member_id, p_role_id, 'member.create',
    CASE WHEN v_existing
      THEN 'Conta existente vinculada pelo administrador (senha preservada)'
      ELSE 'Cadastro de usuário com e-mail e senha pelo administrador' END,
    jsonb_build_object('email', v_email, 'full_name', v_name, 'status', 'active',
                       'role_id', p_role_id, 'existing_account', v_existing)
  );

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'member_id', v_member_id,
    'email', v_email,
    'status', 'active',
    'existing_account', v_existing
  );
END;
$$;

-- 2. Redefinicao de senha pelo administrador ---------------------------------------
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

  -- A senha vale para todas as clinicas: com vinculo em outra, so o proprio usuario troca.
  IF EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id = p_target_user_id AND m.company_id <> p_company_id
      AND m.status IN ('active', 'pending', 'suspended')
  ) THEN
    RAISE EXCEPTION 'Usuário também acessa outra clínica' USING ERRCODE = '42501', HINT = 'admin.shared_account';
  END IF;

  actor_owner := public.company_role_is_owner(actor.role_id);
  target_owner := public.company_role_is_owner(target_member.role_id);

  IF target_owner AND NOT actor_owner THEN
    RAISE EXCEPTION 'Apenas proprietários podem gerenciar proprietários' USING ERRCODE = '42501', HINT = 'admin.owner_only';
  END IF;

  IF NOT actor_owner AND NOT (target_member.effective_permissions <@ actor.effective_permissions) THEN
    RAISE EXCEPTION 'Este usuário tem permissões que você não possui' USING ERRCODE = '42501', HINT = 'admin.containment';
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'A nova senha deve ter no mínimo 8 caracteres' USING HINT = 'admin.password_too_short';
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

REVOKE ALL ON FUNCTION public.admin_create_direct_user(uuid, text, text, text, uuid, uuid, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_direct_user(uuid, text, text, text, uuid, uuid, text, uuid[], boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, uuid, text) TO authenticated;

-- 3. Exclusao de prontuario: permissao na clinica do paciente ---------------------
CREATE OR REPLACE FUNCTION public.delete_medical_record(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient uuid;
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'Prontuario obrigatorio'; END IF;

  SELECT patient_id INTO v_patient FROM public.medical_records WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT NULLIF(to_jsonb(p)->>'company_id', '')::uuid INTO v_company
    FROM public.patients p WHERE p.id = v_patient;

  IF NOT (
    (v_company IS NULL AND public.has_any_permission('records.edit'))
    OR (v_company IS NOT NULL AND public.has_permission(v_company, 'records.edit'))
  ) THEN
    RAISE EXCEPTION 'Sem permissao para excluir prontuarios.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('medcore.record_delete', 'on', true);
  DELETE FROM public.medical_record_addenda WHERE record_id = p_id;
  DELETE FROM public.medical_records WHERE id = p_id;
  PERFORM set_config('medcore.record_delete', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_medical_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_medical_record(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferencia: anon_pode deve ser false em todas.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'execute') AS anon_pode,
       has_function_privilege('authenticated', p.oid, 'execute') AS logado_pode
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('admin_create_direct_user', 'admin_set_user_password', 'delete_medical_record');

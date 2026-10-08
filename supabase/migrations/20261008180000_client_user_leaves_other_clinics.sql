-- =============================================================================
-- MedCore: usuário de um cliente não continua vendo a Clinica Vitta.
--
-- Problema: um e-mail cadastrado antes em Configurações > Usuários (ou pela tela de login,
-- antes da separação por empresa) ficou vinculado à Clinica Vitta. Ao criar um cliente novo
-- com esse e-mail, platform_create_client_user só ACRESCENTAVA o vínculo novo: o vínculo com
-- a Vitta continuava ativo e a clínica aberta continuava a Vitta.
--
-- Agora, ao criar/vincular o usuário de um cliente pela área Clientes:
--   * a clínica aberta dele passa a ser o cliente novo;
--   * os vínculos com outras clínicas são removidos (registrado na auditoria de cada uma).
-- Administradores da plataforma não são removidos de nenhuma clínica.
--
-- Aplicar inteiro, de uma vez, no SQL Editor, DEPOIS de 20261008160000. Reaplicável.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.platform_create_client_user(
  p_company_id uuid, p_email text, p_password text, p_full_name text
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

  SELECT id INTO v_role FROM public.company_roles WHERE is_system AND key = 'owner' LIMIT 1;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Perfil Proprietário não encontrado' USING HINT = 'admin.invalid_role';
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

  -- Clínica aberta = o cliente novo (administrador da plataforma mantém a que estava usando)
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
    role_id = EXCLUDED.role_id, status = 'active', status_reason = NULL,
    platform_paused = false, status_changed_at = now(), status_changed_by = auth.uid()
  RETURNING id INTO v_member;

  INSERT INTO public.company_member_audit (company_id, actor_id, target_user_id, member_id, role_id,
                                           action, reason, data_after)
  VALUES (p_company_id, auth.uid(), v_user, v_member, v_role, 'member.create',
          'Usuário do cliente criado pela administração da plataforma',
          jsonb_build_object('email', v_email, 'full_name', v_name, 'existing_account', v_existing,
                             'removed_from', v_removed));

  RETURN jsonb_build_object('user_id', v_user, 'member_id', v_member, 'email', v_email,
                            'existing_account', v_existing, 'removed_from', v_removed);
END $$;

REVOKE ALL ON FUNCTION public.platform_create_client_user(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_create_client_user(uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Conferência (rodar depois, opcional): quem ainda está ativo na primeira clínica (Vitta).
-- Quem não for da equipe da Vitta deve ser removido em Configurações > Usuários e permissões,
-- ou movido para o próprio cliente em Administração > Clientes > Novo usuário.
--
-- SELECT u.email, m.status, r.name AS perfil, m.created_at
--   FROM public.company_members m
--   JOIN auth.users u ON u.id = m.user_id
--   LEFT JOIN public.company_roles r ON r.id = m.role_id
--  WHERE m.company_id = (SELECT id FROM public.companies ORDER BY created_at, id LIMIT 1)
--    AND m.status <> 'removed'
--  ORDER BY m.created_at;

-- Homologacao apenas, apos 20260925120000_user_permissions.sql. Use psql com ON_ERROR_STOP=1.
-- Tudo roda em transacao e termina em ROLLBACK. Nao aponte para producao.
BEGIN;

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '' ELSE jsonb_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END $f$;

-- Executa p_sql e exige falha com o HINT informado (a falha e desfeita pelo subbloco).
CREATE FUNCTION pg_temp.expect_hint(p_sql text, p_hint text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = PG_EXCEPTION_HINT;
    IF got IS DISTINCT FROM p_hint THEN
      RAISE EXCEPTION 'Esperava %, obteve % (%) em: %', p_hint, got, SQLERRM, p_sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Esperava falha % em: %', p_hint, p_sql;
END $f$;

DO $$
DECLARE
  company_a uuid := gen_random_uuid();
  company_b uuid := gen_random_uuid();
  owner_u uuid := gen_random_uuid();
  admin_u uuid := gen_random_uuid();
  manager_u uuid := gen_random_uuid();
  recep_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  invitee_u uuid := gen_random_uuid();
  signup_u uuid := gen_random_uuid();
  invited_signup_u uuid := gen_random_uuid();
  role_owner uuid := '7f000000-0000-4000-8000-000000000001';
  role_admin uuid := '7f000000-0000-4000-8000-000000000002';
  role_reception uuid := '7f000000-0000-4000-8000-000000000004';
  role_viewer uuid := '7f000000-0000-4000-8000-000000000007';
  owner_m uuid; admin_m uuid; manager_m uuid; recep_m uuid; outsider_m uuid;
  custom_role uuid;
  request uuid := gen_random_uuid();
  ver integer;
  res jsonb;
  inv_id uuid;
BEGIN
  INSERT INTO public.companies (id, name) VALUES (company_a, 'Clinica A (teste)'), (company_b, 'Clinica B (teste)');
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    (owner_u, owner_u::text || '@example.invalid', now()),
    (admin_u, admin_u::text || '@example.invalid', now()),
    (manager_u, manager_u::text || '@example.invalid', now()),
    (recep_u, recep_u::text || '@example.invalid', now()),
    (outsider_u, outsider_u::text || '@example.invalid', now()),
    (invitee_u, invitee_u::text || '@example.invalid', now());
  DELETE FROM public.company_members WHERE user_id IN (owner_u, admin_u, manager_u, recep_u, outsider_u, invitee_u);
  INSERT INTO public.company_members (company_id, user_id, status, role_id) VALUES
    (company_a, owner_u, 'active', role_owner),
    (company_a, admin_u, 'active', role_admin),
    (company_a, recep_u, 'active', role_reception),
    (company_b, outsider_u, 'active', role_owner);
  SELECT id INTO owner_m FROM public.company_members WHERE user_id = owner_u AND company_id = company_a;
  SELECT id INTO admin_m FROM public.company_members WHERE user_id = admin_u AND company_id = company_a;
  SELECT id INTO recep_m FROM public.company_members WHERE user_id = recep_u AND company_id = company_a;
  SELECT id INTO outsider_m FROM public.company_members WHERE user_id = outsider_u AND company_id = company_b;

  -- Permissoes efetivas e verificacoes usadas pelo RLS
  PERFORM pg_temp.act_as(recep_u);
  IF NOT public.is_company_member(company_a) OR public.is_company_member(company_b) THEN
    RAISE EXCEPTION 'is_company_member incorreto para recepcao';
  END IF;
  IF NOT public.is_clinic_member() THEN RAISE EXCEPTION 'Recepcao deveria ser equipe clinica'; END IF;
  IF NOT public.finance_allowed(company_a, 'receive') OR NOT public.finance_allowed(company_a, 'create')
     OR public.finance_allowed(company_a, 'pay') OR public.finance_allowed(company_a, 'reverse')
     OR public.finance_allowed(company_a, 'accounts') OR public.finance_allowed(company_b, 'view') THEN
    RAISE EXCEPTION 'finance_allowed incorreto para recepcao';
  END IF;
  IF NOT public.finance_allowed(NULL, 'view') THEN RAISE EXCEPTION 'Titulos sem clinica devem seguir a permissao'; END IF;
  IF public.has_any_permission('records.view') THEN RAISE EXCEPTION 'Recepcao nao deve ver prontuario'; END IF;
  res := public.get_my_access(company_a);
  IF res->>'status' <> 'active' OR NOT (res->'permissions') ? 'agenda.manage' OR (res->'permissions') ? 'users.view' THEN
    RAISE EXCEPTION 'get_my_access incorreto: %', res;
  END IF;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_get_overview(%L)', company_a), 'admin.forbidden');

  -- Ninguem altera o proprio acesso; admin nao gerencia proprietario
  PERFORM pg_temp.act_as(admin_u);
  SELECT version INTO ver FROM public.company_members WHERE id = admin_m;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_update_member(%L, %s, %L)', admin_m, ver, role_viewer), 'admin.self');
  SELECT version INTO ver FROM public.company_members WHERE id = owner_m;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_update_member(%L, %s, %L)', owner_m, ver, role_admin), 'admin.owner_only');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_set_member_status(%L, %s, %L, %L)', owner_m, ver, 'suspended', 'Teste de bloqueio'), 'admin.owner_only');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_get_overview(%L)', company_b), 'admin.forbidden');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_set_member_status(%L, 1, %L, %L)', outsider_m, 'suspended', 'Outra clinica'), 'admin.forbidden');

  -- Perfil personalizado limitado nao escala privilegios
  PERFORM pg_temp.act_as(owner_u);
  res := public.admin_save_role(company_a, NULL, NULL, 'Gestor de equipe', 'Somente usuarios',
    ARRAY['dashboard.view', 'users.manage']);
  custom_role := (res->>'id')::uuid;
  IF NOT (SELECT permissions @> ARRAY['users.view'] FROM public.company_roles WHERE id = custom_role) THEN
    RAISE EXCEPTION 'Requisitos nao incluidos no perfil';
  END IF;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_save_role(%L, NULL, NULL, %L, %L, ARRAY[%L])',
    company_a, 'gestor DE equipe', '', 'dashboard.view'), 'admin.role_name_taken');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_save_role(%L, NULL, NULL, %L, %L, ARRAY[%L])',
    company_a, 'Invalido', '', 'foo.bar'), 'admin.unknown_permission');
  INSERT INTO public.company_members (company_id, user_id, status, role_id) VALUES (company_a, manager_u, 'active', custom_role);
  SELECT id INTO manager_m FROM public.company_members WHERE user_id = manager_u AND company_id = company_a;
  PERFORM pg_temp.act_as(manager_u);
  SELECT version INTO ver FROM public.company_members WHERE id = recep_m;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_update_member(%L, %s, %L)', recep_m, ver, role_viewer), 'admin.containment');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_create_invitation(%L, %L, %L, NULL, %L)',
    company_a, gen_random_uuid(), 'escala@example.invalid', role_reception), 'admin.escalation');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_save_role(%L, %L, 1, %L, %L, ARRAY[%L])',
    company_a, custom_role, 'Gestor de equipe', '', 'finance.pay'), 'admin.forbidden');

  -- Versao obsoleta, confirmacao de prontuario e suspensao
  PERFORM pg_temp.act_as(owner_u);
  SELECT version INTO ver FROM public.company_members WHERE id = recep_m;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_update_member(%L, %s, %L)', recep_m, ver - 1, role_reception), 'admin.stale');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_update_member(%L, %s, %L, ARRAY[%L])',
    recep_m, ver, role_reception, 'records.view'), 'admin.confirm_sensitive');
  PERFORM public.admin_update_member(recep_m, ver, role_reception, ARRAY['records.view'], '{}', NULL, 'all', '{}', true);
  IF NOT (SELECT 'records.view' = ANY (effective_permissions) FROM public.company_members WHERE id = recep_m) THEN
    RAISE EXCEPTION 'Ajuste individual nao aplicado';
  END IF;
  SELECT version INTO ver FROM public.company_members WHERE id = recep_m;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_set_member_status(%L, %s, %L, %L)', recep_m, ver, 'suspended', ''), 'admin.reason_required');
  PERFORM public.admin_set_member_status(recep_m, ver, 'suspended', 'Afastamento temporario');
  PERFORM pg_temp.act_as(recep_u);
  IF public.is_company_member(company_a) OR public.is_clinic_member() OR public.finance_allowed(company_a, 'view')
     OR public.has_any_permission('records.view') THEN
    RAISE EXCEPTION 'Usuario suspenso manteve acesso';
  END IF;
  res := public.get_my_access(company_a);
  IF res->>'status' <> 'suspended' OR jsonb_array_length(res->'permissions') <> 0 THEN
    RAISE EXCEPTION 'get_my_access nao refletiu a suspensao: %', res;
  END IF;

  -- Ultimo proprietario e transferencia
  PERFORM pg_temp.act_as(owner_u);
  PERFORM pg_temp.expect_hint(format('SELECT public.leave_company(%L)', company_a), 'admin.last_owner');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_transfer_ownership(%L, %L, %L)', company_a, admin_m, ''), 'admin.reason_required');
  PERFORM public.admin_transfer_ownership(company_a, admin_m, 'Mudanca de responsavel');
  IF NOT public.company_role_is_owner((SELECT role_id FROM public.company_members WHERE id = admin_m))
     OR public.company_role_is_owner((SELECT role_id FROM public.company_members WHERE id = owner_m)) THEN
    RAISE EXCEPTION 'Transferencia de propriedade incorreta';
  END IF;
  PERFORM pg_temp.act_as(admin_u);
  PERFORM pg_temp.expect_hint(format('SELECT public.leave_company(%L)', company_a), 'admin.last_owner');

  -- Convite: idempotente, restrito ao e-mail confirmado
  PERFORM pg_temp.act_as(admin_u);
  res := public.admin_create_invitation(company_a, request, invitee_u::text || '@EXAMPLE.invalid', 'Pessoa Convidada', role_viewer);
  inv_id := (res->>'id')::uuid;
  IF NOT (res->>'created')::boolean THEN RAISE EXCEPTION 'Convite nao criado'; END IF;
  res := public.admin_create_invitation(company_a, request, invitee_u::text || '@example.invalid', 'Pessoa Convidada', role_viewer);
  IF (res->>'created')::boolean OR (res->>'id')::uuid <> inv_id THEN RAISE EXCEPTION 'Convite nao idempotente'; END IF;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_create_invitation(%L, %L, %L, NULL, %L)',
    company_a, gen_random_uuid(), invitee_u::text || '@example.invalid', role_viewer), 'admin.invite_exists');
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_touch_invitation(%L)', inv_id), 'admin.resend_throttled');
  PERFORM pg_temp.act_as(owner_u);
  PERFORM pg_temp.expect_hint(format('SELECT public.accept_company_invitation(%L)', inv_id), 'admin.invite_not_found');
  PERFORM pg_temp.act_as(invitee_u);
  IF jsonb_array_length(public.get_my_access(NULL)->'invitations') <> 1 THEN RAISE EXCEPTION 'Convite nao listado'; END IF;
  PERFORM public.accept_company_invitation(inv_id);
  IF NOT public.is_company_member(company_a) OR NOT public.has_permission(company_a, 'patients.view')
     OR public.has_permission(company_a, 'finance.view') THEN
    RAISE EXCEPTION 'Aceite do convite nao aplicou o perfil';
  END IF;
  PERFORM pg_temp.expect_hint(format('SELECT public.accept_company_invitation(%L)', inv_id), 'admin.invite_closed');

  -- Arquivar perfil em uso exige substituto
  PERFORM pg_temp.act_as(admin_u);
  SELECT version INTO ver FROM public.company_roles WHERE id = custom_role;
  PERFORM pg_temp.expect_hint(format('SELECT public.admin_archive_role(%L, %s)', custom_role, ver), 'admin.replacement_required');
  PERFORM public.admin_archive_role(custom_role, ver, role_viewer, 'Perfil substituido');
  IF (SELECT role_id FROM public.company_members WHERE id = manager_m) <> role_viewer THEN
    RAISE EXCEPTION 'Membros nao migrados para o perfil substituto';
  END IF;

  -- Auditoria imutavel e privilegios
  PERFORM pg_temp.act_as(NULL);
  PERFORM pg_temp.expect_hint('UPDATE public.company_member_audit SET reason = ''x''', 'admin.audit_immutable');
  PERFORM pg_temp.expect_hint('DELETE FROM public.company_member_audit', 'admin.audit_immutable');
  IF has_function_privilege('anon', 'public.get_my_access(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_update_member(uuid, integer, uuid, text[], text[], uuid, text, uuid[], boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.company_member_sync_legacy(uuid, uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.company_member_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.company_members', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.company_members', 'status_reason', 'SELECT') THEN
    RAISE EXCEPTION 'Privilegios excessivos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'medical_records'
                 AND policyname = 'perm_guard_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'Guarda de leitura do prontuario ausente';
  END IF;
  IF (SELECT count(*) FROM public.company_member_audit WHERE company_id = company_a) < 8 THEN
    RAISE EXCEPTION 'Auditoria incompleta';
  END IF;

  -- Cadastro publico aguarda aprovacao; convidado entra pelo aceite
  PERFORM pg_temp.act_as(admin_u);
  PERFORM public.admin_create_invitation(company_a, gen_random_uuid(), invited_signup_u::text || '@example.invalid', NULL, role_viewer);
  PERFORM pg_temp.act_as(NULL);
  INSERT INTO auth.users (id, email) VALUES
    (signup_u, signup_u::text || '@example.invalid'),
    (invited_signup_u, invited_signup_u::text || '@example.invalid');
  IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = signup_u AND status = 'pending')
     OR EXISTS (SELECT 1 FROM public.company_members WHERE user_id = invited_signup_u) THEN
    RAISE EXCEPTION 'Gatilho de cadastro incorreto';
  END IF;
  PERFORM pg_temp.act_as(signup_u);
  IF public.is_clinic_member() OR public.finance_allowed(NULL, 'view') THEN
    RAISE EXCEPTION 'Cadastro pendente com acesso';
  END IF;
END $$;

ROLLBACK;

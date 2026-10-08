-- =============================================================================
-- MedCore: separação de dados por cliente (multiempresa) + área "Clientes" da plataforma.
--
--  1. companies ganha situação (ativo/pausado/cancelado) e dados cadastrais do cliente.
--  2. Todas as tabelas de dados da clínica ganham company_id. Os dados atuais ficam com a
--     Clinica Vitta. Novos registros recebem a empresa ativa de quem cadastra (gatilho).
--  3. Trava RESTRITIVA em todas essas tabelas: cada usuário só lê/grava dados da empresa
--     ativa dele. Soma-se às permissões que já existem (não substitui).
--  4. Funções que liam dados sem filtrar empresa passam a filtrar.
--  5. Cadastro pela tela de login não entra mais automaticamente na primeira clínica.
--  6. Plataforma: administradores da plataforma (Guilherme) cadastram clientes, criam o
--     primeiro usuário de cada um e pausam/cancelam o cliente inteiro. A área da plataforma
--     vê apenas dados cadastrais das empresas, nunca dados clínicos.
--
-- Aplicar inteiro, de uma vez, no SQL Editor. Reaplicável.
-- =============================================================================

BEGIN;

-- 1. Empresas ----------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS document text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_status_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_status_check
      CHECK (status IN ('active', 'paused', 'cancelled'));
  END IF;
END $$;

-- Vínculos suspensos pela plataforma (ao pausar o cliente) voltam ao reativar
ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS platform_paused boolean NOT NULL DEFAULT false;

-- 2. Funções de apoio ---------------------------------------------------------------
-- Empresa ativa do usuário: a escolhida no perfil (se o vínculo estiver ativo) ou a primeira ativa.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.active_company_id
       FROM public.profiles p
       JOIN public.company_members m ON m.company_id = p.active_company_id AND m.user_id = p.id
       JOIN public.companies c ON c.id = m.company_id
      WHERE p.id = auth.uid() AND m.status = 'active' AND c.status = 'active'),
    (SELECT m.company_id
       FROM public.company_members m
       JOIN public.companies c ON c.id = m.company_id
      WHERE m.user_id = auth.uid() AND m.status = 'active' AND c.status = 'active'
      ORDER BY m.created_at, m.company_id
      LIMIT 1)
  );
$$;

-- Empresas cujos dados o usuário enxerga agora: só a empresa ativa (sem misturar clientes).
CREATE OR REPLACE FUNCTION public.my_tenant_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.current_tenant_id() IS NULL THEN '{}'::uuid[]
              ELSE ARRAY[public.current_tenant_id()] END;
$$;

-- Novo registro sem empresa: recebe a empresa ativa de quem cadastra.
CREATE OR REPLACE FUNCTION public.set_tenant_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_tenant_id();
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_tenant_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_tenant_ids() TO authenticated;

-- Verificações existentes passam a exigir empresa ativa (cliente pausado/cancelado perde acesso)
CREATE OR REPLACE FUNCTION public.has_permission(p_company_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_members m JOIN public.companies c ON c.id = m.company_id
    WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND c.status = 'active'
      AND m.status = 'active' AND p_permission = ANY (m.effective_permissions)
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_permission(p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_members m JOIN public.companies c ON c.id = m.company_id
    WHERE m.user_id = auth.uid() AND m.status = 'active' AND c.status = 'active'
      AND p_permission = ANY (m.effective_permissions)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members cm JOIN public.companies c ON c.id = cm.company_id
    WHERE cm.company_id = _company_id AND cm.user_id = auth.uid() AND cm.status = 'active'
      AND c.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_clinic_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_members m JOIN public.companies c ON c.id = m.company_id
    WHERE m.user_id = auth.uid() AND m.status = 'active' AND c.status = 'active'
      AND m.effective_permissions && ARRAY['agenda.view', 'patients.view', 'records.view', 'followups.view',
                                            'inventory.view', 'finance.view', 'settings.manage']::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.finance_allowed(p_company uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_action IN ('view', 'create', 'receive', 'pay', 'reverse', 'cancel', 'accounts')
    AND EXISTS (
      SELECT 1 FROM public.company_members m JOIN public.companies c ON c.id = m.company_id
      WHERE m.user_id = auth.uid() AND m.status = 'active' AND c.status = 'active'
        AND (p_company IS NULL OR m.company_id = p_company)
        AND public.finance_action_permitted(m.effective_permissions, p_action)
    );
$$;

-- 3. company_id + trava por empresa em todas as tabelas de dados ----------------------
DO $$
DECLARE
  vitta uuid;
  t text;
  disabled boolean;
  tabs text[] := ARRAY[
    'account_transfers', 'activity_log', 'activity_logs', 'appointments', 'attachments',
    'bank_reconciliations', 'bank_statement_lines', 'card_settlements', 'cases',
    'cash_register_movements', 'cash_register_sessions', 'clinic_settings',
    'commission_allocations', 'commission_payouts', 'cost_centers', 'deadlines',
    'document_comments', 'doctors', 'events', 'exam_orders', 'finance_categories',
    'financial_accounts', 'financial_audit_log', 'financial_categories',
    'financial_classifications', 'insurance_billings', 'inventory_items',
    'inventory_movements', 'medical_record_addenda', 'medical_record_versions',
    'medical_records', 'notifications', 'ofx_batches', 'patient_consents',
    'patient_pipeline_history', 'patient_pipeline_stages', 'patient_quotes', 'patient_tags',
    'patients', 'payment_methods_config', 'prescription_models', 'prescriptions',
    'record_access_log', 'recurring_transactions', 'secretary_doctors', 'service_types',
    'suppliers', 'tasks', 'transaction_attachments', 'transaction_payments', 'transactions',
    'treatment_evolutions', 'treatment_installments', 'treatment_medication_uses',
    'treatment_medications', 'treatment_photos', 'treatment_reminders',
    'treatment_status_history', 'treatments', 'user_roles', 'vital_signs', 'waitlist'
  ];
BEGIN
  -- Dados atuais pertencem à primeira clínica cadastrada (Clinica Vitta)
  SELECT id INTO vitta FROM public.companies ORDER BY created_at, id LIMIT 1;
  IF vitta IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa cadastrada para receber os dados atuais';
  END IF;

  FOREACH t IN ARRAY tabs LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id)', t);

    -- Preenche sem disparar gatilhos de auditoria/versão (se não for possível, preenche assim mesmo)
    disabled := false;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
      disabled := true;
    EXCEPTION WHEN OTHERS THEN
      disabled := false;
    END;
    EXECUTE format('UPDATE public.%I SET company_id = %L WHERE company_id IS NULL', t, vitta);
    IF disabled THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)', t || '_company_id_idx', t);

    EXECUTE format('DROP TRIGGER IF EXISTS a0_set_tenant_company ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a0_set_tenant_company BEFORE INSERT ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.set_tenant_company()', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO public
                    USING (company_id = ANY ((SELECT public.my_tenant_ids())))
                    WITH CHECK (company_id = ANY ((SELECT public.my_tenant_ids())))', t);
  END LOOP;
END $$;

-- 4. Funções que liam dados de todas as clínicas ------------------------------------
CREATE OR REPLACE FUNCTION public.get_clinic_cities()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL OR NOT public.is_clinic_member() THEN '{}'::text[]
    ELSE COALESCE((SELECT cities FROM public.clinic_settings
                    WHERE company_id = public.current_tenant_id()
                    ORDER BY created_at NULLS LAST LIMIT 1), '{}'::text[]) END;
$$;

CREATE OR REPLACE FUNCTION public.get_allowed_doctor_ids()
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doctor_id uuid; v_role text; v_company uuid := public.current_tenant_id();
BEGIN
  SELECT id, role INTO v_doctor_id, v_role FROM public.doctors
   WHERE auth_id = auth.uid() AND company_id = v_company LIMIT 1;
  IF v_doctor_id IS NULL THEN RETURN; END IF;
  IF v_role IN ('admin','medico','recepcionista','enfermeiro') THEN
    RETURN QUERY SELECT id FROM public.doctors WHERE active = true AND company_id = v_company;
  ELSE
    RETURN QUERY SELECT doctor_id FROM public.secretary_doctors
      WHERE secretary_id = v_doctor_id AND company_id = v_company;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_doctor_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.doctors WHERE auth_id = auth.uid() AND company_id = public.current_tenant_id() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.register_patient_consent(
  p_patient_id uuid, p_term_version text DEFAULT '1.0', p_channel text DEFAULT 'presencial'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_permission('patients.manage') THEN
    RAISE EXCEPTION 'Sem permissao para registrar consentimento' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients
                  WHERE id = p_patient_id AND company_id = ANY (public.my_tenant_ids())) THEN
    RAISE EXCEPTION 'Paciente nao encontrado';
  END IF;
  INSERT INTO public.patient_consents (patient_id, term_version, channel)
  VALUES (p_patient_id, COALESCE(NULLIF(btrim(p_term_version), ''), '1.0'),
          COALESCE(NULLIF(btrim(p_channel), ''), 'presencial'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Ajustes por texto nas funções grandes (só troca o trecho; avisa se não encontrar)
DO $$
DECLARE src text; novo text;
BEGIN
  -- Administração: lista de profissionais e sugestão de vínculo só da própria clínica
  src := pg_get_functiondef('public.admin_get_overview(uuid)'::regprocedure);
  novo := replace(src, 'FROM public.doctors d;', 'FROM public.doctors d WHERE d.company_id = p_company_id;');
  novo := replace(novo, 'WHERE m.doctor_id IS NULL AND u.email IS NOT NULL',
                        'WHERE m.doctor_id IS NULL AND u.email IS NOT NULL AND s.company_id = m.company_id');
  IF novo = src THEN
    RAISE NOTICE 'admin_get_overview: trecho não encontrado, sem alteração';
  ELSE
    EXECUTE novo;
  END IF;

  -- Financeiro: some a "clínica de cadastro legado" (todo dado agora tem empresa)
  src := pg_get_functiondef('public.get_financial_snapshot()'::regprocedure);
  novo := replace(src,
    '(SELECT NULL::uuid AS id,''Clinica (cadastro legado)''::text AS name UNION ALL SELECT id,name FROM public.companies) s',
    '(SELECT id,name FROM public.companies WHERE id = ANY (public.my_tenant_ids())) s');
  novo := replace(novo,
    'WHERE public.finance_allowed(t.company_id,''view'') AND t.type',
    'WHERE public.finance_allowed(t.company_id,''view'') AND t.company_id = ANY (public.my_tenant_ids()) AND t.type');
  novo := replace(novo,
    'FROM public.financial_accounts a WHERE public.finance_allowed(a.company_id,''view'')',
    'FROM public.financial_accounts a WHERE public.finance_allowed(a.company_id,''view'') AND a.company_id = ANY (public.my_tenant_ids())');
  novo := replace(novo,
    'FROM public.patients p WHERE public.finance_allowed((to_jsonb(p)->>''company_id'')::uuid,''view'')',
    'FROM public.patients p WHERE public.finance_allowed((to_jsonb(p)->>''company_id'')::uuid,''view'') AND p.company_id = ANY (public.my_tenant_ids())');
  IF novo = src THEN
    RAISE NOTICE 'get_financial_snapshot: trechos não encontrados, sem alteração';
  ELSE
    EXECUTE novo;
  END IF;

  -- Perfil e cidades da clínica: gravavam sempre no PRIMEIRO registro de configuração do banco
  -- (um cliente novo sobrescreveria os dados de outro). Agora, o registro da própria empresa.
  FOREACH src IN ARRAY ARRAY['public.save_clinic_profile(uuid, jsonb)', 'public.save_clinic_cities(uuid, text[])'] LOOP
    novo := pg_get_functiondef(src::regprocedure);
    IF position('FROM public.clinic_settings ORDER BY created_at NULLS LAST LIMIT 1;' IN novo) = 0 THEN
      RAISE NOTICE '%: trecho não encontrado, sem alteração', src;
    ELSE
      EXECUTE replace(novo,
        'FROM public.clinic_settings ORDER BY created_at NULLS LAST LIMIT 1;',
        'FROM public.clinic_settings WHERE company_id = p_company_id ORDER BY created_at NULLS LAST LIMIT 1;');
    END IF;
  END LOOP;

  -- Agenda: empresa do evento = empresa ativa do usuário (antes: a primeira em que entrou)
  FOREACH src IN ARRAY ARRAY['public.save_agenda_event(jsonb)', 'public.trg_prepare_event_row()'] LOOP
    novo := pg_get_functiondef(src::regprocedure);
    IF position('ORDER BY m.created_at LIMIT 1;' IN novo) = 0 THEN
      RAISE NOTICE '%: trecho não encontrado, sem alteração', src;
    ELSE
      EXECUTE replace(novo, 'ORDER BY m.created_at LIMIT 1;',
        'ORDER BY (m.company_id IS NOT DISTINCT FROM public.current_tenant_id()) DESC, m.created_at LIMIT 1;');
    END IF;
  END LOOP;

  -- Planos (financeiro dos acompanhamentos): só da empresa ativa
  src := pg_get_functiondef('public.get_financial_plans()'::regprocedure);
  novo := replace(src,
    'WHERE public.finance_allowed((to_jsonb(t)->>''company_id'')::uuid,''view'');',
    'WHERE public.finance_allowed((to_jsonb(t)->>''company_id'')::uuid,''view'') AND t.company_id = ANY (public.my_tenant_ids());');
  IF novo = src THEN
    RAISE NOTICE 'get_financial_plans: trecho não encontrado, sem alteração';
  ELSE
    EXECUTE novo;
  END IF;
END $$;

-- 5. Cadastro pela tela de login não entra mais na primeira clínica -----------------
-- (clientes e usuários são criados pela plataforma ou pela administração de cada clínica)
CREATE OR REPLACE FUNCTION public.attach_default_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END $$;

-- 6. Plataforma: administradores e clientes ------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_admins TO service_role;

INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'guigos191@gmail.com'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.platform_require()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito à administração da plataforma' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
END $$;

-- Lista de clientes: só dados cadastrais e usuários (nunca dados clínicos)
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
          'status', m.status, 'role', r.name, 'last_sign_in_at', u.last_sign_in_at
        ) ORDER BY m.created_at)
        FROM public.company_members m
        LEFT JOIN auth.users u ON u.id = m.user_id
        LEFT JOIN public.profiles p ON p.id = m.user_id
        LEFT JOIN public.company_roles r ON r.id = m.role_id
        WHERE m.company_id = c.id AND m.status <> 'removed'), '[]'::jsonb)
    ) ORDER BY c.created_at)
    FROM public.companies c), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.platform_save_client(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := COALESCE(p_id, gen_random_uuid());
  v_name text := NULLIF(btrim(COALESCE(p_data->>'name', '')), '');
  f text;
BEGIN
  PERFORM public.platform_require();
  IF v_name IS NULL OR length(v_name) > 160 THEN
    RAISE EXCEPTION 'Informe o nome da empresa (até 160 caracteres)' USING HINT = 'admin.invalid_name';
  END IF;
  FOREACH f IN ARRAY ARRAY['legal_name','document','contact_name','phone','email','address','city','state','notes'] LOOP
    IF length(COALESCE(p_data->>f, '')) > 1000 THEN
      RAISE EXCEPTION 'Campo % muito longo', f USING HINT = 'admin.invalid_request';
    END IF;
  END LOOP;

  INSERT INTO public.companies (id, name, legal_name, document, contact_name, phone, email,
                                address, city, state, notes)
  VALUES (v_id, v_name,
          NULLIF(btrim(p_data->>'legal_name'), ''), NULLIF(btrim(p_data->>'document'), ''),
          NULLIF(btrim(p_data->>'contact_name'), ''), NULLIF(btrim(p_data->>'phone'), ''),
          NULLIF(lower(btrim(p_data->>'email')), ''), NULLIF(btrim(p_data->>'address'), ''),
          NULLIF(btrim(p_data->>'city'), ''), NULLIF(btrim(p_data->>'state'), ''),
          NULLIF(btrim(p_data->>'notes'), ''))
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, legal_name = EXCLUDED.legal_name, document = EXCLUDED.document,
    contact_name = EXCLUDED.contact_name, phone = EXCLUDED.phone, email = EXCLUDED.email,
    address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state,
    notes = EXCLUDED.notes, updated_at = now();
  RETURN v_id;
END $$;

-- Primeiro usuário (proprietário) de um cliente, com e-mail e senha
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

  INSERT INTO public.profiles (id, full_name, active_company_id)
  VALUES (v_user, COALESCE(v_name, split_part(v_email, '@', 1)), p_company_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(btrim(public.profiles.full_name), ''), EXCLUDED.full_name),
    active_company_id = CASE WHEN v_existing THEN COALESCE(public.profiles.active_company_id, EXCLUDED.active_company_id)
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
          jsonb_build_object('email', v_email, 'full_name', v_name, 'existing_account', v_existing));

  RETURN jsonb_build_object('user_id', v_user, 'member_id', v_member, 'email', v_email,
                            'existing_account', v_existing);
END $$;

-- Pausar / cancelar / reativar o cliente inteiro
CREATE OR REPLACE FUNCTION public.platform_set_client_status(p_company_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM public.platform_require();
  IF p_status NOT IN ('active', 'paused', 'cancelled') THEN
    RAISE EXCEPTION 'Situação inválida' USING HINT = 'admin.invalid_status';
  END IF;
  IF p_status <> 'active' AND (v_reason IS NULL OR length(v_reason) < 5) THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 5 caracteres' USING HINT = 'admin.reason_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_members m
             WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.status = 'active')
     AND p_status <> 'active' THEN
    RAISE EXCEPTION 'Você não pode pausar a clínica em que está trabalhando' USING HINT = 'admin.self';
  END IF;

  UPDATE public.companies
     SET status = p_status, status_reason = v_reason, status_changed_at = now(), updated_at = now()
   WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado' USING HINT = 'admin.not_found';
  END IF;

  IF p_status = 'active' THEN
    -- Volta quem estava ativo antes da pausa
    UPDATE public.company_members
       SET status = 'active', status_reason = NULL, platform_paused = false,
           status_changed_at = now(), status_changed_by = auth.uid()
     WHERE company_id = p_company_id AND platform_paused;
  ELSE
    -- Bloqueia todos os acessos ativos (as sessões abertas perdem acesso em até um minuto)
    UPDATE public.company_members
       SET status = 'suspended',
           status_reason = CASE WHEN p_status = 'paused' THEN 'Cliente pausado: ' ELSE 'Cliente cancelado: ' END || v_reason,
           platform_paused = true, status_changed_at = now(), status_changed_by = auth.uid()
     WHERE company_id = p_company_id AND status = 'active';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_require() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_list_clients() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_save_client(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_create_client_user(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_set_client_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_clients() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_client(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_create_client_user(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_client_status(uuid, text, text) TO authenticated;

-- Remove a função temporária do diagnóstico
DROP FUNCTION IF EXISTS public.tmp_diagnostico_multiclientes();

NOTIFY pgrst, 'reload schema';

COMMIT;

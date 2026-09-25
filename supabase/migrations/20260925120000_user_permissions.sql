-- =============================================================================
-- Usuarios, perfis e permissoes por clinica (tela /admin)
--
-- Pre-requisitos: modelo por clinica (20260731131438) e migracoes financeiras
-- (20260919160000 em diante). Aplique primeiro em homologacao, com backup.
-- O arquivo e transacional: qualquer falha desfaz tudo.
--
--  * catalogo de permissoes, perfis do sistema e perfis personalizados;
--  * company_members ganha perfil, ajustes individuais, situacao, profissional
--    vinculado e escopo de agenda; permissoes efetivas sao materializadas;
--  * convites por e-mail, auditoria imutavel e RPCs com regras anti-escalonamento;
--  * is_company_member, is_clinic_member e finance_allowed passam a exigir
--    vinculo ativo com a permissao correspondente; guardas RLS por modulo.
-- =============================================================================
BEGIN;

-- 0. Pre-condicoes --------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL OR to_regclass('public.company_members') IS NULL THEN
    RAISE EXCEPTION 'Modelo por clinica ausente (companies/company_members). Aplique 20260731131438 antes.';
  END IF;
  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.user_roles ausente.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'company_id') THEN
    RAISE EXCEPTION 'user_roles sem company_id (esquema legado). Esta migracao suporta apenas o modelo por clinica.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'role'
               AND data_type NOT IN ('text', 'character varying')) THEN
    RAISE EXCEPTION 'user_roles.role usa tipo legado (enum). Converta a coluna para texto antes desta migracao.';
  END IF;
  IF to_regclass('public.doctors') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Tabelas public.doctors/public.profiles ausentes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies) THEN
    RAISE EXCEPTION 'Nenhuma clinica cadastrada em public.companies.';
  END IF;
END $$;

-- 1. Catalogo de permissoes (espelhado em src/features/admin/permissions.ts) ------
CREATE TABLE IF NOT EXISTS public.permission_catalog (
  key text PRIMARY KEY CHECK (key ~ '^[a-z]+\.[a-z]+$'),
  module text NOT NULL,
  label text NOT NULL,
  requires text[] NOT NULL DEFAULT '{}',
  enforcement text NOT NULL CHECK (enforcement IN ('server', 'interface')),
  sort_order integer NOT NULL
);

INSERT INTO public.permission_catalog (key, module, label, requires, enforcement, sort_order) VALUES
  ('dashboard.view', 'dashboard', 'Ver paineis', '{}', 'interface', 10),
  ('agenda.view', 'agenda', 'Ver agenda', '{}', 'interface', 20),
  ('agenda.manage', 'agenda', 'Agendar e alterar', '{agenda.view}', 'server', 21),
  ('patients.view', 'patients', 'Ver pacientes', '{}', 'interface', 30),
  ('patients.manage', 'patients', 'Cadastrar e editar pacientes', '{patients.view}', 'server', 31),
  ('records.view', 'records', 'Ver prontuario', '{}', 'server', 40),
  ('records.edit', 'records', 'Registrar no prontuario', '{records.view}', 'server', 41),
  ('followups.view', 'followups', 'Ver acompanhamentos', '{}', 'interface', 50),
  ('followups.manage', 'followups', 'Registrar acompanhamentos', '{followups.view}', 'interface', 51),
  ('finance.view', 'finance', 'Consultar financeiro', '{}', 'server', 60),
  ('finance.receive', 'finance', 'Cobrar e receber', '{finance.view}', 'server', 61),
  ('finance.pay', 'finance', 'Lancar e pagar despesas', '{finance.view}', 'server', 62),
  ('finance.reverse', 'finance', 'Estornar e cancelar', '{finance.view}', 'server', 63),
  ('finance.accounts', 'finance', 'Administrar contas', '{finance.view}', 'server', 64),
  ('inventory.view', 'inventory', 'Ver estoque', '{}', 'interface', 70),
  ('inventory.manage', 'inventory', 'Movimentar estoque', '{inventory.view}', 'server', 71),
  ('reports.view', 'reports', 'Ver relatorios', '{}', 'interface', 80),
  ('settings.manage', 'settings', 'Configurar a clinica', '{}', 'server', 90),
  ('users.view', 'admin', 'Ver usuarios', '{}', 'server', 100),
  ('users.manage', 'admin', 'Gerenciar usuarios', '{users.view}', 'server', 101),
  ('roles.manage', 'admin', 'Gerenciar perfis', '{users.view}', 'server', 102),
  ('audit.view', 'admin', 'Ver auditoria', '{}', 'server', 103)
ON CONFLICT (key) DO UPDATE SET module = EXCLUDED.module, label = EXCLUDED.label,
  requires = EXCLUDED.requires, enforcement = EXCLUDED.enforcement, sort_order = EXCLUDED.sort_order;

-- 2. Perfis de acesso ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  key text,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  permissions text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  based_on uuid REFERENCES public.company_roles(id) ON DELETE SET NULL,
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT company_roles_kind_check CHECK (
    (is_system AND company_id IS NULL AND key IS NOT NULL)
    OR (NOT is_system AND company_id IS NOT NULL AND key IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS company_roles_system_key_idx ON public.company_roles (key) WHERE is_system;
CREATE UNIQUE INDEX IF NOT EXISTS company_roles_company_name_idx
  ON public.company_roles (company_id, lower(btrim(name))) WHERE archived_at IS NULL AND NOT is_system;

INSERT INTO public.company_roles (id, key, name, description, permissions, is_system, sort_order) VALUES
  ('7f000000-0000-4000-8000-000000000001', 'owner', 'Proprietário',
    'Acesso total, incluindo gestão de proprietários e transferência de propriedade.',
    (SELECT array_agg(c.key ORDER BY c.sort_order) FROM public.permission_catalog c), true, 1),
  ('7f000000-0000-4000-8000-000000000002', 'admin', 'Administrador',
    'Acesso total, exceto as ações exclusivas de proprietários.',
    (SELECT array_agg(c.key ORDER BY c.sort_order) FROM public.permission_catalog c), true, 2),
  ('7f000000-0000-4000-8000-000000000003', 'professional', 'Profissional de saúde',
    'Agenda, pacientes, prontuário e acompanhamentos. Consulta o estoque.',
    ARRAY['dashboard.view','agenda.view','agenda.manage','patients.view','patients.manage','records.view',
          'records.edit','followups.view','followups.manage','inventory.view'], true, 3),
  ('7f000000-0000-4000-8000-000000000004', 'reception', 'Recepção',
    'Agenda, pacientes e recebimentos. Sem prontuário, sem pagar despesas e sem estornar.',
    ARRAY['dashboard.view','agenda.view','agenda.manage','patients.view','patients.manage','followups.view',
          'finance.view','finance.receive'], true, 4),
  ('7f000000-0000-4000-8000-000000000005', 'finance', 'Financeiro',
    'Financeiro completo e relatórios. Sem acesso clínico.',
    ARRAY['dashboard.view','finance.view','finance.receive','finance.pay','finance.reverse','finance.accounts',
          'reports.view'], true, 5),
  ('7f000000-0000-4000-8000-000000000006', 'inventory', 'Estoque',
    'Cadastro e movimentação do estoque.',
    ARRAY['dashboard.view','inventory.view','inventory.manage'], true, 6),
  ('7f000000-0000-4000-8000-000000000007', 'viewer', 'Somente leitura',
    'Consulta de agenda, pacientes, acompanhamentos, estoque e relatórios. Sem prontuário e sem financeiro.',
    ARRAY['dashboard.view','agenda.view','patients.view','followups.view','inventory.view','reports.view'], true, 7)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
  permissions = EXCLUDED.permissions, sort_order = EXCLUDED.sort_order, updated_at = now();

-- 3. Regras de permissao (mesmas funcoes puras do frontend) ---------------------------
-- Fecho: acrescenta os requisitos de cada permissao; descarta chaves desconhecidas.
CREATE OR REPLACE FUNCTION public.permission_closure(p_permissions text[])
RETURNS text[] LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE r(key) AS (
    SELECT DISTINCT k FROM unnest(COALESCE(p_permissions, '{}'::text[])) AS k
    UNION
    SELECT u.req FROM r
    JOIN public.permission_catalog c ON c.key = r.key
    CROSS JOIN LATERAL unnest(c.requires) AS u(req)
  )
  SELECT COALESCE(array_agg(c.key ORDER BY c.sort_order), '{}'::text[])
  FROM public.permission_catalog c
  WHERE c.key IN (SELECT r.key FROM r);
$$;

-- Poda: remove permissoes cujos requisitos nao estao presentes (ate estabilizar).
CREATE OR REPLACE FUNCTION public.permission_prune(p_permissions text[])
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  cur text[] := COALESCE(p_permissions, '{}'::text[]);
  nxt text[];
BEGIN
  LOOP
    SELECT COALESCE(array_agg(c.key ORDER BY c.sort_order), '{}'::text[]) INTO nxt
    FROM public.permission_catalog c
    WHERE c.key = ANY (cur) AND c.requires <@ cur;
    EXIT WHEN cardinality(nxt) = cardinality(cur);
    cur := nxt;
  END LOOP;
  RETURN nxt;
END $$;

-- Efetivas = poda(fecho(perfil + ajustes) - removidas).
CREATE OR REPLACE FUNCTION public.permission_effective(p_role text[], p_extra text[], p_revoked text[])
RETURNS text[] LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.permission_prune(ARRAY(
    SELECT k FROM unnest(public.permission_closure(COALESCE(p_role, '{}'::text[]) || COALESCE(p_extra, '{}'::text[]))) AS k
    WHERE NOT (k = ANY (COALESCE(p_revoked, '{}'::text[])))
  ));
$$;

CREATE OR REPLACE FUNCTION public.permission_assert_known(p_permissions text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE unknown text;
BEGIN
  SELECT string_agg(DISTINCT k, ', ') INTO unknown
  FROM unnest(COALESCE(p_permissions, '{}'::text[])) AS k
  WHERE NOT EXISTS (SELECT 1 FROM public.permission_catalog c WHERE c.key = k);
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Permissoes desconhecidas: %', unknown USING ERRCODE = '22023', HINT = 'admin.unknown_permission';
  END IF;
END $$;

-- Ajustes individuais normalizados em relacao ao perfil.
CREATE OR REPLACE FUNCTION public.permission_adjustments(
  p_role_permissions text[], p_extra text[], p_revoked text[], OUT extra text[], OUT revoked text[])
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE base text[];
BEGIN
  PERFORM public.permission_assert_known(p_extra);
  PERFORM public.permission_assert_known(p_revoked);
  base := public.permission_closure(p_role_permissions);
  extra := ARRAY(SELECT DISTINCT e FROM unnest(COALESCE(p_extra, '{}'::text[])) AS e
                 WHERE NOT (e = ANY (base)) ORDER BY 1);
  revoked := ARRAY(SELECT DISTINCT v FROM unnest(COALESCE(p_revoked, '{}'::text[])) AS v
                   WHERE v = ANY (base) ORDER BY 1);
END $$;

-- Acesso ao prontuario concedido fora de um perfil clinico exige confirmacao.
CREATE OR REPLACE FUNCTION public.permission_grants_sensitive(p_role_permissions text[], p_effective text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_effective, '{}'::text[]) && ARRAY['records.view', 'records.edit']::text[]
     AND NOT (COALESCE(p_role_permissions, '{}'::text[]) && ARRAY['records.view']::text[]);
$$;

-- 4. Vinculo usuario x clinica -------------------------------------------------------
ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.company_roles(id),
  ADD COLUMN IF NOT EXISTS extra_permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS revoked_permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS effective_permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agenda_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS agenda_professional_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE public.company_members DROP CONSTRAINT IF EXISTS company_members_status_check;
ALTER TABLE public.company_members ADD CONSTRAINT company_members_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'removed'));
ALTER TABLE public.company_members DROP CONSTRAINT IF EXISTS company_members_agenda_scope_check;
ALTER TABLE public.company_members ADD CONSTRAINT company_members_agenda_scope_check
  CHECK (agenda_scope IN ('all', 'own', 'selected'));

CREATE INDEX IF NOT EXISTS company_members_user_active_idx ON public.company_members (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS company_members_role_idx ON public.company_members (role_id);
CREATE INDEX IF NOT EXISTS company_members_doctor_idx ON public.company_members (doctor_id) WHERE doctor_id IS NOT NULL;

-- Permissoes efetivas e versao sao sempre recalculadas pelo banco.
CREATE OR REPLACE FUNCTION public.company_members_compute_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  role_company uuid;
  role_permissions text[] := '{}';
BEGIN
  NEW.extra_permissions := COALESCE(NEW.extra_permissions, '{}');
  NEW.revoked_permissions := COALESCE(NEW.revoked_permissions, '{}');
  NEW.agenda_professional_ids := COALESCE(NEW.agenda_professional_ids, '{}');
  IF NEW.role_id IS NOT NULL THEN
    SELECT r.company_id, r.permissions INTO role_company, role_permissions
    FROM public.company_roles r WHERE r.id = NEW.role_id;
    IF NOT FOUND OR (role_company IS NOT NULL AND role_company <> NEW.company_id) THEN
      RAISE EXCEPTION 'Perfil de acesso invalido para esta clinica' USING HINT = 'admin.invalid_role';
    END IF;
  END IF;
  NEW.effective_permissions := public.permission_effective(role_permissions, NEW.extra_permissions, NEW.revoked_permissions);
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_members_compute_access ON public.company_members;
CREATE TRIGGER company_members_compute_access BEFORE INSERT OR UPDATE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.company_members_compute_access();

-- 5. Convites (o vinculo e criado no aceite, pelo e-mail confirmado) ---------------------
CREATE TABLE IF NOT EXISTS public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text CHECK (full_name IS NULL OR length(full_name) <= 120),
  role_id uuid NOT NULL REFERENCES public.company_roles(id),
  extra_permissions text[] NOT NULL DEFAULT '{}',
  revoked_permissions text[] NOT NULL DEFAULT '{}',
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  agenda_scope text NOT NULL DEFAULT 'all' CHECK (agenda_scope IN ('all', 'own', 'selected')),
  agenda_professional_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  request_id uuid NOT NULL UNIQUE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  send_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  responded_at timestamptz,
  responded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_reason text,
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS company_invitations_pending_email_idx
  ON public.company_invitations (company_id, email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS company_invitations_email_idx ON public.company_invitations (email) WHERE status = 'pending';

-- 6. Auditoria de acessos (somente insercao) ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_member_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  actor_id uuid,
  target_user_id uuid,
  member_id uuid,
  invitation_id uuid,
  role_id uuid,
  action text NOT NULL,
  reason text,
  data_before jsonb,
  data_after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_member_audit_company_idx ON public.company_member_audit (company_id, id DESC);
CREATE INDEX IF NOT EXISTS company_member_audit_target_idx ON public.company_member_audit (company_id, target_user_id, id DESC);

CREATE OR REPLACE FUNCTION public.company_member_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'A auditoria de acessos nao pode ser alterada' USING ERRCODE = '42501', HINT = 'admin.audit_immutable';
END $$;
DROP TRIGGER IF EXISTS company_member_audit_immutable ON public.company_member_audit;
CREATE TRIGGER company_member_audit_immutable BEFORE UPDATE OR DELETE ON public.company_member_audit
  FOR EACH ROW EXECUTE FUNCTION public.company_member_audit_immutable();

-- 7. Verificacoes de acesso usadas por RLS e RPCs ------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(p_company_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.company_id = p_company_id AND m.user_id = auth.uid()
      AND m.status = 'active' AND p_permission = ANY (m.effective_permissions)
  );
$$;

-- Para tabelas sem company_id (cadastro unico da clinica).
CREATE OR REPLACE FUNCTION public.has_any_permission(p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id = auth.uid() AND m.status = 'active' AND p_permission = ANY (m.effective_permissions)
  );
$$;

-- Vinculo so vale enquanto ativo: suspensao, remocao e cadastros pendentes perdem o acesso.
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = _company_id AND cm.user_id = auth.uid() AND cm.status = 'active'
  );
$$;

-- Equipe da clinica: vinculo ativo com permissao de algum modulo operacional (antes: cadastro
-- ativo em doctors). O prontuario tem guarda propria (records.view) mais abaixo.
CREATE OR REPLACE FUNCTION public.is_clinic_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id = auth.uid() AND m.status = 'active'
      AND m.effective_permissions && ARRAY['agenda.view', 'patients.view', 'records.view', 'followups.view',
                                            'inventory.view', 'finance.view', 'settings.manage']::text[]
  );
$$;

-- Acoes financeiras existentes -> permissoes. Agendar gera cobranca pendente ('create').
CREATE OR REPLACE FUNCTION public.finance_action_permitted(p_permissions text[], p_action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_action
    WHEN 'view' THEN 'finance.view' = ANY (p_permissions)
    WHEN 'create' THEN p_permissions && ARRAY['finance.receive', 'finance.pay', 'agenda.manage']::text[]
    WHEN 'receive' THEN 'finance.receive' = ANY (p_permissions)
    WHEN 'pay' THEN 'finance.pay' = ANY (p_permissions)
    WHEN 'reverse' THEN 'finance.reverse' = ANY (p_permissions)
    WHEN 'cancel' THEN 'finance.reverse' = ANY (p_permissions)
    WHEN 'accounts' THEN 'finance.accounts' = ANY (p_permissions)
    ELSE false
  END;
$$;

-- Substitui os ramos legados (user_roles, doctors, profiles). Registros sem clinica
-- (cadastro legado) seguem a permissao em qualquer vinculo ativo.
CREATE OR REPLACE FUNCTION public.finance_allowed(p_company uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_action IN ('view', 'create', 'receive', 'pay', 'reverse', 'cancel', 'accounts')
    AND EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.user_id = auth.uid() AND m.status = 'active'
        AND (p_company IS NULL OR m.company_id = p_company)
        AND public.finance_action_permitted(m.effective_permissions, p_action)
    );
$$;

-- Alterar as permissoes de um perfil recalcula quem o utiliza.
CREATE OR REPLACE FUNCTION public.company_roles_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    UPDATE public.company_members SET role_id = role_id WHERE role_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS company_roles_after_update ON public.company_roles;
CREATE TRIGGER company_roles_after_update AFTER UPDATE OF permissions ON public.company_roles
  FOR EACH ROW EXECUTE FUNCTION public.company_roles_after_update();

-- 8. Migracao dos papeis atuais --------------------------------------------------------------
-- Toda conta passa a ter vinculo. Mapeamento (auditado como migration.backfill):
--   user_roles owner -> Proprietario; admin ou profissional admin -> Administrador;
--   medico/enfermeiro -> Profissional de saude (+ consultar e receber, usados no sinal da agenda);
--   recepcionista/secretaria/atendente -> Recepcao; finance_* -> Financeiro (ou ajuste individual);
--   demais contas (sem papel nem profissional ativo) -> aguardando aprovacao.
-- Bloco unico: a tabela temporaria existe apenas dentro dele, sem depender de o editor manter a
-- sessao entre comandos. Reaplicavel: so mapeia vinculos ativos ainda sem perfil.
DO $$
DECLARE
  unknown text;
  m_rec record;
  v_role_key text;
  v_extras text[];
  v_revoked text[];
  v_role_id uuid;
  v_role_perms text[];
  v_norm_extras text[];
  v_norm_revoked text[];
  v_status text;
  v_effective text[];
BEGIN
  SELECT string_agg(DISTINCT ur.role::text, ', ') INTO unknown FROM public.user_roles ur
  WHERE ur.role::text NOT IN ('owner', 'admin', 'member', 'user', 'finance_admin', 'finance_edit', 'finance_view');
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Papeis nao mapeados em user_roles: %. Revise o mapeamento antes de aplicar.', unknown;
  END IF;
  SELECT string_agg(DISTINCT d.role, ', ') INTO unknown FROM public.doctors d
  WHERE d.auth_id IS NOT NULL AND d.active
    AND d.role NOT IN ('admin', 'medico', 'enfermeiro', 'recepcionista', 'secretaria', 'atendente');
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Funcoes de profissionais nao mapeadas: %. Revise o mapeamento antes de aplicar.', unknown;
  END IF;

  ALTER TABLE public.company_members DROP CONSTRAINT IF EXISTS company_members_active_role_check;

  -- Situacao explicita: numa reaplicacao o padrao ja e pending e a conta ficaria fora do mapeamento.
  INSERT INTO public.company_members (company_id, user_id, status)
  SELECT DISTINCT ur.company_id, ur.user_id, 'active'::text
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
  JOIN public.companies c ON c.id = ur.company_id
  ON CONFLICT (company_id, user_id) DO NOTHING;

  INSERT INTO public.company_members (company_id, user_id, status)
  SELECT (SELECT c.id FROM public.companies c ORDER BY c.created_at, c.id LIMIT 1), u.id, 'active'::text
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = u.id)
  ON CONFLICT (company_id, user_id) DO NOTHING;

  FOR m_rec IN
    SELECT m.id AS member_id, m.company_id, m.user_id, m.doctor_id AS current_doctor_id,
      COALESCE((SELECT array_agg(DISTINCT ur.role::text) FROM public.user_roles ur
                WHERE ur.user_id = m.user_id AND ur.company_id = m.company_id), '{}'::text[]) AS legacy_roles,
      d.id AS doctor_id,
      d.role AS doctor_role
    FROM public.company_members m
    LEFT JOIN LATERAL (
      SELECT dd.id, dd.role FROM public.doctors dd
      WHERE dd.auth_id = m.user_id AND dd.active
      ORDER BY (dd.role = 'admin') DESC, dd.created_at
      LIMIT 1
    ) d ON true
    WHERE m.role_id IS NULL
  LOOP
    v_role_key := CASE
      WHEN 'owner' = ANY (m_rec.legacy_roles) THEN 'owner'
      WHEN 'admin' = ANY (m_rec.legacy_roles) OR m_rec.doctor_role = 'admin' THEN 'admin'
      WHEN m_rec.doctor_role IN ('medico', 'enfermeiro') THEN 'professional'
      WHEN m_rec.doctor_role IN ('recepcionista', 'secretaria', 'atendente') THEN 'reception'
      WHEN m_rec.legacy_roles && ARRAY['finance_admin', 'finance_edit', 'finance_view'] THEN 'finance'
      ELSE NULL
    END;

    v_extras := '{}'::text[];
    v_revoked := '{}'::text[];

    IF v_role_key = 'professional' THEN
      v_extras := ARRAY['finance.view', 'finance.receive'];
    END IF;

    IF v_role_key IN ('professional', 'reception') THEN
      IF 'finance_admin' = ANY (m_rec.legacy_roles) THEN
        v_extras := v_extras || ARRAY['finance.view', 'finance.receive', 'finance.pay', 'finance.reverse', 'finance.accounts'];
      ELSIF 'finance_edit' = ANY (m_rec.legacy_roles) THEN
        v_extras := v_extras || ARRAY['finance.view', 'finance.receive', 'finance.pay'];
      ELSIF 'finance_view' = ANY (m_rec.legacy_roles) THEN
        v_extras := v_extras || ARRAY['finance.view'];
      END IF;
    END IF;

    IF v_role_key = 'finance' THEN
      IF 'finance_admin' = ANY (m_rec.legacy_roles) THEN
        v_revoked := '{}'::text[];
      ELSIF 'finance_edit' = ANY (m_rec.legacy_roles) THEN
        v_revoked := ARRAY['finance.reverse', 'finance.accounts'];
      ELSE
        v_revoked := ARRAY['finance.receive', 'finance.pay', 'finance.reverse', 'finance.accounts'];
      END IF;
    END IF;

    IF v_role_key IS NOT NULL THEN
      SELECT r.id, r.permissions INTO v_role_id, v_role_perms
      FROM public.company_roles r
      WHERE r.is_system AND r.key = v_role_key;

      SELECT ARRAY(SELECT DISTINCT e FROM unnest(v_extras) AS e WHERE NOT (e = ANY (v_role_perms)) ORDER BY 1)
      INTO v_norm_extras;

      SELECT ARRAY(SELECT DISTINCT v FROM unnest(v_revoked) AS v WHERE v = ANY (v_role_perms) ORDER BY 1)
      INTO v_norm_revoked;

      v_status := 'active';

      UPDATE public.company_members
      SET role_id = v_role_id,
          extra_permissions = v_norm_extras,
          revoked_permissions = v_norm_revoked,
          doctor_id = COALESCE(m_rec.current_doctor_id, m_rec.doctor_id),
          status = 'active',
          status_reason = NULL,
          status_changed_at = now()
      WHERE id = m_rec.member_id
      RETURNING effective_permissions INTO v_effective;
    ELSE
      v_role_id := NULL;
      v_norm_extras := '{}'::text[];
      v_norm_revoked := '{}'::text[];
      v_status := 'pending';

      UPDATE public.company_members
      SET role_id = NULL,
          extra_permissions = '{}'::text[],
          revoked_permissions = '{}'::text[],
          doctor_id = COALESCE(m_rec.current_doctor_id, m_rec.doctor_id),
          status = 'pending',
          status_reason = 'Conta sem papel administrativo nem cadastro de profissional ativo. Revise em Administracao > Usuarios.',
          status_changed_at = now()
      WHERE id = m_rec.member_id
      RETURNING effective_permissions INTO v_effective;
    END IF;

    INSERT INTO public.company_member_audit (
      company_id, actor_id, target_user_id, member_id, role_id, action, reason, data_before, data_after
    ) VALUES (
      m_rec.company_id, NULL, m_rec.user_id, m_rec.member_id, v_role_id, 'migration.backfill', 'Migracao inicial de papeis',
      jsonb_build_object('legacy_roles', to_jsonb(m_rec.legacy_roles), 'doctor_role', m_rec.doctor_role),
      jsonb_build_object('status', v_status, 'role_key', v_role_key,
        'extra_permissions', to_jsonb(v_norm_extras), 'revoked_permissions', to_jsonb(v_norm_revoked),
        'effective_permissions', to_jsonb(v_effective))
    );
  END LOOP;

  ALTER TABLE public.company_members ADD CONSTRAINT company_members_active_role_check
    CHECK (status <> 'active' OR role_id IS NOT NULL);
  ALTER TABLE public.company_members ALTER COLUMN status SET DEFAULT 'pending';
END $$;

-- 9. Novos cadastros: convidados entram pelo aceite; os demais aguardam aprovacao ----------
CREATE OR REPLACE FUNCTION public.attach_default_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid;
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_invitations i
    WHERE i.status = 'pending' AND i.expires_at > now() AND i.email = lower(btrim(NEW.email))
  ) THEN
    RETURN NEW;
  END IF;
  SELECT c.id INTO _company FROM public.companies c ORDER BY c.created_at, c.id LIMIT 1;
  IF _company IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.company_members (company_id, user_id, status, status_reason, status_changed_at)
  VALUES (_company, NEW.id, 'pending', 'Cadastro aguardando aprovacao do administrador.', now())
  ON CONFLICT (company_id, user_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_attach_default_company ON auth.users;
CREATE TRIGGER trg_attach_default_company AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.attach_default_company();

-- 10. Privilegios das tabelas: escrita somente pelas RPCs ------------------------------------
ALTER TABLE public.permission_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permission_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.permission_catalog TO authenticated;
GRANT ALL ON public.permission_catalog TO service_role;
DROP POLICY IF EXISTS permission_catalog_read ON public.permission_catalog;
CREATE POLICY permission_catalog_read ON public.permission_catalog FOR SELECT TO authenticated USING (true);

ALTER TABLE public.company_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_roles TO authenticated;
GRANT ALL ON public.company_roles TO service_role;
DROP POLICY IF EXISTS company_roles_read ON public.company_roles;
CREATE POLICY company_roles_read ON public.company_roles FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.is_company_member(company_id));

ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.company_invitations TO service_role;

ALTER TABLE public.company_member_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_member_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.company_member_audit TO service_role;

-- Colegas enxergam apenas os campos basicos do vinculo; motivos e permissoes ficam nas RPCs.
REVOKE ALL ON public.company_members FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, company_id, user_id, created_at, status, role_id, doctor_id) ON public.company_members TO authenticated;
GRANT ALL ON public.company_members TO service_role;

-- 11. Apoio interno das RPCs ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_role_is_owner(p_role_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_roles r WHERE r.id = p_role_id AND r.is_system AND r.key = 'owner');
$$;

CREATE OR REPLACE FUNCTION public.company_active_owner_count(p_company_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer
  FROM public.company_members m
  JOIN public.company_roles r ON r.id = m.role_id
  WHERE m.company_id = p_company_id AND m.status = 'active' AND r.is_system AND r.key = 'owner';
$$;

CREATE OR REPLACE FUNCTION public.company_member_snapshot(m public.company_members)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'status', m.status,
    'role_id', m.role_id,
    'role_name', (SELECT r.name FROM public.company_roles r WHERE r.id = m.role_id),
    'extra_permissions', to_jsonb(m.extra_permissions),
    'revoked_permissions', to_jsonb(m.revoked_permissions),
    'effective_permissions', to_jsonb(m.effective_permissions),
    'doctor_id', m.doctor_id,
    'agenda_scope', m.agenda_scope,
    'agenda_professional_ids', to_jsonb(m.agenda_professional_ids));
$$;

CREATE OR REPLACE FUNCTION public.company_member_audit_write(
  p_company_id uuid, p_action text, p_target_user_id uuid, p_member_id uuid, p_invitation_id uuid,
  p_role_id uuid, p_reason text, p_before jsonb, p_after jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.company_member_audit
    (company_id, actor_id, target_user_id, member_id, invitation_id, role_id, action, reason, data_before, data_after)
  VALUES (p_company_id, auth.uid(), p_target_user_id, p_member_id, p_invitation_id, p_role_id, p_action,
    NULLIF(btrim(COALESCE(p_reason, '')), ''), p_before, p_after);
$$;

-- Mantem user_roles (owner/admin/member) e o vinculo legado com doctors/profiles coerentes.
CREATE OR REPLACE FUNCTION public.company_member_sync_legacy(p_member_id uuid, p_previous_doctor_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.company_members%ROWTYPE;
  legacy text;
BEGIN
  SELECT * INTO m FROM public.company_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT CASE WHEN m.status <> 'active' THEN NULL
              WHEN r.key = 'owner' THEN 'owner'
              WHEN r.key = 'admin' THEN 'admin'
              ELSE 'member' END
    INTO legacy
  FROM (SELECT 1) AS one
  LEFT JOIN public.company_roles r ON r.id = m.role_id AND r.is_system;
  DELETE FROM public.user_roles ur
  WHERE ur.user_id = m.user_id AND ur.company_id = m.company_id AND ur.role::text IN ('owner', 'admin', 'member', 'user');
  IF legacy IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, company_id, role) VALUES (m.user_id, m.company_id, legacy)
    ON CONFLICT DO NOTHING;
  END IF;
  IF p_previous_doctor_id IS NOT NULL AND p_previous_doctor_id IS DISTINCT FROM m.doctor_id THEN
    UPDATE public.doctors d SET auth_id = NULL
    WHERE d.id = p_previous_doctor_id AND d.auth_id = m.user_id
      AND NOT EXISTS (SELECT 1 FROM public.company_members o
                      WHERE o.user_id = m.user_id AND o.doctor_id = p_previous_doctor_id AND o.status <> 'removed');
    UPDATE public.profiles p SET doctor_id = NULL WHERE p.id = m.user_id AND p.doctor_id = p_previous_doctor_id;
  END IF;
  IF m.doctor_id IS NOT NULL THEN
    UPDATE public.doctors d SET auth_id = m.user_id WHERE d.id = m.doctor_id AND d.auth_id IS NULL;
    UPDATE public.profiles p SET doctor_id = m.doctor_id WHERE p.id = m.user_id AND p.doctor_id IS DISTINCT FROM m.doctor_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_actor(p_company_id uuid)
RETURNS public.company_members LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.company_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao expirada' USING ERRCODE = '42501', HINT = 'admin.unauthenticated';
  END IF;
  SELECT * INTO a FROM public.company_members
  WHERE company_id = p_company_id AND user_id = auth.uid() AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sem acesso ativo a esta clinica' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION public.admin_require(p_actor public.company_members, p_permission text)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT (p_permission = ANY (p_actor.effective_permissions)) THEN
    RAISE EXCEPTION 'Perfil sem permissao para esta acao' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_reason(p_reason text, p_required boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_required AND (v IS NULL OR length(v) < 5) THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 5 caracteres' USING HINT = 'admin.reason_required';
  END IF;
  IF v IS NOT NULL AND length(v) > 500 THEN
    RAISE EXCEPTION 'Motivo muito longo' USING HINT = 'admin.reason_too_long';
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.admin_agenda_ids(p_scope text, p_ids uuid[])
RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE ids uuid[];
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('all', 'own', 'selected') THEN
    RAISE EXCEPTION 'Escopo de agenda invalido' USING HINT = 'admin.invalid_agenda';
  END IF;
  IF p_scope <> 'selected' THEN
    RETURN '{}'::uuid[];
  END IF;
  ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL ORDER BY 1);
  IF cardinality(ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um profissional' USING HINT = 'admin.agenda_empty';
  END IF;
  IF cardinality(ids) > 200 THEN
    RAISE EXCEPTION 'Selecao de agenda muito grande' USING HINT = 'admin.invalid_agenda';
  END IF;
  RETURN ids;
END $$;

CREATE OR REPLACE FUNCTION public.admin_assert_doctor_available(p_doctor_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_doctor_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.doctors d
                 WHERE d.id = p_doctor_id AND (d.auth_id IS NULL OR d.auth_id IS NOT DISTINCT FROM p_user_id))
     OR EXISTS (SELECT 1 FROM public.company_members o
                WHERE o.doctor_id = p_doctor_id AND o.status <> 'removed' AND o.user_id IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'Profissional inexistente ou vinculado a outro usuario' USING HINT = 'admin.doctor_taken';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.my_pending_invitations()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'company_id', i.company_id,
      'company_name', c.name,
      'role_name', r.name,
      'invited_at', i.invited_at,
      'expires_at', i.expires_at,
      'invited_by_name', COALESCE(NULLIF(btrim(p.full_name), ''), 'Administrador')
    ) ORDER BY i.invited_at DESC), '[]'::jsonb)
  FROM auth.users u
  JOIN public.company_invitations i
    ON i.email = lower(btrim(u.email)) AND i.status = 'pending' AND i.expires_at > now()
  JOIN public.companies c ON c.id = i.company_id
  JOIN public.company_roles r ON r.id = i.role_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by
  WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.company_members x
                    WHERE x.company_id = i.company_id AND x.user_id = u.id AND x.status = 'active');
$$;

-- 12. Acesso do usuario logado (menu, rotas e bloqueios da interface) -------------------------
CREATE OR REPLACE FUNCTION public.get_my_access(p_company_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_email text;
  preferred uuid;
  m public.company_members%ROWTYPE;
  r public.company_roles%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('schema', 1, 'status', 'none', 'permissions', '[]'::jsonb,
      'companies', '[]'::jsonb, 'invitations', '[]'::jsonb);
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = uid;
  SELECT p.active_company_id INTO preferred FROM public.profiles p WHERE p.id = uid;
  SELECT cm.* INTO m FROM public.company_members cm
  WHERE cm.user_id = uid
  ORDER BY (cm.company_id = p_company_id) DESC NULLS LAST,
           (cm.status = 'active') DESC,
           (cm.company_id = preferred) DESC NULLS LAST,
           cm.created_at, cm.id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('schema', 1, 'status', 'none', 'user_id', uid, 'email', v_email,
      'permissions', '[]'::jsonb, 'companies', '[]'::jsonb, 'invitations', public.my_pending_invitations());
  END IF;
  SELECT * INTO r FROM public.company_roles WHERE id = m.role_id;
  RETURN jsonb_build_object(
    'schema', 1,
    'user_id', uid,
    'email', v_email,
    'company_id', m.company_id,
    'company_name', (SELECT c.name FROM public.companies c WHERE c.id = m.company_id),
    'member_id', m.id,
    'status', m.status,
    'role', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name) END,
    'is_owner', COALESCE(r.is_system AND r.key = 'owner', false),
    'permissions', CASE WHEN m.status = 'active' THEN to_jsonb(m.effective_permissions) ELSE '[]'::jsonb END,
    'doctor_id', m.doctor_id,
    'agenda_scope', m.agenda_scope,
    'agenda_professional_ids', to_jsonb(m.agenda_professional_ids),
    'companies', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', x.status)
                    ORDER BY c.name), '[]'::jsonb)
                  FROM public.company_members x JOIN public.companies c ON c.id = x.company_id
                  WHERE x.user_id = uid),
    'invitations', public.my_pending_invitations());
END $$;

-- 13. Tela /admin: leitura --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_overview(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  can_users boolean;
  v_members jsonb := '[]'::jsonb;
  v_invitations jsonb := '[]'::jsonb;
  v_professionals jsonb := '[]'::jsonb;
  v_roles jsonb;
BEGIN
  actor := public.admin_actor(p_company_id);
  IF NOT (actor.effective_permissions && ARRAY['users.view', 'roles.manage', 'audit.view']::text[]) THEN
    RAISE EXCEPTION 'Perfil sem acesso a administracao' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  can_users := 'users.view' = ANY (actor.effective_permissions);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'key', r.key, 'name', r.name, 'description', r.description, 'is_system', r.is_system,
      'permissions', to_jsonb(r.permissions), 'based_on', r.based_on, 'version', r.version, 'updated_at', r.updated_at,
      'member_count', (SELECT count(*) FROM public.company_members x
                       WHERE x.role_id = r.id AND x.company_id = p_company_id AND x.status <> 'removed'),
      'invitation_count', (SELECT count(*) FROM public.company_invitations i
                           WHERE i.role_id = r.id AND i.company_id = p_company_id AND i.status = 'pending')
    ) ORDER BY r.sort_order, lower(r.name)), '[]'::jsonb)
  INTO v_roles
  FROM public.company_roles r
  WHERE r.archived_at IS NULL AND (r.company_id IS NULL OR r.company_id = p_company_id);

  IF can_users THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'user_id', m.user_id,
        'full_name', COALESCE(NULLIF(btrim(p.full_name), ''), split_part(u.email, '@', 1), 'Usuario'),
        'email', u.email,
        'avatar_url', p.avatar_url,
        'status', m.status,
        'status_reason', m.status_reason,
        'status_changed_at', m.status_changed_at,
        'role_id', m.role_id,
        'extra_permissions', to_jsonb(m.extra_permissions),
        'revoked_permissions', to_jsonb(m.revoked_permissions),
        'effective_permissions', to_jsonb(m.effective_permissions),
        'doctor_id', m.doctor_id,
        'doctor_name', d.name,
        'agenda_scope', m.agenda_scope,
        'agenda_professional_ids', to_jsonb(m.agenda_professional_ids),
        'last_sign_in_at', u.last_sign_in_at,
        'email_confirmed', u.email_confirmed_at IS NOT NULL,
        'created_at', m.created_at,
        'accepted_at', m.accepted_at,
        'version', m.version,
        'is_self', m.user_id = actor.user_id,
        'suggested_doctor', sd.suggestion
      ) ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END,
                 lower(COALESCE(NULLIF(btrim(p.full_name), ''), u.email, ''))), '[]'::jsonb)
    INTO v_members
    FROM public.company_members m
    LEFT JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN public.profiles p ON p.id = m.user_id
    LEFT JOIN public.doctors d ON d.id = m.doctor_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role) AS suggestion
      FROM public.doctors s
      WHERE m.doctor_id IS NULL AND u.email IS NOT NULL AND lower(s.email) = lower(u.email)
        AND (s.auth_id IS NULL OR s.auth_id = m.user_id)
      LIMIT 1
    ) sd ON true
    WHERE m.company_id = p_company_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'full_name', i.full_name, 'role_id', i.role_id,
        'extra_permissions', to_jsonb(i.extra_permissions), 'revoked_permissions', to_jsonb(i.revoked_permissions),
        'doctor_id', i.doctor_id, 'agenda_scope', i.agenda_scope,
        'agenda_professional_ids', to_jsonb(i.agenda_professional_ids),
        'invited_at', i.invited_at, 'last_sent_at', i.last_sent_at, 'send_count', i.send_count,
        'expires_at', i.expires_at, 'expired', i.expires_at <= now(),
        'invited_by_name', COALESCE(NULLIF(btrim(p.full_name), ''), 'Administrador'),
        'version', i.version
      ) ORDER BY i.invited_at DESC), '[]'::jsonb)
    INTO v_invitations
    FROM public.company_invitations i
    LEFT JOIN public.profiles p ON p.id = i.invited_by
    WHERE i.company_id = p_company_id AND i.status = 'pending';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'specialty', d.specialty, 'role', d.role, 'active', d.active,
        'linked_user_id', d.auth_id
      ) ORDER BY d.active DESC, lower(d.name)), '[]'::jsonb)
    INTO v_professionals
    FROM public.doctors d;
  END IF;

  RETURN jsonb_build_object(
    'company', (SELECT jsonb_build_object('id', c.id, 'name', c.name) FROM public.companies c WHERE c.id = p_company_id),
    'actor', jsonb_build_object('member_id', actor.id, 'user_id', actor.user_id, 'role_id', actor.role_id,
      'is_owner', public.company_role_is_owner(actor.role_id), 'permissions', to_jsonb(actor.effective_permissions)),
    'roles', v_roles,
    'members', v_members,
    'invitations', v_invitations,
    'professionals', v_professionals);
END $$;

-- 14. Tela /admin: alteracoes em usuarios -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_member(
  p_member_id uuid,
  p_version integer,
  p_role_id uuid,
  p_extra_permissions text[] DEFAULT '{}',
  p_revoked_permissions text[] DEFAULT '{}',
  p_doctor_id uuid DEFAULT NULL,
  p_agenda_scope text DEFAULT 'all',
  p_agenda_professional_ids uuid[] DEFAULT '{}',
  p_confirm_sensitive boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target public.company_members%ROWTYPE;
  actor public.company_members%ROWTYPE;
  role_row public.company_roles%ROWTYPE;
  actor_owner boolean;
  target_owner boolean;
  new_owner boolean;
  v_extra text[];
  v_revoked text[];
  v_effective text[];
  v_agenda uuid[];
  v_before jsonb;
  previous_doctor uuid;
BEGIN
  SELECT * INTO target FROM public.company_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado' USING HINT = 'admin.not_found';
  END IF;
  PERFORM 1 FROM public.companies WHERE id = target.company_id FOR UPDATE;
  actor := public.admin_actor(target.company_id);
  PERFORM public.admin_require(actor, 'users.manage');
  SELECT * INTO target FROM public.company_members WHERE id = p_member_id FOR UPDATE;
  IF target.user_id = actor.user_id THEN
    RAISE EXCEPTION 'Nao e permitido alterar o proprio acesso' USING ERRCODE = '42501', HINT = 'admin.self';
  END IF;
  IF target.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Registro alterado por outra pessoa' USING HINT = 'admin.stale';
  END IF;
  IF target.status = 'removed' THEN
    RAISE EXCEPTION 'Restaure o acesso antes de editar' USING HINT = 'admin.removed';
  END IF;
  SELECT * INTO role_row FROM public.company_roles
  WHERE id = p_role_id AND archived_at IS NULL AND (company_id IS NULL OR company_id = target.company_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de acesso invalido' USING HINT = 'admin.invalid_role';
  END IF;
  actor_owner := public.company_role_is_owner(actor.role_id);
  target_owner := public.company_role_is_owner(target.role_id);
  new_owner := role_row.is_system AND role_row.key = 'owner';
  IF (target_owner OR new_owner) AND NOT actor_owner THEN
    RAISE EXCEPTION 'Apenas proprietarios gerenciam proprietarios' USING ERRCODE = '42501', HINT = 'admin.owner_only';
  END IF;
  IF new_owner THEN
    v_extra := '{}';
    v_revoked := '{}';
  ELSE
    SELECT a.extra, a.revoked INTO v_extra, v_revoked
    FROM public.permission_adjustments(role_row.permissions, p_extra_permissions, p_revoked_permissions) AS a;
  END IF;
  v_effective := public.permission_effective(role_row.permissions, v_extra, v_revoked);
  IF NOT actor_owner THEN
    IF NOT (target.effective_permissions <@ actor.effective_permissions) THEN
      RAISE EXCEPTION 'Usuario com permissoes que voce nao possui' USING ERRCODE = '42501', HINT = 'admin.containment';
    END IF;
    IF NOT (v_effective <@ actor.effective_permissions) THEN
      RAISE EXCEPTION 'Permissoes acima das suas' USING ERRCODE = '42501', HINT = 'admin.escalation';
    END IF;
  END IF;
  IF target_owner AND NOT new_owner AND target.status = 'active'
     AND public.company_active_owner_count(target.company_id) <= 1 THEN
    RAISE EXCEPTION 'A clinica precisa de um proprietario ativo' USING HINT = 'admin.last_owner';
  END IF;
  IF NOT COALESCE(p_confirm_sensitive, false)
     AND public.permission_grants_sensitive(role_row.permissions, v_effective)
     AND NOT (target.effective_permissions && ARRAY['records.view', 'records.edit']::text[]) THEN
    RAISE EXCEPTION 'Confirme o acesso ao prontuario' USING HINT = 'admin.confirm_sensitive';
  END IF;
  v_agenda := public.admin_agenda_ids(p_agenda_scope, p_agenda_professional_ids);
  PERFORM public.admin_assert_doctor_available(p_doctor_id, target.user_id);

  v_before := public.company_member_snapshot(target);
  previous_doctor := target.doctor_id;
  UPDATE public.company_members SET
    role_id = role_row.id,
    extra_permissions = v_extra,
    revoked_permissions = v_revoked,
    doctor_id = p_doctor_id,
    agenda_scope = p_agenda_scope,
    agenda_professional_ids = v_agenda
  WHERE id = target.id
  RETURNING * INTO target;
  PERFORM public.company_member_sync_legacy(target.id, previous_doctor);
  PERFORM public.company_member_audit_write(target.company_id, 'member.update', target.user_id, target.id, NULL,
    target.role_id, NULL, v_before,
    public.company_member_snapshot(target) || jsonb_build_object('sensitive_confirmed', COALESCE(p_confirm_sensitive, false)));
  RETURN jsonb_build_object('id', target.id, 'version', target.version,
    'effective_permissions', to_jsonb(target.effective_permissions));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_member_status(
  p_member_id uuid,
  p_version integer,
  p_status text,
  p_reason text DEFAULT NULL,
  p_role_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target public.company_members%ROWTYPE;
  actor public.company_members%ROWTYPE;
  role_row public.company_roles%ROWTYPE;
  actor_owner boolean;
  target_owner boolean;
  role_changed boolean := false;
  v_reason text;
  v_action text;
  v_before jsonb;
  v_effective text[];
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('active', 'suspended', 'removed') THEN
    RAISE EXCEPTION 'Situacao invalida' USING HINT = 'admin.invalid_status';
  END IF;
  SELECT * INTO target FROM public.company_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado' USING HINT = 'admin.not_found';
  END IF;
  PERFORM 1 FROM public.companies WHERE id = target.company_id FOR UPDATE;
  actor := public.admin_actor(target.company_id);
  PERFORM public.admin_require(actor, 'users.manage');
  SELECT * INTO target FROM public.company_members WHERE id = p_member_id FOR UPDATE;
  IF target.user_id = actor.user_id THEN
    RAISE EXCEPTION 'Nao e permitido alterar o proprio acesso' USING ERRCODE = '42501', HINT = 'admin.self';
  END IF;
  IF target.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Registro alterado por outra pessoa' USING HINT = 'admin.stale';
  END IF;
  IF target.status = p_status THEN
    RAISE EXCEPTION 'Usuario ja esta nesta situacao' USING HINT = 'admin.same_status';
  END IF;
  IF p_status = 'suspended' AND target.status <> 'active' THEN
    RAISE EXCEPTION 'Somente usuarios ativos podem ser suspensos' USING HINT = 'admin.invalid_transition';
  END IF;

  v_action := CASE
    WHEN p_status = 'active' AND target.status = 'pending' THEN 'member.approve'
    WHEN p_status = 'active' AND target.status = 'suspended' THEN 'member.reactivate'
    WHEN p_status = 'active' THEN 'member.restore'
    WHEN p_status = 'suspended' THEN 'member.suspend'
    WHEN target.status = 'pending' THEN 'member.reject'
    ELSE 'member.remove'
  END;
  v_reason := public.admin_reason(p_reason, p_status IN ('suspended', 'removed'));

  IF p_status = 'active' THEN
    SELECT * INTO role_row FROM public.company_roles
    WHERE id = COALESCE(p_role_id, target.role_id) AND archived_at IS NULL
      AND (company_id IS NULL OR company_id = target.company_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escolha um perfil de acesso valido' USING HINT = 'admin.invalid_role';
    END IF;
    role_changed := role_row.id IS DISTINCT FROM target.role_id;
  ELSE
    SELECT * INTO role_row FROM public.company_roles WHERE id = target.role_id;
  END IF;

  actor_owner := public.company_role_is_owner(actor.role_id);
  target_owner := public.company_role_is_owner(target.role_id)
    OR (p_status = 'active' AND COALESCE(role_row.is_system AND role_row.key = 'owner', false));
  IF target_owner AND NOT actor_owner THEN
    RAISE EXCEPTION 'Apenas proprietarios gerenciam proprietarios' USING ERRCODE = '42501', HINT = 'admin.owner_only';
  END IF;
  IF NOT actor_owner THEN
    v_effective := CASE WHEN role_changed
      THEN public.permission_effective(role_row.permissions, '{}', '{}')
      ELSE public.permission_effective(COALESCE(role_row.permissions, '{}'), target.extra_permissions, target.revoked_permissions)
    END;
    IF NOT (target.effective_permissions <@ actor.effective_permissions)
       OR NOT (v_effective <@ actor.effective_permissions) THEN
      RAISE EXCEPTION 'Usuario com permissoes que voce nao possui' USING ERRCODE = '42501', HINT = 'admin.containment';
    END IF;
  END IF;
  IF target.status = 'active' AND p_status <> 'active' AND public.company_role_is_owner(target.role_id)
     AND public.company_active_owner_count(target.company_id) <= 1 THEN
    RAISE EXCEPTION 'A clinica precisa de um proprietario ativo' USING HINT = 'admin.last_owner';
  END IF;

  v_before := public.company_member_snapshot(target);
  UPDATE public.company_members SET
    status = p_status,
    role_id = CASE WHEN p_status = 'active' THEN role_row.id ELSE role_id END,
    extra_permissions = CASE WHEN role_changed THEN '{}'::text[] ELSE extra_permissions END,
    revoked_permissions = CASE WHEN role_changed THEN '{}'::text[] ELSE revoked_permissions END,
    status_reason = v_reason,
    status_changed_at = now(),
    status_changed_by = actor.user_id,
    accepted_at = CASE WHEN v_action = 'member.approve' THEN now() ELSE accepted_at END
  WHERE id = target.id
  RETURNING * INTO target;
  PERFORM public.company_member_sync_legacy(target.id);
  PERFORM public.company_member_audit_write(target.company_id, v_action, target.user_id, target.id, NULL,
    target.role_id, v_reason, v_before, public.company_member_snapshot(target));
  RETURN jsonb_build_object('id', target.id, 'version', target.version, 'status', target.status);
END $$;

-- Transferencia: o destino vira proprietario e quem transfere passa a administrador.
CREATE OR REPLACE FUNCTION public.admin_transfer_ownership(p_company_id uuid, p_member_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  target public.company_members%ROWTYPE;
  owner_role uuid;
  admin_role uuid;
  v_reason text;
  before_target jsonb;
  before_actor jsonb;
BEGIN
  PERFORM 1 FROM public.companies WHERE id = p_company_id FOR UPDATE;
  actor := public.admin_actor(p_company_id);
  IF NOT public.company_role_is_owner(actor.role_id) THEN
    RAISE EXCEPTION 'Apenas proprietarios transferem a propriedade' USING ERRCODE = '42501', HINT = 'admin.owner_only';
  END IF;
  v_reason := public.admin_reason(p_reason, true);
  SELECT * INTO target FROM public.company_members WHERE id = p_member_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado' USING HINT = 'admin.not_found';
  END IF;
  IF target.user_id = actor.user_id THEN
    RAISE EXCEPTION 'Escolha outro usuario' USING HINT = 'admin.self';
  END IF;
  IF target.status <> 'active' THEN
    RAISE EXCEPTION 'Transfira apenas para usuario ativo' USING HINT = 'admin.invalid_transition';
  END IF;
  SELECT id INTO owner_role FROM public.company_roles WHERE is_system AND key = 'owner';
  SELECT id INTO admin_role FROM public.company_roles WHERE is_system AND key = 'admin';
  SELECT * INTO actor FROM public.company_members WHERE id = actor.id FOR UPDATE;
  before_target := public.company_member_snapshot(target);
  before_actor := public.company_member_snapshot(actor);
  UPDATE public.company_members SET role_id = owner_role, extra_permissions = '{}', revoked_permissions = '{}'
  WHERE id = target.id RETURNING * INTO target;
  UPDATE public.company_members SET role_id = admin_role, extra_permissions = '{}', revoked_permissions = '{}'
  WHERE id = actor.id RETURNING * INTO actor;
  PERFORM public.company_member_sync_legacy(target.id);
  PERFORM public.company_member_sync_legacy(actor.id);
  PERFORM public.company_member_audit_write(p_company_id, 'ownership.transfer', target.user_id, target.id, NULL,
    owner_role, v_reason,
    jsonb_build_object('new_owner', before_target, 'previous_owner', before_actor),
    jsonb_build_object('new_owner', public.company_member_snapshot(target),
      'previous_owner', public.company_member_snapshot(actor), 'previous_owner_user_id', actor.user_id));
  RETURN jsonb_build_object('new_owner_member_id', target.id, 'previous_owner_member_id', actor.id);
END $$;

-- Saida voluntaria (unica alteracao permitida sobre o proprio vinculo).
CREATE OR REPLACE FUNCTION public.leave_company(p_company_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  v_reason text;
  v_before jsonb;
  next_company uuid;
BEGIN
  PERFORM 1 FROM public.companies WHERE id = p_company_id FOR UPDATE;
  actor := public.admin_actor(p_company_id);
  SELECT * INTO actor FROM public.company_members WHERE id = actor.id FOR UPDATE;
  IF public.company_role_is_owner(actor.role_id) AND public.company_active_owner_count(p_company_id) <= 1 THEN
    RAISE EXCEPTION 'Transfira a propriedade antes de sair' USING HINT = 'admin.last_owner';
  END IF;
  v_reason := public.admin_reason(p_reason, false);
  v_before := public.company_member_snapshot(actor);
  UPDATE public.company_members SET status = 'removed', status_reason = COALESCE(v_reason, 'Saiu da clinica'),
    status_changed_at = now(), status_changed_by = actor.user_id
  WHERE id = actor.id RETURNING * INTO actor;
  PERFORM public.company_member_sync_legacy(actor.id);
  SELECT x.company_id INTO next_company FROM public.company_members x
  WHERE x.user_id = actor.user_id AND x.status = 'active' ORDER BY x.created_at LIMIT 1;
  UPDATE public.profiles p SET active_company_id = next_company WHERE p.id = actor.user_id AND p.active_company_id = p_company_id;
  PERFORM public.company_member_audit_write(p_company_id, 'member.leave', actor.user_id, actor.id, NULL, actor.role_id,
    v_reason, v_before, public.company_member_snapshot(actor));
  RETURN jsonb_build_object('company_id', p_company_id, 'next_company_id', next_company);
END $$;

-- 15. Tela /admin: perfis personalizados ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_role(
  p_company_id uuid,
  p_role_id uuid,
  p_version integer,
  p_name text,
  p_description text,
  p_permissions text[],
  p_based_on uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  actor_owner boolean;
  role_row public.company_roles%ROWTYPE;
  v_name text := btrim(COALESCE(p_name, ''));
  v_description text := btrim(COALESCE(p_description, ''));
  v_permissions text[];
  v_before jsonb;
  affected integer := 0;
BEGIN
  PERFORM 1 FROM public.companies WHERE id = p_company_id FOR UPDATE;
  actor := public.admin_actor(p_company_id);
  PERFORM public.admin_require(actor, 'roles.manage');
  actor_owner := public.company_role_is_owner(actor.role_id);
  IF length(v_name) < 2 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Nome do perfil invalido' USING HINT = 'admin.role_name';
  END IF;
  IF length(v_description) > 280 THEN
    RAISE EXCEPTION 'Descricao muito longa' USING HINT = 'admin.role_description';
  END IF;
  PERFORM public.permission_assert_known(p_permissions);
  v_permissions := public.permission_closure(p_permissions);
  IF cardinality(v_permissions) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma permissao' USING HINT = 'admin.role_empty';
  END IF;
  IF NOT actor_owner AND NOT (v_permissions <@ actor.effective_permissions) THEN
    RAISE EXCEPTION 'Permissoes acima das suas' USING ERRCODE = '42501', HINT = 'admin.escalation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_roles r
             WHERE r.archived_at IS NULL AND (r.company_id IS NULL OR r.company_id = p_company_id)
               AND lower(btrim(r.name)) = lower(v_name) AND r.id IS DISTINCT FROM p_role_id) THEN
    RAISE EXCEPTION 'Ja existe um perfil com este nome' USING HINT = 'admin.role_name_taken';
  END IF;

  IF p_role_id IS NULL THEN
    IF p_based_on IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.company_roles b WHERE b.id = p_based_on AND (b.company_id IS NULL OR b.company_id = p_company_id)) THEN
      RAISE EXCEPTION 'Perfil de origem invalido' USING HINT = 'admin.invalid_role';
    END IF;
    INSERT INTO public.company_roles (company_id, name, description, permissions, is_system, based_on, created_by, sort_order)
    VALUES (p_company_id, v_name, v_description, v_permissions, false, p_based_on, actor.user_id, 100)
    RETURNING * INTO role_row;
    PERFORM public.company_member_audit_write(p_company_id, 'role.create', NULL, NULL, NULL, role_row.id, NULL, NULL,
      jsonb_build_object('name', role_row.name, 'description', role_row.description,
        'permissions', to_jsonb(role_row.permissions), 'based_on', p_based_on));
  ELSE
    SELECT * INTO role_row FROM public.company_roles
    WHERE id = p_role_id AND company_id = p_company_id AND NOT is_system AND archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Perfil nao editavel' USING HINT = 'admin.role_readonly';
    END IF;
    IF role_row.version IS DISTINCT FROM p_version THEN
      RAISE EXCEPTION 'Registro alterado por outra pessoa' USING HINT = 'admin.stale';
    END IF;
    IF actor.role_id = role_row.id THEN
      RAISE EXCEPTION 'Nao e permitido editar o proprio perfil' USING ERRCODE = '42501', HINT = 'admin.own_role';
    END IF;
    SELECT count(*) INTO affected FROM public.company_members m WHERE m.role_id = role_row.id AND m.status <> 'removed';
    IF affected > 0 AND role_row.permissions IS DISTINCT FROM v_permissions THEN
      PERFORM public.admin_require(actor, 'users.manage');
    END IF;
    IF NOT actor_owner AND EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.role_id = role_row.id AND m.status <> 'removed'
        AND NOT (m.effective_permissions <@ actor.effective_permissions)) THEN
      RAISE EXCEPTION 'Perfil usado por quem tem permissoes que voce nao possui' USING ERRCODE = '42501', HINT = 'admin.containment';
    END IF;
    v_before := jsonb_build_object('name', role_row.name, 'description', role_row.description,
      'permissions', to_jsonb(role_row.permissions));
    UPDATE public.company_roles SET name = v_name, description = v_description, permissions = v_permissions,
      version = version + 1, updated_at = now()
    WHERE id = role_row.id
    RETURNING * INTO role_row;
    PERFORM public.company_member_audit_write(p_company_id, 'role.update', NULL, NULL, NULL, role_row.id, NULL, v_before,
      jsonb_build_object('name', role_row.name, 'description', role_row.description,
        'permissions', to_jsonb(role_row.permissions), 'affected_members', affected));
  END IF;
  RETURN jsonb_build_object('id', role_row.id, 'version', role_row.version, 'affected_members', affected);
END $$;

-- Arquivar exige perfil substituto quando ha usuarios ou convites usando o perfil.
CREATE OR REPLACE FUNCTION public.admin_archive_role(
  p_role_id uuid, p_version integer, p_replacement_role_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  actor_owner boolean;
  role_row public.company_roles%ROWTYPE;
  repl public.company_roles%ROWTYPE;
  m public.company_members%ROWTYPE;
  v_reason text;
  v_before jsonb;
  v_extra text[];
  v_revoked text[];
  affected integer;
  pending_invites integer;
BEGIN
  SELECT * INTO role_row FROM public.company_roles WHERE id = p_role_id;
  IF NOT FOUND OR role_row.is_system OR role_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Perfil nao editavel' USING HINT = 'admin.role_readonly';
  END IF;
  PERFORM 1 FROM public.companies WHERE id = role_row.company_id FOR UPDATE;
  actor := public.admin_actor(role_row.company_id);
  PERFORM public.admin_require(actor, 'roles.manage');
  SELECT * INTO role_row FROM public.company_roles WHERE id = p_role_id FOR UPDATE;
  IF role_row.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Registro alterado por outra pessoa' USING HINT = 'admin.stale';
  END IF;
  IF actor.role_id = role_row.id THEN
    RAISE EXCEPTION 'Nao e permitido arquivar o proprio perfil' USING ERRCODE = '42501', HINT = 'admin.own_role';
  END IF;
  actor_owner := public.company_role_is_owner(actor.role_id);
  v_reason := public.admin_reason(p_reason, false);
  SELECT count(*) INTO affected FROM public.company_members WHERE role_id = role_row.id AND status <> 'removed';
  SELECT count(*) INTO pending_invites FROM public.company_invitations WHERE role_id = role_row.id AND status = 'pending';

  IF affected > 0 OR pending_invites > 0 THEN
    PERFORM public.admin_require(actor, 'users.manage');
    IF p_replacement_role_id IS NULL THEN
      RAISE EXCEPTION 'Escolha um perfil substituto' USING HINT = 'admin.replacement_required';
    END IF;
    SELECT * INTO repl FROM public.company_roles
    WHERE id = p_replacement_role_id AND id <> role_row.id AND archived_at IS NULL
      AND (company_id IS NULL OR company_id = role_row.company_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Perfil substituto invalido' USING HINT = 'admin.invalid_role';
    END IF;
    IF repl.is_system AND repl.key = 'owner' AND NOT actor_owner THEN
      RAISE EXCEPTION 'Apenas proprietarios gerenciam proprietarios' USING ERRCODE = '42501', HINT = 'admin.owner_only';
    END IF;
    FOR m IN SELECT * FROM public.company_members
             WHERE role_id = role_row.id AND status <> 'removed' ORDER BY id FOR UPDATE LOOP
      SELECT a.extra, a.revoked INTO v_extra, v_revoked
      FROM public.permission_adjustments(repl.permissions, m.extra_permissions, m.revoked_permissions) AS a;
      IF NOT actor_owner AND (
           NOT (m.effective_permissions <@ actor.effective_permissions)
           OR NOT (public.permission_effective(repl.permissions, v_extra, v_revoked) <@ actor.effective_permissions)) THEN
        RAISE EXCEPTION 'Perfil usado por quem tem permissoes que voce nao possui' USING ERRCODE = '42501', HINT = 'admin.containment';
      END IF;
      v_before := public.company_member_snapshot(m);
      UPDATE public.company_members SET role_id = repl.id, extra_permissions = v_extra, revoked_permissions = v_revoked
      WHERE id = m.id RETURNING * INTO m;
      PERFORM public.company_member_sync_legacy(m.id);
      PERFORM public.company_member_audit_write(m.company_id, 'member.role_replaced', m.user_id, m.id, NULL, repl.id,
        v_reason, v_before, public.company_member_snapshot(m));
    END LOOP;
    UPDATE public.company_invitations SET role_id = repl.id, version = version + 1
    WHERE role_id = role_row.id AND status = 'pending';
  END IF;

  UPDATE public.company_roles SET archived_at = now(), archived_by = actor.user_id, version = version + 1, updated_at = now()
  WHERE id = role_row.id;
  PERFORM public.company_member_audit_write(role_row.company_id, 'role.archive', NULL, NULL, NULL, role_row.id, v_reason,
    jsonb_build_object('name', role_row.name, 'permissions', to_jsonb(role_row.permissions)),
    jsonb_build_object('replacement_role_id', repl.id, 'replacement_role_name', repl.name,
      'affected_members', affected, 'moved_invitations', pending_invites));
  RETURN jsonb_build_object('id', role_row.id, 'affected_members', affected);
END $$;

-- 16. Convites ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_invitation(
  p_company_id uuid,
  p_request_id uuid,
  p_email text,
  p_full_name text,
  p_role_id uuid,
  p_extra_permissions text[] DEFAULT '{}',
  p_revoked_permissions text[] DEFAULT '{}',
  p_doctor_id uuid DEFAULT NULL,
  p_agenda_scope text DEFAULT 'all',
  p_agenda_professional_ids uuid[] DEFAULT '{}',
  p_confirm_sensitive boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  actor_owner boolean;
  role_row public.company_roles%ROWTYPE;
  existing public.company_invitations%ROWTYPE;
  inv public.company_invitations%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_name text := NULLIF(btrim(COALESCE(p_full_name, '')), '');
  v_extra text[];
  v_revoked text[];
  v_effective text[];
  v_agenda uuid[];
  member_status text;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Solicitacao invalida' USING HINT = 'admin.invalid_request';
  END IF;
  PERFORM 1 FROM public.companies WHERE id = p_company_id FOR UPDATE;
  actor := public.admin_actor(p_company_id);
  PERFORM public.admin_require(actor, 'users.manage');
  SELECT * INTO existing FROM public.company_invitations WHERE request_id = p_request_id;
  IF FOUND THEN
    IF existing.company_id = p_company_id AND existing.email = v_email THEN
      RETURN jsonb_build_object('id', existing.id, 'email', existing.email, 'created', false);
    END IF;
    RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados' USING HINT = 'admin.request_reused';
  END IF;
  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'E-mail invalido' USING HINT = 'admin.invalid_email';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 120 THEN
    RAISE EXCEPTION 'Nome muito longo' USING HINT = 'admin.invalid_name';
  END IF;
  SELECT * INTO role_row FROM public.company_roles
  WHERE id = p_role_id AND archived_at IS NULL AND (company_id IS NULL OR company_id = p_company_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de acesso invalido' USING HINT = 'admin.invalid_role';
  END IF;
  actor_owner := public.company_role_is_owner(actor.role_id);
  IF role_row.is_system AND role_row.key = 'owner' THEN
    IF NOT actor_owner THEN
      RAISE EXCEPTION 'Apenas proprietarios gerenciam proprietarios' USING ERRCODE = '42501', HINT = 'admin.owner_only';
    END IF;
    v_extra := '{}';
    v_revoked := '{}';
  ELSE
    SELECT a.extra, a.revoked INTO v_extra, v_revoked
    FROM public.permission_adjustments(role_row.permissions, p_extra_permissions, p_revoked_permissions) AS a;
  END IF;
  v_effective := public.permission_effective(role_row.permissions, v_extra, v_revoked);
  IF NOT actor_owner AND NOT (v_effective <@ actor.effective_permissions) THEN
    RAISE EXCEPTION 'Permissoes acima das suas' USING ERRCODE = '42501', HINT = 'admin.escalation';
  END IF;
  IF NOT COALESCE(p_confirm_sensitive, false) AND public.permission_grants_sensitive(role_row.permissions, v_effective) THEN
    RAISE EXCEPTION 'Confirme o acesso ao prontuario' USING HINT = 'admin.confirm_sensitive';
  END IF;
  v_agenda := public.admin_agenda_ids(p_agenda_scope, p_agenda_professional_ids);
  PERFORM public.admin_assert_doctor_available(p_doctor_id,
    (SELECT u.id FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1));

  SELECT m.status INTO member_status
  FROM public.company_members m JOIN auth.users u ON u.id = m.user_id
  WHERE m.company_id = p_company_id AND lower(u.email) = v_email
  LIMIT 1;
  IF member_status = 'active' THEN
    RAISE EXCEPTION 'E-mail ja tem acesso a esta clinica' USING HINT = 'admin.already_member';
  ELSIF member_status = 'suspended' THEN
    RAISE EXCEPTION 'Usuario suspenso nesta clinica' USING HINT = 'admin.member_suspended';
  ELSIF member_status = 'pending' THEN
    RAISE EXCEPTION 'Usuario aguardando aprovacao nesta clinica' USING HINT = 'admin.member_pending';
  END IF;

  UPDATE public.company_invitations SET status = 'cancelled', cancel_reason = 'Expirado', responded_at = now(),
    version = version + 1
  WHERE company_id = p_company_id AND email = v_email AND status = 'pending' AND expires_at <= now();
  IF EXISTS (SELECT 1 FROM public.company_invitations
             WHERE company_id = p_company_id AND email = v_email AND status = 'pending') THEN
    RAISE EXCEPTION 'Convite pendente para este e-mail' USING HINT = 'admin.invite_exists';
  END IF;

  INSERT INTO public.company_invitations (company_id, email, full_name, role_id, extra_permissions, revoked_permissions,
    doctor_id, agenda_scope, agenda_professional_ids, request_id, invited_by, last_sent_at, send_count)
  VALUES (p_company_id, v_email, v_name, role_row.id, v_extra, v_revoked, p_doctor_id, p_agenda_scope, v_agenda,
    p_request_id, actor.user_id, now(), 1)
  RETURNING * INTO inv;
  PERFORM public.company_member_audit_write(p_company_id, 'invite.create', NULL, NULL, inv.id, inv.role_id, NULL, NULL,
    jsonb_build_object('email', inv.email, 'role_name', role_row.name, 'extra_permissions', to_jsonb(v_extra),
      'revoked_permissions', to_jsonb(v_revoked), 'effective_permissions', to_jsonb(v_effective),
      'sensitive_confirmed', COALESCE(p_confirm_sensitive, false)));
  RETURN jsonb_build_object('id', inv.id, 'email', inv.email, 'created', true);
END $$;

-- Registra o reenvio; o e-mail e disparado pelo cliente (Supabase Auth, OTP).
CREATE OR REPLACE FUNCTION public.admin_touch_invitation(p_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv public.company_invitations%ROWTYPE;
  actor public.company_members%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.company_invitations WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite nao encontrado' USING HINT = 'admin.invite_not_found';
  END IF;
  actor := public.admin_actor(inv.company_id);
  PERFORM public.admin_require(actor, 'users.manage');
  SELECT * INTO inv FROM public.company_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Convite nao esta pendente' USING HINT = 'admin.invite_closed';
  END IF;
  IF public.company_role_is_owner(inv.role_id) AND NOT public.company_role_is_owner(actor.role_id) THEN
    RAISE EXCEPTION 'Apenas proprietarios gerenciam proprietarios' USING ERRCODE = '42501', HINT = 'admin.owner_only';
  END IF;
  IF inv.last_sent_at IS NOT NULL AND inv.last_sent_at > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'Aguarde para reenviar' USING HINT = 'admin.resend_throttled';
  END IF;
  UPDATE public.company_invitations SET last_sent_at = now(), send_count = send_count + 1,
    expires_at = GREATEST(expires_at, now() + interval '7 days'), version = version + 1
  WHERE id = inv.id
  RETURNING * INTO inv;
  PERFORM public.company_member_audit_write(inv.company_id, 'invite.resend', NULL, NULL, inv.id, inv.role_id, NULL, NULL,
    jsonb_build_object('email', inv.email, 'send_count', inv.send_count));
  RETURN jsonb_build_object('id', inv.id, 'email', inv.email, 'expires_at', inv.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_invitation(p_invitation_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv public.company_invitations%ROWTYPE;
  actor public.company_members%ROWTYPE;
  v_reason text;
BEGIN
  SELECT * INTO inv FROM public.company_invitations WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite nao encontrado' USING HINT = 'admin.invite_not_found';
  END IF;
  actor := public.admin_actor(inv.company_id);
  PERFORM public.admin_require(actor, 'users.manage');
  SELECT * INTO inv FROM public.company_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Convite nao esta pendente' USING HINT = 'admin.invite_closed';
  END IF;
  IF public.company_role_is_owner(inv.role_id) AND NOT public.company_role_is_owner(actor.role_id) THEN
    RAISE EXCEPTION 'Apenas proprietarios gerenciam proprietarios' USING ERRCODE = '42501', HINT = 'admin.owner_only';
  END IF;
  v_reason := public.admin_reason(p_reason, false);
  UPDATE public.company_invitations SET status = 'cancelled', cancel_reason = v_reason, responded_at = now(),
    responded_by = actor.user_id, version = version + 1
  WHERE id = inv.id;
  PERFORM public.company_member_audit_write(inv.company_id, 'invite.cancel', NULL, NULL, inv.id, inv.role_id, v_reason,
    NULL, jsonb_build_object('email', inv.email));
  RETURN jsonb_build_object('id', inv.id);
END $$;

-- Aceite pelo proprio convidado: exige e-mail confirmado igual ao do convite.
CREATE OR REPLACE FUNCTION public.accept_company_invitation(p_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  inv public.company_invitations%ROWTYPE;
  m public.company_members%ROWTYPE;
  v_before jsonb;
  v_doctor uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sessao expirada' USING ERRCODE = '42501', HINT = 'admin.unauthenticated';
  END IF;
  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_email, v_confirmed FROM auth.users u WHERE u.id = uid;
  SELECT * INTO inv FROM public.company_invitations WHERE id = p_invitation_id;
  IF NOT FOUND OR v_email IS NULL OR inv.email <> v_email THEN
    RAISE EXCEPTION 'Convite nao encontrado' USING HINT = 'admin.invite_not_found';
  END IF;
  IF v_confirmed IS NULL THEN
    RAISE EXCEPTION 'Confirme o e-mail antes de aceitar' USING HINT = 'admin.email_unconfirmed';
  END IF;
  PERFORM 1 FROM public.companies WHERE id = inv.company_id FOR UPDATE;
  SELECT * INTO inv FROM public.company_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Convite nao esta pendente' USING HINT = 'admin.invite_closed';
  END IF;
  IF inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Convite expirado' USING HINT = 'admin.invite_expired';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_roles r WHERE r.id = inv.role_id AND r.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Perfil do convite indisponivel' USING HINT = 'admin.invalid_role';
  END IF;
  v_doctor := inv.doctor_id;
  IF v_doctor IS NOT NULL AND (
       NOT EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = v_doctor AND (d.auth_id IS NULL OR d.auth_id = uid))
       OR EXISTS (SELECT 1 FROM public.company_members o
                  WHERE o.doctor_id = v_doctor AND o.user_id <> uid AND o.status <> 'removed')) THEN
    v_doctor := NULL;
  END IF;

  SELECT * INTO m FROM public.company_members WHERE company_id = inv.company_id AND user_id = uid FOR UPDATE;
  IF FOUND THEN
    IF m.status = 'suspended' THEN
      RAISE EXCEPTION 'Acesso suspenso nesta clinica' USING ERRCODE = '42501', HINT = 'admin.self_suspended';
    END IF;
    v_before := public.company_member_snapshot(m);
    IF m.status <> 'active' THEN
      UPDATE public.company_members SET status = 'active', role_id = inv.role_id,
        extra_permissions = inv.extra_permissions, revoked_permissions = inv.revoked_permissions,
        doctor_id = COALESCE(v_doctor, doctor_id), agenda_scope = inv.agenda_scope,
        agenda_professional_ids = inv.agenda_professional_ids, status_reason = NULL, status_changed_at = now(),
        status_changed_by = uid, invited_by = inv.invited_by, invited_at = inv.invited_at, accepted_at = now()
      WHERE id = m.id
      RETURNING * INTO m;
    END IF;
  ELSE
    INSERT INTO public.company_members (company_id, user_id, status, role_id, extra_permissions, revoked_permissions,
      doctor_id, agenda_scope, agenda_professional_ids, status_changed_at, status_changed_by, invited_by, invited_at, accepted_at)
    VALUES (inv.company_id, uid, 'active', inv.role_id, inv.extra_permissions, inv.revoked_permissions, v_doctor,
      inv.agenda_scope, inv.agenda_professional_ids, now(), uid, inv.invited_by, inv.invited_at, now())
    RETURNING * INTO m;
  END IF;

  UPDATE public.company_invitations SET status = 'accepted', responded_at = now(), responded_by = uid, version = version + 1
  WHERE id = inv.id;
  PERFORM public.company_member_sync_legacy(m.id);
  UPDATE public.profiles p SET active_company_id = inv.company_id
  WHERE p.id = uid AND (p.active_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.company_members x
    WHERE x.user_id = uid AND x.company_id = p.active_company_id AND x.status = 'active'));
  IF inv.full_name IS NOT NULL THEN
    UPDATE public.profiles p SET full_name = inv.full_name
    WHERE p.id = uid AND (p.full_name IS NULL OR btrim(p.full_name) = '' OR lower(p.full_name) = v_email
                          OR p.full_name = split_part(v_email, '@', 1));
  END IF;
  PERFORM public.company_member_audit_write(inv.company_id, 'invite.accept', uid, m.id, inv.id, m.role_id, NULL, v_before,
    public.company_member_snapshot(m) || jsonb_build_object('email', inv.email));
  RETURN jsonb_build_object('company_id', inv.company_id, 'member_id', m.id);
END $$;

CREATE OR REPLACE FUNCTION public.decline_company_invitation(p_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  inv public.company_invitations%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sessao expirada' USING ERRCODE = '42501', HINT = 'admin.unauthenticated';
  END IF;
  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_email, v_confirmed FROM auth.users u WHERE u.id = uid;
  SELECT * INTO inv FROM public.company_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR v_email IS NULL OR v_confirmed IS NULL OR inv.email <> v_email THEN
    RAISE EXCEPTION 'Convite nao encontrado' USING HINT = 'admin.invite_not_found';
  END IF;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Convite nao esta pendente' USING HINT = 'admin.invite_closed';
  END IF;
  UPDATE public.company_invitations SET status = 'declined', responded_at = now(), responded_by = uid, version = version + 1
  WHERE id = inv.id;
  PERFORM public.company_member_audit_write(inv.company_id, 'invite.decline', uid, NULL, inv.id, inv.role_id, NULL, NULL,
    jsonb_build_object('email', inv.email));
  RETURN jsonb_build_object('id', inv.id);
END $$;

-- 17. Auditoria (paginada por id decrescente) ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_audit(
  p_company_id uuid,
  p_target_user_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_before_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.company_members%ROWTYPE;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_entries jsonb;
  v_last bigint;
  v_count integer;
BEGIN
  actor := public.admin_actor(p_company_id);
  PERFORM public.admin_require(actor, 'audit.view');
  WITH page AS (
    SELECT a.* FROM public.company_member_audit a
    WHERE a.company_id = p_company_id
      AND (p_target_user_id IS NULL OR a.target_user_id = p_target_user_id OR a.actor_id = p_target_user_id)
      AND (p_action IS NULL OR a.action = p_action OR a.action LIKE p_action || '.%')
      AND (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at < p_to)
      AND (p_before_id IS NULL OR a.id < p_before_id)
    ORDER BY a.id DESC
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', page.id,
      'created_at', page.created_at,
      'action', page.action,
      'reason', page.reason,
      'actor_id', page.actor_id,
      'actor_name', CASE WHEN page.actor_id IS NULL THEN 'Sistema'
                         ELSE COALESCE(NULLIF(btrim(ap.full_name), ''), split_part(au.email, '@', 1), 'Usuario') END,
      'target_user_id', page.target_user_id,
      'target_name', COALESCE(NULLIF(btrim(tp.full_name), ''), split_part(tu.email, '@', 1),
                              page.data_after ->> 'email', page.data_before ->> 'email'),
      'role_id', page.role_id,
      'role_name', r.name,
      'data_before', page.data_before,
      'data_after', page.data_after
    ) ORDER BY page.id DESC), '[]'::jsonb), min(page.id), count(*)
  INTO v_entries, v_last, v_count
  FROM page
  LEFT JOIN public.profiles ap ON ap.id = page.actor_id
  LEFT JOIN auth.users au ON au.id = page.actor_id
  LEFT JOIN public.profiles tp ON tp.id = page.target_user_id
  LEFT JOIN auth.users tu ON tu.id = page.target_user_id
  LEFT JOIN public.company_roles r ON r.id = page.role_id;
  RETURN jsonb_build_object('entries', v_entries,
    'next_before_id', CASE WHEN v_count = v_limit THEN v_last ELSE NULL END);
END $$;

-- 18. Guardas RLS por modulo (restritivas: somam-se as politicas existentes) ----------------------
DO $$
DECLARE
  g record;
  expr text;
  has_company boolean;
  rls_on boolean;
BEGIN
  FOR g IN SELECT * FROM (VALUES
      ('events', ARRAY['agenda.manage']),
      ('tasks', ARRAY['agenda.manage']),
      ('deadlines', ARRAY['agenda.manage']),
      ('appointments', ARRAY['agenda.manage']),
      ('waitlist', ARRAY['agenda.manage']),
      ('patients', ARRAY['patients.manage']),
      ('medical_records', ARRAY['records.edit']),
      ('prescriptions', ARRAY['records.edit']),
      ('exam_orders', ARRAY['records.edit']),
      ('vital_signs', ARRAY['records.edit']),
      ('inventory_items', ARRAY['inventory.manage']),
      ('inventory_movements', ARRAY['inventory.manage']),
      ('clinic_settings', ARRAY['settings.manage']),
      ('service_types', ARRAY['settings.manage']),
      ('finance_categories', ARRAY['settings.manage', 'finance.accounts'])
    ) AS v(tbl, perms)
  LOOP
    IF to_regclass(format('public.%I', g.tbl)) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT c.relrowsecurity INTO rls_on FROM pg_class c WHERE c.oid = to_regclass(format('public.%I', g.tbl));
    IF NOT rls_on THEN
      RAISE NOTICE 'RLS desativado em public.%: guarda de permissao registrada, mas inativa.', g.tbl;
    END IF;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = g.tbl AND column_name = 'company_id')
      INTO has_company;
    SELECT string_agg(
      CASE WHEN has_company AND g.tbl IN ('events', 'tasks', 'deadlines')
        THEN format('(CASE WHEN company_id IS NULL THEN (SELECT public.has_any_permission(%L)) ELSE public.has_permission(company_id, %L) END)', p, p)
        ELSE format('(SELECT public.has_any_permission(%L))', p)
      END, ' OR ')
      INTO expr
    FROM unnest(g.perms) AS p;
    EXECUTE format('DROP POLICY IF EXISTS perm_guard_insert ON public.%I', g.tbl);
    EXECUTE format('CREATE POLICY perm_guard_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', g.tbl, expr);
    EXECUTE format('DROP POLICY IF EXISTS perm_guard_update ON public.%I', g.tbl);
    EXECUTE format('CREATE POLICY perm_guard_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', g.tbl, expr, expr);
    EXECUTE format('DROP POLICY IF EXISTS perm_guard_delete ON public.%I', g.tbl);
    EXECUTE format('CREATE POLICY perm_guard_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', g.tbl, expr);
  END LOOP;

  -- Leitura do prontuario exige permissao propria (LGPD): nem recepcao nem financeiro por padrao.
  FOR g IN SELECT unnest(ARRAY['medical_records', 'prescriptions', 'exam_orders', 'vital_signs']) AS tbl LOOP
    IF to_regclass(format('public.%I', g.tbl)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS perm_guard_select ON public.%I', g.tbl);
    EXECUTE format('CREATE POLICY perm_guard_select ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_any_permission(%L)))', g.tbl, 'records.view');
  END LOOP;
END $$;

-- Movimentacao manual de estoque (mesma regra de 20260919140000 + permissao do modulo).
CREATE OR REPLACE FUNCTION public.move_inventory_item(p_id uuid, p_item_id uuid, p_type text, p_quantity integer, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item public.inventory_items%ROWTYPE; movement public.inventory_movements%ROWTYPE; company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF NOT public.has_any_permission('inventory.manage') THEN
    RAISE EXCEPTION 'Sem permissao para movimentar o estoque' USING ERRCODE = '42501', HINT = 'admin.forbidden';
  END IF;
  SELECT * INTO item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item nao encontrado'; END IF;
  company := (to_jsonb(item)->>'company_id')::uuid;
  IF (company IS NOT NULL AND NOT public.is_company_member(company))
     OR (company IS NULL AND NOT public.is_clinic_member()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  SELECT * INTO movement FROM public.inventory_movements WHERE id = p_id;
  IF FOUND THEN
    IF ROW(movement.item_id, movement.type, movement.quantity, movement.reason) IS DISTINCT FROM ROW(p_item_id, p_type, p_quantity, p_reason) THEN
      RAISE EXCEPTION 'Solicitacao ja utilizada com outros dados';
    END IF;
    RETURN;
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_type IS NULL OR p_type NOT IN ('entrada','saida') THEN
    RAISE EXCEPTION 'Movimentacao invalida';
  END IF;
  IF p_type = 'saida' AND item.quantity < p_quantity THEN RAISE EXCEPTION 'Estoque insuficiente'; END IF;
  UPDATE public.inventory_items SET quantity = quantity + CASE WHEN p_type = 'entrada' THEN p_quantity ELSE -p_quantity END WHERE id = p_item_id;
  EXECUTE 'INSERT INTO public.inventory_movements(id,item_id,type,quantity,reason' ||
    CASE WHEN company IS NOT NULL THEN ',company_id' ELSE '' END || ') VALUES ($1,$2,$3,$4,$5' ||
    CASE WHEN company IS NOT NULL THEN ',$6' ELSE '' END || ')'
    USING p_id, p_item_id, p_type, p_quantity, p_reason, company;
END;
$$;

-- 19. Privilegios de funcoes ------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.permission_closure(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.permission_prune(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.permission_effective(text[], text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.permission_assert_known(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.permission_adjustments(text[], text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.permission_grants_sensitive(text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_members_compute_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_roles_after_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_member_audit_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_default_company() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_action_permitted(text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_role_is_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_active_owner_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_member_snapshot(public.company_members) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_member_audit_write(uuid, text, uuid, uuid, uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_member_sync_legacy(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_require(public.company_members, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reason(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agenda_ids(text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_assert_doctor_available(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_pending_invitations() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.has_permission(uuid, text)',
    'public.has_any_permission(text)',
    'public.is_company_member(uuid)',
    'public.is_clinic_member()',
    'public.finance_allowed(uuid, text)',
    'public.move_inventory_item(uuid, uuid, text, integer, text)',
    'public.get_my_access(uuid)',
    'public.admin_get_overview(uuid)',
    'public.admin_update_member(uuid, integer, uuid, text[], text[], uuid, text, uuid[], boolean)',
    'public.admin_set_member_status(uuid, integer, text, text, uuid)',
    'public.admin_transfer_ownership(uuid, uuid, text)',
    'public.leave_company(uuid, text)',
    'public.admin_save_role(uuid, uuid, integer, text, text, text[], uuid)',
    'public.admin_archive_role(uuid, integer, uuid, text)',
    'public.admin_create_invitation(uuid, uuid, text, text, uuid, text[], text[], uuid, text, uuid[], boolean)',
    'public.admin_touch_invitation(uuid)',
    'public.admin_cancel_invitation(uuid, text)',
    'public.accept_company_invitation(uuid)',
    'public.decline_company_invitation(uuid)',
    'public.admin_list_audit(uuid, uuid, text, timestamptz, timestamptz, bigint, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;

-- 20. Resumo para conferencia: o SQL Editor exibe esta tabela ao final (situacao e perfil de cada
-- pessoa). O antes/depois fica na auditoria (acao migration.backfill).
SELECT c.name AS clinica,
  COALESCE(u.email, m.user_id::text) AS usuario,
  CASE m.status
    WHEN 'active' THEN 'Ativo'
    WHEN 'pending' THEN 'Aguardando aprovação'
    WHEN 'suspended' THEN 'Suspenso'
    WHEN 'removed' THEN 'Removido'
    ELSE m.status
  END AS situacao,
  COALESCE(r.name, '-') AS perfil
FROM public.company_members m
JOIN public.companies c ON c.id = m.company_id
LEFT JOIN auth.users u ON u.id = m.user_id
LEFT JOIN public.company_roles r ON r.id = m.role_id
ORDER BY 1, CASE m.status WHEN 'active' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, r.sort_order, 2;


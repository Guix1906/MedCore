BEGIN;

-- ============================================================================
-- 1. CORRIGIR public.finance_allowed:
-- Garantir que médicos, recepcionistas e membros da clínica possam gerar
-- cobranças e registrar títulos no agendamento de consultas.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.finance_allowed(p_company uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND p_action IN ('view','create','receive','pay','reverse','cancel','accounts') AND (
    -- 1. Usuário com papel administrativo/financeiro na tabela user_roles
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND ((to_jsonb(r)->>'company_id')::uuid IS NULL
             OR p_company IS NULL
             OR (to_jsonb(r)->>'company_id')::uuid = p_company)
        AND (p_company IS NULL OR public.is_company_member(p_company))
        AND (r.role::text IN ('owner','admin','finance_admin')
          OR (r.role::text = 'finance_edit' AND p_action IN ('view','create','receive','pay'))
          OR (r.role::text = 'finance_view' AND p_action = 'view'))
    )
    -- 2. Membro ativo da empresa/clínica (pode visualizar, criar cobrança de consulta e receber)
    OR (
      p_action IN ('view', 'create', 'receive') AND (
        (p_company IS NOT NULL AND public.is_company_member(p_company))
        OR public.is_clinic_member()
      )
    )
    -- 3. Profissional / médico / recepcionista cadastrado e ativo
    OR (
      EXISTS (
        SELECT 1 FROM public.doctors d
        WHERE d.auth_id = auth.uid() AND d.active
          AND (
            d.role IN ('admin', 'recepcionista', 'secretaria', 'atendente', 'medico')
            OR p_action IN ('view', 'create', 'receive')
          )
      )
    )
    -- 4. Fallback para administradores do sistema em profiles
    OR (
      p_action IN ('view', 'create', 'receive') AND EXISTS (
        SELECT 1 FROM public.profiles pr
        WHERE pr.id = auth.uid()
          AND (p_company IS NULL OR pr.active_company_id = p_company OR public.is_company_member(p_company))
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.finance_allowed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_allowed(uuid, text) TO authenticated;

-- ============================================================================
-- 2. CORRIGIR public.create_event_financial_title:
-- Evitar que a empresa da cobrança seja sobrescrita com NULL quando o paciente
-- não possui company_id definido.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_event_financial_title(
  p_event_id uuid,
  p_amount numeric,
  p_due_date date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.events%ROWTYPE;
  t public.transactions%ROWTYPE;
  result uuid;
  finance_company uuid;
  patient_comp uuid;
BEGIN
  -- Busca o evento com bloqueio para consistência
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_allowed(e.company_id, 'create') THEN
    RAISE EXCEPTION 'Evento inexistente ou sem permissao financeira';
  END IF;

  -- Se já houver cobrança para este evento (idempotência)
  SELECT * INTO t FROM public.transactions WHERE origin_key = 'event:' || p_event_id;
  IF FOUND THEN
    IF ROW(t.amount, t.due_date) IS DISTINCT FROM ROW(p_amount, p_due_date) THEN
      RAISE EXCEPTION 'Evento ja possui cobranca com outras condicoes';
    END IF;
    RETURN t.id;
  END IF;

  -- Determinação segura da empresa financeira
  finance_company := e.company_id;
  IF e.patient_id IS NOT NULL THEN
    SELECT (to_jsonb(p)->>'company_id')::uuid INTO patient_comp FROM public.patients p WHERE p.id = e.patient_id;
    IF patient_comp IS NOT NULL AND e.company_id IS NOT NULL AND patient_comp <> e.company_id THEN
      RAISE EXCEPTION 'Paciente do evento pertence a outra clinica';
    END IF;
    -- Se o paciente tiver empresa definida, valida; caso contrário, preserva a empresa do evento
    finance_company := COALESCE(e.company_id, patient_comp);
  END IF;

  -- Cria o título financeiro da consulta/atendimento
  result := public.create_financial_title(
    gen_random_uuid(),
    'receita',
    p_amount,
    p_due_date,
    'Cobranca de atendimento',
    e.patient_id,
    NULL,
    'Atendimentos',
    NULL,
    finance_company
  );

  UPDATE public.transactions SET origin_key = 'event:' || p_event_id WHERE id = result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_financial_title(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_financial_title(uuid, numeric, date) TO authenticated;

COMMIT;

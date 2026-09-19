BEGIN;

ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS next_return_date date,
  ADD COLUMN IF NOT EXISTS last_return_date date,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'parcelado',
  ADD COLUMN IF NOT EXISTS down_payment_method text,
  ADD COLUMN IF NOT EXISTS down_payment_due_date date,
  ADD COLUMN IF NOT EXISTS first_due_date date;
ALTER TABLE public.treatments ALTER COLUMN return_days SET DEFAULT 30;
ALTER TABLE public.treatments DROP CONSTRAINT IF EXISTS treatment_payment_type_check;
ALTER TABLE public.treatments ADD CONSTRAINT treatment_payment_type_check
  CHECK (payment_type IN ('a_vista', 'parcelado', 'financiado'));

-- Legacy installations without company_id retain their existing clinic membership boundary.
CREATE OR REPLACE FUNCTION public.can_access_treatment(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.treatments t WHERE t.id = p_id AND
      CASE WHEN to_jsonb(t)->>'company_id' IS NOT NULL
        THEN public.is_company_member((to_jsonb(t)->>'company_id')::uuid)
        ELSE public.is_clinic_member() END
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_treatment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_treatment(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.treatment_evolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES public.treatments(id) ON DELETE RESTRICT,
  occurred_on date NOT NULL,
  notes text NOT NULL CHECK (length(btrim(notes)) > 0),
  weight_kg numeric(6,2) CHECK (weight_kg > 0 AND weight_kg <= 700),
  parameters text,
  next_step text,
  is_return boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.treatment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES public.treatments(id) ON DELETE RESTRICT,
  previous_status text NOT NULL,
  status text NOT NULL,
  justification text NOT NULL CHECK (length(btrim(justification)) > 0),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.treatment_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES public.treatments(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE,
  taken_on date NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  objective text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (split_part(storage_path, '/', 1) = treatment_id::text)
);
CREATE TABLE IF NOT EXISTS public.treatment_medication_uses (
  id uuid PRIMARY KEY,
  treatment_id uuid NOT NULL REFERENCES public.treatments(id) ON DELETE RESTRICT,
  medication_id uuid NOT NULL REFERENCES public.treatment_medications(id) ON DELETE RESTRICT,
  medication_name text NOT NULL,
  dose text NOT NULL CHECK (length(btrim(dose)) > 0),
  route text,
  used_at timestamptz NOT NULL,
  notes text,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity integer,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((inventory_item_id IS NULL AND quantity IS NULL) OR
         (inventory_item_id IS NOT NULL AND quantity IS NOT NULL AND quantity > 0))
);

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['treatment_evolutions', 'treatment_status_history', 'treatment_photos', 'treatment_medication_uses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format('DROP POLICY IF EXISTS treatment_read ON public.%I', tbl);
    EXECUTE format('CREATE POLICY treatment_read ON public.%I FOR SELECT TO authenticated USING (public.can_access_treatment(treatment_id))', tbl);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_treatment_id_created_at_idx ON public.%I (treatment_id, created_at DESC)', tbl, tbl);
  END LOOP;
END $$;
GRANT INSERT ON public.treatment_photos TO authenticated;
DROP POLICY IF EXISTS treatment_photo_insert ON public.treatment_photos;
CREATE POLICY treatment_photo_insert ON public.treatment_photos FOR INSERT TO authenticated
  WITH CHECK (public.can_access_treatment(treatment_id) AND created_by = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('treatment-photos', 'treatment-photos', false, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS treatment_photo_storage_read ON storage.objects;
CREATE POLICY treatment_photo_storage_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'treatment-photos' AND CASE
  WHEN split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
  THEN public.can_access_treatment(split_part(name, '/', 1)::uuid) ELSE false END);
DROP POLICY IF EXISTS treatment_photo_storage_insert ON storage.objects;
CREATE POLICY treatment_photo_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'treatment-photos' AND CASE
  WHEN split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
  THEN public.can_access_treatment(split_part(name, '/', 1)::uuid) ELSE false END);
-- Only orphaned uploads can be removed; recorded clinical photos are retained.
DROP POLICY IF EXISTS treatment_photo_storage_cleanup ON storage.objects;
CREATE POLICY treatment_photo_storage_cleanup ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'treatment-photos' AND owner_id = auth.uid()::text
  AND NOT EXISTS (SELECT 1 FROM public.treatment_photos p WHERE p.storage_path = name));

CREATE OR REPLACE FUNCTION public.treatment_followup_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.return_days IS NULL THEN NEW.return_days := 30; END IF;
  IF NEW.return_days < 1 OR NEW.return_days > 365 THEN
    RAISE EXCEPTION 'Intervalo de retorno deve estar entre 1 e 365 dias';
  END IF;
  IF NEW.end_date < NEW.start_date THEN RAISE EXCEPTION 'Fim do protocolo anterior ao inicio'; END IF;
  IF NEW.status IN ('finalizado', 'cancelado') THEN
    NEW.next_return_date := NULL;
  ELSE
    NEW.next_return_date := COALESCE(NEW.last_return_date, NEW.start_date) + NEW.return_days;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.uid() IS NULL OR NOT public.can_access_treatment(OLD.id) THEN
      RAISE EXCEPTION 'Acesso negado';
    END IF;
    IF NULLIF(btrim(NEW.status_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Informe a justificativa da mudanca de status';
    END IF;
    INSERT INTO public.treatment_status_history(treatment_id, previous_status, status, justification)
      VALUES (NEW.id, OLD.status, NEW.status, NEW.status_reason);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.treatment_followup_dates() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS treatment_followup_dates ON public.treatments;
CREATE TRIGGER treatment_followup_dates BEFORE INSERT OR UPDATE ON public.treatments
FOR EACH ROW EXECUTE FUNCTION public.treatment_followup_dates();
UPDATE public.treatments SET return_days = COALESCE(return_days, 30)
WHERE return_days IS NULL OR next_return_date IS NULL OR status IN ('finalizado','cancelado');

CREATE OR REPLACE FUNCTION public.record_treatment_evolution(
  p_id uuid, p_treatment_id uuid, p_occurred_on date, p_notes text,
  p_weight_kg numeric DEFAULT NULL, p_parameters text DEFAULT NULL,
  p_next_step text DEFAULT NULL, p_is_return boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.treatments%ROWTYPE; existing public.treatment_evolutions%ROWTYPE;
BEGIN
  IF NOT public.can_access_treatment(p_treatment_id) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT * INTO t FROM public.treatments WHERE id = p_treatment_id FOR UPDATE;
  SELECT * INTO existing FROM public.treatment_evolutions WHERE id = p_id;
  IF FOUND THEN
    IF existing.treatment_id <> p_treatment_id OR existing.created_by <> auth.uid() THEN RAISE EXCEPTION 'Registro duplicado'; END IF;
    IF ROW(existing.occurred_on, existing.notes, existing.weight_kg, existing.parameters, existing.next_step, existing.is_return)
      IS DISTINCT FROM ROW(p_occurred_on, btrim(p_notes), p_weight_kg, p_parameters, p_next_step, p_is_return) THEN
      RAISE EXCEPTION 'Esta solicitacao ja foi salva com outros dados; atualize o historico';
    END IF;
    RETURN existing.id;
  END IF;
  IF p_occurred_on IS NULL OR p_occurred_on > CURRENT_DATE OR p_occurred_on < t.start_date THEN
    RAISE EXCEPTION 'Data da evolucao deve estar entre o inicio do plano e hoje';
  END IF;
  IF p_weight_kg IS NOT NULL AND (p_weight_kg <= 0 OR p_weight_kg > 700 OR p_weight_kg <> round(p_weight_kg, 2)) THEN RAISE EXCEPTION 'Peso invalido: use ate duas casas decimais'; END IF;
  IF p_is_return AND t.status <> 'em_andamento' THEN RAISE EXCEPTION 'Retorno exige plano em andamento'; END IF;
  INSERT INTO public.treatment_evolutions(id, treatment_id, occurred_on, notes, weight_kg, parameters, next_step, is_return)
    VALUES(p_id, p_treatment_id, p_occurred_on, btrim(p_notes), p_weight_kg, p_parameters, p_next_step, p_is_return);
  IF p_is_return THEN
    UPDATE public.treatments SET last_return_date = GREATEST(COALESCE(last_return_date, p_occurred_on), p_occurred_on)
      WHERE id = p_treatment_id;
  END IF;
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_treatment_evolution(uuid,uuid,date,text,numeric,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_treatment_evolution(uuid,uuid,date,text,numeric,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_treatment_medication_use(
  p_id uuid, p_medication_id uuid, p_dose text, p_used_at timestamptz,
  p_route text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_inventory_item_id uuid DEFAULT NULL, p_quantity integer DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.treatment_medications%ROWTYPE; t public.treatments%ROWTYPE;
  item public.inventory_items%ROWTYPE; existing public.treatment_medication_uses%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.treatment_medications WHERE id = p_medication_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_treatment(m.treatment_id) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT * INTO t FROM public.treatments WHERE id = m.treatment_id FOR UPDATE;
  SELECT * INTO existing FROM public.treatment_medication_uses WHERE id = p_id;
  IF FOUND THEN
    IF existing.medication_id <> p_medication_id OR existing.created_by <> auth.uid() THEN RAISE EXCEPTION 'Registro duplicado'; END IF;
    IF ROW(existing.dose, existing.used_at, existing.route, existing.notes, existing.inventory_item_id, existing.quantity)
      IS DISTINCT FROM ROW(btrim(p_dose), p_used_at, p_route, p_notes, p_inventory_item_id, p_quantity) THEN
      RAISE EXCEPTION 'Esta solicitacao ja foi salva com outros dados; atualize o historico';
    END IF;
    RETURN existing.id;
  END IF;
  IF t.status <> 'em_andamento' OR m.status <> 'ativo' THEN RAISE EXCEPTION 'Plano e medicacao devem estar ativos'; END IF;
  IF p_used_at IS NULL OR p_used_at > now() OR p_used_at::date < t.start_date THEN RAISE EXCEPTION 'Data de uso invalida'; END IF;
  IF p_inventory_item_id IS NOT NULL THEN
    SELECT * INTO item FROM public.inventory_items WHERE id = p_inventory_item_id FOR UPDATE;
    IF NOT FOUND OR NOT item.active THEN RAISE EXCEPTION 'Item de estoque indisponivel'; END IF;
    IF (to_jsonb(item)->>'company_id') IS DISTINCT FROM (to_jsonb(t)->>'company_id') THEN RAISE EXCEPTION 'Item de outra clinica'; END IF;
    IF item.expiry_date < p_used_at::date THEN RAISE EXCEPTION 'Item de estoque vencido'; END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR item.quantity < p_quantity THEN RAISE EXCEPTION 'Quantidade indisponivel em estoque'; END IF;
    UPDATE public.inventory_items SET quantity = quantity - p_quantity WHERE id = item.id;
    EXECUTE 'INSERT INTO public.inventory_movements(item_id, type, quantity, reason, doctor_id' ||
      CASE WHEN to_jsonb(item)->>'company_id' IS NOT NULL THEN ', company_id' ELSE '' END ||
      ') VALUES ($1,$2,$3,$4,$5' || CASE WHEN to_jsonb(item)->>'company_id' IS NOT NULL THEN ',$6' ELSE '' END || ')'
      USING item.id, 'saida', p_quantity, 'Uso em acompanhamento ' || t.id::text, t.doctor_id, (to_jsonb(item)->>'company_id')::uuid;
  ELSIF p_quantity IS NOT NULL THEN
    RAISE EXCEPTION 'Quantidade de estoque exige um item da clinica';
  END IF;
  INSERT INTO public.treatment_medication_uses(id, treatment_id, medication_id, medication_name, dose, route, used_at, notes, inventory_item_id, quantity)
    VALUES(p_id, t.id, m.id, m.name, btrim(p_dose), p_route, p_used_at, p_notes, p_inventory_item_id, p_quantity);
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_treatment_medication_use(uuid,uuid,text,timestamptz,text,text,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_treatment_medication_use(uuid,uuid,text,timestamptz,text,text,uuid,integer) TO authenticated;

-- A single synchronizer replaces both historical triggers; entry is installment zero.
DROP TRIGGER IF EXISTS treatment_installment_paid ON public.treatment_installments;
DROP TRIGGER IF EXISTS trg_installment_sync ON public.treatment_installments;
CREATE OR REPLACE FUNCTION public.sync_installment_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.treatments%ROWTYPE; tx_id uuid; tx_status text; company uuid;
BEGIN
  SELECT * INTO t FROM public.treatments WHERE id = NEW.treatment_id;
  tx_status := CASE WHEN NEW.status = 'pago' THEN 'pago'
    WHEN NEW.status IN ('cancelado','renegociado') THEN 'cancelado'
    WHEN NEW.due_date < CURRENT_DATE THEN 'vencido' ELSE 'pendente' END;
  SELECT id INTO tx_id FROM public.transactions WHERE installment_id = NEW.id ORDER BY created_at LIMIT 1;
  -- Some installations used only the reverse transaction_id link.
  IF tx_id IS NULL THEN tx_id := NULLIF(to_jsonb(NEW)->>'transaction_id', '')::uuid; END IF;
  company := (to_jsonb(t)->>'company_id')::uuid;
  IF tx_id IS NULL THEN
    EXECUTE 'INSERT INTO public.transactions(type, amount, date, status, description, payment_method, patient_id, doctor_id, treatment_id, installment_id' ||
      CASE WHEN company IS NOT NULL THEN ', company_id' ELSE '' END ||
      ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10' || CASE WHEN company IS NOT NULL THEN ',$11' ELSE '' END || ') RETURNING id'
    INTO tx_id USING 'receita', NEW.amount, COALESCE(NEW.paid_date, NEW.due_date), tx_status,
      'Acompanhamento: ' || t.title || CASE WHEN NEW.number = 0 THEN ' - Entrada' ELSE ' - Parcela ' || NEW.number END,
      NEW.payment_method, t.patient_id, t.doctor_id, t.id, NEW.id, company;
  ELSE
    UPDATE public.transactions SET amount = NEW.amount, date = COALESCE(NEW.paid_date, NEW.due_date),
      status = tx_status, payment_method = NEW.payment_method, installment_id = NEW.id, treatment_id = t.id,
      description = 'Acompanhamento: ' || t.title || CASE WHEN NEW.number = 0 THEN ' - Entrada' ELSE ' - Parcela ' || NEW.number END,
      updated_at = now() WHERE id = tx_id;
  END IF;
  IF to_jsonb(t)->>'company_id' IS NOT NULL THEN
    EXECUTE 'UPDATE public.transactions SET company_id = $1 WHERE id = $2'
      USING (to_jsonb(t)->>'company_id')::uuid, tx_id;
  END IF;
  UPDATE public.transactions SET due_date = NEW.due_date,
    paid_at = CASE WHEN NEW.status = 'pago' THEN NEW.paid_date::timestamptz ELSE NULL END
    WHERE id = tx_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_installment_transaction() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_installment_sync AFTER INSERT OR UPDATE ON public.treatment_installments
FOR EACH ROW EXECUTE FUNCTION public.sync_installment_transaction();

CREATE OR REPLACE FUNCTION public.configure_treatment_payment(
  p_treatment_id uuid, p_total numeric, p_discount numeric, p_down numeric,
  p_type text, p_down_method text, p_method text, p_count integer,
  p_down_due date, p_first_due date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.treatments%ROWTYPE; balance_cents bigint; each_cents bigint; remainder_cents bigint; i integer;
  methods text[] := ARRAY['pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia','convenio'];
BEGIN
  IF NOT public.can_access_treatment(p_treatment_id) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT * INTO t FROM public.treatments WHERE id = p_treatment_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.treatment_installments WHERE treatment_id = t.id AND status = 'pago') THEN
    RAISE EXCEPTION 'Plano com recebimentos: preserve as parcelas pagas; nao e permitida a regeneracao';
  END IF;
  IF p_total IS NULL OR p_discount IS NULL OR p_down IS NULL OR p_total <= 0 OR p_discount < 0 OR p_down < 0
     OR p_discount + p_down > p_total OR p_total <> round(p_total,2) OR p_down <> round(p_down,2) OR p_discount <> round(p_discount,2) THEN
    RAISE EXCEPTION 'Valores invalidos: confira total, desconto e entrada';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('a_vista','parcelado','financiado') OR p_count IS NULL OR p_count < 1 OR p_count > 120
    OR (p_type = 'a_vista' AND p_count <> 1) THEN RAISE EXCEPTION 'Tipo ou numero de parcelas invalido'; END IF;
  balance_cents := round((p_total - p_discount - p_down) * 100);
  IF p_down > 0 AND (p_down_method IS NULL OR NOT p_down_method = ANY(methods) OR p_down_due IS NULL) THEN RAISE EXCEPTION 'Informe forma e vencimento da entrada'; END IF;
  IF balance_cents > 0 AND (p_method IS NULL OR NOT p_method = ANY(methods) OR p_first_due IS NULL OR balance_cents < p_count) THEN
    RAISE EXCEPTION 'Informe forma, vencimento e parcelas validas para o saldo';
  END IF;
  UPDATE public.treatment_installments SET status = 'cancelado' WHERE treatment_id = t.id;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'treatment_installments' AND column_name = 'transaction_id') THEN
    EXECUTE 'UPDATE public.treatment_installments SET transaction_id = NULL WHERE treatment_id = $1 AND transaction_id IS NOT NULL' USING t.id;
  END IF;
  DELETE FROM public.transactions WHERE treatment_id = t.id AND installment_id IN
    (SELECT id FROM public.treatment_installments WHERE treatment_id = t.id);
  DELETE FROM public.treatment_installments WHERE treatment_id = t.id;
  UPDATE public.treatments SET total_value = p_total, discount = p_discount, down_payment = p_down,
    payment_type = p_type, down_payment_method = p_down_method, payment_method = p_method,
    installments_count = p_count, down_payment_due_date = p_down_due, first_due_date = p_first_due
    WHERE id = t.id;
  IF p_down > 0 THEN
    INSERT INTO public.treatment_installments(treatment_id, number, amount, due_date, payment_method)
      VALUES(t.id, 0, p_down, p_down_due, p_down_method);
  END IF;
  IF balance_cents > 0 THEN
    each_cents := balance_cents / p_count;
    remainder_cents := balance_cents % p_count;
    FOR i IN 1..p_count LOOP
      INSERT INTO public.treatment_installments(treatment_id, number, amount, due_date, payment_method)
        VALUES(t.id, i, (each_cents + CASE WHEN i <= remainder_cents THEN 1 ELSE 0 END)::numeric / 100,
          (p_first_due + make_interval(months => i - 1))::date, p_method);
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.configure_treatment_payment(uuid,numeric,numeric,numeric,text,text,text,integer,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_treatment_payment(uuid,numeric,numeric,numeric,text,text,text,integer,date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_treatment_installments(p_treatment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE t public.treatments%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.treatments WHERE id = p_treatment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano nao encontrado'; END IF;
  PERFORM public.configure_treatment_payment(t.id, t.total_value, t.discount, t.down_payment,
    t.payment_type, COALESCE(t.down_payment_method, t.payment_method), t.payment_method,
    t.installments_count, COALESCE(t.down_payment_due_date, t.start_date), COALESCE(t.first_due_date, t.start_date));
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_treatment_installment(p_id uuid, p_paid_date date, p_method text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inst public.treatment_installments%ROWTYPE;
BEGIN
  SELECT * INTO inst FROM public.treatment_installments WHERE id = p_id;
  IF NOT FOUND OR NOT public.can_access_treatment(inst.treatment_id) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  PERFORM 1 FROM public.treatments WHERE id = inst.treatment_id FOR UPDATE;
  SELECT * INTO inst FROM public.treatment_installments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela alterada; atualize a tela'; END IF;
  IF inst.status = 'pago' THEN RETURN; END IF;
  IF inst.status NOT IN ('pendente','atrasado') THEN RAISE EXCEPTION 'Parcela indisponivel para recebimento'; END IF;
  IF p_paid_date IS NULL OR p_paid_date > CURRENT_DATE OR p_method IS NULL OR p_method NOT IN
    ('pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia','convenio') THEN RAISE EXCEPTION 'Data ou forma de recebimento invalida'; END IF;
  UPDATE public.treatment_installments SET status = 'pago', paid_date = p_paid_date, payment_method = p_method WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pay_treatment_installment(uuid,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_treatment_installment(uuid,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_treatment_alerts()
RETURNS TABLE(id text, treatment_id uuid, patient_name text, title text, kind text, target_date date, amount numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT 'return:' || t.id || ':' || t.next_return_date, t.id, p.name, t.title, 'retorno', t.next_return_date, NULL::numeric
  FROM public.treatments t JOIN public.patients p ON p.id = t.patient_id
  WHERE public.can_access_treatment(t.id) AND t.status = 'em_andamento' AND t.next_return_date <= CURRENT_DATE + 7
  UNION ALL
  SELECT 'protocol:' || t.id || ':' || t.end_date, t.id, p.name, t.title, 'protocolo', t.end_date, NULL::numeric
  FROM public.treatments t JOIN public.patients p ON p.id = t.patient_id
  WHERE public.can_access_treatment(t.id) AND t.status IN ('em_andamento','pausado') AND t.end_date <= CURRENT_DATE + 7
  UNION ALL
  SELECT 'completed:' || t.id, t.id, p.name, t.title, 'concluido', t.end_date, NULL::numeric
  FROM public.treatments t JOIN public.patients p ON p.id = t.patient_id
  WHERE public.can_access_treatment(t.id) AND t.status = 'finalizado'
  UNION ALL
  SELECT 'payment:' || i.id, t.id, p.name, t.title, 'pagamento', i.due_date, i.amount
  FROM public.treatment_installments i JOIN public.treatments t ON t.id = i.treatment_id JOIN public.patients p ON p.id = t.patient_id
  WHERE public.can_access_treatment(t.id) AND i.status IN ('pendente','atrasado') AND i.due_date <= CURRENT_DATE + 7;
$$;
REVOKE ALL ON FUNCTION public.get_treatment_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_treatment_alerts() TO authenticated;

CREATE OR REPLACE FUNCTION public.move_inventory_item(p_id uuid, p_item_id uuid, p_type text, p_quantity integer, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item public.inventory_items%ROWTYPE; movement public.inventory_movements%ROWTYPE; company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso negado'; END IF;
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
REVOKE ALL ON FUNCTION public.move_inventory_item(uuid,uuid,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_inventory_item(uuid,uuid,text,integer,text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.treatment_installments FROM authenticated, anon;

COMMIT;

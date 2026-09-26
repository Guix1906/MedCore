import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import { reportingRows } from "./finance-math";
import type { FinanceSnapshot, FinancialTitle, FinancialPayment, FinancialAccount } from "./finance-schema";
import { getStoredLocalEvents } from "@/lib/local-events";
import { isRecordWiped, addSuppressedIds } from "@/lib/wipe-system";

// Demonstração ou títulos base desabilitados para refletir 100% os dados reais cadastrados pelo usuário
const BASELINE_TITLES: FinancialTitle[] = [];
const BASELINE_PAYMENTS: FinancialPayment[] = [];

const DEFAULT_ACCOUNTS: FinancialAccount[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "BANCO DO BRASIL / PIX",
    type: "corrente",
    company_id: null,
    active: true,
    balance_kind: "available",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Caixa Geral / Tesouraria",
    type: "caixa",
    company_id: null,
    active: true,
    balance_kind: "available",
  },
];

const STORAGE_KEY_LOCAL_PAYMENTS = "medcore_local_payments";
const STORAGE_KEY_LOCAL_TITLES = "medcore_local_titles";

export function getLocalTitles(): FinancialTitle[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCAL_TITLES);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((t) => !isRecordWiped(t)) : [];
  } catch {
    return [];
  }
}

export function extractEventId(str: string | null | undefined): string | null {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  if (s.startsWith("event:")) return s.slice(6).trim();
  if (s.startsWith("pay-evt-")) return s.slice(8).trim();
  if (s.startsWith("evt-")) return s.slice(4).trim();
  if (s.startsWith("title-pay-evt-")) return s.slice(14).trim();
  if (s.startsWith("title-pay-")) {
    const rest = s.slice(10).trim();
    if (rest.startsWith("evt-")) return rest.slice(4).trim();
    return rest;
  }
  if (s.startsWith("syn-pay-evt-")) return s.slice(12).trim();
  if (s.startsWith("syn-pay-")) {
    const rest = s.slice(8).trim();
    if (rest.startsWith("evt-")) return rest.slice(4).trim();
    return rest;
  }
  return null;
}

export function getTitleEventKey(t: any): string | null {
  if (!t) return null;
  return extractEventId(t.origin_key) || extractEventId(t.id);
}

export function saveLocalFinancialTitle(title: FinancialTitle): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getLocalTitles();
    const itemToSave = {
      ...title,
      created_at: (title as any).created_at || new Date().toISOString(),
    };
    const titleEv = getTitleEventKey(title);
    const next = [
      itemToSave,
      ...current.filter((t) => {
        if (t.id === title.id) return false;
        if (title.origin_key && t.origin_key === title.origin_key) return false;
        const tEv = getTitleEventKey(t);
        if (titleEv && tEv && titleEv === tEv) return false;
        return true;
      }),
    ];
    localStorage.setItem(STORAGE_KEY_LOCAL_TITLES, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_local_title_saved"));
  } catch (e) {
    console.error("Erro ao salvar título local:", e);
  }
}

export function getLocalPayments(): FinancialPayment[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCAL_PAYMENTS);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => !isRecordWiped(p)) : [];
  } catch {
    return [];
  }
}

export function saveLocalPayment(payment: FinancialPayment): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getLocalPayments();
    const itemToSave = {
      ...payment,
      created_at: payment.created_at || new Date().toISOString(),
    };
    const payEv = extractEventId(payment.id) || extractEventId(payment.transaction_id);
    const next = [
      itemToSave,
      ...current.filter((p) => {
        if (p.id === payment.id) return false;
        const pEv = extractEventId(p.id) || extractEventId(p.transaction_id);
        if (payEv && pEv && payEv === pEv) return false;
        return true;
      }),
    ];
    localStorage.setItem(STORAGE_KEY_LOCAL_PAYMENTS, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_local_title_saved"));
  } catch (e) {
    console.error("Erro ao salvar pagamento local:", e);
  }
}

export function reverseLocalPayment(paymentId: string, reason: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getLocalPayments();
    const next = current.map((p) =>
      p.id === paymentId
        ? {
            ...p,
            reversed_at: new Date().toISOString(),
            reversed_by: "Usuário",
            reversal_reason: reason,
          }
        : p,
    );
    localStorage.setItem(STORAGE_KEY_LOCAL_PAYMENTS, JSON.stringify(next));
  } catch (e) {
    console.error("Erro ao estornar pagamento local:", e);
  }
}

export function deleteLocalFinancialTitle(idOrOriginKey: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    addSuppressedIds([idOrOriginKey]);
    const current = getLocalTitles();
    const next = current.filter(
      (t) =>
        t.id !== idOrOriginKey &&
        t.origin_key !== idOrOriginKey &&
        !idOrOriginKey.includes(t.id),
    );
    localStorage.setItem(STORAGE_KEY_LOCAL_TITLES, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_local_title_saved"));
  } catch (e) {
    console.error("Erro ao excluir título local:", e);
  }
}

export function deleteLocalPayment(paymentId: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    addSuppressedIds([paymentId]);
    const current = getLocalPayments();
    const next = current.filter((p) => p.id !== paymentId && p.transaction_id !== paymentId);
    localStorage.setItem(STORAGE_KEY_LOCAL_PAYMENTS, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_local_title_saved"));
  } catch (e) {
    console.error("Erro ao excluir pagamento local:", e);
  }
}

function parseMetaNumber(val: any): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^\d.,]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function parseEventFinancialMeta(description: string | null | undefined) {
  if (!description) return null;
  const m = description.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]);
    const procedurePrice = parseMetaNumber(meta.procedurePrice || meta.price || meta.total || meta.valor);
    const downPayment = parseMetaNumber(meta.downPayment || meta.sinal || meta.entry);
    const remainingValue = parseMetaNumber(meta.remainingValue || meta.restante);
    if (procedurePrice > 0 || downPayment > 0) {
      return {
        procedurePrice: procedurePrice > 0 ? procedurePrice : downPayment,
        downPayment,
        remainingValue:
          remainingValue > 0 ? remainingValue : Math.max(0, procedurePrice - downPayment),
        downPaymentMethod: meta.downPaymentMethod || meta.forma || "pix",
        clientId: meta.clientId || null,
        patientName: meta.patientName || null,
      };
    }
  } catch {}
  return null;
}

function normalizeFinancialSnapshot(
  raw: FinanceSnapshot,
  remoteEvents: any[] = [],
): FinanceSnapshot {
  let deletedTitleIds = new Set<string>();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const rawTitles = localStorage.getItem("medcore_deleted_titles");
      if (rawTitles) {
        const parsed = JSON.parse(rawTitles);
        if (Array.isArray(parsed)) parsed.forEach((id) => deletedTitleIds.add(id));
      }
      const rawCash = localStorage.getItem("medcore_deleted_cash_entries");
      if (rawCash) {
        const parsed = JSON.parse(rawCash);
        if (Array.isArray(parsed)) parsed.forEach((id) => deletedTitleIds.add(id));
      }
    } catch {}
  }

  const rawTitles: FinancialTitle[] = (Array.isArray(raw?.titles) ? raw.titles : []).filter(
    (t) => !isRecordWiped(t) && !deletedTitleIds.has(t.id),
  );
  const rawPayments: FinancialPayment[] = (Array.isArray(raw?.payments) ? raw.payments : []).filter(
    (p) =>
      !isRecordWiped(p) &&
      !deletedTitleIds.has(p.id) &&
      !deletedTitleIds.has(p.transaction_id),
  );
  const rawAccounts: FinancialAccount[] = Array.isArray(raw?.accounts) ? raw.accounts : [];
  const rawScopes: any[] = Array.isArray(raw?.scopes) ? raw.scopes : [];

  // 0. Mapeia todos os agendamentos (locais e remotos) para cruzar IDs, pacientes e metadados financeiros
  const localEvents = getStoredLocalEvents();
  const allEventsMap = new Map<string, any>();
  remoteEvents.forEach((re) => {
    if (re?.id && !isRecordWiped(re)) allEventsMap.set(re.id, re);
  });
  localEvents.forEach((le) => {
    if (le?.id && !isRecordWiped(le)) {
      const existing = allEventsMap.get(le.id);
      allEventsMap.set(le.id, existing ? { ...existing, ...le } : le);
    }
  });

  // Função auxiliar para vincular qualquer título ao seu agendamento (por origin_key, id ou correspondência de paciente e procedimento)
  function resolveTitleEventKey(t: FinancialTitle | undefined | null): string | null {
    if (!t) return null;
    const directKey = extractEventId(t.origin_key) || extractEventId(t.id);
    if (directKey) return directKey;

    const normPatient = (t.patient_name || t.payer_name || "").trim().toLowerCase();
    const tAmount = Number(t.amount) || 0;
    if (normPatient && normPatient !== "paciente" && normPatient !== "cliente") {
      for (const ev of allEventsMap.values()) {
        const evPatient = (ev.patient_name || (ev.title && ev.title.includes("-") ? ev.title.split("-")[0]?.trim() : "")).toLowerCase();
        if (evPatient && (evPatient === normPatient || normPatient.includes(evPatient) || evPatient.includes(normPatient))) {
          const fMeta = parseEventFinancialMeta(ev.description);
          if (fMeta && Math.abs((fMeta.procedurePrice || fMeta.downPayment) - tAmount) < 0.01) {
            return ev.id;
          }
        }
      }
    }
    return null;
  }

  const mergedTitles: FinancialTitle[] = [];
  const existingTitleIds = new Set<string>();
  const existingEventToTitleMap = new Map<string, FinancialTitle>();

  // 1. Deduplica e insere títulos remotos (garante 1 título por agendamento)
  rawTitles.forEach((rt) => {
    if (existingTitleIds.has(rt.id)) return;
    const evKey = resolveTitleEventKey(rt);
    if (evKey) {
      if (!rt.origin_key) rt.origin_key = `event:${evKey}`;
      const existing = existingEventToTitleMap.get(evKey);
      if (existing) {
        if ((Number(rt.paid_amount) || 0) > (Number(existing.paid_amount) || 0)) {
          existing.paid_amount = rt.paid_amount;
        }
        if ((Number(rt.amount) || 0) > (Number(existing.amount) || 0)) {
          existing.amount = rt.amount;
        }
        if (existing.paid_amount >= existing.amount && existing.amount > 0) {
          existing.status = "pago";
        }
        existingTitleIds.add(rt.id);
        return;
      }
      existingEventToTitleMap.set(evKey, rt);
    }
    mergedTitles.push(rt);
    existingTitleIds.add(rt.id);
  });

  // 1a. Merge baseline titles se não existirem e não estiverem limpos
  BASELINE_TITLES.forEach((bt) => {
    if (!existingTitleIds.has(bt.id) && !deletedTitleIds.has(bt.id) && !isRecordWiped(bt)) {
      mergedTitles.push(bt);
      existingTitleIds.add(bt.id);
    }
  });

  // 1b. Merge títulos locais armazenados (localStorage) com deduplicação estrita por agendamento
  const localTitles = getLocalTitles();
  localTitles.forEach((lt) => {
    if (deletedTitleIds.has(lt.id) || isRecordWiped(lt) || existingTitleIds.has(lt.id)) return;
    const evKey = resolveTitleEventKey(lt);
    if (evKey) {
      const existing = existingEventToTitleMap.get(evKey);
      if (existing) {
        // Título já existe para este agendamento! Atualiza dados sem duplicar o título
        if ((Number(lt.paid_amount) || 0) > (Number(existing.paid_amount) || 0)) {
          existing.paid_amount = lt.paid_amount;
        }
        if ((Number(lt.amount) || 0) > (Number(existing.amount) || 0)) {
          existing.amount = lt.amount;
        }
        if (existing.paid_amount >= existing.amount && existing.amount > 0) {
          existing.status = "pago";
        }
        existingTitleIds.add(lt.id);
        return;
      }
      existingEventToTitleMap.set(evKey, lt);
    }
    mergedTitles.push(lt);
    existingTitleIds.add(lt.id);
  });

  // Mapa rápido de títulos por ID
  const titlesById = new Map<string, FinancialTitle>();
  mergedTitles.forEach((t) => titlesById.set(t.id, t));

  function getPaymentEventKey(p: FinancialPayment): string | null {
    const fromP = extractEventId(p.id) || extractEventId(p.transaction_id);
    if (fromP) return fromP;
    const t = titlesById.get(p.transaction_id);
    if (t) return resolveTitleEventKey(t);

    const normPayer = (p.payer_name || "").trim().toLowerCase();
    const pAmt = Number(p.amount) || 0;
    if (normPayer && normPayer !== "paciente" && normPayer !== "cliente") {
      for (const ev of allEventsMap.values()) {
        const evPatient = (ev.patient_name || (ev.title && ev.title.includes("-") ? ev.title.split("-")[0]?.trim() : "")).toLowerCase();
        if (evPatient && (evPatient === normPayer || normPayer.includes(evPatient) || evPatient.includes(normPayer))) {
          const fMeta = parseEventFinancialMeta(ev.description);
          if (fMeta && Math.abs((fMeta.downPayment || fMeta.procedurePrice) - pAmt) < 0.01) {
            return ev.id;
          }
        }
      }
    }
    return null;
  }

  // 2. Merge pagamentos remotos e deduplica por agendamento
  const mergedPayments: FinancialPayment[] = [];
  const existingPaymentIds = new Set<string>();
  const existingTxPaymentIds = new Set<string>();
  const handledEventDownPayments = new Set<string>();

  rawPayments.forEach((p) => {
    if (existingPaymentIds.has(p.id)) return;
    const evKey = getPaymentEventKey(p);
    if (evKey && !p.reversed_at) {
      if (handledEventDownPayments.has(evKey)) return;
      handledEventDownPayments.add(evKey);
    }
    mergedPayments.push(p);
    existingPaymentIds.add(p.id);
    existingTxPaymentIds.add(p.transaction_id);
  });

  BASELINE_PAYMENTS.forEach((bp) => {
    if (
      !existingPaymentIds.has(bp.id) &&
      !deletedTitleIds.has(bp.id) &&
      !deletedTitleIds.has(bp.transaction_id) &&
      !isRecordWiped(bp)
    ) {
      mergedPayments.push(bp);
      existingPaymentIds.add(bp.id);
      existingTxPaymentIds.add(bp.transaction_id);
    }
  });

  // 3. Integração de agendamentos com valores financeiros (Local Events + Remote Events)

  Array.from(allEventsMap.values()).forEach((event) => {
    if (isRecordWiped(event)) return;
    const fMeta = parseEventFinancialMeta(event.description);
    if (!fMeta) return;

    const total = fMeta.procedurePrice > 0 ? fMeta.procedurePrice : fMeta.downPayment;
    const down = fMeta.downPayment > 0 ? fMeta.downPayment : 0;
    const eventStartsAt = event.starts_at || new Date().toISOString();
    const eventDateStr = eventStartsAt.slice(0, 10);
    const eventCompStr = eventStartsAt.slice(0, 7) + "-01";

    const bookingDateStr = event.created_at
      ? event.created_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const signalPaidDate = eventDateStr <= bookingDateStr ? eventDateStr : bookingDateStr;

    if (
      isRecordWiped({
        id: `evt-${event.id}`,
        created_at: event.created_at,
        date: signalPaidDate,
        starts_at: event.starts_at,
      })
    ) {
      return;
    }

    const patientName =
      fMeta.patientName ||
      event.patient_name ||
      (event.title && event.title.includes("-") ? event.title.split("-")[0]?.trim() : "") ||
      (event.title && !["agendamento", "atendimento", "consulta"].includes(event.title.trim().toLowerCase()) ? event.title.trim() : "") ||
      "Paciente";

    const titleDescription = event.title
      ? (event.title.includes(" - ") ? event.title : `${event.title} - ${patientName}`)
      : `Atendimento - ${patientName}`;

    let existingTitle =
      existingEventToTitleMap.get(event.id) ||
      mergedTitles.find((t) => getTitleEventKey(t) === event.id || t.id === `evt-${event.id}`);

    if (existingTitle) {
      if (patientName && (!existingTitle.patient_name || existingTitle.patient_name === "Paciente" || existingTitle.patient_name === "Cliente")) {
        existingTitle.patient_name = patientName;
      }
      if (patientName && (!existingTitle.payer_name || existingTitle.payer_name === "Paciente" || existingTitle.payer_name === "Cliente")) {
        existingTitle.payer_name = patientName;
      }
      if (down > 0 && (Number(existingTitle.paid_amount) || 0) < down) {
        existingTitle.paid_amount = down;
        if (existingTitle.paid_amount >= existingTitle.amount && existingTitle.amount > 0) {
          existingTitle.status = "pago";
        }
      }
      if (down > 0 && !handledEventDownPayments.has(event.id) && !existingTxPaymentIds.has(existingTitle.id)) {
        const payId = `pay-evt-${event.id}`;
        if (!existingPaymentIds.has(payId) && !deletedTitleIds.has(payId) && !isRecordWiped({ id: payId, created_at: event.created_at, paid_on: signalPaidDate })) {
          const evtPayment: FinancialPayment = {
            id: payId,
            transaction_id: existingTitle.id,
            amount: down,
            paid_on: signalPaidDate,
            payment_method: (fMeta.downPaymentMethod || "PIX").toUpperCase(),
            account_id: raw.accounts[0]?.id || "00000000-0000-0000-0000-000000000001",
            payer_name: existingTitle.patient_name || patientName,
            created_by: null,
            created_at: event.created_at || new Date().toISOString(),
            legacy: false,
            reversed_at: null,
            reversed_by: null,
            reversal_reason: null,
          };
          mergedPayments.push(evtPayment);
          existingPaymentIds.add(payId);
          existingTxPaymentIds.add(existingTitle.id);
          handledEventDownPayments.add(event.id);
        }
      }
    } else {
      const evtTitleId = `evt-${event.id}`;
      if (!deletedTitleIds.has(evtTitleId) && !deletedTitleIds.has(event.id) && !isRecordWiped({ id: evtTitleId, created_at: event.created_at, date: signalPaidDate })) {
        const newTitle: FinancialTitle = {
          id: evtTitleId,
          type: "receita",
          amount: total,
          paid_amount: down,
          due_date: eventDateStr,
          date: signalPaidDate,
          competence_date: eventCompStr,
          status: down >= total && total > 0 ? "pago" : "pendente",
          description: titleDescription,
          category: "Atendimentos",
          patient_id: event.patient_id || fMeta.clientId || null,
          patient_name: patientName,
          payer_name: patientName,
          company_id: event.company_id || null,
          treatment_id: null,
          installment_id: null,
          origin_key: `event:${event.id}`,
          can_settle: true,
          can_reverse: true,
          can_cancel: true,
        };
        mergedTitles.push(newTitle);
        existingTitleIds.add(newTitle.id);
        existingEventToTitleMap.set(event.id, newTitle);
        titlesById.set(newTitle.id, newTitle);

        if (down > 0 && !handledEventDownPayments.has(event.id)) {
          const payId = `pay-evt-${event.id}`;
          if (!existingPaymentIds.has(payId) && !deletedTitleIds.has(payId) && !isRecordWiped({ id: payId, created_at: event.created_at, paid_on: signalPaidDate })) {
            const evtPayment: FinancialPayment = {
              id: payId,
              transaction_id: evtTitleId,
              amount: down,
              paid_on: signalPaidDate,
              payment_method: (fMeta.downPaymentMethod || "PIX").toUpperCase(),
              account_id: raw.accounts[0]?.id || "00000000-0000-0000-0000-000000000001",
              payer_name: patientName,
              created_by: null,
              created_at: event.created_at || new Date().toISOString(),
              legacy: false,
              reversed_at: null,
              reversed_by: null,
              reversal_reason: null,
            };
            mergedPayments.push(evtPayment);
            existingPaymentIds.add(payId);
            existingTxPaymentIds.add(evtTitleId);
            handledEventDownPayments.add(event.id);
          }
        }
      }
    }
  });

  // 4. Merge pagamentos locais persistidos no localStorage (ex: baixa de valores restantes)
  const localPayments = getLocalPayments();
  localPayments.forEach((lp) => {
    if (deletedTitleIds.has(lp.id) || deletedTitleIds.has(lp.transaction_id) || isRecordWiped(lp)) return;
    if (existingPaymentIds.has(lp.id)) return;

    const evKey = getPaymentEventKey(lp);
    if (evKey && !lp.reversed_at) {
      if (handledEventDownPayments.has(evKey)) {
        return; // Sinal já registrado em mergedPayments, não duplica
      }
      handledEventDownPayments.add(evKey);
    }

    // Deduplicação estrita: se já existe um pagamento equivalente em mergedPayments (mesmo valor, pagador e data)
    const isDup = mergedPayments.some((mp) => {
      if (mp.reversed_at) return false;
      const sameAmt = Math.abs(Number(mp.amount) - Number(lp.amount)) < 0.01;
      const sameDt = (mp.paid_on || "").slice(0, 10) === (lp.paid_on || "").slice(0, 10);
      const normMp = (mp.payer_name || "").trim().toLowerCase();
      const normLp = (lp.payer_name || "").trim().toLowerCase();
      const sameP = normMp && normLp && (normMp === normLp || normMp.includes(normLp) || normLp.includes(normMp));
      return sameAmt && (sameDt || mp.transaction_id === lp.transaction_id) && (sameP || mp.transaction_id === lp.transaction_id);
    });
    if (isDup) return;

    mergedPayments.push(lp);
    existingPaymentIds.add(lp.id);
    existingTxPaymentIds.add(lp.transaction_id);

    const targetTitle =
      titlesById.get(lp.transaction_id) || (evKey ? existingEventToTitleMap.get(evKey) : undefined);
    if (targetTitle && !lp.reversed_at && !lp.id.startsWith("pay-evt-")) {
      targetTitle.paid_amount = (Number(targetTitle.paid_amount) || 0) + Number(lp.amount);
      if (targetTitle.paid_amount >= targetTitle.amount && targetTitle.amount > 0) {
        targetTitle.status = "pago";
      }
    }
  });

  // 5. Gera pagamento sintético apenas para títulos manuais marcados como 'pago' que não possuam nenhum pagamento
  mergedTitles.forEach((t) => {
    if (isRecordWiped(t)) return;
    const evKey = resolveTitleEventKey(t);
    if (evKey && handledEventDownPayments.has(evKey)) return;
    if (existingTxPaymentIds.has(t.id)) return;

    // IMPORTANTE: Títulos de agendamento NUNCA geram pagamentos sintéticos aqui.
    // Pagamentos de agendamento são reais (sinal em payments) ou saldo restante pendente.
    const isAgendamento =
      Boolean(t.origin_key && t.origin_key.startsWith("event:")) ||
      Boolean(t.id && t.id.startsWith("evt-")) ||
      (t.category || "").toLowerCase().includes("atendimento") ||
      (t.description || "").toLowerCase().includes("agendamento");
    if (isAgendamento) return;

    // Só gera pagamento sintético se o título foi marcado explicitamente como 'pago' (100% quitado)
    // Títulos parciais / pendentes pertencem a Contas a Receber, NÃO ao Fluxo de Caixa.
    if (t.status === "pago") {
      const synPayId = `syn-pay-${t.id}`;
      if (isRecordWiped({ id: synPayId, date: t.date, paid_on: t.date, created_at: (t as any).created_at })) return;
      const synPay: FinancialPayment = {
        id: synPayId,
        transaction_id: t.id,
        amount: Number(t.paid_amount) > 0 ? Number(t.paid_amount) : Number(t.amount),
        paid_on: t.date || (t as any).created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        payment_method: "PIX",
        account_id: raw.accounts[0]?.id || "00000000-0000-0000-0000-000000000001",
        payer_name: t.patient_name || t.payer_name || "Cliente",
        created_by: null,
        created_at: (t as any).created_at || new Date().toISOString(),
        legacy: false,
        reversed_at: null,
        reversed_by: null,
        reversal_reason: null,
      };
      mergedPayments.push(synPay);
      existingPaymentIds.add(synPay.id);
      existingTxPaymentIds.add(t.id);
      if (evKey) handledEventDownPayments.add(evKey);
    }
  });

  // 5. Ensure accounts exist
  const existingAccountNames = new Set(rawAccounts.map((a) => (a.name ? a.name.toLowerCase() : "")));
  const mergedAccounts = [...rawAccounts];
  DEFAULT_ACCOUNTS.forEach((da) => {
    if (!existingAccountNames.has(da.name.toLowerCase())) {
      mergedAccounts.push(da);
      existingAccountNames.add(da.name.toLowerCase());
    }
  });

  // 6. Ensure scopes have full permissions
  const mergedScopes =
    rawScopes.length > 0
      ? rawScopes.map((s) => ({
          ...s,
          can_create: true,
          can_pay: true,
          can_accounts: true,
        }))
      : [
          {
            id: null,
            name: "Clínica Principal",
            can_create: true,
            can_pay: true,
            can_accounts: true,
          },
        ];

  // Sanitização rigorosa de títulos para prevenir quebras em runtime
  const sanitizedTitles: FinancialTitle[] = mergedTitles
    .filter((t): t is FinancialTitle => Boolean(t && t.id && !isRecordWiped(t)))
    .map((t) => {
      const amountNum = Number(t.amount);
      const paidNum = Number(t.paid_amount);
      const safeAmount = Number.isFinite(amountNum) ? amountNum : 0;
      const safePaid = Number.isFinite(paidNum) ? paidNum : 0;
      const dateStr = t.date ? String(t.date).slice(0, 10) : "";
      const dueStr = t.due_date ? String(t.due_date).slice(0, 10) : dateStr || new Date().toISOString().slice(0, 10);

      return {
        ...t,
        id: String(t.id),
        type: (t.type === "despesa" ? "despesa" : "receita") as "receita" | "despesa",
        amount: safeAmount,
        paid_amount: safePaid,
        due_date: dueStr,
        date: dateStr || dueStr,
        status: String(t.status || (safePaid >= safeAmount && safeAmount > 0 ? "pago" : "pendente")),
        description: t.description ? String(t.description) : null,
        category: t.category ? String(t.category) : "Geral",
        patient_id: t.patient_id ? String(t.patient_id) : null,
        patient_name: t.patient_name ? String(t.patient_name) : null,
        payer_name: t.payer_name ? String(t.payer_name) : null,
        company_id: t.company_id ? String(t.company_id) : null,
        treatment_id: t.treatment_id ? String(t.treatment_id) : null,
        installment_id: t.installment_id ? String(t.installment_id) : null,
        competence_date: t.competence_date ? String(t.competence_date) : null,
        origin_key: t.origin_key ? String(t.origin_key) : null,
        can_settle: t.can_settle ?? true,
        can_reverse: t.can_reverse ?? true,
        can_cancel: t.can_cancel ?? true,
      };
    });

  const sanitizedPayments: FinancialPayment[] = mergedPayments
    .filter((p): p is FinancialPayment => Boolean(p && p.id && !isRecordWiped(p)))
    .map((p) => {
      const amountNum = Number(p.amount);
      const safeAmount = Number.isFinite(amountNum) ? amountNum : 0;
      const paidOnStr = p.paid_on ? String(p.paid_on).slice(0, 10) : new Date().toISOString().slice(0, 10);

      return {
        ...p,
        id: String(p.id),
        transaction_id: String(p.transaction_id || ""),
        amount: safeAmount,
        paid_on: paidOnStr,
        payment_method: p.payment_method ? String(p.payment_method) : "PIX",
        account_id: p.account_id ? String(p.account_id) : null,
        payer_name: p.payer_name ? String(p.payer_name) : null,
        created_by: p.created_by ? String(p.created_by) : null,
        created_at: p.created_at ? String(p.created_at) : new Date().toISOString(),
        legacy: Boolean(p.legacy),
        reversed_at: p.reversed_at ? String(p.reversed_at) : null,
        reversed_by: p.reversed_by ? String(p.reversed_by) : null,
        reversal_reason: p.reversal_reason ? String(p.reversal_reason) : null,
      };
    });

  return {
    ...raw,
    titles: sanitizedTitles,
    payments: sanitizedPayments,
    accounts: mergedAccounts,
    scopes: mergedScopes,
  };
}

export async function getFinancialSnapshot(): Promise<FinanceSnapshot> {
  try {
    const { data, error } = await supabase.rpc("get_financial_snapshot");
    if (error) {
      console.warn("Aviso ao carregar financial snapshot via RPC, utilizando fallback seguro:", error);
    }

    let remoteEvents: any[] = [];
    try {
      const { data: evts } = await supabase
        .from("events")
        .select("id, title, starts_at, description, patient_id, company_id, created_at")
        .order("starts_at", { ascending: false })
        .limit(100);
      if (evts && Array.isArray(evts)) {
        remoteEvents = evts;
      }
    } catch {}

    const raw: FinanceSnapshot = {
      titles: Array.isArray(data?.titles) ? data.titles : [],
      payments: Array.isArray(data?.payments) ? data.payments : [],
      accounts: Array.isArray(data?.accounts) ? data.accounts : [],
      scopes: Array.isArray(data?.scopes) ? data.scopes : [],
      patients: Array.isArray(data?.patients) ? data.patients : [],
    };

    // Enriquece origin_key caso a RPC do banco não tenha retornado a coluna
    if (raw.titles.length > 0) {
      const missingOriginIds = raw.titles
        .filter((t) => !t.origin_key && t.id && !t.id.startsWith("evt-"))
        .map((t) => t.id);
      if (missingOriginIds.length > 0) {
        try {
          const { data: txOrigins } = await (supabase as any)
            .from("transactions")
            .select("id, origin_key")
            .in("id", missingOriginIds);
          if (txOrigins && Array.isArray(txOrigins)) {
            const map = new Map(txOrigins.map((o: any) => [o.id, o.origin_key]));
            raw.titles.forEach((t) => {
              if (!t.origin_key && map.has(t.id)) {
                t.origin_key = map.get(t.id);
              }
            });
          }
        } catch {}
      }
    }

    // Se o snapshot remoto estiver vazio (ex: RPC indisponível ou RLS restrito), busca diretamente em public.transactions
    if (!raw.titles.length) {
      try {
        const { data: txList } = await (supabase as any)
          .from("transactions")
          .select("id, type, amount, paid_amount, due_date, date, status, description, category, patient_id, payer_name, company_id, treatment_id, installment_id, competence_date, origin_key, created_at")
          .is("deleted_at", null)
          .order("date", { ascending: false })
          .limit(100);
        if (txList && Array.isArray(txList)) {
          raw.titles = txList.map((t: any) => ({
            ...t,
            can_settle: true,
            can_reverse: true,
            can_cancel: true,
          }));
        }
      } catch {}
    }

    if (!raw.payments.length) {
      try {
        const { data: payList } = await (supabase as any)
          .from("transaction_payments")
          .select("id, transaction_id, amount, paid_on, payment_method, account_id, payer_name, created_by, created_at, legacy, reversed_at, reversed_by, reversal_reason")
          .is("reversed_at", null)
          .order("paid_on", { ascending: false })
          .limit(100);
        if (payList && Array.isArray(payList)) {
          raw.payments = payList;
        }
      } catch {}
    }

    return normalizeFinancialSnapshot(raw, remoteEvents);
  } catch (criticalErr) {
    console.warn("Erro ao processar snapshot financeiro, fornecendo estado seguro:", criticalErr);
    return normalizeFinancialSnapshot({
      titles: [],
      payments: [],
      accounts: [],
      scopes: [],
      patients: [],
    });
  }
}

export async function getFinancialReportingRows() {
  const data = await getFinancialSnapshot();
  if (!data.scopes.length) throw new Error("Sem permissão para consultar indicadores financeiros.");
  return reportingRows(data);
}

export async function refreshFinance(qc: QueryClient) {
  try {
    qc.removeQueries({ queryKey: ["financial-snapshot"] });
    qc.removeQueries({ queryKey: ["cash-flow-snapshot"] });
  } catch {}
  await Promise.all(
    [
      "financial-snapshot",
      "cash-flow-snapshot",
      "financial-operations",
      "transactions",
      "treatment-installments",
      "treatment-finance-plans",
      "treatment-ledger",
      "treatment-alerts",
      "treatments-list",
      "dashboard",
      "reports-data",
    ].map((key) => qc.invalidateQueries({ queryKey: [key], refetchType: "all" })),
  );
}

import type { FinanceSnapshot, FinancialTitle, FinancialPayment } from "./finance-schema";
import { isRecordWiped } from "@/lib/wipe-system";

export const cents = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, "")) || 0;
  if (!Number.isFinite(num)) return 0;
  const result = Math.round(num * 100);
  if (!Number.isSafeInteger(result)) return 0;
  return result;
};

export const remaining = (title: FinancialTitle): number => {
  if (!title || title.status === "cancelado") return 0;
  const total = cents(title.amount);
  const paid = cents(title.paid_amount);
  return Math.max(0, (total - paid) / 100);
};

export function isFreeBalance(title: FinancialTitle): boolean {
  if (!title) return false;
  const desc = (title.description || "").toLowerCase();
  const cat = (title.category || "").toLowerCase();
  return (
    desc.includes("saldo livre") ||
    desc.includes("sem vencimento") ||
    desc.includes("[saldo_livre]") ||
    cat.includes("saldo livre")
  );
}

export function titleStatus(title: FinancialTitle, today: string) {
  if (!title || title.status === "cancelado") return "Cancelado";
  if (remaining(title) === 0) return "Quitado";
  if (isFreeBalance(title)) {
    return (Number(title.paid_amount) || 0) > 0 ? "Parcial (sem vencimento)" : "Em aberto sem vencimento";
  }
  const dueDate = title.due_date || "";
  if (dueDate && dueDate < today) return (Number(title.paid_amount) || 0) > 0 ? "Parcial / vencido" : "Vencido";
  return (Number(title.paid_amount) || 0) > 0 ? "Parcial" : "A vencer";
}

export function extractEventId(str: string | null | undefined): string | null {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  if (s.startsWith("event:")) return s.slice(6).replace(/-downpayment$|-remaining$/, "").trim();
  if (s.startsWith("pay-evt-")) return s.slice(8).replace(/-downpayment$|-remaining$/, "").trim();
  if (s.startsWith("evt-")) return s.slice(4).replace(/-downpayment$|-remaining$/, "").trim();
  if (s.startsWith("title-pay-evt-")) return s.slice(14).replace(/-downpayment$|-remaining$/, "").trim();
  if (s.startsWith("title-pay-")) {
    const rest = s.slice(10).trim();
    if (rest.startsWith("evt-")) return rest.slice(4).replace(/-downpayment$|-remaining$/, "").trim();
    return null;
  }
  if (s.startsWith("syn-pay-evt-")) return s.slice(12).replace(/-downpayment$|-remaining$/, "").trim();
  if (s.startsWith("syn-pay-")) {
    const rest = s.slice(8).trim();
    if (rest.startsWith("evt-")) return rest.slice(4).replace(/-downpayment$|-remaining$/, "").trim();
    return null;
  }
  return null;
}

export function getDeletedFinanceIds(): Set<string> {
  const deleted = new Set<string>();
  if (typeof window === "undefined" || !window.localStorage) return deleted;
  try {
    const rawCash = localStorage.getItem("medcore_deleted_cash_entries");
    if (rawCash) {
      const parsed = JSON.parse(rawCash);
      if (Array.isArray(parsed)) parsed.forEach((id) => id && deleted.add(String(id)));
    }
    const rawTitles = localStorage.getItem("medcore_deleted_titles");
    if (rawTitles) {
      const parsed = JSON.parse(rawTitles);
      if (Array.isArray(parsed)) parsed.forEach((id) => id && deleted.add(String(id)));
    }
  } catch {}

  const expanded = new Set<string>(deleted);
  deleted.forEach((id) => {
    if (!id || typeof id !== "string") return;
    const evId = extractEventId(id);
    if (evId) {
      expanded.add(evId);
      expanded.add(`event:${evId}`);
      expanded.add(`evt-${evId}`);
      expanded.add(`evt-${evId}-downpayment`);
      expanded.add(`evt-${evId}-remaining`);
      expanded.add(`pay-evt-${evId}`);
      expanded.add(`title-pay-evt-${evId}`);
      expanded.add(`syn-pay-evt-${evId}`);
    }
    if (id.startsWith("title-pay-")) {
      expanded.add(id.slice(10));
    } else {
      expanded.add(`title-pay-${id}`);
    }
    if (id.startsWith("pay-evt-")) {
      expanded.add(id.slice(8));
    }
  });

  return expanded;
}

export function isTitleDeleted(
  title: FinancialTitle | undefined | null,
  deletedIds?: Set<string>,
): boolean {
  if (!title) return true;
  if (isRecordWiped(title)) return true;
  const set = deletedIds || getDeletedFinanceIds();
  if (set.has(title.id)) return true;
  if (title.origin_key && set.has(title.origin_key)) return true;
  if (set.has(`title-pay-${title.id}`)) return true;

  const evId = extractEventId(title.origin_key) || extractEventId(title.id);
  if (evId) {
    if (
      set.has(evId) ||
      set.has(`event:${evId}`) ||
      set.has(`evt-${evId}`) ||
      set.has(`pay-evt-${evId}`) ||
      set.has(`evt-${evId}-downpayment`) ||
      set.has(`evt-${evId}-remaining`)
    ) {
      return true;
    }
  }
  return false;
}

export function isPaymentDeleted(
  payment: FinancialPayment | undefined | null,
  deletedIds?: Set<string>,
): boolean {
  if (!payment) return true;
  if (isRecordWiped(payment)) return true;
  const set = deletedIds || getDeletedFinanceIds();
  if (set.has(payment.id)) return true;
  if (payment.transaction_id) {
    if (set.has(payment.transaction_id)) return true;
    if (set.has(`title-pay-${payment.transaction_id}`)) return true;
  }

  const evId = extractEventId(payment.id) || extractEventId(payment.transaction_id);
  if (evId) {
    if (
      set.has(evId) ||
      set.has(`event:${evId}`) ||
      set.has(`evt-${evId}`) ||
      set.has(`pay-evt-${evId}`) ||
      set.has(`evt-${evId}-downpayment`) ||
      set.has(`evt-${evId}-remaining`)
    ) {
      return true;
    }
  }
  return false;
}

export function financialSummary(
  data: FinanceSnapshot,
  titles: FinancialTitle[],
  start: string,
  end: string,
  accountId = "",
) {
  const deletedIds = getDeletedFinanceIds();
  const within = (date?: string | null) => (!date ? false : (!start || date >= start) && (!end || date <= end));
  const safeTitles = (Array.isArray(titles) ? titles : []).filter((t) => !isTitleDeleted(t, deletedIds));
  const safePayments = (Array.isArray(data?.payments) ? data.payments : []).filter((p) => !isPaymentDeleted(p, deletedIds));
  const byId = new Map(safeTitles.map((t) => [t.id, t]));
  let income = 0,
    expense = 0,
    receivable = 0,
    payable = 0;
  for (const p of safePayments) {
    if (!p || isPaymentDeleted(p, deletedIds)) continue;
    const title = byId.get(p.transaction_id);
    if (!title || title.status === "cancelado" || isTitleDeleted(title, deletedIds) || p.reversed_at || !within(p.paid_on) || (accountId && p.account_id !== accountId))
      continue;
    if (title.type === "receita") income += cents(p.amount);
    else expense += cents(p.amount);
  }
  for (const t of safeTitles) {
    if (!t || t.status === "cancelado" || isTitleDeleted(t, deletedIds)) continue;
    if (isFreeBalance(t)) {
      // Saldo livre compõe o total a receber da clínica, mas não é projetado em um mês específico quando há filtro de período (start/end)
      if (start || end) continue;
      if (t.type === "receita") receivable += cents(remaining(t));
      else payable += cents(remaining(t));
      continue;
    }
    if (!within(t.due_date)) continue;
    if (t.type === "receita") receivable += cents(remaining(t));
    else payable += cents(remaining(t));
  }
  return {
    income: income / 100,
    expense: expense / 100,
    result: (income - expense) / 100,
    receivable: receivable / 100,
    payable: payable / 100,
  };
}

// Reporting rows represent either an actual payment or the unpaid balance, never the full title twice.
export function reportingRows(data: FinanceSnapshot) {
  const deletedIds = getDeletedFinanceIds();

  const safeTitles = (Array.isArray(data?.titles) ? data.titles : []).filter(
    (t) => !isTitleDeleted(t, deletedIds),
  );
  const safePayments = (Array.isArray(data?.payments) ? data.payments : []).filter(
    (p) => !isPaymentDeleted(p, deletedIds),
  );

  const byId = new Map(safeTitles.map((t) => [t.id, t]));
  const handledTitleIds = new Set<string>();

  const paid = safePayments
    .filter((p) => {
      if (!p || p.reversed_at || isPaymentDeleted(p, deletedIds)) return false;
      const t = byId.get(p.transaction_id);
      if (t && isTitleDeleted(t, deletedIds)) return false;
      return true;
    })
    .map((p) => {
      const t = byId.get(p.transaction_id);
      if (t) handledTitleIds.add(t.id);
      return {
        id: p.id,
        title_id: t?.id || p.transaction_id,
        type: t?.type || "receita",
        amount: Number(p.amount || 0),
        date: p.paid_on || t?.due_date || t?.date || new Date().toISOString().slice(0, 10),
        due_date: t?.due_date || p.paid_on,
        status: "pago",
        category: t?.category || "Geral",
      };
    });

  const syntheticPaid: any[] = [];
  safeTitles.forEach((t) => {
    if (!t || isTitleDeleted(t, deletedIds)) return;
    if (t.status === "cancelado") return;
    const isAgendamento =
      Boolean(t.origin_key && t.origin_key.startsWith("event:")) ||
      Boolean(t.id && t.id.startsWith("evt-")) ||
      (t.category || "").toLowerCase().includes("atendimento") ||
      (t.description || "").toLowerCase().includes("agendamento");
    if (isAgendamento) return;

    if (t.status === "pago" && !handledTitleIds.has(t.id)) {
      handledTitleIds.add(t.id);
      syntheticPaid.push({
        id: `title-pay-${t.id}`,
        title_id: t.id,
        type: t.type,
        amount: Number(t.paid_amount > 0 ? t.paid_amount : t.amount),
        date: t.date || t.due_date || new Date().toISOString().slice(0, 10),
        due_date: t.due_date,
        status: "pago",
        category: t.category || "Geral",
      });
    }
  });

  const pending = safeTitles
    .filter((t) => {
      if (isTitleDeleted(t, deletedIds)) return false;
      if (t.status === "cancelado") return false;
      return remaining(t) > 0;
    })
    .map((t) => ({
      id: t.id,
      title_id: t.id,
      type: t.type,
      amount: remaining(t),
      date: t.due_date,
      due_date: t.due_date,
      status: "pendente",
      category: t.category,
    }));

  return [...paid, ...syntheticPaid, ...pending];
}

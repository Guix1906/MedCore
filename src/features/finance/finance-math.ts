import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";

export const cents = (value: number) => {
  const result = Math.round(value * 100);
  if (!Number.isFinite(value) || !Number.isSafeInteger(result))
    throw new Error("Valor financeiro inválido.");
  return result;
};
export const remaining = (title: FinancialTitle) =>
  title.status === "cancelado" ? 0 : (cents(title.amount) - cents(title.paid_amount)) / 100;

export function isFreeBalance(title: FinancialTitle): boolean {
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
  if (title.status === "cancelado") return "Cancelado";
  if (remaining(title) === 0) return "Quitado";
  if (isFreeBalance(title)) {
    return title.paid_amount > 0 ? "Parcial (sem vencimento)" : "Em aberto sem vencimento";
  }
  if (title.due_date < today) return title.paid_amount > 0 ? "Parcial / vencido" : "Vencido";
  return title.paid_amount > 0 ? "Parcial" : "A vencer";
}

export function financialSummary(
  data: FinanceSnapshot,
  titles: FinancialTitle[],
  start: string,
  end: string,
  accountId = "",
) {
  const within = (date: string) => (!start || date >= start) && (!end || date <= end);
  const byId = new Map(titles.map((t) => [t.id, t]));
  let income = 0,
    expense = 0,
    receivable = 0,
    payable = 0;
  for (const p of data.payments) {
    const title = byId.get(p.transaction_id);
    if (!title || p.reversed_at || !within(p.paid_on) || (accountId && p.account_id !== accountId))
      continue;
    if (title.type === "receita") income += cents(p.amount);
    else expense += cents(p.amount);
  }
  for (const t of titles) {
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
  let deletedIds = new Set<string>();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const rawCash = localStorage.getItem("medcore_deleted_cash_entries");
      if (rawCash) {
        const parsed = JSON.parse(rawCash);
        if (Array.isArray(parsed)) {
          parsed.forEach((id) => deletedIds.add(id));
        }
      }
      const rawTitles = localStorage.getItem("medcore_deleted_titles");
      if (rawTitles) {
        const parsed = JSON.parse(rawTitles);
        if (Array.isArray(parsed)) {
          parsed.forEach((id) => deletedIds.add(id));
        }
      }
    } catch {}
  }

  const byId = new Map(data.titles.map((t) => [t.id, t]));
  const handledTitleIds = new Set<string>();

  const paid = data.payments
    .filter((p) => {
      if (p.reversed_at) return false;
      if (deletedIds.has(p.id) || deletedIds.has(p.transaction_id)) return false;
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
        date: p.paid_on || t?.due_date || t?.date || "2026-09-15",
        due_date: t?.due_date || p.paid_on,
        status: "pago",
        category: t?.category || "Geral",
      };
    });

  const syntheticPaid: any[] = [];
  data.titles.forEach((t) => {
    if (deletedIds.has(t.id) || deletedIds.has(`title-pay-${t.id}`)) return;
    if (t.status === "cancelado") return;
    if ((t.status === "pago" || Number(t.paid_amount || 0) > 0) && !handledTitleIds.has(t.id)) {
      handledTitleIds.add(t.id);
      syntheticPaid.push({
        id: `title-pay-${t.id}`,
        title_id: t.id,
        type: t.type,
        amount: Number(t.paid_amount > 0 ? t.paid_amount : t.amount),
        date: t.date || t.due_date || "2026-09-15",
        due_date: t.due_date,
        status: "pago",
        category: t.category || "Geral",
      });
    }
  });

  const pending = data.titles
    .filter((t) => {
      if (deletedIds.has(t.id) || deletedIds.has(`title-pay-${t.id}`)) return false;
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

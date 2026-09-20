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
  const byId = new Map(data.titles.map((t) => [t.id, t]));
  const paid = data.payments
    .filter((p) => !p.reversed_at)
    .map((p) => {
      const t = byId.get(p.transaction_id);
      if (!t) throw new Error("Pagamento sem título financeiro acessível.");
      return {
        id: p.id,
        title_id: t.id,
        type: t.type,
        amount: p.amount,
        date: p.paid_on,
        due_date: t.due_date,
        status: "pago",
        category: t.category,
      };
    });
  const pending = data.titles
    .filter((t) => remaining(t) > 0)
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
  return [...paid, ...pending];
}

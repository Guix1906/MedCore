import { cents } from "./finance-math";
import type { CashFlowSnapshot } from "./cash-flow-schema";

export type CashEntry = {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  kind: "receita" | "despesa" | "transferencia";
  reversed: boolean;
  transferId: string | null;
};

export function cashFlow(data: CashFlowSnapshot, start: string, end: string, accountId = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
    throw new Error("Informe um período válido para o fluxo de caixa.");
  const accountIds = new Set(data.accounts.map((a) => a.id));
  if (accountId && !accountIds.has(accountId)) throw new Error("Conta fora do escopo selecionado.");
  const within = (date: string) => date >= start && date <= end;
  const entries: CashEntry[] = [];
  let unassigned = 0;
  let legacy = 0;
  for (const p of data.payments) {
    if (!p.reversed_at && within(p.date)) {
      if (p.legacy) legacy++;
      if (!p.account_id) unassigned++;
    }
    if (!p.account_id) continue;
    if (!accountIds.has(p.account_id))
      throw new Error("Baixa vinculada a conta de outra clínica ou indisponível.");
    const amount = cents(p.amount) / 100;
    if (amount <= 0) throw new Error("Baixa com valor inválido.");
    entries.push({
      id: p.id,
      accountId: p.account_id,
      date: p.date,
      amount: p.type === "receita" ? amount : -amount,
      kind: p.type,
      reversed: !!p.reversed_at,
      transferId: null,
    });
  }
  for (const t of data.transfers) {
    if (
      !accountIds.has(t.from_account_id) ||
      !accountIds.has(t.to_account_id) ||
      t.from_account_id === t.to_account_id
    )
      throw new Error("Transferência com contas inválidas.");
    const amount = cents(t.amount) / 100;
    if (amount <= 0) throw new Error("Transferência com valor inválido.");
    for (const [id, sign] of [
      [t.from_account_id, -1],
      [t.to_account_id, 1],
    ] as const) {
      entries.push({
        id: `${t.id}:${id}`,
        accountId: id,
        date: t.date,
        amount: sign * amount,
        kind: "transferencia",
        reversed: !!t.reversed_at,
        transferId: t.id,
      });
    }
  }
  const rows = data.accounts
    .filter((a) => !accountId || a.id === accountId)
    .map((a) => {
      const movements = entries.filter((e) => e.accountId === a.id && !e.reversed);
      const complete =
        a.opening_date !== null &&
        a.opening_date <= start &&
        a.opening_amount !== null &&
        a.kind !== null;
      let opening = complete ? cents(a.opening_amount!) : 0;
      let income = 0,
        expense = 0,
        transfers = 0;
      for (const e of movements) {
        if (complete && e.date >= a.opening_date! && e.date < start) opening += cents(e.amount);
        if (!within(e.date)) continue;
        if (e.kind === "receita") income += cents(e.amount);
        else if (e.kind === "despesa") expense -= cents(e.amount);
        else transfers += cents(e.amount);
      }
      return {
        account: a,
        opening: complete ? opening / 100 : null,
        income: income / 100,
        expense: expense / 100,
        transfers: transfers / 100,
        result: (income - expense) / 100,
        closing: complete ? (opening + income - expense + transfers) / 100 : null,
      };
    });
  const totals = (kind: "available" | "receivable") => {
    const selected = rows.filter((r) => r.account.kind === kind);
    // An unclassified account makes the consolidated balance incomplete, not zero.
    if (rows.some((r) => r.account.kind === null) || selected.some((r) => r.closing === null))
      return null;
    return selected.reduce((sum, r) => sum + cents(r.closing!), 0) / 100;
  };
  return {
    rows,
    entries: entries
      .filter((e) => within(e.date) && (!accountId || e.accountId === accountId))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    available: totals("available"),
    receivable: totals("receivable"),
    unassigned,
    legacy,
  };
}

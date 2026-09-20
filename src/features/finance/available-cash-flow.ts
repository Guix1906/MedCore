import { cashFlow } from "./cash-flow-math";
import { cents } from "./finance-math";
import { validDate } from "./operations-math";
import type { CashFlowSnapshot } from "./cash-flow-schema";
import type { OperationsSnapshot } from "./operations-schema";

export function availableCashFlow(
  cash: CashFlowSnapshot,
  ops: OperationsSnapshot,
  start: string,
  end: string,
  accountId = "",
) {
  if (!validDate(start) || !validDate(end) || start > end)
    throw new Error("Informe um período válido.");
  const balances = cashFlow(cash, start, end, accountId);
  if (accountId && !cash.accounts.some((a) => a.id === accountId && a.kind === "available"))
    throw new Error("Selecione uma conta de caixa ou banco.");
  const accounts = balances.rows.filter((r) => r.account.kind === "available");
  const complete =
    accounts.length > 0 &&
    accounts.every((r) => r.opening !== null) &&
    !cash.accounts.some((a) => a.kind === null) &&
    balances.unassigned === 0;
  const opening = complete ? accounts.reduce((total, r) => total + cents(r.opening!), 0) : null;
  const availableIds = new Set(
    cash.accounts.filter((a) => a.kind === "available").map((a) => a.id),
  );
  const entries = ops.entries
    .filter((e) => e.date >= start && e.date <= end && (!accountId || e.account_id === accountId))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.source_id.localeCompare(b.source_id) ||
        a.source_kind.localeCompare(b.source_kind),
    );
  let income = 0,
    expense = 0,
    running = opening;
  const rows = entries.map((entry) => {
    const value = cents(entry.amount);
    if (!availableIds.has(entry.account_id))
      throw new Error("Movimento de disponibilidade vinculado a conta incompatível.");
    const transfer = entry.source_kind.startsWith("transfer_")
      ? cash.transfers.find((t) => t.id === entry.source_id)
      : undefined;
    const internal =
      !!transfer &&
      availableIds.has(transfer.from_account_id) &&
      availableIds.has(transfer.to_account_id);
    if (accountId || !internal) {
      if (value > 0) income += value;
      else expense -= value;
    }
    if (running !== null) running += value;
    return { ...entry, balance: running, internal };
  });
  const closing = complete ? accounts.reduce((total, r) => total + cents(r.closing!), 0) : null;
  if (closing !== null && closing !== running)
    throw new Error(
      "Movimentos e saldos das contas divergentes. Atualize os dados e confira os registros antes de usar o relatório.",
    );
  return {
    rows,
    opening,
    income,
    expense,
    closing,
    complete,
    unassigned: balances.unassigned,
    legacy: balances.legacy,
  };
}

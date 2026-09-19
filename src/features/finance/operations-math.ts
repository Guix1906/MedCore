import { cents } from "./finance-math";
import type { FinanceSnapshot } from "./finance-schema";
import type { CashFlowSnapshot } from "./cash-flow-schema";
import type { DfcGroup, DreGroup, OperationsSnapshot, StatementLine } from "./operations-schema";

export const DRE_LABELS: Record<DreGroup, string> = {
  revenue: "Receita bruta",
  deductions: "Deducoes da receita",
  costs: "Custos dos servicos",
  operating: "Despesas operacionais",
  financial_income: "Receitas financeiras",
  financial_expense: "Despesas financeiras",
  taxes: "Tributos sobre o resultado",
  excluded: "Fora da DRE (patrimonial)",
};
export const DFC_LABELS: Record<DfcGroup, string> = {
  operating: "Operacional",
  investing: "Investimento",
  financing: "Financiamento",
};
export function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
export function managementReports(
  finance: FinanceSnapshot,
  ops: OperationsSnapshot,
  cash: CashFlowSnapshot,
  start: string,
  end: string,
) {
  if (!validDate(start) || !validDate(end) || start > end)
    throw new Error("Informe um periodo valido.");
  const within = (date: string) => date >= start && date <= end;
  const classes = new Map(ops.classifications.map((c) => [c.transaction_id, c]));
  const titles = new Map(finance.titles.map((t) => [t.id, t]));
  const payments = new Map(finance.payments.map((p) => [p.id, p]));
  const dre: Record<DreGroup, number> = {
    revenue: 0,
    deductions: 0,
    costs: 0,
    operating: 0,
    financial_income: 0,
    financial_expense: 0,
    taxes: 0,
    excluded: 0,
  };
  const missingCompetence: string[] = [],
    missingClassification: string[] = [];
  for (const t of finance.titles) {
    if (t.status === "cancelado") continue;
    if (!t.competence_date) {
      missingCompetence.push(t.id);
      continue;
    }
    if (!within(t.competence_date)) continue;
    const c = classes.get(t.id);
    if (!c) {
      missingClassification.push(t.id);
      continue;
    }
    dre[c.dre_group] += cents(t.amount) * (t.type === "receita" ? 1 : -1);
  }
  const dfc: Record<DfcGroup, number> = { operating: 0, investing: 0, financing: 0 };
  let unclassifiedCash = 0,
    internalTransfers = 0;
  const missingCash: string[] = [];
  const addCash = (titleId: string | null, amount: number, entryId: string) => {
    const classification = titleId && classes.get(titleId);
    if (classification && titles.has(titleId!)) dfc[classification.dfc_group] += amount;
    else {
      unclassifiedCash += amount;
      missingCash.push(entryId);
    }
  };
  for (const e of ops.entries) {
    if (!within(e.date)) continue;
    if (e.source_kind === "transfer_in" || e.source_kind === "transfer_out") {
      const transfer = cash.transfers.find((t) => t.id === e.source_id);
      const other = cash.accounts.find(
        (a) =>
          a.id ===
          (e.source_kind === "transfer_in" ? transfer?.from_account_id : transfer?.to_account_id),
      );
      if (other?.kind === "available") {
        internalTransfers += cents(e.amount);
        continue;
      }
      addCash(null, cents(e.amount), e.source_id);
      continue;
    }
    const card = e.source_kind === "card" ? ops.cards.find((c) => c.id === e.source_id) : null;
    const payment = payments.get(card?.payment_id ?? e.source_id);
    if (card && payment) {
      if (cents(payment.amount) - cents(card.fee) !== cents(e.amount))
        throw new Error("Liquidacao de cartao divergente do credito liquido.");
      // Split the net deposit into gross and fee, honoring both titles' classifications.
      addCash(payment.transaction_id, cents(payment.amount), e.source_id);
      if (card.fee > 0)
        addCash(card.fee_title_id, -cents(card.fee), card.fee_payment_id ?? e.source_id);
    } else addCash(payment?.transaction_id ?? null, cents(e.amount), e.source_id);
  }
  const unassigned = finance.payments.filter(
    (p) =>
      !p.reversed_at &&
      within(p.paid_on) &&
      (!p.account_id || !cash.accounts.find((a) => a.id === p.account_id)?.kind),
  );
  const netRevenue = dre.revenue + dre.deductions;
  const grossResult = netRevenue + dre.costs;
  const operatingResult = grossResult + dre.operating;
  const netResult = operatingResult + dre.financial_income + dre.financial_expense + dre.taxes;
  return {
    dre,
    dfc,
    netRevenue,
    grossResult,
    operatingResult,
    netResult,
    cashChange:
      dfc.operating + dfc.investing + dfc.financing + unclassifiedCash + internalTransfers,
    unclassifiedCash,
    internalTransfers,
    missingCompetence,
    missingClassification,
    missingCash,
    unassigned,
    completeDre: missingCompetence.length === 0 && missingClassification.length === 0,
    completeDfc: missingCash.length === 0 && unassigned.length === 0 && internalTransfers === 0,
  };
}

// Strict, quoted CSV with a fixed header avoids guessing dates, signs or bank identifiers.
export function parseStatementCsv(text: string): StatementLine[] {
  if (text.length > 2_000_000) throw new Error("Arquivo acima de 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i <= source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === undefined) throw new Error("CSV com aspas nao fechadas.");
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === "," || char === "\n" || char === undefined) {
      row.push(field);
      field = "";
      closed = false;
      if (char !== ",") {
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
      }
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || char === '"' || char === "\r") throw new Error("CSV malformado.");
      field += char;
    }
  }
  if (rows.shift()?.join(",") !== "external_id,date,amount,description")
    throw new Error("Cabecalho esperado: external_id,date,amount,description");
  if (!rows.length || rows.length > 1000)
    throw new Error("Importe de 1 a 1000 linhas por arquivo.");
  const ids = new Set<string>();
  return rows.map((r, i) => {
    const [external_id, date, amount, description] = r;
    if (
      r.length !== 4 ||
      !external_id.trim() ||
      external_id.length > 200 ||
      !validDate(date) ||
      !/^-?\d+(\.\d{1,2})?$/.test(amount)
    )
      throw new Error(`Linha ${i + 2} invalida: confira identificador, data ISO e valor decimal.`);
    const value = Number(amount);
    if (!Number.isFinite(value) || Math.abs(value) > 999999999999.99 || cents(value) === 0)
      throw new Error(`Valor invalido na linha ${i + 2}.`);
    if (ids.has(external_id.trim())) throw new Error(`Identificador repetido na linha ${i + 2}.`);
    ids.add(external_id.trim());
    return { external_id: external_id.trim(), date, amount: value, description };
  });
}

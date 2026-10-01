// Teste do fluxo de caixa com previstos: consulta de R$ 600 com sinal de R$ 200 pago.
// Executado com: npx tsx scripts/verify-cashflow-forecast.mjs
import assert from "node:assert/strict";
import { reportingRows } from "../src/features/finance/finance-math.ts";
import { calcCashFlow, projectOverdueToToday } from "../src/lib/finance.ts";

const today = new Date();
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const future = new Date(today);
future.setDate(today.getDate() + 3);

const title = (over) => ({
  amount: 0, paid_amount: 0, due_date: iso(today), date: iso(today), status: "pendente",
  description: "", category: null, patient_id: null, patient_name: null, payer_name: null,
  company_id: null, treatment_id: null, installment_id: null, competence_date: null,
  can_settle: true, can_reverse: true, can_cancel: true, ...over,
});

const snapshot = {
  titles: [
    // Consulta hoje: R$ 600, sinal de R$ 200 pago hoje -> restam R$ 400 previstos
    title({ id: "consulta", type: "receita", amount: 600, paid_amount: 200 }),
    // Conta a pagar daqui a 3 dias: R$ 150 -> saída prevista
    title({ id: "aluguel", type: "despesa", amount: 150, due_date: iso(future), date: iso(future) }),
    // Despesa paga hoje: R$ 50 -> saída
    title({ id: "material", type: "despesa", amount: 50, paid_amount: 50, status: "pago" }),
  ],
  payments: [
    { id: "p1", transaction_id: "consulta", amount: 200, paid_on: iso(today), reversed_at: null },
    { id: "p2", transaction_id: "material", amount: 50, paid_on: iso(today), reversed_at: null },
  ],
  accounts: [],
  scopes: [],
};

const rows = reportingRows(snapshot);
const start = new Date(today.getFullYear(), today.getMonth(), 1);
const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
const days = calcCashFlow(rows, "day", undefined, [start, end]);
const sum = (k) => days.reduce((s, d) => s + d[k], 0);

assert.equal(sum("entradas"), 200, "entrada = sinal pago");
assert.equal(sum("entradasPrev"), 400, "entrada prevista = restante da consulta");
assert.equal(sum("saidas"), 50, "saída = despesa paga");
assert.equal(sum("saidasPrev"), 150, "saída prevista = conta futura");

const todayRow = days.find((d) => d.date === iso(today));
assert.equal(todayRow.entradas, 200);
assert.equal(todayRow.entradasPrev, 400);
const futureRow = days.find((d) => d.date === iso(future));
assert.equal(futureRow.saidasPrev, 150, "conta futura cai no dia do vencimento");

// Depois de receber o restante: tudo vira entrada, nada previsto
snapshot.titles[0].paid_amount = 600;
snapshot.payments.push({ id: "p3", transaction_id: "consulta", amount: 400, paid_on: iso(today), reversed_at: null });
const after = calcCashFlow(reportingRows(snapshot), "day", undefined, [start, end]);
assert.equal(after.reduce((s, d) => s + d.entradas, 0), 600);
assert.equal(after.reduce((s, d) => s + d.entradasPrev, 0), 0);

// Conta vencida e em aberto (caso real: consulta de R$ 600 vencida há 3 dias, nada pago)
// continua como entrada prevista, projetada para hoje.
const past = new Date(today);
past.setDate(today.getDate() - 3);
const overdue = {
  ...snapshot,
  titles: [title({ id: "vencida", type: "receita", amount: 600, due_date: iso(past), date: iso(past) })],
  payments: [],
};
const overdueRows = calcCashFlow(projectOverdueToToday(reportingRows(overdue)), "day", undefined, [today, end]);
assert.equal(overdueRows.reduce((s, d) => s + d.entradasPrev, 0), 600, "vencida aparece como prevista");
assert.equal(overdueRows.find((d) => d.date === iso(today)).entradasPrev, 600, "projetada para hoje");

console.log("ok: fluxo de caixa com previstos");

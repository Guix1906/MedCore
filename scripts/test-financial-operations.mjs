import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const mathUrl = moduleUrl(transpile('../src/features/finance/finance-math.ts'));
const { managementReports, parseStatementCsv, validDate } = await import(moduleUrl(transpile('../src/features/finance/operations-math.ts').replace('"./finance-math"', JSON.stringify(mathUrl))));
const { cashFlow } = await import(moduleUrl(transpile('../src/features/finance/cash-flow-math.ts').replace('"./finance-math"', JSON.stringify(mathUrl))));
const title = (id, amount, type = 'receita', extra = {}) => ({ id, amount, type, paid_amount: 0, status: 'pendente', company_id: null, competence_date: '2026-09-01', due_date: '2026-10-01', ...extra });
const payment = (id, transaction_id, account_id, amount, extra = {}) => ({ id, transaction_id, account_id, amount, paid_on: '2026-09-10', reversed_at: null, ...extra });
const account = (id, kind = 'available', opening_amount = 0) => ({ id, name: id, kind, opening_date: '2026-09-01', opening_amount });
const finance = {
  titles: [title('service', 100, 'receita', { paid_amount: 100 }), title('pending', 600), title('fee', 3, 'despesa', { paid_amount: 3 }), title('cost', 20, 'despesa', { paid_amount: 20 }), title('cancelled', 999, 'receita', { status: 'cancelado' })],
  payments: [payment('receipt', 'service', 'cards', 100, { paid_on: '2026-08-31' }), payment('fee-payment', 'fee', 'bank', 3), payment('cost-payment', 'cost', 'bank', 20)],
  accounts: [], scopes: [], patients: [],
};
const cash = {
  accounts: [account('cards', 'receivable', 100), account('bank'), account('cash')],
  payments: finance.payments.map((p) => ({ ...p, date: p.paid_on, type: finance.titles.find((t) => t.id === p.transaction_id).type })),
  transfers: [{ id: 'settlement', from_account_id: 'cards', to_account_id: 'bank', amount: 100, date: '2026-09-10', reversed_at: null }, { id: 'internal', from_account_id: 'bank', to_account_id: 'cash', amount: 5, date: '2026-09-10', reversed_at: null }],
};
const ops = {
  classifications: [{ transaction_id: 'service', dre_group: 'revenue', dfc_group: 'operating' }, { transaction_id: 'pending', dre_group: 'revenue', dfc_group: 'operating' }, { transaction_id: 'fee', dre_group: 'financial_expense', dfc_group: 'operating' }, { transaction_id: 'cost', dre_group: 'costs', dfc_group: 'operating' }],
  cards: [{ id: 'settlement', payment_id: 'receipt', fee: 3, fee_title_id: 'fee', fee_payment_id: 'fee-payment' }],
  entries: [{ source_kind: 'card', source_id: 'settlement', account_id: 'bank', amount: 97, date: '2026-09-10' }, { source_kind: 'payment', source_id: 'cost-payment', account_id: 'bank', amount: -20, date: '2026-09-10' }, { source_kind: 'transfer_out', source_id: 'internal', account_id: 'bank', amount: -5, date: '2026-09-10' }, { source_kind: 'transfer_in', source_id: 'internal', account_id: 'cash', amount: 5, date: '2026-09-10' }],
};
let report = managementReports(finance, ops, cash, '2026-09-01', '2026-09-30');
assert.equal(report.dre.revenue, 70000, 'competence includes pending titles exactly once');
assert.equal(report.netRevenue, 70000);
assert.equal(report.grossResult, 68000);
assert.equal(report.netResult, 67700);
assert.equal(report.dfc.operating, 7700, 'card fee counted once; deposit occurs after original receipt');
assert.equal(report.internalTransfers, 0);
assert.equal(report.cashChange, 7700);
assert.equal(report.completeDre, true);
assert.equal(report.completeDfc, true);
const flow = cashFlow(cash, '2026-09-01', '2026-09-30');
assert.equal(flow.available, 77);
assert.equal(flow.receivable, 0);
assert.equal(flow.rows.find((r) => r.account.id === 'bank').closing, 72);
assert.equal(flow.rows.find((r) => r.account.id === 'cash').closing, 5);
assert.equal(report.cashChange / 100, flow.available, 'DFC reconciles available accounts');
const incomplete = { ...finance, titles: [...finance.titles, title('undated', 10, 'receita', { competence_date: null }), title('unclassified', 30)] };
report = managementReports(incomplete, ops, cash, '2026-09-01', '2026-09-30');
assert.deepEqual(report.missingCompetence, ['undated']);
assert.deepEqual(report.missingClassification, ['unclassified']);
assert.equal(report.completeDre, false);
const noClass = { ...ops, classifications: ops.classifications.filter((c) => c.transaction_id !== 'service') };
report = managementReports(finance, noClass, cash, '2026-09-01', '2026-09-30');
assert.equal(report.unclassifiedCash, 10000);
assert.equal(report.dfc.operating, -2300);
assert.equal(report.cashChange, 7700);
assert.equal(report.completeDfc, false);
const feeClass = { ...ops, classifications: ops.classifications.map((c) => c.transaction_id === 'fee' ? { ...c, dfc_group: 'financing' } : c) };
report = managementReports(finance, feeClass, cash, '2026-09-01', '2026-09-30');
assert.equal(report.dfc.financing, -300);
assert.equal(report.dfc.operating, 8000);
assert.equal(report.cashChange, 7700);
const missingFee = { ...ops, classifications: ops.classifications.filter((c) => c.transaction_id !== 'fee') };
report = managementReports(finance, missingFee, cash, '2026-09-01', '2026-09-30');
assert.equal(report.unclassifiedCash, -300);
assert.equal(report.completeDfc, false);
assert.equal(report.cashChange, 7700);
assert.throws(() => managementReports(finance, { ...ops, entries: [{ ...ops.entries[0], amount: 98 }] }, cash, '2026-09-01', '2026-09-30'));
const unassigned = { ...finance, payments: [...finance.payments, payment('orphan', 'pending', null, 1)] };
assert.equal(managementReports(unassigned, ops, cash, '2026-09-01', '2026-09-30').completeDfc, false);
report = managementReports(finance, ops, cash, '2026-09-11', '2026-09-30');
assert.equal(report.cashChange, 0);
assert.equal(report.netResult, 0);
assert.throws(() => managementReports(finance, ops, cash, '2026-09-30', '2026-09-01'));
assert.throws(() => managementReports(finance, ops, cash, '2026-02-30', '2026-09-01'));
assert.equal(validDate('2024-02-29'), true);
assert.equal(validDate('2026-02-29'), false);
const header = 'external_id,date,amount,description\n';
assert.deepEqual(parseStatementCsv('\uFEFF' + header + 'FIT1,2026-09-10,97.00,"Deposit, card"\nFIT2,2026-09-10,-20.01,"A ""quoted"" expense"\n'), [
  { external_id: 'FIT1', date: '2026-09-10', amount: 97, description: 'Deposit, card' },
  { external_id: 'FIT2', date: '2026-09-10', amount: -20.01, description: 'A "quoted" expense' },
]);
assert.equal(parseStatementCsv((header + 'A,2026-09-10,0.01,"two\nlines"').replace(/\n/g, '\r\n'))[0].description, 'two\nlines');
for (const line of ['A,2026-09-10,0,x', 'A,2026-09-10,1.001,x', 'A,2026-09-10,NaN,x', 'A,2026-02-30,1,x', 'A,10/09/2026,1,x', 'A,2026-09-10,1,"bad', 'A,2026-09-10,1,"bad"x', 'A,2026-09-10,1,x,extra', 'A,2026-09-10,1e2,x', ',2026-09-10,1,x']) assert.throws(() => parseStatementCsv(header + line), line);
assert.throws(() => parseStatementCsv(header + 'A,2026-09-10,1,x\n A ,2026-09-10,2,y'));
assert.throws(() => parseStatementCsv('date,amount,description\n2026-09-10,1,x'));
assert.throws(() => parseStatementCsv(header));
const thousand = Array.from({ length: 1000 }, (_, i) => `${i},2026-09-10,0.01,x`).join('\n');
assert.equal(parseStatementCsv(header + thousand).length, 1000);
assert.throws(() => parseStatementCsv(header + thousand + '\n1000,2026-09-10,1,x'));
for (const file of ['20260919200000_financial_operations.sql', '20260919201000_financial_shifts.sql', '20260919202000_financial_cards_commissions.sql', '20260919203000_financial_reconciliation.sql', '20260919204000_financial_operation_guards.sql']) {
  const sql = readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
  assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0, file);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /SECURITY DEFINER(?! SET search_path=public)/);
}
console.log('Financial operations: competence versus cash, card gross/net/fee classifications, transfer conservation, DFC-account equality, incomplete-data warnings, dates and strict CSV limits passed.');

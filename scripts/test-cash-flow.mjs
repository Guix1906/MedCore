import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const mathUrl = moduleUrl(transpile('../src/features/finance/finance-math.ts'));
const { cashFlow } = await import(moduleUrl(transpile('../src/features/finance/cash-flow-math.ts').replace('"./finance-math"', JSON.stringify(mathUrl))));
const account = (id, amount, kind = 'available', date = '2026-09-01') => ({ id, name: id, active: true, kind, opening_date: date, opening_amount: amount });
const payment = (id, account_id, amount, date, type = 'receita', extra = {}) => ({ id, account_id, amount, date, type, legacy: false, reversed_at: null, ...extra });
const transfer = (id, from_account_id, to_account_id, amount, date, extra = {}) => ({ id, from_account_id, to_account_id, amount, date, reversed_at: null, ...extra });
const data = {
  accounts: [account('cash', 100), account('bank', 500), account('cards', 0, 'receivable')],
  payments: [payment('old', 'cash', 999, '2026-08-31'), payment('a', 'cash', 200, '2026-09-01'), payment('b', 'bank', 50, '2026-09-02', 'despesa'), payment('c', 'cards', 300, '2026-09-03')],
  transfers: [transfer('t', 'cash', 'bank', 80, '2026-09-02')],
};
let result = cashFlow(data, '2026-09-01', '2026-09-30');
assert.equal(result.available, 750);
assert.equal(result.receivable, 300);
assert.equal(result.rows[0].closing, 220);
assert.equal(result.rows[1].closing, 530);
assert.equal(result.rows.reduce((sum, r) => sum + r.transfers, 0), 0);
assert.equal(result.rows.reduce((sum, r) => sum + r.result, 0), 450);
assert.equal(result.entries.length, 5);
assert.equal(result.entries.filter((e) => e.kind === 'transferencia').length, 2);
result = cashFlow(data, '2026-09-02', '2026-09-02', 'cash');
assert.equal(result.rows[0].opening, 300);
assert.equal(result.rows[0].closing, 220);
assert.equal(result.rows[0].result, 0);
assert.equal(result.rows[0].transfers, -80);
assert.equal(result.entries.length, 1);
assert.equal(cashFlow(data, '2026-09-03', '2026-09-30', 'cash').rows[0].opening, 220);
const reversed = { ...data, transfers: [{ ...data.transfers[0], reversed_at: '2026-09-04' }] };
assert.equal(cashFlow(reversed, '2026-09-01', '2026-09-30', 'cash').available, 300);
assert.equal(cashFlow(reversed, '2026-09-01', '2026-09-30').available, 750);
assert.equal(cashFlow(reversed, '2026-09-01', '2026-09-30').entries.filter((e) => e.reversed).length, 2);
const corrections = { ...data, payments: data.payments.map((p) => p.id === 'a' ? { ...p, reversed_at: '2026-09-04' } : p) };
assert.equal(cashFlow(corrections, '2026-09-01', '2026-09-30').available, 550);
const missing = { ...data, accounts: [...data.accounts, account('unknown', null, null, null)] };
assert.equal(cashFlow(missing, '2026-09-01', '2026-09-30').available, null);
assert.equal(cashFlow(missing, '2026-09-01', '2026-09-30').receivable, null);
assert.equal(cashFlow(missing, '2026-09-01', '2026-09-30', 'bank').available, 530);
assert.equal(cashFlow(data, '2026-08-01', '2026-09-30').available, null);
const unassigned = { ...data, payments: [...data.payments, payment('u', null, 77, '2026-09-02', 'receita', { legacy: true })] };
assert.equal(cashFlow(unassigned, '2026-09-01', '2026-09-30').unassigned, 1);
assert.equal(cashFlow(unassigned, '2026-09-01', '2026-09-30').legacy, 1);
assert.equal(cashFlow(unassigned, '2026-09-01', '2026-09-30').available, 750);
const inactive = { ...data, accounts: data.accounts.map((a) => ({ ...a, active: false })) };
assert.equal(cashFlow(inactive, '2026-09-01', '2026-09-30').available, 750);
const pennies = { accounts: [account('cash', -0.1)], payments: [payment('a', 'cash', 0.1, '2026-09-01'), payment('b', 'cash', 0.2, '2026-09-01')], transfers: [] };
assert.equal(cashFlow(pennies, '2026-09-01', '2026-09-30').available, 0.2);
assert.throws(() => cashFlow(data, '2026-09-30', '2026-09-01'));
assert.throws(() => cashFlow(data, '', '2026-09-01'));
assert.throws(() => cashFlow(data, '2026-09-01', '2026-09-30', 'other'));
assert.throws(() => cashFlow({ ...data, payments: [payment('bad', 'other', 1, '2026-09-01')] }, '2026-09-01', '2026-09-30'));
assert.throws(() => cashFlow({ ...data, transfers: [transfer('bad', 'cash', 'cash', 1, '2026-09-01')] }, '2026-09-01', '2026-09-30'));
assert.throws(() => cashFlow({ ...data, transfers: [transfer('bad', 'cash', 'other', 1, '2026-09-01')] }, '2026-09-01', '2026-09-30'));
const many = { ...pennies, payments: Array.from({ length: 1501 }, (_, i) => payment(String(i), 'cash', 0.1, '2026-09-01')) };
assert.equal(cashFlow(many, '2026-09-01', '2026-09-30').available, 150);
for (const file of ['20260919140000_treatment_followup.sql', '20260919160000_financial_settlements.sql', '20260919180000_financial_cash_flow.sql']) {
  const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  assert.equal(/(?:\bDO |\bAS |\bEND |^)\$(?!\$)(?=\s|;|$)/m.test(sql), false, `${file}: malformed dollar delimiter`);
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0, `${file}: unbalanced dollar blocks`);
}
console.log('Cash flow: confirmed opening, date/account boundaries, cards separation, transfer conservation, corrections, legacy warnings, inactive accounts and exact cents passed.');

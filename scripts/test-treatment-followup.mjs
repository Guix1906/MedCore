import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/acompanhamentos/followup-utils.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { paymentPreview, moneyCents, protocolDeadline, formatClinicalDate, localDate } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

assert.deepEqual(paymentPreview('1200', '0', '300', 3), {
  total: 1200, discount: 0, down: 300, balance: 900, parts: [300, 300, 300],
});
assert.deepEqual(paymentPreview('100', '0', '0', 3).parts, [33.34, 33.33, 33.33]);
assert.deepEqual(paymentPreview('100', '10', '90', 1).parts, []);
assert.deepEqual(paymentPreview('0,02', '0', '0', 2).parts, [0.01, 0.01]);
assert.equal(moneyCents('12,34'), 1234);
for (const value of ['-1', '1.234', '1,234', 'NaN', 'Infinity', '', '1e3', '1.2.3']) {
  assert.throws(() => moneyCents(value), undefined, value);
}
for (const values of [['100', '101', '0', 1], ['100', '0', '101', 1], ['100', '0', '0', 0], ['100', '0', '0', 121], ['100', '0', '0', 1.5], ['0.01', '0', '0', 2]]) {
  assert.throws(() => paymentPreview(...values));
}
for (let cents = 1; cents <= 1000; cents++) {
  for (const count of [1, 2, 3, 7, 12, 120]) {
    if (cents < count) continue;
    const result = paymentPreview((cents / 100).toFixed(2), '0', '0', count);
    assert.equal(result.parts.length, count);
    assert.equal(result.parts.reduce((sum, p) => sum + Math.round(p * 100), 0), cents);
    assert.ok(result.parts.every(p => p >= 0.01));
  }
}
assert.equal(protocolDeadline('em_andamento', '2026-09-18', '2026-09-19'), 'Protocolo vencido');
assert.equal(protocolDeadline('em_andamento', '2026-09-19', '2026-09-19'), 'Protocolo vence hoje');
assert.equal(protocolDeadline('em_andamento', '2026-09-26', '2026-09-19'), 'Protocolo a vencer');
assert.equal(protocolDeadline('em_andamento', '2026-09-27', '2026-09-19'), 'Dentro do prazo');
assert.equal(protocolDeadline('pausado', '2026-09-18', '2026-09-19'), 'Protocolo vencido');
assert.equal(protocolDeadline('finalizado', '2026-09-18', '2026-09-19'), 'Plano concluído');
assert.equal(protocolDeadline('cancelado', '2026-09-18', '2026-09-19'), 'Cancelado');
assert.equal(protocolDeadline('em_andamento', null, '2026-09-19'), 'Sem prazo');
assert.equal(protocolDeadline('em_andamento', '2028-03-01', '2028-02-23'), 'Protocolo a vencer');
assert.equal(formatClinicalDate('2026-09-19'), '19/09/2026');
assert.equal(localDate(new Date(2026, 8, 19, 23, 59)), '2026-09-19');
console.log('Treatment follow-up: payment totals, cent distribution, validation and deadline boundaries passed.');

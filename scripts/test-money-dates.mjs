import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.TZ = 'America/Sao_Paulo';

async function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { parseMoneyBR } = await load('../src/lib/money.ts');
const { parseDateOnly, formatDateOnly, todayLocal } = await load('../src/lib/date-utils.ts');

// Valores digitados no padrao brasileiro
for (const [input, expected] of [
  ['1.500,00', 1500], ['1.500', 1500], ['1500', 1500], ['1500,5', 1500.5], ['1500.50', 1500.5],
  ['R$ 1.234,56', 1234.56], ['0,99', 0.99], ['12', 12], ['1.234.567,89', 1234567.89], [250, 250],
]) {
  assert.equal(parseMoneyBR(input), expected, String(input));
}
for (const input of ['', null, undefined, 'abc', '1,2,3', '1e3', '--5']) {
  assert.equal(parseMoneyBR(input), null, String(input));
}

// Datas sem horario nao podem voltar um dia no fuso de Brasilia
assert.equal(formatDateOnly('2026-10-06'), '06/10/2026');
assert.equal(formatDateOnly('2026-01-01T00:00:00'), '01/01/2026');
assert.equal(formatDateOnly(null), '—');
assert.equal(parseDateOnly('2026-02-30')?.getDate() ?? null, 2); // Date ajusta: 02/03
assert.equal(parseDateOnly('lixo'), null);
assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
assert.equal(todayLocal(), `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);

console.log('Money and dates: Brazilian thousand separators, invalid inputs, date-only fields without timezone shift and local today passed.');

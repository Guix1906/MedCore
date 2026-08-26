import assert from 'assert';

function calcKPIs(rows) {
  const active = rows.filter((r) => r.status !== 'cancelado' && r.status !== 'canceled');
  const isPaid = (r) => r.status === 'pago' || r.status === 'concluido' || r.status === 'completed';
  const isPending = (r) => r.status === 'pendente' || r.status === 'pending' || r.status === 'vencido' || r.status === 'overdue';
  const isIncome = (r) => r.type === 'receita' || r.type === 'income';
  const isExpense = (r) => r.type === 'despesa' || r.type === 'expense';

  const sum = (arr, pred) =>
    arr.filter(pred).reduce((s, r) => s + Number(r.amount || 0), 0);

  const receitaPaga = sum(active, (r) => isPaid(r) && isIncome(r));
  const receitaPrevista = sum(active, (r) => isPending(r) && isIncome(r));
  const despesaPaga = sum(active, (r) => isPaid(r) && isExpense(r));
  const despesaPrevista = sum(active, (r) => isPending(r) && isExpense(r));

  return {
    receitaPaga,
    receitaPrevista,
    despesaPaga,
    despesaPrevista,
    saldoAtual: receitaPaga - despesaPaga,
    saldoPrevisto: (receitaPaga + receitaPrevista) - (despesaPaga + despesaPrevista),
  };
}

console.log('=== TESTES DE MATEMÁTICA E VOCABULÁRIO FINANCEIRO ===');

// Conjunto 1: Dados canônicos em português
const canonicalRows = [
  { id: '1', type: 'receita', status: 'pago', amount: 1000 },
  { id: '2', type: 'receita', status: 'pendente', amount: 500 },
  { id: '3', type: 'despesa', status: 'pago', amount: 300 },
  { id: '4', type: 'despesa', status: 'pendente', amount: 200 },
  { id: '5', type: 'receita', status: 'cancelado', amount: 999 },
];

const kpi1 = calcKPIs(canonicalRows);
assert.strictEqual(kpi1.receitaPaga, 1000, 'Receita paga canônica incorreta');
assert.strictEqual(kpi1.receitaPrevista, 500, 'Receita prevista canônica incorreta');
assert.strictEqual(kpi1.despesaPaga, 300, 'Despesa paga canônica incorreta');
assert.strictEqual(kpi1.despesaPrevista, 200, 'Despesa prevista canônica incorreta');
assert.strictEqual(kpi1.saldoAtual, 700, 'Saldo atual incorreto');
assert.strictEqual(kpi1.saldoPrevisto, 1000, 'Saldo previsto incorreto');
console.log('[PASS] Teste 1: Dados canônicos calculados com exatidão.');

// Conjunto 2: Dados mistos (legado em inglês + variações)
const mixedRows = [
  { id: '1', type: 'income', status: 'completed', amount: 1000 },
  { id: '2', type: 'income', status: 'pending', amount: 500 },
  { id: '3', type: 'expense', status: 'completed', amount: 300 },
  { id: '4', type: 'expense', status: 'pending', amount: 200 },
  { id: '5', type: 'income', status: 'canceled', amount: 999 },
];

const kpi2 = calcKPIs(mixedRows);
assert.deepStrictEqual(kpi1, kpi2, 'Dados mistos legados devem produzir exatamente o mesmo resultado numérico que dados canônicos');
console.log('[PASS] Teste 2: Equivalência perfeita entre formato legado (inglês) e canônico (pt-BR).');

console.log('\n======================================================');
console.log(' TODOS OS TESTES FINANCEIROS PASSARAM COM SUCESSO! ');
console.log('======================================================');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/features/finance/finance-math.ts', import.meta.url),'utf8');
const { outputText } = ts.transpileModule(source,{ compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022} });
const { remaining, titleStatus, financialSummary, reportingRows, cents } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const title = {id:'t',type:'receita',amount:600,paid_amount:300,due_date:'2026-09-10',date:'2026-08-01',status:'pendente'};
const payment = (id,amount,paid_on,account_id='pix',reversed_at=null) => ({id,transaction_id:'t',amount,paid_on,account_id,reversed_at});
const data = {titles:[title],payments:[payment('a',200,'2026-09-01'),payment('b',100,'2026-09-02','cash')],accounts:[],patients:[],scopes:[]};
assert.equal(remaining(title),300);
assert.equal(titleStatus(title,'2026-09-11'),'Parcial / vencido');
assert.equal(titleStatus(title,'2026-09-10'),'Parcial');
assert.deepEqual(financialSummary(data,data.titles,'2026-09-01','2026-09-30'),{income:300,expense:0,result:300,receivable:300,payable:0});
assert.deepEqual(financialSummary(data,data.titles,'2026-09-02','2026-09-02'),{income:100,expense:0,result:100,receivable:0,payable:0});
assert.equal(financialSummary(data,data.titles,'','','pix').income,200);
assert.equal(financialSummary(data,[],'','').income,0);
const rows = reportingRows(data);
assert.deepEqual(rows.map(({amount,date,status})=>({amount,date,status})),[
  {amount:200,date:'2026-09-01',status:'pago'},
  {amount:100,date:'2026-09-02',status:'pago'},
  {amount:300,date:'2026-09-10',status:'pendente'},
]);
assert.equal(rows.reduce((sum,r)=>sum+cents(r.amount),0),60000);
const reversed={...data,titles:[{...title,paid_amount:100}],payments:[{...data.payments[0],reversed_at:'2026-09-03'},data.payments[1]]};
assert.equal(financialSummary(reversed,reversed.titles,'','').income,100);
assert.equal(financialSummary(reversed,reversed.titles,'','').receivable,500);
assert.equal(reportingRows(reversed).length,2);
const paid={...title,paid_amount:600,status:'pago'};
assert.equal(titleStatus(paid,'2026-10-01'),'Quitado');
assert.equal(remaining({...title,status:'cancelado',paid_amount:0}),0);
assert.equal(reportingRows({titles:[{...title,status:'cancelado',paid_amount:0}],payments:[]}).length,0);
assert.equal(remaining({...title,amount:0.3,paid_amount:0.1}),0.2);
const small={titles:[{...title,amount:0.3,paid_amount:0.3}],payments:[payment('a',0.1,'2026-09-01'),payment('b',0.2,'2026-09-01')]};
assert.equal(financialSummary(small,small.titles,'','').income,0.3);
const expense={...title,id:'e',type:'despesa',amount:90,paid_amount:20};
const both={...data,titles:[title,expense],payments:[...data.payments,{...payment('ep',20,'2026-09-02'),transaction_id:'e'}]};
assert.deepEqual(financialSummary(both,both.titles,'',''),{income:300,expense:20,result:280,receivable:300,payable:70});
assert.throws(()=>cents(NaN));
assert.throws(()=>cents(Infinity));
assert.throws(()=>reportingRows({titles:[],payments:[payment('x',1,'2026-09-01')]}));
// More than the former 500-record UI cap must contribute to the official totals.
const many={...data,payments:Array.from({length:1501},(_,i)=>payment(String(i),0.1,'2026-09-01'))};
assert.equal(financialSummary(many,data.titles,'','').income,150.1);
console.log('Financial ledger: partial payments, period/account filters, reversal, exact cents, residual reporting and >500 events passed.');

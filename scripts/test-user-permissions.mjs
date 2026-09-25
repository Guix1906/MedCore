import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/admin/permissions.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const p = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const sql = readFileSync(new URL('../supabase/migrations/20260925120000_user_permissions.sql', import.meta.url), 'utf8');

// 1. Catalogo TS == catalogo da migracao (chave, modulo, requisitos, verificacao e ordem).
const rows = [...sql.matchAll(/\('([a-z]+\.[a-z]+)', '([a-z]+)', '[^']*', '\{([^}]*)\}', '(server|interface)', (\d+)\)/g)]
  .map(([, key, module, requires, enforcement, order]) => ({ key, module, requires: requires ? requires.split(',') : [], enforcement, order: Number(order) }));
assert.equal(rows.length, p.PERMISSIONS.length, 'quantidade de permissoes');
const sortedRows = [...rows].sort((a, b) => a.order - b.order);
sortedRows.forEach((row, i) => {
  const def = p.PERMISSIONS[i];
  assert.equal(row.key, def.key, `ordem do catalogo em ${row.key}`);
  assert.equal(row.module, def.module, `modulo de ${row.key}`);
  assert.deepEqual(row.requires, [...def.requires], `requisitos de ${row.key}`);
  assert.equal(row.enforcement, def.enforcement, `verificacao de ${row.key}`);
});
assert.equal(new Set(p.PERMISSION_KEYS).size, p.PERMISSION_KEYS.length, 'chaves unicas');
for (const def of p.PERMISSIONS) {
  for (const req of def.requires) assert.ok(p.isPermissionKey(req), `requisito desconhecido ${req}`);
  assert.ok(p.PERMISSION_MODULES.some((m) => m.id === def.module), `modulo desconhecido ${def.module}`);
}

// 2. Perfis do sistema: mesmas permissoes na migracao.
const roleBlock = sql.slice(sql.indexOf('INSERT INTO public.company_roles'), sql.indexOf('ON CONFLICT (id) DO UPDATE'));
for (const role of p.SYSTEM_ROLES) {
  const start = roleBlock.indexOf(`'${role.key}', '${role.name}'`);
  assert.ok(start >= 0, `perfil ${role.key} (${role.name}) ausente na migracao`);
  const chunk = roleBlock.slice(start, roleBlock.indexOf('true,', start));
  const perms = chunk.includes('FROM public.permission_catalog')
    ? [...p.PERMISSION_KEYS]
    : [...chunk.matchAll(/'([a-z]+\.[a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(p.sortPermissions(perms), p.sortPermissions(role.permissions), `permissoes do perfil ${role.key}`);
  assert.deepEqual(p.closure(role.permissions), p.sortPermissions(role.permissions), `perfil ${role.key} deve incluir seus requisitos`);
}

// 3. Regras de fecho, poda e efetivas.
assert.deepEqual(p.closure(['finance.pay']), ['finance.view', 'finance.pay']);
assert.deepEqual(p.closure(['users.manage', 'roles.manage']), ['users.view', 'users.manage', 'roles.manage']);
assert.deepEqual(p.closure(['foo.bar']), []);
assert.deepEqual(p.prune(['finance.pay']), []);
assert.deepEqual(p.prune(['agenda.manage', 'agenda.view', 'agenda.manage']), ['agenda.view', 'agenda.manage']);
assert.deepEqual(p.effectivePermissions(['finance.view', 'finance.pay'], [], ['finance.view']), []);
assert.deepEqual(p.effectivePermissions(['agenda.view'], ['agenda.manage'], []), ['agenda.view', 'agenda.manage']);
assert.deepEqual(p.effectivePermissions(['records.view', 'records.edit'], [], ['records.edit']), ['records.view']);

const reception = p.SYSTEM_ROLES.find((r) => r.key === 'reception').permissions;
const professional = p.SYSTEM_ROLES.find((r) => r.key === 'professional').permissions;
const finance = p.SYSTEM_ROLES.find((r) => r.key === 'finance').permissions;
assert.ok(!reception.includes('records.view') && !reception.includes('finance.pay') && !reception.includes('finance.reverse'), 'recepcao sem prontuario, pagamentos e estornos');
assert.ok(!finance.some((k) => k.startsWith('records.')), 'financeiro sem prontuario');

// Propriedade: efetivas sao sempre consistentes e os ajustes reproduzem o conjunto desejado.
let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = () => p.PERMISSION_KEYS.filter(() => random() < 0.3);
for (let i = 0; i < 2000; i++) {
  const role = pick();
  const extra = pick();
  const revoked = pick();
  const effective = p.effectivePermissions(role, extra, revoked);
  for (const key of effective) {
    for (const req of p.permissionDef(key).requires) assert.ok(effective.includes(req), `requisito ${req} ausente em ${key}`);
    assert.ok(!revoked.includes(key), 'permissao removida continua efetiva');
  }
  const desired = p.prune(p.closure(pick()));
  const adj = p.adjustmentsFor(role, desired);
  assert.deepEqual(p.effectivePermissions(role, adj.extra, adj.revoked), desired, 'ajustes nao reproduzem o conjunto desejado');
  const toggled = p.togglePermission(desired, p.PERMISSION_KEYS[i % p.PERMISSION_KEYS.length], i % 2 === 0);
  assert.deepEqual(p.prune(p.closure(toggled)), toggled, 'alternar permissao gerou conjunto inconsistente');
}
assert.deepEqual(p.togglePermission(['finance.view', 'finance.pay', 'finance.receive'], 'finance.view', false), []);
assert.deepEqual(p.togglePermission([], 'records.edit', true), ['records.view', 'records.edit']);
assert.deepEqual(p.dependentsOf('users.view'), ['users.manage', 'roles.manage']);

// 4. Anti-escalonamento e confirmacao de prontuario (mesmas regras das RPCs).
assert.ok(p.isSubset(reception, p.PERMISSION_KEYS));
assert.ok(!p.isSubset(professional, reception));
assert.ok(p.grantsSensitiveAccess(reception, [...reception, 'records.view']));
assert.ok(!p.grantsSensitiveAccess(professional, professional));
assert.ok(!p.grantsSensitiveAccess(reception, [...reception, 'records.view'], ['records.view']));
assert.equal(p.suggestedRoleKey('medico'), 'professional');
assert.equal(p.suggestedRoleKey('secretaria'), 'reception');
assert.equal(p.suggestedRoleKey('admin'), 'admin');
assert.equal(p.suggestedRoleKey('outro'), null);

// 5. Rotas, agenda, auditoria e validacoes.
const has = (set) => (key) => set.includes(key);
assert.equal(p.firstAllowedRoute(has(finance)), '/dashboard');
assert.equal(p.firstAllowedRoute(has(['inventory.view'])), '/estoque');
assert.equal(p.firstAllowedRoute(has([])), null);
assert.equal(p.routeRuleFor('/acompanhamentos/123').path, '/acompanhamentos');
assert.equal(p.routeRuleFor('/admin').any.includes('users.view'), true);
assert.equal(p.routeRuleFor('/auth'), null);
assert.deepEqual(p.routeRuleFor('/configuracoes').any, ['settings.manage', 'finance.accounts']);
assert.equal(p.resolveAdminTab('perfis'), 'perfis');
assert.equal(p.resolveAdminTab('x'), 'usuarios');
assert.equal(p.agendaVisibleIds({ scope: 'all', ownIds: ['a'], selectedIds: [] }), null);
const visible = p.agendaVisibleIds({ scope: 'selected', ownIds: ['me', null], selectedIds: ['doc'] });
assert.deepEqual([...visible].sort(), ['doc', 'me']);
const items = [{ assignedTo: 'me' }, { assignedTo: 'other' }, { assignedTo: null }, { assignedTo: 'other', kind: 'feriado' }, { assignedTo: 'doc' }];
assert.equal(p.filterByAgendaScope(items, visible).length, 4);
assert.equal(p.filterByAgendaScope(items, null).length, 5);
assert.deepEqual(p.describeAuditChange(
  { status: 'active', role_name: 'Recepção', effective_permissions: ['finance.view'] },
  { status: 'suspended', role_name: 'Financeiro', effective_permissions: ['finance.view', 'finance.pay'] },
), ['Situação: Ativo → Suspenso', 'Perfil: Recepção → Financeiro', '+ Lançar e pagar despesas']);
assert.ok(p.isValidEmail(' Pessoa@Clinica.com.br '));
assert.ok(!p.isValidEmail('sem-arroba') && !p.isValidEmail('a@b'));
assert.equal(p.safeRedirectPath('/admin?aba=perfis'), '/admin?aba=perfis');
for (const bad of ['//evil.com', 'https://evil.com', '/auth', '/auth?x=1', '/\\evil', 'admin', null, '/a\nb']) {
  assert.equal(p.safeRedirectPath(bad), null, String(bad));
}
assert.ok(p.isUuidValue('7f000000-0000-4000-8000-000000000001') && !p.isUuidValue('comp_medcore_default'));

// 6. Estrutura da migracao: funcoes publicas com privilegio explicito e sem acesso anonimo.
for (const fn of ['get_my_access', 'admin_get_overview', 'admin_update_member', 'admin_set_member_status', 'admin_transfer_ownership',
  'admin_save_role', 'admin_archive_role', 'admin_create_invitation', 'admin_touch_invitation', 'admin_cancel_invitation',
  'admin_list_audit', 'accept_company_invitation', 'decline_company_invitation', 'leave_company']) {
  assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `funcao ${fn}`);
  assert.match(sql, new RegExp(`'public\\.${fn}\\(`), `privilegio de ${fn}`);
}
const definers = [...sql.matchAll(/SECURITY DEFINER(?! SET search_path)/g)];
assert.equal(definers.length, 0, 'toda funcao SECURITY DEFINER fixa o search_path');
assert.equal((sql.match(/\$\$/g) || []).length % 2, 0, 'delimitadores $$ balanceados');
assert.match(sql, /^BEGIN;/m);
assert.match(sql, /^COMMIT;\s*$/m);
assert.doesNotMatch(sql, /^(?:CREATE TEMP|UPDATE _member_map|INSERT INTO _member_map)/m, 'tabela temporaria apenas dentro de bloco DO');

console.log('Usuarios e permissoes: catalogo igual a migracao, perfis, fecho/poda, ajustes, anti-escalonamento, rotas, agenda e auditoria validados.');

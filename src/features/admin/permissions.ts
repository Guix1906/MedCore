/**
 * Catálogo de permissões e regras puras de acesso.
 *
 * Espelha supabase/migrations/20260925120000_user_permissions.sql (o banco é quem
 * decide; a interface apenas antecipa). Sem imports: scripts/test-user-permissions.mjs
 * transpila este arquivo isoladamente e compara o catálogo com a migração.
 */

export type PermissionModuleId =
  | "dashboard"
  | "agenda"
  | "patients"
  | "records"
  | "followups"
  | "finance"
  | "inventory"
  | "reports"
  | "settings"
  | "admin";

/** server: verificado pelo banco (RLS/RPC). interface: filtra navegação; os dados seguem o módulo de origem. */
export type Enforcement = "server" | "interface";

export type PermissionDef = {
  key: string;
  module: PermissionModuleId;
  label: string;
  description: string;
  requires: readonly string[];
  enforcement: Enforcement;
};

export const PERMISSION_MODULES: readonly { id: PermissionModuleId; label: string }[] = [
  { id: "dashboard", label: "Visão geral" },
  { id: "agenda", label: "Agenda" },
  { id: "patients", label: "Pacientes" },
  { id: "records", label: "Prontuário" },
  { id: "followups", label: "Acompanhamentos" },
  { id: "finance", label: "Financeiro" },
  { id: "inventory", label: "Estoque" },
  { id: "reports", label: "Relatórios" },
  { id: "settings", label: "Configurações" },
  { id: "admin", label: "Administração" },
];

export const PERMISSIONS = [
  {
    key: "dashboard.view",
    module: "dashboard",
    label: "Ver painéis",
    description: "Dashboard e indicadores. Os números seguem as permissões de cada módulo.",
    requires: [],
    enforcement: "interface",
  },
  {
    key: "agenda.view",
    module: "agenda",
    label: "Ver agenda",
    description: "Agenda e visão geral dos atendimentos.",
    requires: [],
    enforcement: "interface",
  },
  {
    key: "agenda.manage",
    module: "agenda",
    label: "Agendar e alterar",
    description: "Criar, remarcar e excluir compromissos. Gera a cobrança pendente do atendimento.",
    requires: ["agenda.view"],
    enforcement: "server",
  },
  {
    key: "patients.view",
    module: "patients",
    label: "Ver pacientes",
    description: "Lista e ficha cadastral dos pacientes.",
    requires: [],
    enforcement: "interface",
  },
  {
    key: "patients.manage",
    module: "patients",
    label: "Cadastrar e editar pacientes",
    description: "Incluir, alterar e excluir pacientes.",
    requires: ["patients.view"],
    enforcement: "server",
  },
  {
    key: "records.view",
    module: "records",
    label: "Ver prontuário",
    description: "Prontuários, prescrições e histórico clínico.",
    requires: [],
    enforcement: "server",
  },
  {
    key: "records.edit",
    module: "records",
    label: "Registrar no prontuário",
    description: "Criar, alterar e excluir registros clínicos.",
    requires: ["records.view"],
    enforcement: "server",
  },
  {
    key: "followups.view",
    module: "followups",
    label: "Ver acompanhamentos",
    description: "Planos de tratamento, evolução e alertas.",
    requires: [],
    enforcement: "interface",
  },
  {
    key: "followups.manage",
    module: "followups",
    label: "Registrar acompanhamentos",
    description: "Evoluções, fotos, retornos e uso de medicação.",
    requires: ["followups.view"],
    enforcement: "interface",
  },
  {
    key: "finance.view",
    module: "finance",
    label: "Consultar financeiro",
    description: "Títulos, fluxo de caixa e demonstrativos.",
    requires: [],
    enforcement: "server",
  },
  {
    key: "finance.receive",
    module: "finance",
    label: "Cobrar e receber",
    description: "Lançar cobranças e registrar recebimentos.",
    requires: ["finance.view"],
    enforcement: "server",
  },
  {
    key: "finance.pay",
    module: "finance",
    label: "Lançar e pagar despesas",
    description: "Contas a pagar e baixas de pagamento.",
    requires: ["finance.view"],
    enforcement: "server",
  },
  {
    key: "finance.reverse",
    module: "finance",
    label: "Estornar e cancelar",
    description: "Estornos de baixas e cancelamento de títulos.",
    requires: ["finance.view"],
    enforcement: "server",
  },
  {
    key: "finance.accounts",
    module: "finance",
    label: "Administrar contas",
    description: "Contas financeiras, aberturas, transferências e categorias.",
    requires: ["finance.view"],
    enforcement: "server",
  },
  {
    key: "inventory.view",
    module: "inventory",
    label: "Ver estoque",
    description: "Itens, saldos e movimentações.",
    requires: [],
    enforcement: "interface",
  },
  {
    key: "inventory.manage",
    module: "inventory",
    label: "Movimentar estoque",
    description: "Cadastrar itens e registrar entradas e saídas.",
    requires: ["inventory.view"],
    enforcement: "server",
  },
  {
    key: "reports.view",
    module: "reports",
    label: "Ver relatórios",
    description: "Relatórios gerenciais. Os dados seguem as permissões de cada módulo.",
    requires: [],
    enforcement: "interface",
  },
  {
    key: "settings.manage",
    module: "settings",
    label: "Configurar a clínica",
    description: "Dados da clínica, serviços, categorias e cidades de atendimento.",
    requires: [],
    enforcement: "server",
  },
  {
    key: "users.view",
    module: "admin",
    label: "Ver usuários",
    description: "Lista de usuários, perfis e situação de acesso.",
    requires: [],
    enforcement: "server",
  },
  {
    key: "users.manage",
    module: "admin",
    label: "Gerenciar usuários",
    description: "Convidar, aprovar, alterar acessos, suspender e remover.",
    requires: ["users.view"],
    enforcement: "server",
  },
  {
    key: "roles.manage",
    module: "admin",
    label: "Gerenciar perfis",
    description: "Criar, editar e arquivar perfis de acesso.",
    requires: ["users.view"],
    enforcement: "server",
  },
  {
    key: "audit.view",
    module: "admin",
    label: "Ver auditoria",
    description: "Histórico de alterações de acesso.",
    requires: [],
    enforcement: "server",
  },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

const DEFS: readonly PermissionDef[] = PERMISSIONS;
const BY_KEY = new Map<string, PermissionDef>(DEFS.map((p) => [p.key, p]));
const ORDER = new Map<string, number>(DEFS.map((p, index) => [p.key, index]));

export const PERMISSION_KEYS = DEFS.map((p) => p.key) as PermissionKey[];
export const ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  "users.view",
  "users.manage",
  "roles.manage",
  "audit.view",
];
export const RECORD_PERMISSIONS: readonly PermissionKey[] = ["records.view", "records.edit"];

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && BY_KEY.has(value);
}

export function permissionDef(key: string): PermissionDef | undefined {
  return BY_KEY.get(key);
}

export function permissionLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export function moduleLabel(module: string): string {
  return PERMISSION_MODULES.find((m) => m.id === module)?.label ?? module;
}

export function permissionsByModule(): {
  id: PermissionModuleId;
  label: string;
  items: PermissionDef[];
}[] {
  return PERMISSION_MODULES.map((m) => ({
    ...m,
    items: DEFS.filter((p) => p.module === m.id),
  }));
}

/** Remove duplicados e chaves desconhecidas, na ordem do catálogo. */
export function sortPermissions(keys: Iterable<string>): PermissionKey[] {
  return Array.from(new Set(keys))
    .filter(isPermissionKey)
    .sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

/** Acrescenta os requisitos (transitivos) de cada permissão. */
export function closure(keys: Iterable<string>): PermissionKey[] {
  const out = new Set<string>();
  const stack = Array.from(keys);
  while (stack.length > 0) {
    const key = stack.pop() as string;
    const def = BY_KEY.get(key);
    if (!def || out.has(key)) continue;
    out.add(key);
    stack.push(...def.requires);
  }
  return sortPermissions(out);
}

/** Remove permissões cujos requisitos não estão presentes, até estabilizar. */
export function prune(keys: Iterable<string>): PermissionKey[] {
  let current = sortPermissions(keys);
  for (;;) {
    const present = new Set<string>(current);
    const next = current.filter((key) =>
      (BY_KEY.get(key)?.requires ?? []).every((req) => present.has(req)),
    );
    if (next.length === current.length) return next;
    current = next;
  }
}

/** Efetivas = poda(fecho(perfil + ajustes) − removidas). Igual a public.permission_effective. */
export function effectivePermissions(
  role: Iterable<string>,
  extra: Iterable<string> = [],
  revoked: Iterable<string> = [],
): PermissionKey[] {
  const removed = new Set<string>(revoked);
  return prune(closure([...role, ...extra]).filter((key) => !removed.has(key)));
}

/** Ajustes individuais que levam do perfil ao conjunto desejado. */
export function adjustmentsFor(
  role: Iterable<string>,
  desired: Iterable<string>,
): { extra: PermissionKey[]; revoked: PermissionKey[] } {
  const base = new Set<string>(closure(role));
  const want = new Set<string>(closure(desired));
  return {
    extra: sortPermissions([...want].filter((key) => !base.has(key))),
    revoked: sortPermissions([...base].filter((key) => !want.has(key))),
  };
}

export function dependentsOf(key: string): PermissionKey[] {
  const out = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const def of DEFS) {
      if (def.requires.includes(current) && !out.has(def.key)) {
        out.add(def.key);
        stack.push(def.key);
      }
    }
  }
  return sortPermissions(out);
}

/** Marcar inclui os requisitos; desmarcar remove quem depende da permissão. */
export function togglePermission(
  current: Iterable<string>,
  key: string,
  enabled: boolean,
): PermissionKey[] {
  const set = new Set<string>(current);
  if (enabled) {
    for (const k of closure([key])) set.add(k);
  } else {
    set.delete(key);
    for (const d of dependentsOf(key)) set.delete(d);
  }
  return sortPermissions(set);
}

export function isSubset(a: Iterable<string>, b: Iterable<string>): boolean {
  const container = new Set(b);
  for (const key of a) if (!container.has(key)) return false;
  return true;
}

export function diffPermissions(
  before: Iterable<string>,
  after: Iterable<string>,
): { added: PermissionKey[]; removed: PermissionKey[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: sortPermissions([...a].filter((key) => !b.has(key))),
    removed: sortPermissions([...b].filter((key) => !a.has(key))),
  };
}

/** Prontuário liberado fora de um perfil clínico, pela primeira vez: pede confirmação. */
export function grantsSensitiveAccess(
  rolePermissions: Iterable<string>,
  effective: Iterable<string>,
  previousEffective: Iterable<string> = [],
): boolean {
  const role = new Set(rolePermissions);
  const now = new Set(effective);
  const before = new Set(previousEffective);
  const hasRecords = (s: Set<string>) => RECORD_PERMISSIONS.some((k) => s.has(k));
  return hasRecords(now) && !role.has("records.view") && !hasRecords(before);
}

// Perfis do sistema --------------------------------------------------------------------------------

export type SystemRoleKey =
  "owner" | "admin" | "professional" | "reception" | "finance" | "inventory" | "viewer";

export const SYSTEM_ROLES: readonly {
  key: SystemRoleKey;
  name: string;
  permissions: readonly PermissionKey[];
}[] = [
  { key: "owner", name: "Proprietário", permissions: PERMISSION_KEYS },
  { key: "admin", name: "Administrador", permissions: PERMISSION_KEYS },
  {
    key: "professional",
    name: "Profissional de saúde",
    permissions: [
      "dashboard.view",
      "agenda.view",
      "agenda.manage",
      "patients.view",
      "patients.manage",
      "records.view",
      "records.edit",
      "followups.view",
      "followups.manage",
      "inventory.view",
    ],
  },
  {
    key: "reception",
    name: "Recepção",
    permissions: [
      "dashboard.view",
      "agenda.view",
      "agenda.manage",
      "patients.view",
      "patients.manage",
      "followups.view",
      "finance.view",
      "finance.receive",
    ],
  },
  {
    key: "finance",
    name: "Financeiro",
    permissions: [
      "dashboard.view",
      "finance.view",
      "finance.receive",
      "finance.pay",
      "finance.reverse",
      "finance.accounts",
      "reports.view",
    ],
  },
  {
    key: "inventory",
    name: "Estoque",
    permissions: ["dashboard.view", "inventory.view", "inventory.manage"],
  },
  {
    key: "viewer",
    name: "Somente leitura",
    permissions: [
      "dashboard.view",
      "agenda.view",
      "patients.view",
      "followups.view",
      "inventory.view",
      "reports.view",
    ],
  },
];

/** Perfil sugerido ao aprovar um cadastro vinculado a um profissional (doctors.role). */
export function suggestedRoleKey(doctorRole: string | null | undefined): SystemRoleKey | null {
  if (!doctorRole) return null;
  if (doctorRole === "admin") return "admin";
  if (doctorRole === "medico" || doctorRole === "enfermeiro") return "professional";
  if (["recepcionista", "secretaria", "atendente"].includes(doctorRole)) return "reception";
  return null;
}

// Situações, rotas e auditoria ---------------------------------------------------------------------

export type MemberStatus = "pending" | "active" | "suspended" | "removed";

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  pending: "Aguardando aprovação",
  active: "Ativo",
  suspended: "Suspenso",
  removed: "Removido",
};

export function isMemberStatus(value: unknown): value is MemberStatus {
  return value === "pending" || value === "active" || value === "suspended" || value === "removed";
}

export type AgendaScope = "all" | "own" | "selected";

export const AGENDA_SCOPE_LABEL: Record<AgendaScope, string> = {
  all: "Todos os profissionais",
  own: "Somente a própria agenda",
  selected: "Profissionais selecionados",
};

export function isAgendaScope(value: unknown): value is AgendaScope {
  return value === "all" || value === "own" || value === "selected";
}

/** Responsáveis visíveis na agenda (null = todos). */
export function agendaVisibleIds(input: {
  scope: AgendaScope;
  ownIds: (string | null | undefined)[];
  selectedIds: string[];
}): Set<string> | null {
  if (input.scope === "all") return null;
  const ids = new Set<string>(input.ownIds.filter((id): id is string => !!id));
  if (input.scope === "selected") for (const id of input.selectedIds) ids.add(id);
  return ids;
}

/** Feriados e compromissos sem responsável continuam visíveis. */
export function filterByAgendaScope<T extends { assignedTo?: string | null; kind?: string }>(
  items: T[],
  visible: Set<string> | null,
): T[] {
  if (!visible) return items;
  return items.filter(
    (item) => item.kind === "feriado" || !item.assignedTo || visible.has(item.assignedTo),
  );
}

export const MODULE_ROUTES: readonly {
  path: string;
  label: string;
  any: readonly PermissionKey[];
}[] = [
  { path: "/dashboard", label: "Dashboard", any: ["dashboard.view"] },
  { path: "/agenda", label: "Agenda", any: ["agenda.view"] },
  { path: "/visao-geral", label: "Visão geral da agenda", any: ["agenda.view"] },
  { path: "/pacientes", label: "Pacientes", any: ["patients.view"] },
  { path: "/acompanhamentos", label: "Acompanhamentos", any: ["followups.view"] },
  { path: "/prontuario", label: "Prontuário", any: ["records.view"] },
  { path: "/financeiro", label: "Financeiro", any: ["finance.view"] },
  { path: "/estoque", label: "Estoque", any: ["inventory.view"] },
  { path: "/relatorios", label: "Relatórios", any: ["reports.view"] },
  { path: "/configuracoes", label: "Configurações", any: ["settings.manage", "finance.accounts"] },
  { path: "/admin", label: "Administração", any: ["users.view", "roles.manage", "audit.view"] },
];

export function routeRuleFor(pathname: string) {
  return (
    MODULE_ROUTES.find((rule) => pathname === rule.path || pathname.startsWith(`${rule.path}/`)) ??
    null
  );
}

export function firstAllowedRoute(has: (key: PermissionKey) => boolean): string | null {
  return MODULE_ROUTES.find((rule) => rule.any.some(has))?.path ?? null;
}

export type AdminTab = "usuarios" | "perfis" | "auditoria";

export function resolveAdminTab(value: unknown): AdminTab {
  return value === "perfis" || value === "auditoria" ? value : "usuarios";
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "member.update": "Acesso alterado",
  "member.approve": "Cadastro aprovado",
  "member.reject": "Cadastro recusado",
  "member.suspend": "Acesso suspenso",
  "member.reactivate": "Acesso reativado",
  "member.restore": "Acesso restaurado",
  "member.remove": "Acesso removido",
  "member.leave": "Saiu da clínica",
  "member.role_replaced": "Perfil substituído",
  "ownership.transfer": "Propriedade transferida",
  "role.create": "Perfil criado",
  "role.update": "Perfil alterado",
  "role.archive": "Perfil arquivado",
  "invite.create": "Convite enviado",
  "invite.resend": "Convite reenviado",
  "invite.cancel": "Convite cancelado",
  "invite.accept": "Convite aceito",
  "invite.decline": "Convite recusado",
  "migration.backfill": "Migração inicial",
};

export const AUDIT_ACTION_GROUPS: readonly { value: string; label: string }[] = [
  { value: "member", label: "Usuários" },
  { value: "invite", label: "Convites" },
  { value: "role", label: "Perfis" },
  { value: "ownership", label: "Propriedade" },
  { value: "migration", label: "Migração" },
];

type AuditSnapshot = {
  status?: unknown;
  role_name?: unknown;
  effective_permissions?: unknown;
  permissions?: unknown;
  name?: unknown;
  email?: unknown;
};

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Linhas legíveis com o que mudou em um registro de auditoria. */
export function describeAuditChange(before: unknown, after: unknown): string[] {
  const b = (before && typeof before === "object" ? before : {}) as AuditSnapshot;
  const a = (after && typeof after === "object" ? after : {}) as AuditSnapshot;
  const lines: string[] = [];
  if (typeof a.email === "string" && !b.email) lines.push(`E-mail: ${a.email}`);
  if (isMemberStatus(a.status) && a.status !== b.status) {
    lines.push(
      isMemberStatus(b.status)
        ? `Situação: ${MEMBER_STATUS_LABEL[b.status]} → ${MEMBER_STATUS_LABEL[a.status]}`
        : `Situação: ${MEMBER_STATUS_LABEL[a.status]}`,
    );
  }
  if (typeof a.role_name === "string" && a.role_name !== b.role_name) {
    lines.push(
      typeof b.role_name === "string"
        ? `Perfil: ${b.role_name} → ${a.role_name}`
        : `Perfil: ${a.role_name}`,
    );
  }
  if (typeof a.name === "string" && typeof b.name === "string" && a.name !== b.name) {
    lines.push(`Nome: ${b.name} → ${a.name}`);
  }
  const beforePerms = asStringList(b.effective_permissions ?? b.permissions);
  const afterPerms = asStringList(a.effective_permissions ?? a.permissions);
  if (afterPerms.length > 0 || beforePerms.length > 0) {
    const { added, removed } = diffPermissions(beforePerms, afterPerms);
    if (added.length > 0) lines.push(`+ ${added.map(permissionLabel).join(", ")}`);
    if (removed.length > 0) lines.push(`− ${removed.map(permissionLabel).join(", ")}`);
  }
  return lines;
}

// Validações ------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isUuidValue(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Destino pós-login: somente caminhos internos do app. */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  if (path === "/auth" || path.startsWith("/auth?") || path.startsWith("/auth/")) return null;
  if (Array.from(path).some((ch) => ch.charCodeAt(0) < 32)) return null;
  return path;
}

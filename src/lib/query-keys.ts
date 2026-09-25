/**
 * Chaves centralizadas de React Query.
 *
 * Convenção:
 * - Sempre usar as factories abaixo em vez de literais inline.
 * - Escopo por empresa: sempre incluir companyId (ou null) como primeiro parâmetro.
 */

export const qk = {
  /** Empresa ativa do usuário logado */
  activeCompany: (userId: string | null | undefined) => ["active-company", userId] as const,

  /** Membros da empresa */
  team: {
    members: (companyId: string | null | undefined) => ["company-members", companyId] as const,
  },

  /** Acesso do usuário logado (permissões efetivas, situação e convites) */
  access: {
    all: () => ["my-access"] as const,
    me: (userId: string | null | undefined, companyId: string | null | undefined) =>
      ["my-access", userId, companyId] as const,
  },

  /** Administração de usuários e perfis (/admin) */
  admin: {
    all: (companyId: string | null | undefined) => ["admin", companyId] as const,
    overview: (companyId: string | null | undefined) => ["admin", companyId, "overview"] as const,
    audit: (companyId: string | null | undefined, filters: Record<string, string | null>) =>
      ["admin", companyId, "audit", filters] as const,
    memberHistory: (companyId: string | null | undefined, userId: string | null | undefined) =>
      ["admin", companyId, "member-history", userId] as const,
  },

  /** Mini-listas para selects/dropdowns */
  membersMini: (companyId: string | null | undefined) => ["members-mini", companyId] as const,
  casesMini: (companyId: string | null | undefined) => ["cases-mini", companyId] as const,

  /** Agendamentos (eventos, tarefas, prazos) */
  agendaLists: {
    tasks: (companyId: string | null | undefined) => ["agenda-tasks", companyId] as const,
    events: (companyId: string | null | undefined) => ["agenda-events", companyId] as const,
    deadlines: (companyId: string | null | undefined) => ["agenda-deadlines", companyId] as const,
  },

  /** Dashboard geral */
  dashboard: {
    all: () => ["dashboard"] as const,
  },
} as const;

/**
 * Perfis padronizados de staleTime para consistência entre queries.
 * Preferir estes valores em vez de números mágicos por query.
 */
export const staleTimes = {
  /** Dados voláteis (chats, notificações). */
  realtime: 0,
  /** Dados de UI que mudam com ações do usuário (kanban, listas editáveis). */
  interactive: 30_000,
  /** Dados de leitura frequente (dashboards, listagens). */
  standard: 5 * 60_000,
  /** Dados quase-estáticos (permissões, metadados da empresa). */
  slow: 10 * 60_000,
  /** Dados praticamente imutáveis por sessão (roles, feature flags). */
  session: 30 * 60_000,
} as const;

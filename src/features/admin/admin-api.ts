import { supabase } from "@/integrations/supabase/client";
import {
  isAgendaScope,
  isMemberStatus,
  isUuidValue,
  type AgendaScope,
  type MemberStatus,
} from "./permissions";

// Tipos ------------------------------------------------------------------------------------------------

export type AccessMode = "loading" | "legacy" | "active" | "blocked";
export type AccessStatus = MemberStatus | "none";

export type PendingInvitation = {
  id: string;
  companyId: string;
  companyName: string;
  roleName: string;
  invitedAt: string | null;
  expiresAt: string | null;
  invitedByName: string;
};

export type MyAccess = {
  mode: AccessMode;
  /** Motivo do modo legado (migração pendente, sessão só do backend PHP ou falha temporária). */
  legacyReason?: "migration" | "no-session" | "unavailable";
  status: AccessStatus;
  userId: string | null;
  email: string | null;
  companyId: string | null;
  companyName: string | null;
  memberId: string | null;
  role: { id: string; key: string | null; name: string } | null;
  isOwner: boolean;
  permissions: Set<string>;
  doctorId: string | null;
  agendaScope: AgendaScope;
  agendaProfessionalIds: string[];
  companies: { id: string; name: string; status: AccessStatus }[];
  invitations: PendingInvitation[];
};

export type AdminRole = {
  id: string;
  key: string | null;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  basedOn: string | null;
  version: number;
  updatedAt: string | null;
  memberCount: number;
  invitationCount: number;
};

export type AdminMember = {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  status: MemberStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  roleId: string | null;
  extra: string[];
  revoked: string[];
  effective: string[];
  doctorId: string | null;
  doctorName: string | null;
  agendaScope: AgendaScope;
  agendaProfessionalIds: string[];
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  createdAt: string | null;
  acceptedAt: string | null;
  version: number;
  isSelf: boolean;
  suggestedDoctor: { id: string; name: string; role: string | null } | null;
};

export type AdminInvitation = {
  id: string;
  email: string;
  fullName: string | null;
  roleId: string;
  doctorId: string | null;
  agendaScope: AgendaScope;
  invitedAt: string | null;
  lastSentAt: string | null;
  sendCount: number;
  expiresAt: string | null;
  expired: boolean;
  invitedByName: string;
};

export type AdminProfessional = {
  id: string;
  name: string;
  specialty: string | null;
  role: string | null;
  active: boolean;
  linkedUserId: string | null;
};

export type AdminOverview = {
  company: { id: string; name: string };
  actor: {
    memberId: string;
    userId: string;
    roleId: string | null;
    isOwner: boolean;
    permissions: string[];
  };
  roles: AdminRole[];
  members: AdminMember[];
  invitations: AdminInvitation[];
  professionals: AdminProfessional[];
};

export type AuditEntry = {
  id: number;
  createdAt: string;
  action: string;
  reason: string | null;
  actorId: string | null;
  actorName: string;
  targetUserId: string | null;
  targetName: string | null;
  roleId: string | null;
  roleName: string | null;
  dataBefore: unknown;
  dataAfter: unknown;
};

export type AuditPage = { entries: AuditEntry[]; nextBeforeId: number | null };

// Erros --------------------------------------------------------------------------------------------------

const FRIENDLY: Record<string, string> = {
  "admin.forbidden": "Seu perfil não permite esta ação.",
  "admin.unauthenticated": "Sua sessão expirou. Entre novamente.",
  "admin.self": "Você não pode alterar o próprio acesso.",
  "admin.stale":
    "Este registro foi alterado por outra pessoa. Os dados foram recarregados: revise e tente de novo.",
  "admin.owner_only": "Apenas proprietários podem gerenciar proprietários.",
  "admin.containment": "Este usuário tem permissões que você não possui.",
  "admin.escalation": "Você só pode conceder permissões que também possui.",
  "admin.last_owner": "A clínica precisa de pelo menos um proprietário ativo.",
  "admin.confirm_sensitive": "Confirme a liberação de acesso ao prontuário.",
  "admin.invalid_role": "Escolha um perfil de acesso válido.",
  "admin.not_found": "Usuário não encontrado nesta clínica.",
  "admin.removed": "Restaure o acesso antes de editar este usuário.",
  "admin.reason_required": "Informe um motivo com pelo menos 5 caracteres.",
  "admin.reason_too_long": "O motivo pode ter no máximo 500 caracteres.",
  "admin.invalid_status": "Situação inválida.",
  "admin.same_status": "O usuário já está nesta situação.",
  "admin.invalid_transition": "Esta mudança de situação não é permitida.",
  "admin.doctor_taken": "Este profissional já está vinculado a outro usuário.",
  "admin.invalid_agenda": "Configuração de agenda inválida.",
  "admin.agenda_empty": "Selecione ao menos um profissional para a agenda.",
  "admin.unknown_permission": "Há permissões desconhecidas. Atualize a página.",
  "admin.role_name": "O nome do perfil deve ter de 2 a 60 caracteres.",
  "admin.role_description": "A descrição pode ter no máximo 280 caracteres.",
  "admin.role_empty": "Selecione ao menos uma permissão.",
  "admin.role_name_taken": "Já existe um perfil com este nome.",
  "admin.role_readonly": "Perfis do sistema não podem ser alterados. Duplique para personalizar.",
  "admin.own_role": "Você não pode alterar o perfil atribuído a você.",
  "admin.replacement_required": "Escolha um perfil substituto para quem usa este perfil.",
  "admin.invalid_request": "Solicitação inválida. Tente novamente.",
  "admin.request_reused": "Esta solicitação já foi usada com outros dados.",
  "admin.invalid_email": "Informe um e-mail válido.",
  "admin.invalid_name": "O nome pode ter no máximo 120 caracteres.",
  "admin.already_member": "Este e-mail já tem acesso a esta clínica.",
  "admin.password_too_short": "A senha deve ter no mínimo 6 caracteres.",
  "admin.member_suspended": "Este acesso está suspenso. Reative-o na lista de usuários.",
  "admin.member_pending": "Esta pessoa já se cadastrou e aguarda aprovação na lista de usuários.",
  "admin.invite_exists": "Já existe um convite pendente para este e-mail. Use “Reenviar convite”.",
  "admin.invite_not_found": "Convite não encontrado para o seu e-mail.",
  "admin.invite_closed": "Este convite não está mais pendente.",
  "admin.invite_expired": "Este convite expirou. Peça um novo convite ao administrador.",
  "admin.resend_throttled": "Aguarde um minuto antes de reenviar o convite.",
  "admin.email_unconfirmed": "Confirme seu e-mail antes de aceitar o convite.",
  "admin.self_suspended": "Seu acesso a esta clínica está suspenso.",
  "admin.audit_immutable": "A auditoria de acessos não pode ser alterada.",
  "admin.migration_pending":
    "A migração de usuários e permissões ainda não foi aplicada no banco de dados.",
};

type RpcError = { message?: string; code?: string; hint?: string | null; details?: string | null };

export class AdminError extends Error {
  code?: string;
  hint?: string;
  constructor(message: string, code?: string, hint?: string) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.hint = hint;
  }
}

export function isMissingFunction(error: RpcError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|function .* does not exist/i.test(error.message ?? "")
  );
}

export function toAdminError(error: unknown): AdminError {
  if (error instanceof AdminError) return error;
  const e = (error ?? {}) as RpcError;
  if (isMissingFunction(e)) {
    return new AdminError(FRIENDLY["admin.migration_pending"], e.code, "admin.migration_pending");
  }
  const hint = e.hint ?? undefined;
  const message =
    (hint && FRIENDLY[hint]) ||
    e.message ||
    "Não foi possível concluir a operação. Tente novamente.";
  return new AdminError(message, e.code, hint);
}

export function adminErrorHint(error: unknown): string | undefined {
  return error instanceof AdminError ? error.hint : undefined;
}

type RpcCall = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: RpcError | null }>;

// As funções novas ainda não constam em types.ts (gerado pelo Supabase).
const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCall;

async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await callRpc(fn, args);
  if (error) throw toAdminError(error);
  return data as T;
}

// Conversores defensivos ---------------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : Number(v) || fallback;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strList = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");

function parseStatus(v: unknown): AccessStatus {
  return isMemberStatus(v) ? v : "none";
}

function parseInvitations(v: unknown): PendingInvitation[] {
  return list(v).map((item) => {
    const r = obj(item);
    return {
      id: String(r.id),
      companyId: String(r.company_id),
      companyName: str(r.company_name) ?? "Clínica",
      roleName: str(r.role_name) ?? "",
      invitedAt: str(r.invited_at),
      expiresAt: str(r.expires_at),
      invitedByName: str(r.invited_by_name) ?? "Administrador",
    };
  });
}

export function emptyAccess(mode: AccessMode, legacyReason?: MyAccess["legacyReason"]): MyAccess {
  return {
    mode,
    legacyReason,
    status: "none",
    userId: null,
    email: null,
    companyId: null,
    companyName: null,
    memberId: null,
    role: null,
    isOwner: false,
    permissions: new Set(),
    doctorId: null,
    agendaScope: "all",
    agendaProfessionalIds: [],
    companies: [],
    invitations: [],
  };
}

export function parseMyAccess(data: unknown): MyAccess {
  const r = obj(data);
  const status = parseStatus(r.status);
  const role = obj(r.role);
  return {
    mode: status === "active" ? "active" : "blocked",
    status,
    userId: str(r.user_id),
    email: str(r.email),
    companyId: str(r.company_id),
    companyName: str(r.company_name),
    memberId: str(r.member_id),
    role: str(role.id)
      ? { id: String(role.id), key: str(role.key), name: str(role.name) ?? "Perfil" }
      : null,
    isOwner: r.is_owner === true,
    permissions: new Set(status === "active" ? strList(r.permissions) : []),
    doctorId: str(r.doctor_id),
    agendaScope: isAgendaScope(r.agenda_scope) ? r.agenda_scope : "all",
    agendaProfessionalIds: strList(r.agenda_professional_ids),
    companies: list(r.companies).map((c) => {
      const x = obj(c);
      return { id: String(x.id), name: str(x.name) ?? "Clínica", status: parseStatus(x.status) };
    }),
    invitations: parseInvitations(r.invitations),
  };
}

function parseRole(v: unknown): AdminRole {
  const r = obj(v);
  return {
    id: String(r.id),
    key: str(r.key),
    name: str(r.name) ?? "Perfil",
    description: str(r.description) ?? "",
    isSystem: r.is_system === true,
    permissions: strList(r.permissions),
    basedOn: str(r.based_on),
    version: num(r.version, 1),
    updatedAt: str(r.updated_at),
    memberCount: num(r.member_count),
    invitationCount: num(r.invitation_count),
  };
}

function parseMember(v: unknown): AdminMember {
  const r = obj(v);
  const suggestion = obj(r.suggested_doctor);
  return {
    id: String(r.id),
    userId: String(r.user_id),
    fullName: str(r.full_name) ?? "Usuário",
    email: str(r.email),
    avatarUrl: str(r.avatar_url),
    status: isMemberStatus(r.status) ? r.status : "pending",
    statusReason: str(r.status_reason),
    statusChangedAt: str(r.status_changed_at),
    roleId: str(r.role_id),
    extra: strList(r.extra_permissions),
    revoked: strList(r.revoked_permissions),
    effective: strList(r.effective_permissions),
    doctorId: str(r.doctor_id),
    doctorName: str(r.doctor_name),
    agendaScope: isAgendaScope(r.agenda_scope) ? r.agenda_scope : "all",
    agendaProfessionalIds: strList(r.agenda_professional_ids),
    lastSignInAt: str(r.last_sign_in_at),
    emailConfirmed: r.email_confirmed === true,
    createdAt: str(r.created_at),
    acceptedAt: str(r.accepted_at),
    version: num(r.version, 1),
    isSelf: r.is_self === true,
    suggestedDoctor: str(suggestion.id)
      ? {
          id: String(suggestion.id),
          name: str(suggestion.name) ?? "Profissional",
          role: str(suggestion.role),
        }
      : null,
  };
}

function parseInvitation(v: unknown): AdminInvitation {
  const r = obj(v);
  return {
    id: String(r.id),
    email: str(r.email) ?? "",
    fullName: str(r.full_name),
    roleId: String(r.role_id),
    doctorId: str(r.doctor_id),
    agendaScope: isAgendaScope(r.agenda_scope) ? r.agenda_scope : "all",
    invitedAt: str(r.invited_at),
    lastSentAt: str(r.last_sent_at),
    sendCount: num(r.send_count),
    expiresAt: str(r.expires_at),
    expired: r.expired === true,
    invitedByName: str(r.invited_by_name) ?? "Administrador",
  };
}

function parseProfessional(v: unknown): AdminProfessional {
  const r = obj(v);
  return {
    id: String(r.id),
    name: str(r.name) ?? "Profissional",
    specialty: str(r.specialty),
    role: str(r.role),
    active: r.active !== false,
    linkedUserId: str(r.linked_user_id),
  };
}

function parseAudit(v: unknown): AuditEntry {
  const r = obj(v);
  return {
    id: num(r.id),
    createdAt: String(r.created_at ?? ""),
    action: String(r.action ?? ""),
    reason: str(r.reason),
    actorId: str(r.actor_id),
    actorName: str(r.actor_name) ?? "Sistema",
    targetUserId: str(r.target_user_id),
    targetName: str(r.target_name),
    roleId: str(r.role_id),
    roleName: str(r.role_name),
    dataBefore: r.data_before ?? null,
    dataAfter: r.data_after ?? null,
  };
}

// Leitura ------------------------------------------------------------------------------------------------

export async function fetchMyAccess(companyId: string | null): Promise<MyAccess> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return emptyAccess("legacy", "no-session");
  const { data, error } = await callRpc("get_my_access", {
    p_company_id: isUuidValue(companyId) ? companyId : null,
  });
  if (error) {
    if (isMissingFunction(error)) return emptyAccess("legacy", "migration");
    throw toAdminError(error);
  }
  return parseMyAccess(data);
}

export async function fetchAdminOverview(companyId: string): Promise<AdminOverview> {
  const r = obj(await rpc("admin_get_overview", { p_company_id: companyId }));
  const company = obj(r.company);
  const actor = obj(r.actor);
  return {
    company: { id: String(company.id ?? companyId), name: str(company.name) ?? "Clínica" },
    actor: {
      memberId: String(actor.member_id),
      userId: String(actor.user_id),
      roleId: str(actor.role_id),
      isOwner: actor.is_owner === true,
      permissions: strList(actor.permissions),
    },
    roles: list(r.roles).map(parseRole),
    members: list(r.members).map(parseMember),
    invitations: list(r.invitations).map(parseInvitation),
    professionals: list(r.professionals).map(parseProfessional),
  };
}

export type AuditFilters = {
  targetUserId?: string | null;
  action?: string | null;
  from?: string | null;
  to?: string | null;
};

/** Datas no formato AAAA-MM-DD, interpretadas no fuso local; "até" inclui o dia inteiro. */
function dayStart(value: string | null | undefined, addDays = 0): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + addDays);
  return date.toISOString();
}

export async function fetchAuditPage(
  companyId: string,
  filters: AuditFilters,
  beforeId: number | null,
  limit = 50,
): Promise<AuditPage> {
  const r = obj(
    await rpc("admin_list_audit", {
      p_company_id: companyId,
      p_target_user_id: filters.targetUserId || null,
      p_action: filters.action || null,
      p_from: dayStart(filters.from),
      p_to: dayStart(filters.to, 1),
      p_before_id: beforeId,
      p_limit: limit,
    }),
  );
  const next = r.next_before_id;
  return {
    entries: list(r.entries).map(parseAudit),
    nextBeforeId: typeof next === "number" ? next : next ? Number(next) : null,
  };
}

// Alterações ---------------------------------------------------------------------------------------------

export type MemberAccessInput = {
  memberId: string;
  version: number;
  roleId: string;
  extra: string[];
  revoked: string[];
  doctorId: string | null;
  agendaScope: AgendaScope;
  agendaProfessionalIds: string[];
  confirmSensitive?: boolean;
};

export async function updateMemberAccess(input: MemberAccessInput) {
  const r = obj(
    await rpc("admin_update_member", {
      p_member_id: input.memberId,
      p_version: input.version,
      p_role_id: input.roleId,
      p_extra_permissions: input.extra,
      p_revoked_permissions: input.revoked,
      p_doctor_id: input.doctorId,
      p_agenda_scope: input.agendaScope,
      p_agenda_professional_ids:
        input.agendaScope === "selected" ? input.agendaProfessionalIds : [],
      p_confirm_sensitive: input.confirmSensitive === true,
    }),
  );
  return { id: String(r.id), version: num(r.version, input.version + 1) };
}

export async function setMemberStatus(input: {
  memberId: string;
  version: number;
  status: "active" | "suspended" | "removed";
  reason?: string | null;
  roleId?: string | null;
}) {
  const r = obj(
    await rpc("admin_set_member_status", {
      p_member_id: input.memberId,
      p_version: input.version,
      p_status: input.status,
      p_reason: input.reason?.trim() || null,
      p_role_id: input.roleId ?? null,
    }),
  );
  return { id: String(r.id), version: num(r.version, input.version + 1) };
}

export async function transferOwnership(companyId: string, memberId: string, reason: string) {
  await rpc("admin_transfer_ownership", {
    p_company_id: companyId,
    p_member_id: memberId,
    p_reason: reason.trim(),
  });
}

export async function leaveCompany(companyId: string, reason?: string | null) {
  const r = obj(
    await rpc("leave_company", { p_company_id: companyId, p_reason: reason?.trim() || null }),
  );
  return { nextCompanyId: str(r.next_company_id) };
}

export async function saveRole(input: {
  companyId: string;
  roleId: string | null;
  version: number | null;
  name: string;
  description: string;
  permissions: string[];
  basedOn?: string | null;
}) {
  const r = obj(
    await rpc("admin_save_role", {
      p_company_id: input.companyId,
      p_role_id: input.roleId,
      p_version: input.version,
      p_name: input.name.trim(),
      p_description: input.description.trim(),
      p_permissions: input.permissions,
      p_based_on: input.basedOn ?? null,
    }),
  );
  return { id: String(r.id), affectedMembers: num(r.affected_members) };
}

export async function archiveRole(input: {
  roleId: string;
  version: number;
  replacementRoleId: string | null;
  reason?: string | null;
}) {
  await rpc("admin_archive_role", {
    p_role_id: input.roleId,
    p_version: input.version,
    p_replacement_role_id: input.replacementRoleId,
    p_reason: input.reason?.trim() || null,
  });
}

export async function createInvitation(input: {
  companyId: string;
  requestId: string;
  email: string;
  fullName: string | null;
  roleId: string;
  doctorId: string | null;
}) {
  const r = obj(
    await rpc("admin_create_invitation", {
      p_company_id: input.companyId,
      p_request_id: input.requestId,
      p_email: input.email,
      p_full_name: input.fullName,
      p_role_id: input.roleId,
      p_doctor_id: input.doctorId,
    }),
  );
  return { id: String(r.id), email: String(r.email ?? input.email), created: r.created !== false };
}

export async function touchInvitation(invitationId: string) {
  const r = obj(await rpc("admin_touch_invitation", { p_invitation_id: invitationId }));
  return { email: String(r.email ?? "") };
}

export async function cancelInvitation(invitationId: string, reason?: string | null) {
  await rpc("admin_cancel_invitation", {
    p_invitation_id: invitationId,
    p_reason: reason?.trim() || null,
  });
}

export async function acceptInvitation(invitationId: string) {
  const r = obj(await rpc("accept_company_invitation", { p_invitation_id: invitationId }));
  return { companyId: str(r.company_id) };
}

export async function declineInvitation(invitationId: string) {
  await rpc("decline_company_invitation", { p_invitation_id: invitationId });
}

export async function switchActiveCompany(userId: string, companyId: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ active_company_id: companyId })
    .eq("id", userId);
  if (error) throw toAdminError(error);
}

function friendlyEmailError(message: string): string {
  if (/rate limit|only request this after|too many/i.test(message)) {
    return "Limite de envio de e-mails atingido. Aguarde alguns minutos e use “Reenviar convite”.";
  }
  if (/signups? not allowed|signup is disabled/i.test(message)) {
    return "O cadastro de novos usuários está desativado no Supabase (Authentication > Providers > Email).";
  }
  if (/redirect/i.test(message)) {
    return "O endereço de retorno não está autorizado no Supabase (Authentication > URL Configuration).";
  }
  return message;
}

/**
 * Envia o link de acesso pelo Supabase Auth (cria a conta se ainda não existir).
 * O convite em si já está registrado no banco; o link apenas autentica o e-mail.
 */
export async function sendInvitationEmail(email: string, fullName?: string | null) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}/auth?modo=convite`,
      data: fullName ? { full_name: fullName } : undefined,
    },
  });
  if (error) throw new AdminError(friendlyEmailError(error.message), error.code, "auth.email");
}

export async function createDirectUser(input: {
  companyId: string;
  email: string;
  password: string;
  fullName: string;
  roleId: string;
  doctorId?: string | null;
  agendaScope?: AgendaScope;
  agendaProfessionalIds?: string[];
  confirmSensitive?: boolean;
}) {
  // 1. Tenta criar pelo Auth do Supabase com cliente isolado (não altera a sessão do admin)
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const authClient = createClient(
      "https://yqgafvblxxyksximctzk.supabase.co",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxZ2FmdmJseHh5a3N4aW1jdHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjA5MTYsImV4cCI6MjA5MjgzNjkxNn0.KsHS2h6eqfm9-suJ_yxpgSQLYw44bvqG4S6xUD-ZSX8",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    await authClient.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: { full_name: input.fullName.trim() },
      },
    });
  } catch {
    // Ignora erro de signup no client; a RPC no banco fará o cadastro ou atualização com senha
  }

  // 2. Chama a RPC segura do banco para ativar o usuário, aplicar perfil e confirmar credenciais
  const r = obj(
    await rpc("admin_create_direct_user", {
      p_company_id: input.companyId,
      p_email: input.email.trim(),
      p_password: input.password,
      p_full_name: input.fullName.trim(),
      p_role_id: input.roleId,
      p_doctor_id: input.doctorId || null,
      p_agenda_scope: input.agendaScope || "all",
      p_agenda_professional_ids: input.agendaProfessionalIds || [],
      p_confirm_sensitive: input.confirmSensitive ?? false,
    }),
  );

  return {
    userId: String(r.user_id),
    memberId: String(r.member_id),
    email: String(r.email),
    status: String(r.status),
  };
}

export async function setUserPassword(companyId: string, targetUserId: string, newPassword: string) {
  await rpc("admin_set_user_password", {
    p_company_id: companyId,
    p_target_user_id: targetUserId,
    p_new_password: newPassword,
  });
}


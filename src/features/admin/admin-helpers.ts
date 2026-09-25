import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import {
  adminErrorHint,
  fetchAdminOverview,
  type AdminMember,
  type AdminOverview,
  type AdminRole,
} from "./admin-api";
import { SYSTEM_ROLES, isSubset, type PermissionKey } from "./permissions";

export type ActorContext = {
  userId: string;
  memberId: string;
  roleId: string | null;
  isOwner: boolean;
  permissions: Set<string>;
  canViewUsers: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canViewAudit: boolean;
};

export function buildActor(overview: AdminOverview): ActorContext {
  const permissions = new Set(overview.actor.permissions);
  return {
    userId: overview.actor.userId,
    memberId: overview.actor.memberId,
    roleId: overview.actor.roleId,
    isOwner: overview.actor.isOwner,
    permissions,
    canViewUsers: permissions.has("users.view"),
    canManageUsers: permissions.has("users.manage"),
    canManageRoles: permissions.has("roles.manage"),
    canViewAudit: permissions.has("audit.view"),
  };
}

export function canGrantPermission(actor: ActorContext, key: PermissionKey | string) {
  return actor.isOwner || actor.permissions.has(key);
}

export function isOwnerRole(role: AdminRole | undefined | null) {
  return !!role && role.isSystem && role.key === "owner";
}

/** Mesmas regras das RPCs; null quando a edição é permitida. */
export function memberBlockReason(
  actor: ActorContext,
  member: AdminMember,
  rolesById: Map<string, AdminRole>,
): string | null {
  if (member.isSelf) return "Você não pode alterar o próprio acesso.";
  if (!actor.canManageUsers) return "Seu perfil permite apenas consultar os usuários.";
  if (isOwnerRole(rolesById.get(member.roleId ?? "")) && !actor.isOwner) {
    return "Apenas proprietários podem gerenciar proprietários.";
  }
  if (!actor.isOwner && !isSubset(member.effective, actor.permissions)) {
    return "Este usuário tem permissões que você não possui.";
  }
  return null;
}

export function roleDisplayName(role: Pick<AdminRole, "key" | "name" | "isSystem"> | undefined) {
  if (!role) return "Sem perfil";
  if (role.isSystem) return SYSTEM_ROLES.find((r) => r.key === role.key)?.name ?? role.name;
  return role.name;
}

export function useAdminOverview(companyId: string | null) {
  return useQuery({
    queryKey: qk.admin.overview(companyId),
    enabled: !!companyId,
    queryFn: () => fetchAdminOverview(companyId as string),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: (count, error) => {
      const hint = adminErrorHint(error);
      return hint !== "admin.forbidden" && hint !== "admin.migration_pending" && count < 1;
    },
  });
}

export function useAdminRefresh(companyId: string | null) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.admin.all(companyId) }),
      queryClient.invalidateQueries({ queryKey: qk.access.all() }),
      queryClient.invalidateQueries({ queryKey: qk.team.members(companyId) }),
    ]);
  };
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return (
    letters
      .map((p) => p.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2) || "US"
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatRelative(value: string | null | undefined) {
  if (!value) return "Nunca acessou";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Há ${days} ${days === 1 ? "dia" : "dias"}`;
  return date.toLocaleDateString("pt-BR");
}

export function sameSet(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useActiveCompany } from "@/hooks/use-active-company";
import { qk } from "@/lib/query-keys";
import { emptyAccess, fetchMyAccess, type MyAccess } from "@/features/admin/admin-api";
import { ADMIN_PERMISSIONS, isUuidValue, type PermissionKey } from "@/features/admin/permissions";

const ADMIN_ONLY = new Set<string>(ADMIN_PERMISSIONS);

/**
 * Acesso do usuário na clínica ativa (consulta get_my_access).
 *
 * - "legacy": migração ainda não aplicada ou sessão sem Supabase. A interface
 *   mantém o comportamento anterior (tudo visível), exceto a Administração.
 * - "blocked": cadastro pendente, suspenso, removido ou sem clínica.
 * - Falhas temporárias preservam o último resultado; sem resultado, a interface
 *   não bloqueia (o banco continua aplicando as regras).
 */
export function usePermissions() {
  const { user } = useAuth();
  const { companyId } = useActiveCompany();
  const requested = isUuidValue(companyId) ? companyId : null;

  const query = useQuery({
    queryKey: qk.access.me(user?.id ?? null, requested),
    enabled: !!user?.id,
    queryFn: () => fetchMyAccess(requested),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // Mantém o último resultado durante a troca de clínica, nunca entre usuários diferentes.
    placeholderData: (previous) => (previous?.userId === user?.id ? previous : undefined),
    retry: 1,
  });

  const access: MyAccess = useMemo(() => {
    if (query.data) return query.data;
    if (query.isError) return emptyAccess("legacy", "unavailable");
    return emptyAccess("loading");
  }, [query.data, query.isError]);

  const can = useCallback(
    (key: PermissionKey) => {
      if (access.mode === "legacy") return !ADMIN_ONLY.has(key);
      if (access.mode !== "active") return false;
      return access.permissions.has(key);
    },
    [access],
  );

  const canAny = useCallback((keys: readonly PermissionKey[]) => keys.some(can), [can]);

  return {
    access,
    can,
    canAny,
    isLoading: access.mode === "loading" && !!user?.id,
    refetch: query.refetch,
  };
}

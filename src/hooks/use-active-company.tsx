import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useMemo, useRef } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { qk, staleTimes } from "@/lib/query-keys";
import { getStoredUser } from "@/services/api";

export function useActiveCompany() {
  const { user } = useAuth();
  const context = useRouteContext({
    strict: false,
    select: (s: Record<string, unknown> | undefined) => ({
      companyId: s?.["companyId"] as string | undefined,
      fullName: s?.["fullName"] as string | undefined,
    }),
  });

  const storedUser = getStoredUser();
  const defaultCompanyId = storedUser?.active_company_id || "comp_medcore_default";

  const { data, isLoading, isFetching } = useQuery({
    queryKey: qk.activeCompany(user?.id),
    staleTime: staleTimes.slow,
    gcTime: 30 * 60_000,
    placeholderData: { companyId: defaultCompanyId, fullName: storedUser?.full_name || null, needsPersist: false },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !!user?.id && !context?.companyId,
    queryFn: async () => {
      if (!user?.id) return { companyId: defaultCompanyId, fullName: null, needsPersist: false };

      if (storedUser?.active_company_id) {
        return {
          companyId: storedUser.active_company_id,
          fullName: storedUser.full_name ?? null,
          needsPersist: false,
        };
      }

      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("active_company_id, full_name")
          .eq("id", user.id)
          .maybeSingle();

        const { data: memberships } = await supabase
          .from("company_members")
          .select("company_id")
          .eq("user_id", user.id);

        const validCompanyIds = (memberships ?? []).map((m) => m.company_id);
        
        let companyId: string | null = null;
        let needsPersist = false;

        if (profile?.active_company_id && validCompanyIds.includes(profile.active_company_id)) {
          companyId = profile.active_company_id;
        } else if (validCompanyIds.length > 0) {
          companyId = validCompanyIds[0];
          needsPersist = true;
        } else {
          companyId = defaultCompanyId;
        }

        return {
          companyId,
          fullName: profile?.full_name ?? null,
          needsPersist,
        };
      } catch {
        return {
          companyId: defaultCompanyId,
          fullName: storedUser?.full_name ?? null,
          needsPersist: false,
        };
      }
    },
  });

  const persistedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || !data?.needsPersist || !data.companyId) return;
    if (persistedRef.current === data.companyId) return;
    persistedRef.current = data.companyId;
    void supabase.from("profiles").update({ active_company_id: data.companyId }).eq("id", user.id);
  }, [user?.id, data?.needsPersist, data?.companyId]);

  return useMemo(() => {
    const companyId = context?.companyId ?? data?.companyId ?? defaultCompanyId;
    const fullName = context?.fullName ?? data?.fullName ?? storedUser?.full_name ?? null;

    return {
      companyId,
      fullName,
      isLoading: !companyId && (isLoading || isFetching),
    };
  }, [context, data, isLoading, isFetching, defaultCompanyId, storedUser]);
}

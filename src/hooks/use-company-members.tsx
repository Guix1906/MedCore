import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { qk, staleTimes } from "@/lib/query-keys";

export type CompanyMember = {
  user_id: string;
  full_name: string | null;
  role: string | null;
};

export function useCompanyMembers(companyId: string | null) {
  const { data = [] } = useQuery({
    queryKey: qk.team.members(companyId),
    enabled: !!companyId,
    staleTime: staleTimes.standard,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("company_members")
        .select("user_id")
        .eq("company_id", companyId!);
      if (error) throw error;
      const ids = (rows ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [] as CompanyMember[];
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").in("id", ids),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("company_id", companyId!)
          .in("user_id", ids),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      const roleRank: Record<string, number> = { owner: 3, admin: 2, lawyer: 1, member: 0 };
      const roleByUser = new Map<string, string>();
      (roles ?? []).forEach((r: { user_id: string; role: string }) => {
        const prev = roleByUser.get(r.user_id);
        if (!prev || (roleRank[r.role] ?? -1) > (roleRank[prev] ?? -1)) {
          roleByUser.set(r.user_id, r.role);
        }
      });
      return (profiles ?? []).map((p) => ({
        user_id: p.id,
        full_name: p.full_name,
        role: roleByUser.get(p.id) ?? null,
      })) as CompanyMember[];
    },
  });
  const byId = useMemo(() => {
    const map = new Map<string, string>();
    data.forEach((m) => map.set(m.user_id, m.full_name ?? "Membro"));
    return map;
  }, [data]);
  return { members: data, byId };
}

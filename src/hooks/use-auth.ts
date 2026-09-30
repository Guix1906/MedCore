import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { removeStoredToken } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";
import { purgeLocalClinicalData } from "@/lib/legacy-local-data";
import { invalidateAuthRouteCache } from "@/routes/_authenticated/route";
import { qk } from "@/lib/query-keys";

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  doctor_id: string | null;
};

export function useAuth() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      invalidateAuthRouteCache();
      if (session) {
        queryClient.setQueryData(["auth", "session"], session);
      } else if (event === "SIGNED_OUT") {
        queryClient.setQueryData(["auth", "session"], null);
      }
      void queryClient.invalidateQueries({ queryKey: ["auth"] });
      void queryClient.invalidateQueries({ queryKey: qk.access.all() });
      void queryClient.invalidateQueries({ queryKey: ["active-company"] });
      void queryClient.invalidateQueries({ queryKey: ["company-members"] });
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      try {
        const { data } = await supabase.auth.getSession();
        return data.session;
      } catch {
        return null;
      }
    },
    staleTime: 15_000,
    gcTime: 60 * 60_000,
  });

  const session = sessionQuery.data ?? null;
  const user = session?.user ?? null;

  const profileQuery = useQuery({
    queryKey: ["auth", "profile", user?.id],
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, phone, doctor_id")
          .eq("id", user!.id)
          .maybeSingle();
        return data as Profile | null;
      } catch {
        return null;
      }
    },
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  return {
    session,
    user,
    profile: profileQuery.data ?? null,
    loading: sessionQuery.isLoading,
    isAuthenticated: !!session,
  };
}

export async function signOut() {
  removeStoredToken();
  purgeLocalClinicalData();
  await supabase.auth.signOut();
}

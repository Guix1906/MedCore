import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authService, getStoredToken, getStoredUser, type UserProfile } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  doctor_id: string | null;
};

export function useAuth() {
  const queryClient = useQueryClient();

  // 1. Sessão rápida (PHP ou Supabase)
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      // Prioridade 1: Token PHP em memória / storage
      const token = getStoredToken();
      const phpUser = getStoredUser();
      if (token && phpUser) {
        return {
          access_token: token,
          user: {
            id: phpUser.id,
            email: phpUser.email,
            user_metadata: { full_name: phpUser.full_name, avatar_url: phpUser.avatar_url },
          },
        };
      }

      // Prioridade 2: Fallback Supabase
      try {
        const { data } = await supabase.auth.getSession();
        return data.session;
      } catch {
        return null;
      }
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });

  const session = sessionQuery.data ?? null;
  const user = session?.user ?? null;

  const profileQuery = useQuery({
    queryKey: ["auth", "profile", user?.id],
    queryFn: async () => {
      const phpUser = getStoredUser();
      if (phpUser && phpUser.id === user?.id) {
        return {
          id: phpUser.id,
          full_name: phpUser.full_name ?? null,
          avatar_url: phpUser.avatar_url ?? null,
          phone: phpUser.phone ?? null,
          doctor_id: null,
        } as Profile;
      }

      // Consulta Supabase como fallback
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
  await authService.signOut();
  try {
    await supabase.auth.signOut();
  } catch {}
}

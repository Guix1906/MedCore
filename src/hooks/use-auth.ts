import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  doctor_id: string | null;
};

export function useAuth() {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });

  const session = sessionQuery.data ?? null;
  const user = session?.user ?? null;

  const profileQuery = useQuery({
    queryKey: ["auth", "profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, phone, doctor_id")
        .eq("id", user!.id)
        .maybeSingle();
      return data as Profile | null;
    },
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (sess) {
        queryClient.setQueryData(["auth", "session"], sess);
      } else {
        queryClient.clear();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return {
    session,
    user,
    profile: profileQuery.data ?? null,
    loading: sessionQuery.isLoading,
    isAuthenticated: !!session,
  };
}

export async function signOut() {
  await supabase.auth.signOut();
}

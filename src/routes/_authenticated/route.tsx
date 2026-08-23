import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getStoredToken, getStoredUser } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // 1. Fast path ultra-rápido: Token do backend PHP em memória/localStorage (0ms de latência)
    const token = getStoredToken();
    const phpUser = getStoredUser();

    if (token && phpUser) {
      return { user: phpUser };
    }

    // 2. Fallback Supabase
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      let user = sessionData.session?.user;

      if (!user) {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) throw redirect({ to: "/auth" });
        user = data.user;
      }

      return { user };
    } catch (e: any) {
      if (e?.isRedirect) throw e;
      if (!token) throw redirect({ to: "/auth" });
      return { user: { id: "usr_guest", email: "user@medcore.com" } };
    }
  },
  component: () => <Outlet />,
});

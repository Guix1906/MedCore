import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getStoredToken, removeStoredToken, authService } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // 1. Validação do Token do backend PHP contra o servidor
    const token = getStoredToken();
    if (token) {
      try {
        const me = await authService.getMe();
        if (me && me.user) {
          return { user: me.user };
        }
      } catch (err) {
        console.warn("Sessão JWT inválida ou expirada:", err);
        removeStoredToken();
      }
    }

    // 2. Validação instantânea da sessão do Supabase em memória/cache
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        return { user: sessionData.session.user };
      }
      const { data, error } = await supabase.auth.getUser();
      if (!error && data?.user) {
        return { user: data.user };
      }
    } catch (e: any) {
      if (e?.isRedirect) throw e;
    }

    // 3. Bloqueio absoluto sem bypass: redirecionar para login
    throw redirect({
      to: "/auth",
      search: {
        redirect: location?.pathname || "/dashboard",
      },
    });
  },
  component: () => <Outlet />,
});

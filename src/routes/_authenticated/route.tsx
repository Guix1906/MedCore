import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getStoredToken, removeStoredToken, authService } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";

let cachedUser: any = null;
let cachedAt = 0;
const AUTH_CACHE_DURATION = 10 * 60 * 1000;

export function invalidateAuthRouteCache() {
  cachedUser = null;
  cachedAt = 0;
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
      invalidateAuthRouteCache();
    }
  });
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // 0. Cache em memória ultra-rápido (0ms): se já validado recentemente, libera a navegação imediatamente
    if (cachedUser && Date.now() - cachedAt < AUTH_CACHE_DURATION) {
      return { user: cachedUser };
    }

    // 1. Validação do Token do backend PHP em memória/storage se configurado
    const token = getStoredToken();
    if (token) {
      try {
        const me = await authService.getMe();
        if (me && me.user) {
          cachedUser = me.user;
          cachedAt = Date.now();
          return { user: me.user };
        }
      } catch (err) {
        removeStoredToken();
      }
    }

    // 2. Validação instantânea da sessão do Supabase em memória/cache local (0ms)
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        cachedUser = sessionData.session.user;
        cachedAt = Date.now();
        return { user: sessionData.session.user };
      }
      const { data, error } = await supabase.auth.getUser();
      if (!error && data?.user) {
        cachedUser = data.user;
        cachedAt = Date.now();
        return { user: data.user };
      }
    } catch (e: any) {
      if (e?.isRedirect) throw e;
    }

    cachedUser = null;
    cachedAt = 0;

    // 3. Redirecionar para login caso não haja sessão
    throw redirect({
      to: "/auth",
      search: {
        redirect: location?.href || location?.pathname || "/dashboard",
      },
    });
  },
  component: () => <Outlet />,
});

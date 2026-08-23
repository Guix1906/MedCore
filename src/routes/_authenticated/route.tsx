import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Fast path: cached session in memory/storage (0ms network latency on page switch)
    const { data: sessionData } = await supabase.auth.getSession();
    let user = sessionData.session?.user;

    if (!user) {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw redirect({ to: "/auth" });
      user = data.user;
    }

    return { user };
  },
  component: () => <Outlet />,
});


import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  ScriptOnce,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import SmoothScroll from "@/components/motion/SmoothScroll";
import { useTheme } from "@/hooks/use-theme";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { autoWipeLegacyTestDataIfNeeded } from "@/lib/wipe-system";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { getSiteOrigin } from "@/services/site-origin";

function NotFoundComponent() {
  return (
    <div className="app-canvas flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-semibold tracking-tight text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou mudou de endereço.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="app-canvas flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Não foi possível carregar esta página
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tente carregar novamente ou volte ao início do sistema.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-full border border-input bg-card px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    try {
      const origin = await getSiteOrigin();
      return { origin };
    } catch {
      return { origin: "" };
    }
  },
  head: ({ loaderData }) => {
    const origin =
      loaderData?.origin ||
      (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "") ||
      (typeof process !== "undefined" && process.env?.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "") ||
      (typeof process !== "undefined" && process.env?.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "") ||
      "https://meedcore.vercel.app";

    const ogImage = `${origin.replace(/\/$/, "")}/og-image.png`;

    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Dr. Jonatas Bandeira — Nutrologia" },
        {
          name: "description",
          content:
            "Sistema de gestão clínica, agendamentos e prontuário médico MedCore • Dr. Jonatas Bandeira - Nutrologia.",
        },
        { property: "og:site_name", content: "Dr. Jonatas Bandeira — Nutrologia" },
        { property: "og:title", content: "Dr. Jonatas Bandeira — Nutrologia" },
        {
          property: "og:description",
          content:
            "Sistema de gestão clínica, agendamentos e prontuário médico MedCore • Dr. Jonatas Bandeira - Nutrologia.",
        },
        { property: "og:type", content: "website" },
        { property: "og:image", content: ogImage },
        { property: "og:image:secure_url", content: ogImage },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: "Logo Dr. Jonatas Bandeira — Nutrologia" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "Dr. Jonatas Bandeira — Nutrologia" },
        {
          name: "twitter:description",
          content:
            "Sistema de gestão clínica, agendamentos e prontuário médico MedCore • Dr. Jonatas Bandeira - Nutrologia.",
        },
        { name: "twitter:image", content: ogImage },
      ],
      links: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          // Inter é o fallback fora das plataformas Apple, que usam a fonte do sistema.
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap",
        },
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "image_src", href: ogImage },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // O script de tema altera a classe do <html> antes da hidratação.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <ScriptOnce>{THEME_INIT_SCRIPT}</ScriptOnce>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useTheme();

  useEffect(() => {
    autoWipeLegacyTestDataIfNeeded();
  }, []);

  // Stale deploy: a hashed route chunk from an old build no longer exists.
  // Reload once (guarded) so the browser picks up the new asset manifest.
  useEffect(() => {
    const KEY = "chunk-reload-at";
    const recover = () => {
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < 10_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    };
    const onPreloadError = () => recover();
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = String(e.reason?.message ?? e.reason ?? "");
      if (/dynamically imported module|Importing a module script failed/i.test(msg)) recover();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <SmoothScroll />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}

// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      port: 8080,
      strictPort: true,
      warmup: {
        clientFiles: [
          "./src/routes/__root.tsx",
          "./src/routes/_authenticated/dashboard.tsx",
          "./src/routes/_authenticated/agenda.tsx",
          "./src/routes/_authenticated/pacientes.tsx",
          "./src/routes/_authenticated/acompanhamentos.tsx",
          "./src/routes/_authenticated/prontuario.tsx",
          "./src/routes/_authenticated/financeiro.tsx",
          "./src/routes/_authenticated/estoque.tsx",
          "./src/routes/_authenticated/relatorios.tsx",
          "./src/routes/_authenticated/configuracoes.tsx",
          "./src/routes/_authenticated/visao-geral.tsx",
          "./src/components/AppShell.tsx",
          "./src/components/agenda/novo-agendamento-dialog.tsx",
        ],
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "@tanstack/react-router",
        "@tanstack/react-query",
        "lucide-react",
        "recharts",
        "apexcharts",
        "react-apexcharts",
        "framer-motion",
        "date-fns",
        "clsx",
        "tailwind-merge",
        "sonner",
        "lenis",
        "@supabase/supabase-js",
        "@formkit/auto-animate",
        "@radix-ui/react-dialog",
        "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-select",
        "@radix-ui/react-tabs",
        "@radix-ui/react-popover",
        "@radix-ui/react-tooltip",
        "@radix-ui/react-accordion",
        "@radix-ui/react-alert-dialog",
        "@radix-ui/react-avatar",
        "@radix-ui/react-checkbox",
        "@radix-ui/react-radio-group",
        "@radix-ui/react-scroll-area",
        "@radix-ui/react-separator",
        "@radix-ui/react-slider",
        "@radix-ui/react-switch"
      ],
    },
  },
});

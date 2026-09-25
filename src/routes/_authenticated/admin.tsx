import { useCallback } from "react";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import AppShell from "@/components/AppShell";
import AdminPage from "@/features/admin/AdminPage";
import { resolveAdminTab, type AdminTab } from "@/features/admin/permissions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administração • MedCore" },
      { name: "description", content: "Usuários, perfis de acesso e permissões da clínica." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: SearchSchemaInput & { aba?: unknown }) => ({
    aba: resolveAdminTab(search.aba),
  }),
  component: AdminRoute,
});

function AdminRoute() {
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const changeTab = useCallback(
    (tab: AdminTab) => {
      void navigate({ search: { aba: tab }, replace: true });
    },
    [navigate],
  );
  return (
    <AppShell title="Administração">
      <AdminPage tab={aba} onTabChange={changeTab} />
    </AppShell>
  );
}

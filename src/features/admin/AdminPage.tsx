import { useEffect, useMemo } from "react";
import type { ElementType } from "react";
import { Database, History, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui-app";
import { usePermissions } from "@/hooks/use-permissions";
import { adminErrorHint, toAdminError } from "./admin-api";
import { buildActor, useAdminOverview, useAdminRefresh } from "./admin-helpers";
import { AuditTab } from "./AuditTab";
import { RolesTab } from "./RolesTab";
import { UsersTab } from "./UsersTab";
import type { AdminTab } from "./permissions";

const TABS: { id: AdminTab; label: string; icon: ElementType }[] = [
  { id: "usuarios", label: "Usuários", icon: Users },
  { id: "perfis", label: "Perfis e permissões", icon: ShieldCheck },
  { id: "auditoria", label: "Auditoria", icon: History },
];

export default function AdminPage({
  tab,
  onTabChange,
}: {
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}) {
  const { access } = usePermissions();
  const companyId = access.mode === "active" ? access.companyId : null;
  const overview = useAdminOverview(companyId);
  const refresh = useAdminRefresh(companyId);
  const actor = useMemo(() => (overview.data ? buildActor(overview.data) : null), [overview.data]);

  const available = TABS.filter((item) => {
    if (!actor) return item.id === "usuarios";
    if (item.id === "usuarios") return actor.canViewUsers;
    if (item.id === "perfis") return actor.canViewUsers || actor.canManageRoles;
    return actor.canViewAudit;
  });
  const current = available.some((item) => item.id === tab)
    ? tab
    : (available[0]?.id ?? "usuarios");

  useEffect(() => {
    if (actor && current !== tab) onTabChange(current);
  }, [actor, current, tab, onTabChange]);

  const migrationPending =
    (access.mode === "legacy" && access.legacyReason === "migration") ||
    adminErrorHint(overview.error) === "admin.migration_pending";

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Administração
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Usuários e permissões
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {overview.data?.company.name ?? access.companyName ?? "Clínica"} · quem acessa o MedCore
            e o que cada pessoa pode fazer.
          </p>
        </div>
        {overview.data && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={overview.isFetching}
          >
            <RefreshCw
              className={overview.isFetching ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            Atualizar
          </Button>
        )}
      </header>

      {migrationPending ? (
        <MigrationPending />
      ) : access.mode === "legacy" ? (
        <Notice title="Não foi possível verificar suas permissões">
          {access.legacyReason === "no-session"
            ? "Entre novamente com seu e-mail e senha para usar a administração."
            : "Verifique sua conexão e tente novamente em instantes."}
        </Notice>
      ) : access.mode === "loading" || overview.isPending ? (
        <SkeletonTable rows={6} columns={5} />
      ) : overview.error ? (
        <Notice title="Não foi possível carregar a administração">
          {toAdminError(overview.error).message}{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => void overview.refetch()}
          >
            Tentar novamente
          </button>
        </Notice>
      ) : overview.data && actor ? (
        <>
          <nav aria-label="Seções da administração" className="border-b border-slate-200">
            <label className="block pb-3 text-sm md:hidden">
              Seção
              <select
                className="mt-1 w-full rounded-lg border bg-white p-2"
                value={current}
                onChange={(event) => onTabChange(event.target.value as AdminTab)}
              >
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="hidden gap-1 overflow-x-auto md:flex">
              {available.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-current={id === current ? "page" : undefined}
                  onClick={() => onTabChange(id)}
                  className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    id === current
                      ? "border-primary text-primary"
                      : "border-transparent text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </nav>

          {current === "usuarios" && actor.canViewUsers && (
            <UsersTab overview={overview.data} actor={actor} onRefresh={refresh} />
          )}
          {current === "perfis" && (
            <RolesTab overview={overview.data} actor={actor} onRefresh={refresh} />
          )}
          {current === "auditoria" && actor.canViewAudit && <AuditTab overview={overview.data} />}
        </>
      ) : null}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function MigrationPending() {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5"
      aria-labelledby="migration-title"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
          <Database size={20} aria-hidden="true" />
        </span>
        <div className="space-y-2 text-sm text-slate-700">
          <h2 id="migration-title" className="text-base font-semibold text-slate-900">
            Migração do banco pendente
          </h2>
          <p>
            A tela está publicada, mas o banco ainda não tem a estrutura de usuários e permissões.
            Até a migração ser aplicada, o sistema continua funcionando como antes, sem restrições
            por perfil.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Faça backup e aplique{" "}
              <code className="rounded bg-slate-100 px-1">
                supabase/migrations/20260925120000_user_permissions.sql
              </code>{" "}
              em homologação e depois em produção.
            </li>
            <li>Confira no aviso final da migração quantos acessos ficaram ativos e pendentes.</li>
            <li>
              Recarregue esta página: proprietários e administradores passam a ver a gestão
              completa.
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

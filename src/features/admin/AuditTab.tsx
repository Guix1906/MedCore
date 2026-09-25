import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, SkeletonRows } from "@/components/ui-app";
import { exportFinanceCsv } from "@/features/finance/export-csv";
import { qk } from "@/lib/query-keys";
import { fetchAuditPage, toAdminError, type AdminOverview, type AuditEntry } from "./admin-api";
import { formatDateTime } from "./admin-helpers";
import { AUDIT_ACTION_GROUPS, AUDIT_ACTION_LABEL, describeAuditChange } from "./permissions";

const ALL = "__all__";

export function AuditTab({ overview }: { overview: AdminOverview }) {
  const [target, setTarget] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters = useMemo(
    () => ({
      targetUserId: target === ALL ? null : target,
      action: action === ALL ? null : action,
      from: from || null,
      to: to || null,
    }),
    [target, action, from, to],
  );

  const query = useInfiniteQuery({
    queryKey: qk.admin.audit(overview.company.id, filters),
    queryFn: ({ pageParam }) => fetchAuditPage(overview.company.id, filters, pageParam, 50),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBeforeId,
    staleTime: 15_000,
  });

  const entries: AuditEntry[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.entries) ?? [],
    [query.data],
  );

  const exportCsv = () => {
    exportFinanceCsv(`auditoria-acessos-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Data", "Ação", "Autor", "Alvo", "Perfil", "Detalhes", "Motivo"],
      ...entries.map((entry) => [
        formatDateTime(entry.createdAt),
        AUDIT_ACTION_LABEL[entry.action] ?? entry.action,
        entry.actorName,
        entry.targetName ?? "",
        entry.roleName ?? "",
        describeAuditChange(entry.dataBefore, entry.dataAfter).join(" | "),
        entry.reason ?? "",
      ]),
    ]);
  };

  const people = overview.members
    .map((m) => ({ id: m.userId, name: m.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1fr_1fr_auto_auto_auto] md:items-end">
        <div className="space-y-1">
          <Label htmlFor="audit-target">Usuário</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="audit-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-action">Tipo de alteração</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id="audit-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {AUDIT_ACTION_GROUPS.map((group) => (
                <SelectItem key={group.value} value={group.value}>
                  {group.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-from">De</Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">Até</Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void query.refetch()}
            aria-label="Atualizar auditoria"
            disabled={query.isFetching}
          >
            <RefreshCw
              className={query.isFetching ? "animate-spin" : undefined}
              aria-hidden="true"
            />
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={entries.length === 0}>
            <Download aria-hidden="true" />
            CSV
          </Button>
        </div>
      </div>

      {query.isPending ? (
        <SkeletonRows count={6} className="rounded-2xl border border-slate-200 bg-white" />
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {toAdminError(query.error).message}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nenhum registro encontrado"
          description="Ajuste os filtros para ver outras alterações."
          className="bg-white"
        />
      ) : (
        <ol className="space-y-2" aria-label="Registros de auditoria">
          {entries.map((entry) => {
            const lines = describeAuditChange(entry.dataBefore, entry.dataAfter);
            return (
              <li key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13.5px] font-semibold text-slate-900">
                    {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                    {entry.targetName && (
                      <span className="font-normal text-slate-600"> · {entry.targetName}</span>
                    )}
                    {!entry.targetName && entry.roleName && (
                      <span className="font-normal text-slate-600"> · {entry.roleName}</span>
                    )}
                  </p>
                  <p className="text-[12px] text-slate-500">
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time> · por{" "}
                    {entry.actorName}
                  </p>
                </div>
                {lines.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-slate-600">
                    {lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {entry.reason && (
                  <p className="mt-1.5 text-[12.5px] text-slate-500">Motivo: {entry.reason}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      )}
    </div>
  );
}

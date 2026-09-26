import { Card, CardHeader, KPICard } from "@/components/ds/Card";
import { Chart } from "@/components/ds/Chart";
import { EmptyState, PageHeader, SkeletonKpiGrid } from "@/components/ui-app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agendaVisibleIds, filterByAgendaScope } from "@/features/admin/permissions";
import { useAgendaData } from "@/features/agenda/hooks/use-agenda-data";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useAuth } from "@/hooks/use-auth";
import { useCompanyMembers } from "@/hooks/use-company-members";
import { usePermissions } from "@/hooks/use-permissions";
import { toLocalDateInputValue } from "@/lib/date-utils";
import { Link } from "@tanstack/react-router";
import { BarChart3, CalendarCheck, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { summarizeAgenda, type OverviewPeriod } from "../overview-utils";
import { SegmentedControl } from "@/components/ui-app/SegmentedControl";

function statusBarClass(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.startsWith("conclu")) return "bg-success";
  if (normalized.startsWith("cancel")) return "bg-destructive";
  if (normalized.startsWith("confirm")) return "bg-info";
  if (normalized.includes("falt") || normalized.includes("não compareceu")) return "bg-warning";
  return "bg-primary/70";
}

export function DashboardPage() {
  const { user } = useAuth();
  const { companyId } = useActiveCompany();
  const { byId } = useCompanyMembers(companyId);
  const { access } = usePermissions();
  const { activities, isLoading, error, refresh } = useAgendaData(companyId, user?.id);
  const [date, setDate] = useState(() => new Date());
  const [period, setPeriod] = useState<OverviewPeriod>("mes");
  const [professional, setProfessional] = useState("todos");
  const [status, setStatus] = useState("todos");
  const visible = useMemo(
    () =>
      access.mode === "active"
        ? filterByAgendaScope(
            activities,
            agendaVisibleIds({
              scope: access.agendaScope,
              ownIds: [user?.id, access.doctorId],
              selectedIds: access.agendaProfessionalIds,
            }),
          )
        : activities,
    [activities, access, user?.id],
  );
  const data = useMemo(
    () => summarizeAgenda(visible, date, period, professional, status),
    [visible, date, period, professional, status],
  );
  const rangeLabel = `${data.start.toLocaleDateString("pt-BR")} – ${data.end.toLocaleDateString("pt-BR")}`;
  const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm";

  return (
    <div className="page-container space-y-5">
      <PageHeader
        title="Indicadores da agenda"
        description="Agendamentos registrados, com o mesmo escopo de acesso da Agenda."
        icon={BarChart3}
        actions={
          <Button asChild variant="outline">
            <Link to="/agenda">Abrir agenda</Link>
          </Button>
        }
      />
      <section
        aria-label="Filtros dos indicadores"
        className="rounded-xl border border-border bg-card p-4 shadow-xs"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5 text-sm font-medium">
            <span id="overview-period-label">Período</span>
            <SegmentedControl
              aria-label="Período"
              value={period}
              onChange={setPeriod}
              className="flex h-10 w-full"
              options={[
                { value: "semana", label: "Semana" },
                { value: "mes", label: "Mês" },
                { value: "ano", label: "Ano" },
              ]}
            />
          </div>
          <label className="space-y-1.5 text-sm font-medium">
            <span>Data de referência</span>
            <Input
              type="date"
              value={toLocalDateInputValue(date)}
              onChange={(event) => {
                if (event.target.value) {
                  const [year, month, day] = event.target.value.split("-").map(Number);
                  setDate(new Date(year, month - 1, day));
                }
              }}
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            <span>Profissional</span>
            <select
              value={professional}
              onChange={(event) => setProfessional(event.target.value)}
              className={selectClass}
            >
              <option value="todos">Todos os profissionais</option>
              {professional !== "todos" && !data.availableProfessionals.includes(professional) && (
                <option value={professional}>
                  {byId.get(professional) ?? "Profissional selecionado"}
                </option>
              )}
              {data.availableProfessionals.map((id) => (
                <option key={id} value={id}>
                  {byId.get(id) ?? "Profissional sem nome"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={selectClass}
            >
              <option value="todos">Todos os status</option>
              {status !== "todos" && !data.availableStatuses.includes(status) && (
                <option value={status}>{status}</option>
              )}
              {data.availableStatuses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-3">
          <p className="text-sm text-muted-foreground">
            Período exibido: <span className="font-medium text-foreground">{rangeLabel}</span>
          </p>
          {(professional !== "todos" || status !== "todos") && (
            <button
              type="button"
              onClick={() => {
                setProfessional("todos");
                setStatus("todos");
              }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Limpar profissional e status
            </button>
          )}
        </div>
      </section>
      {error ? (
        <div role="alert">
          <EmptyState
            title="Indicadores indisponíveis"
            description="Não foi possível atualizar a agenda. Nenhum número de exemplo é utilizado."
            action={
              <Button variant="outline" onClick={() => void refresh()}>
                Tentar novamente
              </Button>
            }
          />
        </div>
      ) : isLoading ? (
        <SkeletonKpiGrid count={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KPICard
              label="Agendamentos no período"
              value={data.total}
              icon={<CalendarCheck size={18} />}
              hint="Após os filtros selecionados"
            />
            <KPICard
              label="Confirmados"
              value={data.statusCounts.get("Confirmado") ?? 0}
              icon={<Clock size={18} />}
              hint="Confirmação registrada"
            />
            <KPICard
              label="Concluídos"
              value={data.statusCounts.get("Concluído") ?? 0}
              icon={<CheckCircle2 size={18} />}
              accent="success"
              hint="Status informado na agenda"
            />
            <KPICard
              label="Cancelados"
              value={data.statusCounts.get("Cancelado") ?? 0}
              icon={<XCircle size={18} />}
              accent="danger"
              hint="Cancelamento registrado"
            />
          </div>
          {!data.total ? (
            <EmptyState
              title="Sem agendamentos neste recorte"
              description="Escolha outro período ou ajuste os filtros. Tarefas, prazos e feriados não entram nestes indicadores."
              illustration={<CalendarCheck size={24} />}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                  <CardHeader
                    title={period === "ano" ? "Agendamentos por mês" : "Agendamentos por dia"}
                    subtitle={rangeLabel}
                  />
                  <Chart
                    type="bar"
                    height={280}
                    series={[
                      { name: "Agendamentos", data: data.buckets.map((bucket) => bucket.count) },
                    ]}
                    options={{
                      xaxis: {
                        categories: data.buckets.map((bucket) => bucket.label),
                        tickAmount: Math.min(data.buckets.length, 10),
                      },
                      yaxis: {
                        min: 0,
                        forceNiceScale: true,
                        labels: { formatter: (value) => String(Math.round(value)) },
                      },
                      plotOptions: { bar: { borderRadius: 4, columnWidth: "45%" } },
                    }}
                  />
                </Card>
                <Card>
                  <CardHeader
                    title="Situação dos agendamentos"
                    subtitle="Participação no total filtrado"
                  />
                  <div className="space-y-5">
                    {Array.from(data.statusCounts).map(([label, count]) => (
                      <div key={label}>
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <span>{label}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {count} · {Math.round((count / data.total) * 100)}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${statusBarClass(label)}`}
                            style={{ width: `${(count / data.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader
                    title="Distribuição por dia da semana"
                    subtitle="Quantidade de agendamentos, não taxa de ocupação"
                  />
                  <Chart
                    type="bar"
                    height={240}
                    series={[{ name: "Agendamentos", data: data.weekDays.map((day) => day.count) }]}
                    options={{
                      xaxis: { categories: data.weekDays.map((day) => day.label) },
                      yaxis: {
                        min: 0,
                        labels: { formatter: (value) => String(Math.round(value)) },
                      },
                      plotOptions: { bar: { borderRadius: 4, columnWidth: "40%" } },
                    }}
                  />
                </Card>
                <Card>
                  <CardHeader
                    title="Agendamentos por profissional"
                    subtitle="Todos os profissionais presentes neste recorte"
                  />
                  <ul className="max-h-64 divide-y divide-border-soft overflow-y-auto">
                    {Array.from(data.professionals)
                      .sort((a, b) => b[1] - a[1])
                      .map(([id, count]) => (
                        <li
                          key={id}
                          className="flex items-center justify-between gap-4 py-3 text-sm"
                        >
                          <span>
                            {id
                              ? (byId.get(id) ?? "Profissional sem nome")
                              : "Profissional não informado"}
                          </span>
                          <span className="font-medium tabular-nums">{count}</span>
                        </li>
                      ))}
                  </ul>
                </Card>
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Os indicadores representam os agendamentos carregados na Agenda. Não incluem estimativas
            de ociosidade, conversão ou evolução clínica.
          </p>
        </>
      )}
    </div>
  );
}

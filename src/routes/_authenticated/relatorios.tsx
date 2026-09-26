import { PageHeader } from "@/components/ui-app/PageHeader";
import { getFinancialReportingRows } from "@/features/finance/finance-api";
import { errorMessage, localDate } from "@/features/acompanhamentos/followup-utils";
import type { DbRow, Json, IconType } from "@/lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Users,
  Calendar,
  DollarSign,
  Package,
  Download,
  FileText,
  Activity,
  PieChart as PieIcon,
} from "lucide-react";
import type { ApexOptions } from "apexcharts";
import { Card as DSCard, CardHeader, KPICard } from "@/components/ds/Card";
import { Chart, CHART_COLORS } from "@/components/ds/Chart";
import { SegmentedControl } from "@/components/ui-app/SegmentedControl";
import { StickyToolbar } from "@/components/ui-app/StickyToolbar";
import { Button } from "@/components/ui/button";
import AppShell from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios • MedCore" },
      { name: "description", content: "Relatórios analíticos da clínica." },
    ],
  }),
  component: RelatoriosPage,
});

type Category = "financeiro" | "clinico" | "operacional" | "estoque";

const CATEGORIES: { id: Category; label: string; icon: IconType }[] = [
  { id: "financeiro", label: "Financeiro", icon: DollarSign },
  { id: "clinico", label: "Clínico", icon: Activity },
  { id: "operacional", label: "Operacional", icon: Calendar },
  { id: "estoque", label: "Estoque", icon: Package },
];

const PERIODS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "90d", label: "90 dias", days: 90 },
  { id: "365d", label: "12 meses", days: 365 },
];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const monthKey = (d: string) => d.slice(0, 7);

function RelatoriosPage() {
  const [cat, setCat] = useState<Category>("financeiro");
  const [periodId, setPeriodId] = useState("30d");

  const period = PERIODS.find((p) => p.id === periodId)!;
  const periodDays = period.days;

  const {
    data: reportData,
    isLoading: loading,
    error: reportError,
  } = useQuery({
    queryKey: ["reports-data", periodDays, cat],
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - periodDays);
      const fromIso = localDate(from);

      const [tx, ap, pa, tr, inv, mv] = await Promise.all([
        cat === "financeiro" ? getFinancialReportingRows() : Promise.resolve([]),
        supabase.from("appointments").select("*").gte("date", fromIso),
        supabase.from("patients").select("id,created_at,gender,birth_date"),
        supabase.from("treatments").select("*"),
        supabase.from("inventory_items").select("*"),
        supabase.from("inventory_movements").select("*").gte("created_at", from.toISOString()),
      ]);

      return {
        transactions: tx.filter((t) => t.date >= fromIso && t.date <= localDate()),
        appointments: ap.data || [],
        patients: pa.data || [],
        treatments: tr.data || [],
        inventory: inv.data || [],
        movements: mv.data || [],
      };
    },
  });

  const transactions = reportData?.transactions ?? [];
  const appointments = reportData?.appointments ?? [];
  const patients = reportData?.patients ?? [];
  const treatments = reportData?.treatments ?? [];
  const inventory = reportData?.inventory ?? [];
  const movements = reportData?.movements ?? [];

  // ---------- Financeiro ----------
  const finData = useMemo(() => {
    const byMonth = new Map<string, { month: string; receita: number; despesa: number }>();
    transactions
      .filter((t) => t.status === "pago")
      .forEach((t) => {
        const k = monthKey(t.date);
        const cur = byMonth.get(k) || { month: k, receita: 0, despesa: 0 };
        const v = Number(t.amount || 0);
        if (t.type === "receita") cur.receita += v;
        else if (t.type === "despesa") cur.despesa += v;
        byMonth.set(k, cur);
      });
    return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions]);

  const finKpis = useMemo(() => {
    const active = transactions;
    const isIncome = (t: { type: string }) => t.type === "receita" || t.type === "income";
    const isExpense = (t: { type: string }) => t.type === "despesa" || t.type === "expense";
    const isPaid = (t: { status: string }) => t.status === "pago" || t.status === "concluido";
    const isPending = (t: { status: string }) => t.status === "pendente" || t.status === "vencido";

    const receita = active
      .filter((t) => isIncome(t) && isPaid(t))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const despesa = active
      .filter((t) => isExpense(t) && isPaid(t))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const pago = active.filter(isPaid).reduce((s, t) => s + Number(t.amount || 0), 0);
    const pendente = active.filter(isPending).reduce((s, t) => s + Number(t.amount || 0), 0);
    return { receita, despesa, saldo: receita - despesa, pago, pendente };
  }, [transactions]);

  const finByCategory = useMemo(() => {
    const map = new Map<string, number>();
    transactions
      .filter((t) => t.status === "pago")
      .forEach((t) => {
        const k = t.category || "Sem categoria";
        map.set(k, (map.get(k) || 0) + Number(t.amount || 0));
      });
    return Array.from(map, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [transactions]);

  // ---------- Clínico ----------
  const clinKpis = useMemo(() => {
    const ativos = treatments.filter((t) => t.status === "ativo").length;
    const concluidos = treatments.filter((t) => t.status === "concluido").length;
    const novos = patients.filter(
      (p) => new Date(p.created_at) >= new Date(Date.now() - period.days * 86400000),
    ).length;
    return { totalPacientes: patients.length, novos, tratativos: ativos, concluidos };
  }, [patients, treatments, period]);

  const clinByGender = useMemo(() => {
    const m = patients.filter((p) => p.gender === "masculino").length;
    const f = patients.filter((p) => p.gender === "feminino").length;
    const o = patients.length - m - f;
    return [
      { name: "Feminino", value: f, color: CHART_COLORS.primarySoft },
      { name: "Masculino", value: m, color: CHART_COLORS.secondary },
      { name: "Outro", value: o, color: CHART_COLORS.neutral },
    ].filter((x) => x.value > 0);
  }, [patients]);

  const clinByAge = useMemo(() => {
    const bins = [
      { name: "0-17", min: 0, max: 17, value: 0 },
      { name: "18-29", min: 18, max: 29, value: 0 },
      { name: "30-44", min: 30, max: 44, value: 0 },
      { name: "45-59", min: 45, max: 59, value: 0 },
      { name: "60+", min: 60, max: 200, value: 0 },
    ];
    patients.forEach((p) => {
      if (!p.birth_date) return;
      const age = Math.floor((Date.now() - new Date(p.birth_date).getTime()) / (365.25 * 86400000));
      const b = bins.find((x) => age >= x.min && age <= x.max);
      if (b) b.value++;
    });
    return bins;
  }, [patients]);

  // ---------- Operacional ----------
  const opByStatus = useMemo(() => {
    const map = new Map<string, number>();
    appointments.forEach((a) => map.set(a.status, (map.get(a.status) || 0) + 1));
    const colors: Record<string, string> = {
      confirmado: CHART_COLORS.success,
      pendente: CHART_COLORS.warning,
      cancelado: CHART_COLORS.danger,
      concluido: CHART_COLORS.primary,
      agendado: CHART_COLORS.secondary,
    };
    return Array.from(map, ([name, value]) => ({
      name,
      value,
      color: colors[name] || CHART_COLORS.neutral,
    }));
  }, [appointments]);

  const opByDay = useMemo(() => {
    const map = new Map<string, number>();
    appointments.forEach((a) => map.set(a.date, (map.get(a.date) || 0) + 1));
    return Array.from(map, ([date, value]) => ({ date: date.slice(5), value })).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [appointments]);

  const opKpis = useMemo(
    () => ({
      total: appointments.length,
      confirmados: appointments.filter((a) => a.status === "confirmado").length,
      cancelados: appointments.filter((a) => a.status === "cancelado").length,
      taxaCancelamento: appointments.length
        ? Math.round(
            (appointments.filter((a) => a.status === "cancelado").length / appointments.length) *
              100,
          )
        : 0,
    }),
    [appointments],
  );

  // ---------- Estoque ----------
  const estKpis = useMemo(() => {
    const total = inventory.length;
    const baixo = inventory.filter(
      (i) => Number(i.quantity || 0) <= Number(i.min_quantity || 0),
    ).length;
    const valor = inventory.reduce(
      (s, i) => s + Number(i.quantity || 0) * Number(i.unit_cost || 0),
      0,
    );
    return { total, baixo, valor, movimentacoes: movements.length };
  }, [inventory, movements]);

  const estCritical = useMemo(
    () =>
      inventory.filter((i) => Number(i.quantity || 0) <= Number(i.min_quantity || 0)).slice(0, 10),
    [inventory],
  );

  function exportCSV() {
    let rows: string[] = [];
    const filename = `relatorio-${cat}-${periodId}.csv`;
    if (cat === "financeiro") {
      rows = [
        "mes,recebido,pago,resultado_caixa",
        ...finData.map((r) => `${r.month},${r.receita},${r.despesa},${r.receita - r.despesa}`),
      ];
    } else if (cat === "clinico") {
      rows = ["faixa,pacientes", ...clinByAge.map((r) => `${r.name},${r.value}`)];
    } else if (cat === "operacional") {
      rows = ["data,agendamentos", ...opByDay.map((r) => `${r.date},${r.value}`)];
    } else {
      rows = [
        "item,quantidade,minimo,custo_unitario",
        ...estCritical.map(
          (i) => `"${i.name}",${i.quantity},${i.min_quantity},${i.unit_cost || 0}`,
        ),
      ];
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Relatórios">
      <div className="page-container space-y-5">
        <PageHeader
          title="Relatórios"
          description="Análises por área, com o período de consulta e exportação explícitos."
          icon={BarChart3}
          className="mb-0"
          actions={
            <>
              <SegmentedControl
                aria-label="Período do relatório"
                value={periodId}
                onChange={setPeriodId}
                options={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
              />
              <Button variant="outline" disabled={loading || !!reportError} onClick={exportCSV}>
                <Download /> Exportar CSV…
              </Button>
            </>
          }
        />

        <StickyToolbar className="mb-0" label="Categorias de relatório">
          <SegmentedControl
            aria-label="Categoria do relatório"
            value={cat}
            onChange={setCat}
            options={CATEGORIES.map(({ id, label, icon: Icon }) => ({
              value: id,
              label: (
                <>
                  <Icon aria-hidden="true" />
                  {label}
                </>
              ),
            }))}
          />
        </StickyToolbar>

        {reportError ? (
          <p role="alert" className="text-destructive">
            {errorMessage(reportError)}. Relatório indisponível; nenhum total foi estimado.
          </p>
        ) : loading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : cat === "financeiro" ? (
          <FinanceiroView data={finData} kpis={finKpis} byCategory={finByCategory} />
        ) : cat === "clinico" ? (
          <ClinicoView kpis={clinKpis} byGender={clinByGender} byAge={clinByAge} />
        ) : cat === "operacional" ? (
          <OperacionalView kpis={opKpis} byStatus={opByStatus} byDay={opByDay} />
        ) : (
          <EstoqueView kpis={estKpis} critical={estCritical} movements={movements} />
        )}
      </div>
    </AppShell>
  );
}

const KPI_ACCENT = {
  violet: "primary",
  green: "success",
  rose: "danger",
  amber: "warning",
  blue: "info",
} as const;

function Kpi({ label, value, hint, tone = "violet", icon: Icon }: DbRow) {
  return (
    <KPICard
      label={label}
      value={value}
      hint={hint}
      accent={KPI_ACCENT[tone as keyof typeof KPI_ACCENT] ?? "primary"}
      icon={<Icon className="size-4" />}
    />
  );
}

function Card({ title, subtitle, children }: DbRow) {
  return (
    <DSCard>
      <CardHeader title={title} subtitle={subtitle} />
      {children}
    </DSCard>
  );
}

const donutOptions = (labels: string[], colors: string[]): ApexOptions => ({
  labels,
  colors,
  stroke: { width: 0 },
  legend: { position: "bottom", horizontalAlign: "center" },
  plotOptions: { pie: { donut: { size: "62%" } } },
});

function FinanceiroView({ data, kpis, byCategory }: DbRow) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Recebido" value={brl(kpis.receita)} tone="green" icon={TrendingUp} />
        <Kpi label="Pago" value={brl(kpis.despesa)} tone="rose" icon={DollarSign} />
        <Kpi label="Resultado de caixa" value={brl(kpis.saldo)} tone="violet" icon={BarChart3} />
        <Kpi
          label="Em aberto (entradas + saídas)"
          value={brl(kpis.pendente)}
          tone="amber"
          icon={FileText}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title="Receita x Despesa"
            subtitle="Baixas efetivas por mês; não representa lucro ou saldo bancário"
          >
            <Chart
              type="bar"
              height={280}
              summary="Receitas e despesas pagas por mês no período."
              series={[
                { name: "Receita", data: data.map((d: DbRow) => Number(d.receita) || 0) },
                { name: "Despesa", data: data.map((d: DbRow) => Number(d.despesa) || 0) },
              ]}
              options={{
                colors: [CHART_COLORS.success, CHART_COLORS.danger],
                plotOptions: {
                  bar: { borderRadius: 6, borderRadiusApplication: "end", columnWidth: "45%" },
                },
                xaxis: { categories: data.map((d: DbRow) => d.month) },
                yaxis: { labels: { formatter: (v) => `R$${(Number(v) / 1000).toFixed(0)}k` } },
                tooltip: { y: { formatter: (v) => brl(Number(v)) } },
              }}
            />
          </Card>
        </div>
        <Card title="Por categoria" subtitle="Top 8">
          <div className="space-y-2">
            {byCategory.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">Sem dados</div>
            )}
            {byCategory.map((c: DbRow, i: number) => {
              const max = byCategory[0].value;
              return (
                <div key={c.name}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="max-w-[60%] truncate text-foreground/80">{c.name}</span>
                    <span className="font-medium tabular-nums text-muted-foreground">
                      {brl(c.value)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(c.value / max) * 100}%`,
                        background: `hsl(${260 + i * 15}, 70%, 60%)`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ClinicoView({ kpis, byGender, byAge }: DbRow) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Pacientes" value={kpis.totalPacientes} tone="violet" icon={Users} />
        <Kpi label="Novos" value={kpis.novos} tone="green" icon={TrendingUp} hint="no período" />
        <Kpi label="Tratamentos ativos" value={kpis.tratativos} tone="blue" icon={Activity} />
        <Kpi label="Concluídos" value={kpis.concluidos} tone="amber" icon={FileText} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Pacientes por sexo">
          <Chart
            type="donut"
            height={260}
            summary={`Pacientes por sexo: ${byGender.map((g: DbRow) => `${g.name} ${g.value}`).join(", ")}.`}
            series={byGender.map((g: DbRow) => Number(g.value) || 0)}
            options={donutOptions(
              byGender.map((g: DbRow) => g.name),
              byGender.map((g: DbRow) => g.color),
            )}
          />
        </Card>
        <Card title="Faixa etária">
          <Chart
            type="bar"
            height={260}
            summary="Quantidade de pacientes por faixa etária."
            series={[{ name: "Pacientes", data: byAge.map((a: DbRow) => Number(a.value) || 0) }]}
            options={{
              colors: [CHART_COLORS.primary],
              plotOptions: {
                bar: { borderRadius: 6, borderRadiusApplication: "end", columnWidth: "50%" },
              },
              xaxis: { categories: byAge.map((a: DbRow) => a.name) },
              yaxis: { labels: { formatter: (v) => String(Math.round(Number(v))) } },
            }}
          />
        </Card>
      </div>
    </div>
  );
}

function OperacionalView({ kpis, byStatus, byDay }: DbRow) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Agendamentos" value={kpis.total} tone="violet" icon={Calendar} />
        <Kpi label="Confirmados" value={kpis.confirmados} tone="green" icon={TrendingUp} />
        <Kpi label="Cancelados" value={kpis.cancelados} tone="rose" icon={FileText} />
        <Kpi
          label="Taxa cancelamento"
          value={`${kpis.taxaCancelamento}%`}
          tone="amber"
          icon={PieIcon}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Agendamentos por dia">
            <Chart
              type="line"
              height={280}
              summary="Quantidade de agendamentos por dia no período."
              series={[
                { name: "Agendamentos", data: byDay.map((d: DbRow) => Number(d.value) || 0) },
              ]}
              options={{
                colors: [CHART_COLORS.primary],
                stroke: { curve: "smooth", width: 2.5 },
                markers: { size: 3, strokeWidth: 0 },
                xaxis: { categories: byDay.map((d: DbRow) => d.date) },
                yaxis: { labels: { formatter: (v) => String(Math.round(Number(v))) } },
              }}
            />
          </Card>
        </div>
        <Card title="Por status">
          <Chart
            type="pie"
            height={280}
            summary={`Agendamentos por status: ${byStatus.map((s: DbRow) => `${s.name} ${s.value}`).join(", ")}.`}
            series={byStatus.map((s: DbRow) => Number(s.value) || 0)}
            options={donutOptions(
              byStatus.map((s: DbRow) => s.name),
              byStatus.map((s: DbRow) => s.color),
            )}
          />
        </Card>
      </div>
    </div>
  );
}

function EstoqueView({ kpis, critical, movements }: DbRow) {
  const inOut = useMemo(() => {
    const entrada = movements
      .filter((m: DbRow) => m.type === "entrada")
      .reduce((s: number, m: DbRow) => s + Number(m.quantity || 0), 0);
    const saida = movements
      .filter((m: DbRow) => m.type === "saida")
      .reduce((s: number, m: DbRow) => s + Number(m.quantity || 0), 0);
    return [
      { name: "Entradas", value: entrada, color: CHART_COLORS.success },
      { name: "Saídas", value: saida, color: CHART_COLORS.danger },
    ];
  }, [movements]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Itens" value={kpis.total} tone="violet" icon={Package} />
        <Kpi label="Estoque baixo" value={kpis.baixo} tone="rose" icon={FileText} />
        <Kpi label="Valor total" value={brl(kpis.valor)} tone="green" icon={DollarSign} />
        <Kpi
          label="Movimentações"
          value={kpis.movimentacoes}
          tone="blue"
          icon={Activity}
          hint="no período"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Itens em nível crítico" subtitle="Estoque ≤ mínimo">
            {critical.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum item crítico 🎉
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="mc-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="num">
                        Qtd
                      </th>
                      <th scope="col" className="num">
                        Mínimo
                      </th>
                      <th scope="col" className="num">
                        Custo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {critical.map((i: DbRow) => (
                      <tr key={i.id}>
                        <td className="text-foreground/80">{i.name}</td>
                        <td className="num font-medium text-destructive">{i.quantity}</td>
                        <td className="num text-muted-foreground">{i.min_quantity}</td>
                        <td className="num text-muted-foreground">
                          {brl(Number(i.unit_cost || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <Card title="Entradas x Saídas">
          <Chart
            type="donut"
            height={260}
            summary={`Movimentações de estoque: entradas ${inOut[0].value}, saídas ${inOut[1].value}.`}
            series={inOut.map((s) => s.value)}
            options={donutOptions(
              inOut.map((s) => s.name),
              inOut.map((s) => s.color),
            )}
          />
        </Card>
      </div>
    </div>
  );
}

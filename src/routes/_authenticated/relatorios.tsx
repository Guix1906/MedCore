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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";
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

const CATEGORIES: { id: Category; label: string; icon: IconType; color: string }[] = [
  { id: "financeiro", label: "Financeiro", icon: DollarSign, color: "#10B981" },
  { id: "clinico", label: "Clínico", icon: Activity, color: "#8B47FF" },
  { id: "operacional", label: "Operacional", icon: Calendar, color: "#3B82F6" },
  { id: "estoque", label: "Estoque", icon: Package, color: "#F59E0B" },
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

  const { data: reportData, isLoading: loading } = useQuery({
    queryKey: ["reports-data", periodDays],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - periodDays);
      const fromIso = from.toISOString().slice(0, 10);

      const [tx, ap, pa, tr, inv, mv] = await Promise.all([
        supabase.from("transactions").select("*").gte("date", fromIso),
        supabase.from("appointments").select("*").gte("date", fromIso),
        supabase.from("patients").select("id,created_at,gender,birth_date"),
        supabase.from("treatments").select("*"),
        supabase.from("inventory_items").select("*"),
        supabase.from("inventory_movements").select("*").gte("created_at", from.toISOString()),
      ]);

      return {
        transactions: tx.data || [],
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
      .filter((t) => t.status !== "cancelado")
      .forEach((t) => {
        const k = monthKey(t.date);
        const cur = byMonth.get(k) || { month: k, receita: 0, despesa: 0 };
        const v = Number(t.amount || 0);
        if (t.type === "receita" || t.type === "income") cur.receita += v;
        else if (t.type === "despesa" || t.type === "expense") cur.despesa += v;
        byMonth.set(k, cur);
      });
    return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions]);

  const finKpis = useMemo(() => {
    const active = transactions.filter((t) => t.status !== "cancelado");
    const isIncome = (t: { type: string }) => t.type === "receita" || t.type === "income";
    const isExpense = (t: { type: string }) => t.type === "despesa" || t.type === "expense";
    const isPaid = (t: { status: string }) => t.status === "pago" || t.status === "concluido";
    const isPending = (t: { status: string }) => t.status === "pendente" || t.status === "vencido";

    const receita = active
      .filter(isIncome)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const despesa = active
      .filter(isExpense)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const pago = active
      .filter(isPaid)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const pendente = active
      .filter(isPending)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    return { receita, despesa, saldo: receita - despesa, pago, pendente };
  }, [transactions]);

  const finByCategory = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((t) => {
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
      { name: "Feminino", value: f, color: "#EC4899" },
      { name: "Masculino", value: m, color: "#3B82F6" },
      { name: "Outro", value: o, color: "#94A3B8" },
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
      confirmado: "#10B981",
      pendente: "#F59E0B",
      cancelado: "#EF4444",
      concluido: "#8B47FF",
      agendado: "#3B82F6",
    };
    return Array.from(map, ([name, value]) => ({ name, value, color: colors[name] || "#94A3B8" }));
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
        "mes,receita,despesa,saldo",
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
      <div className="p-6 space-y-6 bg-slate-50 min-h-full">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
              <BarChart3 className="text-violet-600" size={24} /> Relatórios
            </h1>
            <p className="text-sm text-slate-500">Análises consolidadas por área</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriodId(p.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    periodId === p.id
                      ? "bg-violet-600 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={exportCSV}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
            >
              <Download size={14} /> Exportar CSV
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = cat === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                  active
                    ? "bg-white border-violet-300 text-violet-700 shadow-sm"
                    : "bg-white/50 border-slate-200 text-slate-600 hover:bg-white"
                }`}
                style={active ? { borderColor: c.color, color: c.color } : {}}
              >
                <Icon size={16} /> {c.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Carregando…</div>
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

function Kpi({ label, value, hint, tone = "violet", icon: Icon }: DbRow) {
  const tones: Record<string, string> = {
    violet: "bg-violet-50 text-violet-600",
    green: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl grid place-items-center ${tones[tone]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
          {label}
        </div>
        <div className="text-xl font-semibold text-slate-900 leading-tight truncate">{value}</div>
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: DbRow) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function FinanceiroView({ data, kpis, byCategory }: DbRow) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Receita" value={brl(kpis.receita)} tone="green" icon={TrendingUp} />
        <Kpi label="Despesa" value={brl(kpis.despesa)} tone="rose" icon={DollarSign} />
        <Kpi label="Saldo" value={brl(kpis.saldo)} tone="violet" icon={BarChart3} />
        <Kpi label="Pendente" value={brl(kpis.pendente)} tone="amber" icon={FileText} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title="Receita x Despesa" subtitle="Evolução mensal">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                />
                <RTooltip formatter={(v: number | string) => brl(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="receita" fill="#10B981" radius={[6, 6, 0, 0]} maxBarSize={40} />
                <Bar dataKey="despesa" fill="#EF4444" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
        <Card title="Por categoria" subtitle="Top 8">
          <div className="space-y-2">
            {byCategory.length === 0 && (
              <div className="text-sm text-slate-400 text-center py-8">Sem dados</div>
            )}
            {byCategory.map((c: DbRow, i: number) => {
              const max = byCategory[0].value;
              return (
                <div key={c.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-700 truncate max-w-[60%]">{c.name}</span>
                    <span className="text-slate-500 font-medium">{brl(c.value)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Pacientes" value={kpis.totalPacientes} tone="violet" icon={Users} />
        <Kpi label="Novos" value={kpis.novos} tone="green" icon={TrendingUp} hint="no período" />
        <Kpi label="Tratamentos ativos" value={kpis.tratativos} tone="blue" icon={Activity} />
        <Kpi label="Concluídos" value={kpis.concluidos} tone="amber" icon={FileText} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Pacientes por sexo">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={byGender}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={4}
              >
                {byGender.map((g: DbRow) => (
                  <Cell key={g.name} fill={g.color} />
                ))}
              </Pie>
              <RTooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Faixa etária">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byAge}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
              <RTooltip />
              <Bar dataKey="value" fill="#8B47FF" radius={[6, 6, 0, 0]} maxBarSize={50} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function OperacionalView({ kpis, byStatus, byDay }: DbRow) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title="Agendamentos por dia">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                <RTooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#8B47FF"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
        <Card title="Por status">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" outerRadius={100}>
                {byStatus.map((s: DbRow) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <RTooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
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
      { name: "Entradas", value: entrada, color: "#10B981" },
      { name: "Saídas", value: saida, color: "#EF4444" },
    ];
  }, [movements]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title="Itens em nível crítico" subtitle="Estoque ≤ mínimo">
            {critical.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-8">Nenhum item crítico 🎉</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 uppercase border-b border-slate-100">
                    <tr>
                      <th className="text-left py-2">Item</th>
                      <th className="text-right py-2">Qtd</th>
                      <th className="text-right py-2">Mínimo</th>
                      <th className="text-right py-2">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {critical.map((i: DbRow) => (
                      <tr key={i.id} className="border-b border-slate-50">
                        <td className="py-2 text-slate-700">{i.name}</td>
                        <td className="py-2 text-right font-medium text-rose-600">{i.quantity}</td>
                        <td className="py-2 text-right text-slate-500">{i.min_quantity}</td>
                        <td className="py-2 text-right text-slate-500">
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
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={inOut} dataKey="value" nameKey="name" innerRadius={50} outerRadius={95}>
                {inOut.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <RTooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

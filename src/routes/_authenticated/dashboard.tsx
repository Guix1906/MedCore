import type { DbRow, Json, IconType } from "@/lib/types";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import ReactApexChart from "react-apexcharts";
import {
  HelpCircle,
  AlertTriangle,
  User,
  Clipboard,
  Stethoscope,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Eye,
  ExternalLink,
  CircleHelp,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { financeService, patientsService, companyService, agendaService } from "@/services/api";
import { StatNumber } from "@/components/ds";
import { Chart, CHART_COLORS } from "@/components/ds/Chart";
import type { ApexOptions } from "apexcharts";
import { calcCashFlow } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard • MedCore" },
      {
        name: "description",
        content: "Visão geral da clínica — agendamentos, pacientes e faturamento.",
      },
    ],
  }),
  component: DashboardPage,
});

type Appt = {
  id: string;
  patient_id: string | null;
  doctor_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  type: string | null;
  color?: string;
  title?: string;
  when?: Date;
};
type Patient = { id: string; name: string; gender: string | null; birth_date: string | null };
type DashboardTx = { id: string; type: string; amount: number; date: string; status: string };
type Doctor = { id: string; name: string; avatar_url?: string | null };

const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtBR = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

function parseMeta(desc: string | null | undefined): { color?: string; status?: string; clientId?: string; type?: string } | null {
  if (!desc) return null;
  const m = desc.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function hexToHsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function softenColor(hex: string) {
  if (!hex || !hex.startsWith("#")) return "rgba(124, 92, 252, 0.08)";
  try {
    const { h, s } = hexToHsl(hex);
    return `hsl(${h}, ${s}%, 96%)`;
  } catch {
    return "rgba(124, 92, 252, 0.08)";
  }
}

// ---------- helpers ----------
// Local-date helpers — evita bug de timezone (toISOString retorna UTC e
// causa deslocamento de 1 dia no fuso -03:00, jogando lançamentos e
// agendamentos para o dia errado no filtro do dashboard).
function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISO(s: string) {
  // Parse YYYY-MM-DD como data local (evita UTC shift do `new Date(s)`).
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function shiftRange(
  period: "day" | "week" | "month" | "year",
  start: Date,
  end: Date,
  dir: 1 | -1,
): [Date, Date] {
  const s = new Date(start);
  const e = new Date(end);
  if (period === "month") {
    s.setMonth(s.getMonth() + dir);
    e.setMonth(e.getMonth() + dir);
  } else if (period === "year") {
    s.setFullYear(s.getFullYear() + dir);
    e.setFullYear(e.getFullYear() + dir);
  } else {
    const step = period === "day" ? 1 : 7;
    s.setDate(s.getDate() + step * dir);
    e.setDate(e.getDate() + step * dir);
  }
  return [s, e];
}
function initialRange(): [Date, Date] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - 4);
  return [start, end];
}
function eachDay(start: Date, end: Date) {
  const days: Date[] = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function DashboardPage() {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("day");
  const [range, setRange] = useState<[Date, Date]>(initialRange());
  const [showBalance, setShowBalance] = useState(true);
  const [reportTab, setReportTab] = useState<"prof" | "type" | "insurance" | "cat">("prof");

  const apptsQ = useQuery({
    queryKey: ["dashboard", "events-appointments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, title, description, starts_at, ends_at, assigned_to, case_id")
        .order("starts_at", { ascending: true });
      
      const mapped = (data ?? []).map((e) => {
        const meta = parseMeta(e.description);
        const startsAt = new Date(e.starts_at);
        const endsAt = e.ends_at ? new Date(e.ends_at) : new Date(startsAt.getTime() + 30 * 60_000);
        
        // Format date as local YYYY-MM-DD to avoid UTC date shift issues
        const y = startsAt.getFullYear();
        const m = String(startsAt.getMonth() + 1).padStart(2, "0");
        const d = String(startsAt.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;
        
        // Format time as HH:MM
        const startStr = startsAt.toTimeString().slice(0, 5);
        const endStr = endsAt.toTimeString().slice(0, 5);
        
        return {
          id: e.id,
          patient_id: meta?.clientId || null,
          doctor_id: e.assigned_to || null,
          date: dateStr,
          start_time: startStr,
          end_time: endStr,
          status: meta?.status || "agendado",
          type: meta?.type || "atendimento",
          color: meta?.color || "#7C5CFC",
          title: e.title,
          when: startsAt,
        };
      });

      return mapped as Appt[];
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const patientsQ = useQuery({
    queryKey: ["dashboard", "patients"],
    queryFn: async () => {
      const { data } = await supabase.from("patients").select("id,name,gender,birth_date");
      return (data ?? []) as Patient[];
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const txQ = useQuery({
    queryKey: ["dashboard", "transactions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id,type,amount,date,status,due_date");
      return ((data ?? []) as DbRow[]).map((r) => ({
        id: r.id,
        type: r.type === "receita" ? "income" : r.type === "despesa" ? "expense" : r.type,
        amount: Number(r.amount || 0),
        date: String(r.date || ""),
        status: r.status,
        due_date: r.due_date ?? null,
      })) as DashboardTx[];
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const doctorsQ = useQuery({
    queryKey: ["dashboard", "doctors"],
    queryFn: async () => {
      const { data } = await supabase.from("doctors").select("id,name");
      return (data ?? []) as Doctor[];
    },
    staleTime: 600000,
    gcTime: 1800000,
  });
  const appts = apptsQ.data ?? [];
  const patients = patientsQ.data ?? [];
  const tx = txQ.data ?? [];
  const doctors = doctorsQ.data ?? [];
  const loading = apptsQ.isLoading || patientsQ.isLoading || txQ.isLoading || doctorsQ.isLoading;

  const [rangeStart, rangeEnd] = range;

  // filtered by range
  const apptsInRange = useMemo(
    () => appts.filter((x) => x.date >= toISO(rangeStart) && x.date <= toISO(rangeEnd)),
    [appts, rangeStart, rangeEnd],
  );
  const txInRange = useMemo(
    () => tx.filter((x) => x.date >= toISO(rangeStart) && x.date <= toISO(rangeEnd)),
    [tx, rangeStart, rangeEnd],
  );

  // Status pie
  const statusData = useMemo(() => {
    const map: Record<string, number> = {};
    apptsInRange.forEach((a) => {
      map[a.status] = (map[a.status] ?? 0) + 1;
    });
    const labels: Record<string, { label: string; color: string }> = {
      confirmed: { label: "Confirmado", color: "#C7F062" },
      scheduled: { label: "Agendado", color: "#8B47FF" },
      completed: { label: "Finalizado", color: "#10B981" },
      cancelled: { label: "Cancelado", color: "#EF4444" },
      no_show: { label: "Faltou", color: "#F59E0B" },
    };
    const rows = Object.entries(map).map(([k, v]) => ({
      name: labels[k]?.label ?? k,
      value: v,
      color: labels[k]?.color ?? "#C7F062",
    }));
    return { rows, total: apptsInRange.length };
  }, [apptsInRange]);

  // Gender pie (todos os pacientes cadastrados)
  const genderData = useMemo(() => {
    let f = 0,
      m = 0,
      o = 0;
    patients.forEach((p) => {
      if (p.gender === "F") f++;
      else if (p.gender === "M") m++;
      else o++;
    });
    const rows = [
      { name: "Feminino", value: f, color: "#C9A6FF" },
      { name: "Masculino", value: m, color: "#FCD34D" },
    ];
    if (o > 0) rows.push({ name: "Outro", value: o, color: "#D1D5DB" });
    return { rows: rows.filter((r) => r.value > 0), total: patients.length };
  }, [patients]);

  // Faturamento comparado (bars by day, current period)
  const revenueDaily = useMemo(() => {
    const days = eachDay(rangeStart, rangeEnd);
    return days.map((d) => {
      const iso = toISO(d);
      const total = tx
        .filter((t) => t.date === iso && (t.type === "income" || t.type === "receita") && t.status !== "cancelado")
        .reduce((s, r) => s + Number(r.amount), 0);
      return {
        name: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", ""),
        value: total,
      };
    });
  }, [tx, rangeStart, rangeEnd]);

  const cashflow = useMemo(() => {
    const mapped = tx.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      date: t.date,
      status: t.status === "concluido" ? "pago" : t.status === "cancelado" ? "cancelado" : t.status,
      due_date: (t as { due_date?: string | null }).due_date ?? null,
    }));
    return calcCashFlow(
      mapped as unknown as Parameters<typeof calcCashFlow>[0],
      period,
      undefined,
      range
    );
  }, [tx, period, range]);

  const balance = useMemo(() => {
    const isPaid = (s: string) => s === "concluido" || s === "pago";
    const entradas = txInRange
      .filter((t) => (t.type === "income" || t.type === "receita") && isPaid(t.status))
      .reduce((s, r) => s + Number(r.amount), 0);
    const entradasPrev = txInRange
      .filter((t) => (t.type === "income" || t.type === "receita") && t.status !== "cancelado")
      .reduce((s, r) => s + Number(r.amount), 0);
    const saidas = txInRange
      .filter((t) => (t.type === "expense" || t.type === "despesa") && isPaid(t.status))
      .reduce((s, r) => s + Number(r.amount), 0);
    const saidasPrev = txInRange
      .filter((t) => (t.type === "expense" || t.type === "despesa") && t.status !== "cancelado")
      .reduce((s, r) => s + Number(r.amount), 0);
    return {
      entradas,
      entradasPrev,
      saidas,
      saidasPrev,
      saldo: entradas - saidas,
      saldoPrev: entradasPrev - saidasPrev,
    };
  }, [txInRange]);

  const yaxisMin = -2000;
  const yaxisMax = 4000;
  const yaxisTickAmount = 5;

  // Próximas 24h
  const next24h = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const in24 = new Date(new Date().getTime() + 24 * 3600_000);
    return appts
      .map((a) => ({ ...a, when: a.when || new Date(`${a.date}T${a.start_time}`) }))
      .filter((a) => a.when >= startOfToday && a.when <= in24 && a.status !== "cancelado")
      .sort((a, b) => a.when.getTime() - b.when.getTime());
  }, [appts]);

  // Aniversariantes (mês atual)
  const birthdaysThisMonth = useMemo(() => {
    const m = new Date().getMonth();
    return patients
      .filter((p) => p.birth_date && parseISO(p.birth_date).getMonth() === m)
      .sort((a, b) => parseISO(a.birth_date!).getDate() - parseISO(b.birth_date!).getDate())
      .slice(0, 8);
  }, [patients]);

  // Relatórios — agendamentos por profissional
  const perDoctor = useMemo(() => {
    const dMap = new Map(doctors.map((d) => [d.id, d.name]));
    const counts: Record<string, number> = {};
    apptsInRange.forEach((a) => {
      if (a.doctor_id) counts[a.doctor_id] = (counts[a.doctor_id] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([id, v]) => ({ name: dMap.get(id) ?? "—", value: v, id }))
      .sort((a, b) => b.value - a.value);
  }, [apptsInRange, doctors]);

  // Relatórios — por tipo de agendamento
  const perType = useMemo(() => {
    const counts: Record<string, number> = {};
    apptsInRange.forEach((a) => {
      const key = (a.type ?? "Consulta").trim() || "Consulta";
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [apptsInRange]);

  // Relatórios — por status (aba Convênio/Status)
  const perStatus = useMemo(() => {
    const labels: Record<string, string> = {
      confirmed: "Confirmado",
      scheduled: "Agendado",
      completed: "Finalizado",
      cancelled: "Cancelado",
      no_show: "Faltou",
      pendente: "Pendente",
    };
    const counts: Record<string, number> = {};
    apptsInRange.forEach((a) => {
      const key = labels[a.status] ?? a.status;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [apptsInRange]);

  // Relatórios — categorias financeiras
  const perCategory = useMemo(() => {
    const entradas = txInRange
      .filter((t) => (t.type === "income" || t.type === "receita") && t.status !== "cancelado")
      .reduce((s, r) => s + Number(r.amount), 0);
    const saidas = txInRange
      .filter((t) => (t.type === "expense" || t.type === "despesa") && t.status !== "cancelado")
      .reduce((s, r) => s + Number(r.amount), 0);
    return [
      { name: "Entradas", value: Math.round(entradas) },
      { name: "Saídas", value: Math.round(saidas) },
    ];
  }, [txInRange]);

  const reportMap = {
    prof: {
      title: "Agendamentos por profissional",
      data: perDoctor,
      color: "#D8CBFF",
      empty: "Sem agendamentos no período",
      isCurrency: false,
    },
    type: {
      title: "Agendamentos por tipo",
      data: perType,
      color: "#A78BFA",
      empty: "Sem agendamentos no período",
      isCurrency: false,
    },
    insurance: {
      title: "Agendamentos por status",
      data: perStatus,
      color: "#8B47FF",
      empty: "Sem agendamentos no período",
      isCurrency: false,
    },
    cat: {
      title: "Movimentação financeira",
      data: perCategory,
      color: "#22C55E",
      empty: "Sem lançamentos no período",
      isCurrency: true,
    },
  } as const;
  const currentReport = reportMap[reportTab];

  // Dias mais movimentados
  const busyDays = useMemo(() => {
    const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const arr = names.map((n) => ({ name: n, value: 0 }));
    apptsInRange.forEach((a) => {
      const d = new Date(`${a.date}T00:00:00`);
      arr[d.getDay()].value += 1;
    });
    return arr;
  }, [apptsInRange]);

  // Horários mais movimentados (heatmap)
  const heat = useMemo(() => {
    const hours = Array.from({ length: 12 }, (_, i) => 8 + i); // 8..19
    const grid: number[][] = hours.map(() => Array(7).fill(0));
    let max = 0;
    apptsInRange.forEach((a) => {
      const h = parseInt(a.start_time.slice(0, 2));
      const rowIdx = hours.indexOf(h);
      if (rowIdx < 0) return;
      const col = new Date(`${a.date}T00:00:00`).getDay();
      grid[rowIdx][col] += 1;
      if (grid[rowIdx][col] > max) max = grid[rowIdx][col];
    });
    return { hours, grid, max };
  }, [apptsInRange]);

  const rangeLabel = `${rangeStart.toLocaleDateString("pt-BR")} - ${rangeEnd.toLocaleDateString("pt-BR")}`;

  return (
    <AppShell>
      <RevealGroup className="max-w-7xl mx-auto p-6 space-y-6 pb-16" stagger={0.08} delay={0.05}>
        {/* Fluxo de caixa + Filtros/Balanço */}
        <RevealItem>
          <section className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
            <div
              className="bg-white"
              style={{
                borderRadius: 18,
                padding: 20,
                border: "1px solid #EEF2F6",
                boxShadow: "0 10px 35px rgba(15,23,42,.06)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2
                    style={{
                      fontFamily: "Inter, sans-serif",
                      fontSize: 19,
                      fontWeight: 700,
                      color: "#101828",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    Fluxo de Caixa
                  </h2>
                  <button
                    type="button"
                    title="Entradas e saídas ao longo do período selecionado."
                    className="group inline-flex items-center justify-center h-6 w-6 rounded-full transition-colors"
                  >
                    <CircleHelp
                      size={16}
                      className="text-[#98A2B3] group-hover:text-[#6941C6] transition-colors"
                    />
                  </button>
                </div>
                <div className="flex gap-1" style={{ fontFamily: "Inter, sans-serif" }}>
                  {(["day", "week", "month", "year"] as const).map((p) => {
                    const active = period === p;
                    return (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className="relative px-3 pb-2 pt-1 transition-colors duration-[250ms]"
                        style={{
                          fontSize: 14,
                          fontWeight: active ? 600 : 500,
                          color: active ? "#7C3AED" : "#98A2B3",
                        }}
                        onMouseEnter={(e) => {
                          if (!active)
                            (e.currentTarget as HTMLButtonElement).style.color = "#6941C6";
                        }}
                        onMouseLeave={(e) => {
                          if (!active)
                            (e.currentTarget as HTMLButtonElement).style.color = "#98A2B3";
                        }}
                      >
                        {p === "day"
                          ? "Diária"
                          : p === "week"
                            ? "Semanal"
                            : p === "month"
                              ? "Mensal"
                              : "Anual"}
                        <span
                          className="absolute left-2 right-2 bottom-0 transition-all duration-[250ms]"
                          style={{
                            height: 3,
                            borderRadius: 2,
                            background: "#7C3AED",
                            opacity: active ? 1 : 0,
                            transform: active ? "scaleX(1)" : "scaleX(0.4)",
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="h-[270px] animate-fade-in" key={period}>
                {loading ? (
                  <Skeleton />
                ) : (
                  <ReactApexChart
                    key={`${period}-${cashflow.map((d) => d.date).join()}`}
                    type="line"
                    height={270}
                    series={
                      cashflow.length > 0
                        ? [
                            {
                              name: "Saídas",
                              type: "column",
                              data: cashflow.map((d) => -Math.abs(d.saidas)),
                            },
                            {
                              name: "Entradas",
                              type: "column",
                              data: cashflow.map((d) => d.entradas),
                            },
                            {
                              name: "Saldo",
                              type: "line",
                              data: cashflow.map((d) => d.saldo),
                            },
                          ]
                        : [
                            { name: "Saídas", type: "column", data: [] },
                            { name: "Entradas", type: "column", data: [] },
                            { name: "Saldo", type: "line", data: [] },
                          ]
                    }
                    options={{
                      chart: {
                        id: "cashflow",
                        type: "line",
                        stacked: true,
                        toolbar: { show: false },
                        zoom: { enabled: false },
                        animations: { enabled: true, easing: "easeinout", speed: 700 },
                        fontFamily: "Inter, sans-serif",
                      },
                      colors: ["#FF355B", "#22C55E", "#2F7DF6"],
                      stroke: {
                        width: [0, 0, 3],
                        curve: "straight",
                        dashArray: [0, 0, 0],
                      },
                      markers: {
                        size: [0, 0, 6],
                        strokeWidth: 2,
                        strokeColors: ["#2f7df6"],
                        colors: ["#ffffff"],
                        hover: { size: 8 },
                      },
                      plotOptions: {
                        bar: {
                          columnWidth: "45%",
                          borderRadius: 3,
                          borderRadiusApplication: "around",
                        },
                      },
                      dataLabels: { enabled: false },
                      grid: {
                        borderColor: "#E9EDF5",
                        strokeDashArray: 0,
                        padding: { left: 15, right: 10 },
                      },
                      xaxis: {
                        categories: cashflow.map((d) => d.label),
                        axisBorder: { show: false },
                        axisTicks: { show: false },
                        labels: {
                          style: { fontSize: "12px", colors: "#667085" },
                          offsetY: 6,
                        },
                      },
                      yaxis: {
                        min: yaxisMin,
                        max: yaxisMax,
                        tickAmount: yaxisTickAmount,
                        labels: {
                          style: { fontSize: "11px", fontWeight: 500, colors: "#475467" },
                          offsetX: -12,
                          formatter: (v: number) => {
                            if (v <= -1500) return "-R$ 2k";
                            if (v <= -400) return "-R$ 1k";
                            if (v <= 600) return "-R$ 100";
                            if (v <= 1800) return "R$ 1k";
                            if (v <= 3000) return "R$ 2.5k";
                            return "R$ 4k";
                          },
                        },
                      },
                      legend: { show: false },
                      tooltip: {
                        shared: true,
                        intersect: false,
                        y: {
                          formatter: (value: number) => BRL(Math.abs(value)),
                        },
                      },
                    }}
                  />
                )}
              </div>
              <div
                className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-6 pt-4 border-t"
                style={{
                  borderColor: "#F2F4F7",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#475467",
                }}
              >
                <LegendDot color="#22C55E" label="Entradas" />
                <LegendDot color="#FF355B" label="Saídas" />
                <LegendDot color="#2F7DF6" label="Saldo" line />
              </div>
            </div>

            <div className="flex flex-col h-full space-y-5">
              <div>
                <SectionTitle>Filtros</SectionTitle>
                <Card className="mt-3">
                  <div className="text-[14px] text-[#6B7280] mb-1">Período</div>
                  <PeriodPicker
                    range={range}
                    onChange={(r, p) => {
                      setRange(r);
                      if (p) setPeriod(p);
                    }}
                    onShift={(dir) => setRange(shiftRange(period, rangeStart, rangeEnd, dir))}
                    label={rangeLabel}
                  />
                </Card>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="flex items-center gap-2">
                  <SectionTitle>Balanço</SectionTitle>
                  <CircleHelp size={13} className="text-[#9CA3AF]" />
                </div>
                <Card className="mt-3 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col space-y-1">
                        <div className={`text-[26px] font-bold tabular-nums ${balance.saldo < 0 ? "text-[#FF355B]" : "text-[#22C55E]"}`}>
                          {showBalance ? (
                            <StatNumber value={balance.saldo} format={BRL} />
                          ) : (
                            "R$ ••••••"
                          )}
                        </div>
                        <div className="text-[12px] text-[#6B7280]">
                          de{" "}
                          <span className={`font-semibold ${balance.saldoPrev < 0 ? "text-[#FF355B]" : "text-[#22C55E]"}`}>
                            {showBalance ? BRL(balance.saldoPrev) : "R$ ••••••"}
                          </span>{" "}
                          previstos
                        </div>
                      </div>
                      <button onClick={() => setShowBalance((v) => !v)} className="text-[#8B47FF]">
                        <Eye size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-auto pt-4 border-t border-dashed border-[#F3F4F6]">
                    <div className="flex flex-col space-y-1">
                      <div className="text-[14px] text-[#6B7280] font-semibold">Entradas:</div>
                      <div className="text-[18px] font-bold text-[#22C55E] flex items-center gap-1.5 tabular-nums">
                        {showBalance ? (
                          <StatNumber value={balance.entradas} format={BRL} />
                        ) : (
                          "R$ ••••"
                        )}
                        <Link to="/financeiro" className="text-[#8B47FF]">
                          <ExternalLink size={12} />
                        </Link>
                      </div>
                      <div className="text-[11px] text-[#6B7280]">
                        de{" "}
                        <span className="font-semibold text-[#6B7280]">
                          {showBalance ? BRL(balance.entradasPrev) : "R$ ••••"}
                        </span>{" "}
                        previsto
                      </div>
                    </div>
                    <div className="flex flex-col space-y-1">
                      <div className="text-[14px] text-[#6B7280] font-semibold">Saídas:</div>
                      <div className="text-[18px] font-bold text-[#FF355B] flex items-center gap-1.5 tabular-nums">
                        {showBalance ? (
                          <StatNumber value={balance.saidas} format={(v) => `-${BRL(v)}`} />
                        ) : (
                          "R$ ••••"
                        )}
                        <Link to="/financeiro" className="text-[#8B47FF]">
                          <ExternalLink size={12} />
                        </Link>
                      </div>
                      <div className="text-[11px] text-[#6B7280]">
                        de{" "}
                        <span className="font-semibold text-[#6B7280]">
                          {showBalance ? `-${BRL(balance.saidasPrev)}` : "R$ ••••"}
                        </span>{" "}
                        previsto
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </section>
        </RevealItem>

        {/* Agendamentos das próximas 24h + Faturamento comparado */}
        <RevealItem>
          <section className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
            <Card>
              <SectionTitle>Agendamentos das próximas 24h</SectionTitle>
              {next24h.length === 0 ? (
                <EmptyBlock
                  title="Não há nada aqui!"
                  subtitle="Nenhum agendamento para as próximas 24 horas"
                />
              ) : (
                <div className="mt-4 flex flex-col gap-2">
                  {next24h.slice(0, 6).map((a) => {
                    const pat = patients.find((p) => p.id === a.patient_id);
                    const accent = a.color || "#8B47FF";
                    const bgSoft = softenColor(accent);
                    const name = pat?.name || a.title || "Agendamento";
                    return (
                      <div
                        key={a.id}
                        className="p-3 rounded-xl border-l-[5px] border transition-all flex flex-col gap-1 shadow-sm"
                        style={{
                          background: bgSoft,
                          borderLeftColor: accent,
                          borderTopColor: "rgba(0,0,0,0.02)",
                          borderRightColor: "rgba(0,0,0,0.02)",
                          borderBottomColor: "rgba(0,0,0,0.02)",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: accent }}
                          />
                          <span className="text-[13px] font-bold text-[#1F2937]">
                            {name}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#6B7280] font-semibold ml-4.5">
                          {a.start_time} - {a.end_time}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card>
              <TitleRow title="Faturamento comparado" />
              <div className="h-[240px]">
                <ApexRevenueDaily data={revenueDaily} />
              </div>
            </Card>
          </section>
        </RevealItem>

        {/* Status, Sexo na esquerda e Aniversariantes na direita alinhados */}
        <RevealItem>
          <section className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <TitleRow title="Status por agendamento" />
                <div className="relative h-[240px]">
                  <ApexDonut
                    rows={statusData.rows}
                    centerLabel={String(statusData.total)}
                    centerSub="Agendamentos"
                  />
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-[#6B7280]">
                    {statusData.total} agendamento{statusData.total === 1 ? "" : "s"} no período
                  </div>
                </div>
                <PieLegend rows={statusData.rows} />
              </Card>

              <Card>
                <TitleRow title="Pacientes por sexo" />
                <div className="relative h-[240px]">
                  <ApexDonut
                    rows={genderData.rows}
                    centerLabel={String(genderData.total)}
                    centerSub="Pacientes"
                  />
                  <div className="absolute left-2 bottom-2 text-[11px] text-[#6B7280]">
                    {genderData.total} paciente{genderData.total === 1 ? "" : "s"} cadastrado
                    {genderData.total === 1 ? "" : "s"}
                  </div>
                </div>
                <PieLegend rows={genderData.rows} />
              </Card>
            </div>

            <Card>
              <SectionTitle>Próximos aniversariantes</SectionTitle>
              {birthdaysThisMonth.length === 0 ? (
                <EmptyBlock
                  title="Não há nada aqui!"
                  subtitle={`Nenhum aniversariante em ${new Date().toLocaleString("pt-BR", { month: "long" })}`}
                />
              ) : (
                <div className="mt-4 space-y-3">
                  {birthdaysThisMonth.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-[#EDE4FF] text-[#8B47FF] grid place-items-center text-[11px] font-bold">
                        {p.name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="text-[13px] text-[#111827] flex-1 truncate">{p.name}</div>
                      <div className="text-[12px] text-[#6B7280]">
                        {parseISO(p.birth_date!).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        </RevealItem>

        {/* Relatórios */}
        <RevealItem>
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-[19px] font-bold text-[#111827]">Relatórios</h2>
              <HelpCircle size={14} className="text-[#9CA3AF]" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <div className="flex gap-6 border-b border-[#E5E7EB] mb-4">
                    {[
                      { k: "prof" as const, icon: User, label: "Por profissional" },
                      { k: "type" as const, icon: Clipboard, label: "Por tipo" },
                      { k: "insurance" as const, icon: Stethoscope, label: "Por status" },
                      { k: "cat" as const, icon: LayoutGrid, label: "Financeiro" },
                    ].map(({ k, icon: Icon, label }) => (
                      <button
                        key={k}
                        onClick={() => setReportTab(k)}
                        title={label}
                        className={`pb-2 transition-colors ${reportTab === k ? "text-[#8B47FF] border-b-2 border-[#8B47FF]" : "text-[#9CA3AF] hover:text-[#6B7280]"}`}
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </div>
                  <TitleRow title={currentReport.title} />
                  <div className="h-[240px] mt-2">
                    {currentReport.data.length === 0 ? (
                      <EmptyBlock small title="Sem dados" subtitle={currentReport.empty} />
                    ) : (
                      <ApexBar
                        categories={(currentReport.data as { name: string; value: number }[]).map(
                          (d) => d.name,
                        )}
                        values={(currentReport.data as { name: string; value: number }[]).map(
                          (d) => d.value,
                        )}
                        color={currentReport.color}
                        isCurrency={currentReport.isCurrency}
                        height={240}
                      />
                    )}
                  </div>
                </Card>

                <Card>
                  <TitleRow title="Dias mais movimentados" />
                  <div className="h-[280px]">
                    <ApexBar
                      categories={busyDays.map((d) => d.name)}
                      values={busyDays.map((d) => d.value)}
                      color="#A78BFA"
                      height={280}
                      showValueLabels
                    />
                  </div>
                </Card>
              </div>

              <Card>
                <TitleRow title="Horários mais movimentados" />
                <div className="mt-2 max-h-[280px] overflow-auto">
                  <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
                    <tbody>
                      {heat.hours.map((h, r) => (
                        <tr key={h}>
                          <td className="text-[11px] text-[#6B7280] pr-2 w-8">{h}h</td>
                          {heat.grid[r].map((v, c) => {
                            const alpha = heat.max === 0 ? 0 : v / heat.max;
                            const bg =
                              v === 0 ? "#F3F4F6" : `rgba(139,71,255,${0.15 + alpha * 0.75})`;
                            return (
                              <td key={c}>
                                <div
                                  className="h-5 w-8 rounded"
                                  style={{ background: bg }}
                                  title={`${v} agendamento${v === 1 ? "" : "s"}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </section>
        </RevealItem>
      </RevealGroup>
    </AppShell>
  );
}

// ---------- shared UI ----------
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-[#E5E7EB] p-5 ${className}`}>
      {children}
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[19px] font-bold text-[#111827]">{children}</h3>;
}
function computeStart(to: number): number {
  const abs = Math.abs(to);
  if (abs < 1) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)));
  const step = magnitude >= 1000 ? magnitude : magnitude / 10;
  const floored = Math.floor(abs / step) * step;
  const start = floored >= abs ? floored - step : floored;
  return to < 0 ? -start : start;
}

function CountUp({
  value,
  format,
  duration = 1200,
}: {
  value: number;
  format: (v: number) => string;
  duration?: number;
}) {
  const to = Number(value) || 0;
  const ref = useRef<HTMLSpanElement | null>(null);
  const seenRef = useRef(false);
  const prevRef = useRef<number>(computeStart(to));
  const [display, setDisplay] = useState<number>(prevRef.current);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (seenRef.current) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            seenRef.current = true;
            setInView(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const from = seenRef.current && prevRef.current !== 0 ? prevRef.current : computeStart(to);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(2, -10 * t); // easeOutExpo
      const current = from + (to - from) * (t === 1 ? 1 : eased);
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, inView]);

  return <span ref={ref}>{format(display)}</span>;
}

function TitleRow({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-[19px] font-bold text-[#111827]">{title}</h3>
      <HelpCircle size={13} className="text-[#9CA3AF]" />
    </div>
  );
}
function EmptyBlock({
  title,
  subtitle,
  small,
}: {
  title: string;
  subtitle: string;
  small?: boolean;
}) {
  return (
    <div className={`mt-4 ${small ? "py-6" : "py-10"} px-4`}>
      <AlertTriangle size={22} className="text-[#8B47FF] mb-3" />
      <div className="text-[17px] font-bold text-[#111827]">{title}</div>
      <div className="text-[14px] text-[#6B7280] mt-1">{subtitle}</div>
    </div>
  );
}
function Skeleton() {
  return <div className="h-full w-full rounded-xl bg-[#F3F4F6] animate-pulse" />;
}
function LegendDot({
  color,
  label,
  line,
  dashed,
}: {
  color: string;
  label: string;
  line?: boolean;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line ? (
        <span
          className="inline-block w-5 h-[2px]"
          style={{
            background: color,
            borderTop: dashed ? `2px dashed ${color}` : undefined,
            backgroundColor: dashed ? "transparent" : color,
          }}
        />
      ) : (
        <span className="inline-block w-3 h-3 rounded" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
function DonutChart({
  data,
  centerLabel,
  centerSub,
  centerSubColor,
}: {
  data: { name: string; value: number; color: string }[];
  centerLabel: string;
  centerSub: string;
  centerSubColor: string;
}) {
  const rows = data.length ? data : [{ name: "—", value: 1, color: "#F3F4F6" }];
  return (
    <div className="relative w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            innerRadius="65%"
            outerRadius="90%"
            stroke="none"
            startAngle={90}
            endAngle={-270}
          >
            {rows.map((r, i) => (
              <Cell key={i} fill={r.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-[28px] font-bold text-[#111827] leading-none">{centerLabel}</div>
        <div className="text-[12px] mt-1" style={{ color: centerSubColor }}>
          {centerSub}
        </div>
      </div>
    </div>
  );
}
function PieLegend({ rows }: { rows: { name: string; value: number; color: string }[] }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-[#6B7280]">
      {rows.map((r) => (
        <span key={r.name} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: r.color }} />
          {r.name} ({r.value})
        </span>
      ))}
    </div>
  );
}

type PeriodKey = "day" | "week" | "month" | "year";
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function presetRange(kind: "today" | "week" | "month" | "last7" | "last30"): [Date, Date] {
  const end = startOfDay(new Date());
  if (kind === "today") return [end, end];
  if (kind === "last7") {
    const s = new Date(end);
    s.setDate(end.getDate() - 6);
    return [s, end];
  }
  if (kind === "last30") {
    const s = new Date(end);
    s.setDate(end.getDate() - 29);
    return [s, end];
  }
  if (kind === "week") {
    const s = new Date(end);
    const dow = s.getDay(); // 0=Sun
    s.setDate(end.getDate() - dow);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    return [s, e];
  }
  // month
  const s = new Date(end.getFullYear(), end.getMonth(), 1);
  const e = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  return [s, e];
}

function PeriodPicker({
  range,
  label,
  onChange,
  onShift,
}: {
  range: [Date, Date];
  label: string;
  onChange: (r: [Date, Date], p?: PeriodKey) => void;
  onShift: (dir: 1 | -1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"presets" | "custom">("presets");
  const [customStart, setCustomStart] = useState(toISO(range[0]));
  const [customEnd, setCustomEnd] = useState(toISO(range[1]));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<string>("month");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (key: "today" | "week" | "month" | "last7" | "last30") => {
    const r = presetRange(key);
    const periodMap: Record<string, PeriodKey> = {
      today: "day",
      week: "week",
      month: "month",
      last7: "week",
      last30: "month",
    };
    setActive(key);
    onChange(r, periodMap[key]);
    setOpen(false);
  };

  const applyCustom = () => {
    const s = new Date(customStart);
    const e = new Date(customEnd);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return;
    setActive("custom");
    onChange([startOfDay(s), startOfDay(e)], "day");
    setOpen(false);
  };

  const options: { key: "today" | "week" | "month" | "last7" | "last30"; label: string }[] = [
    { key: "today", label: "Hoje" },
    { key: "week", label: "Esta semana" },
    { key: "month", label: "Este mês" },
    { key: "last7", label: "Últimos 7 dias" },
    { key: "last30", label: "Últimos 30 dias" },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={`flex items-center justify-between h-11 px-2 border rounded-lg bg-white transition-colors ${open ? "border-[#8B47FF] ring-2 ring-[#8B47FF]/20" : "border-[#E5E7EB]"}`}
      >
        <button
          onClick={() => onShift(-1)}
          className="h-8 w-8 grid place-items-center text-[#6B7280] hover:bg-[#F3F4F6] rounded-md"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-[15px] font-medium text-[#111827] hover:bg-[#F9FAFB] h-8 rounded-md"
        >
          {label}
        </button>
        <button
          onClick={() => onShift(1)}
          className="h-8 w-8 grid place-items-center text-[#6B7280] hover:bg-[#F3F4F6] rounded-md"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 bg-white border border-[#8B47FF] rounded-lg shadow-lg overflow-hidden animate-fade-in">
          {mode === "presets" ? (
            <ul className="py-1">
              {options.map((o) => (
                <li key={o.key}>
                  <button
                    onClick={() => pick(o.key)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-[13px] text-left transition-colors ${active === o.key ? "bg-[#F3EBFF] text-[#8B47FF] font-medium" : "text-[#111827] hover:bg-[#F9FAFB]"}`}
                  >
                    <span>{o.label}</span>
                    {active === o.key && <span className="text-[#8B47FF]">✓</span>}
                  </button>
                </li>
              ))}
              <li>
                <button
                  onClick={() => setMode("custom")}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-[13px] text-left transition-colors ${active === "custom" ? "bg-[#F3EBFF] text-[#8B47FF] font-medium" : "text-[#111827] hover:bg-[#F9FAFB]"}`}
                >
                  <span>Customizado</span>
                  {active === "custom" && <span className="text-[#8B47FF]">✓</span>}
                </button>
              </li>
            </ul>
          ) : (
            <div className="p-3 space-y-2">
              <div>
                <div className="text-[11px] text-[#6B7280] mb-1">Início</div>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full h-9 px-2 border border-[#E5E7EB] rounded-md text-[13px]"
                />
              </div>
              <div>
                <div className="text-[11px] text-[#6B7280] mb-1">Fim</div>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full h-9 px-2 border border-[#E5E7EB] rounded-md text-[13px]"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => setMode("presets")}
                  className="text-[12px] text-[#6B7280] hover:text-[#111827]"
                >
                  Voltar
                </button>
                <button
                  onClick={applyCustom}
                  className="h-8 px-3 rounded-md bg-[#8B47FF] text-white text-[12px] font-medium hover:bg-[#7A3AE8]"
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApexRevenueDaily({ data }: { data: { name: string; value: number }[] }) {
  const categories = data.map((d) => d.name);
  const series = [{ name: "Faturamento", data: data.map((d) => d.value) }];
  const options: ApexOptions = {
    chart: {
      toolbar: { show: false },
      fontFamily: "Inter, sans-serif",
      animations: { enabled: true, speed: 500 },
    },
    colors: [CHART_COLORS.primary],
    plotOptions: {
      bar: { borderRadius: 6, columnWidth: "55%", borderRadiusApplication: "end" },
    },
    dataLabels: { enabled: false },
    grid: { borderColor: "#F3F4F6", strokeDashArray: 0, xaxis: { lines: { show: false } } },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: "#6B7280", fontSize: "11px" } },
    },
    yaxis: {
      labels: {
        style: { colors: "#6B7280", fontSize: "11px" },
        formatter: (v) => `R$ ${Math.round(Number(v) / 1000)}k`,
      },
    },
    tooltip: {
      y: {
        formatter: (v) =>
          new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v)),
      },
    },
    fill: {
      type: "gradient",
      gradient: {
        shade: "light",
        type: "vertical",
        gradientToColors: ["#A78BFA"],
        stops: [0, 100],
        opacityFrom: 1,
        opacityTo: 0.85,
      },
    },
  };
  return <Chart type="bar" options={options} series={series} height={240} />;
}

function ApexDonut({
  rows,
  centerLabel,
  centerSub,
}: {
  rows: { name: string; value: number; color: string }[];
  centerLabel: string;
  centerSub: string;
}) {
  const data = rows.length ? rows : [{ name: "—", value: 1, color: "#F3F4F6" }];
  const options: ApexOptions = {
    chart: { fontFamily: "Inter, sans-serif", animations: { enabled: true, speed: 500 } },
    labels: data.map((r) => r.name),
    colors: data.map((r) => r.color),
    stroke: { width: 0 },
    dataLabels: { enabled: false },
    legend: { show: false },
    tooltip: { y: { formatter: (v) => String(v) } },
    plotOptions: {
      pie: {
        donut: {
          size: "72%",
          labels: {
            show: true,
            name: {
              show: true,
              offsetY: 22,
              color: "#8B47FF",
              fontSize: "12px",
              fontWeight: 500,
              formatter: () => centerSub,
            },
            value: {
              show: true,
              offsetY: -12,
              color: "#111827",
              fontSize: "28px",
              fontWeight: 700,
              formatter: () => centerLabel,
            },
            total: {
              show: true,
              label: centerSub,
              color: "#8B47FF",
              fontSize: "12px",
              formatter: () => centerLabel,
            },
          },
        },
      },
    },
  };
  return <Chart type="donut" options={options} series={data.map((r) => r.value)} height="100%" />;
}

function ApexBar({
  categories,
  values,
  color,
  isCurrency,
  height = 240,
  showValueLabels,
}: {
  categories: string[];
  values: number[];
  color: string;
  isCurrency?: boolean;
  height?: number | string;
  showValueLabels?: boolean;
}) {
  const options: ApexOptions = {
    chart: {
      toolbar: { show: false },
      fontFamily: "Inter, sans-serif",
      animations: { enabled: true, speed: 500 },
    },
    colors: [color],
    plotOptions: {
      bar: {
        borderRadius: 8,
        columnWidth: "55%",
        borderRadiusApplication: "end",
        dataLabels: { position: "top" },
      },
    },
    dataLabels: {
      enabled: !!showValueLabels,
      offsetY: -18,
      style: { fontSize: "11px", colors: ["#6B7280"], fontWeight: 500 },
      formatter: (v) => String(v),
    },
    grid: { borderColor: "#F3F4F6", strokeDashArray: 0, xaxis: { lines: { show: false } } },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: "#6B7280", fontSize: "11px" } },
    },
    yaxis: {
      labels: {
        style: { colors: "#6B7280", fontSize: "11px" },
        formatter: (v) =>
          isCurrency ? `R$ ${Math.round(Number(v) / 1000)}k` : String(Math.round(Number(v))),
      },
    },
    tooltip: {
      y: { formatter: (v) => (isCurrency ? BRL(Number(v)) : String(v)) },
    },
  };
  return (
    <Chart
      type="bar"
      options={options}
      series={[{ name: "Total", data: values }]}
      height={height}
    />
  );
}

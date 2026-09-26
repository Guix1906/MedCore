import AppShell from "@/components/AppShell";
import { Card, CardHeader, KPICard, StatNumber } from "@/components/ds";
import { Chart, CHART_COLORS, chartColor } from "@/components/ds/Chart";
import { RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { PageHeader } from "@/components/ui-app/PageHeader";
import { SegmentedControl } from "@/components/ui-app/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { errorMessage } from "@/features/acompanhamentos/followup-utils";
import { BRL, parseMeta } from "@/features/dashboard/dashboard-utils";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { reportingRows } from "@/features/finance/finance-math";
import { useResolvedTheme } from "@/hooks/use-theme";
import { supabase } from "@/integrations/supabase/client";
import { calcCashFlow } from "@/lib/finance";
import { agendaService, companyService, patientsService } from "@/services/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ApexOptions } from "apexcharts";
import {
  Cake,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Inbox,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const base = currentMonthStr === "2026-09" ? now : new Date(2026, 8, 15);
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
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
  const qc = useQueryClient();
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("day");
  const [range, setRange] = useState<[Date, Date]>(initialRange());
  const [showBalance, setShowBalance] = useState(true);
  const [reportTab, setReportTab] = useState<"prof" | "type" | "insurance" | "cat">("prof");

  // Sincronização em tempo real do financeiro com o fluxo de caixa
  useEffect(() => {
    // 1. Escuta alterações no localStorage (exclusão, estorno ou novo pagamento em outras abas ou telas)
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === "medcore_deleted_cash_entries" ||
        e.key === "medcore_deleted_titles" ||
        e.key === "medcore_local_payments"
      ) {
        void qc.invalidateQueries({ queryKey: ["financial-snapshot"] });
      }
    };
    window.addEventListener("storage", handleStorage);

    // 2. Realtime do Supabase para alterações nas tabelas de títulos e baixas financeiras
    const ch = supabase
      .channel("dashboard-financial-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_titles" }, () => {
        void refreshFinance(qc);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_payments" }, () => {
        void refreshFinance(qc);
      })
      .subscribe();

    return () => {
      window.removeEventListener("storage", handleStorage);
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const apptsQ = useQuery({
    queryKey: ["dashboard", "events-appointments"],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      try {
        const phpEvents = await agendaService.getEvents();
        if (phpEvents && Array.isArray(phpEvents)) {
          return phpEvents.map((e) => {
            const startsAt = new Date(e.start_time);
            const endsAt = e.end_time
              ? new Date(e.end_time)
              : new Date(startsAt.getTime() + 30 * 60_000);
            const y = startsAt.getFullYear();
            const m = String(startsAt.getMonth() + 1).padStart(2, "0");
            const d = String(startsAt.getDate()).padStart(2, "0");
            return {
              id: e.id,
              patient_id: (e as any).patient_id || null,
              doctor_id: (e as any).doctor_id || null,
              date: `${y}-${m}-${d}`,
              start_time: startsAt.toTimeString().slice(0, 5),
              end_time: endsAt.toTimeString().slice(0, 5),
              status: e.status || "agendado",
              type: e.event_type || "atendimento",
              color: (e as any).color || CHART_COLORS.primary,
              title: e.title,
              when: startsAt,
            };
          }) as Appt[];
        }
      } catch {}

      const { data } = await supabase
        .from("events")
        .select("id, title, description, starts_at, ends_at, assigned_to, case_id")
        .order("starts_at", { ascending: true });

      const mapped = (data ?? []).map((e) => {
        const meta = parseMeta(e.description);
        const startsAt = new Date(e.starts_at);
        const endsAt = e.ends_at ? new Date(e.ends_at) : new Date(startsAt.getTime() + 30 * 60_000);

        const y = startsAt.getFullYear();
        const m = String(startsAt.getMonth() + 1).padStart(2, "0");
        const d = String(startsAt.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;

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
          color: meta?.color || CHART_COLORS.primary,
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
    placeholderData: (prev) => prev,
    queryFn: async () => {
      try {
        const phpPat = await patientsService.getPatients({ limit: 500 });
        if (phpPat && Array.isArray(phpPat)) {
          return phpPat.map((p) => ({
            id: p.id,
            name: p.name,
            gender: p.gender || null,
            birth_date: p.birth_date || null,
          })) as Patient[];
        }
      } catch {}
      const { data } = await supabase.from("patients").select("id,name,gender,birth_date");
      return (data ?? []) as Patient[];
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const financeQ = useQuery({
    queryKey: ["financial-snapshot"],
    queryFn: getFinancialSnapshot,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const doctorsQ = useQuery({
    queryKey: ["dashboard", "doctors"],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      try {
        const phpDocs = await companyService.getDoctors();
        if (phpDocs && Array.isArray(phpDocs) && phpDocs.length > 0) {
          return phpDocs as Doctor[];
        }
      } catch {}
      const { data } = await supabase.from("doctors").select("id,name");
      return (data ?? []) as Doctor[];
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const appts = apptsQ.data ?? [];
  const patients = patientsQ.data ?? [];
  const tx: DashboardTx[] = useMemo(() => {
    if (!financeQ.data || !financeQ.data.scopes?.length) return [];
    return reportingRows(financeQ.data);
  }, [financeQ.data]);
  const doctors = doctorsQ.data ?? [];
  const loading =
    apptsQ.isLoading || patientsQ.isLoading || financeQ.isLoading || doctorsQ.isLoading;

  // Garante que o dashboard mostre os lançamentos vigentes do sistema caso o mês do usuário não tenha dados
  useEffect(() => {
    if (tx.length > 0) {
      const now = new Date();
      const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const hasCurrentMonthEntries = tx.some((t) => (t.date || "").startsWith(currentMonthStr));
      if (!hasCurrentMonthEntries) {
        const hasSep2026 = tx.some((t) => (t.date || "").startsWith("2026-09"));
        if (hasSep2026) {
          const s = new Date(2026, 8, 1);
          s.setHours(0, 0, 0, 0);
          const e = new Date(2026, 8 + 1, 0);
          e.setHours(23, 59, 59, 999);
          setRange((prev) => {
            const prevStr = toISO(prev[0]).slice(0, 7);
            if (prevStr !== "2026-09") {
              return [s, e];
            }
            return prev;
          });
        }
      }
    }
  }, [tx]);

  const [rangeStart, rangeEnd] = range;

  // filtered by range
  const apptsInRange = useMemo(
    () => appts.filter((x) => x.date >= toISO(rangeStart) && x.date <= toISO(rangeEnd)),
    [appts, rangeStart, rangeEnd],
  );
  const txInRange = useMemo(
    () =>
      tx.filter((x) => {
        const dStr = (x.date || "").slice(0, 10);
        return dStr >= toISO(rangeStart) && dStr <= toISO(rangeEnd);
      }),
    [tx, rangeStart, rangeEnd],
  );

  // Status pie
  const statusData = useMemo(() => {
    const map: Record<string, number> = {};
    apptsInRange.forEach((a) => {
      map[a.status] = (map[a.status] ?? 0) + 1;
    });
    const labels: Record<string, { label: string; color: string }> = {
      confirmed: { label: "Confirmado", color: CHART_COLORS.secondary },
      scheduled: { label: "Agendado", color: CHART_COLORS.primary },
      completed: { label: "Finalizado", color: CHART_COLORS.success },
      cancelled: { label: "Cancelado", color: CHART_COLORS.danger },
      no_show: { label: "Faltou", color: CHART_COLORS.warning },
    };
    const rows = Object.entries(map).map(([k, v]) => ({
      name: labels[k]?.label ?? k,
      value: v,
      color: labels[k]?.color ?? CHART_COLORS.neutral,
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
      { name: "Feminino", value: f, color: CHART_COLORS.primarySoft },
      { name: "Masculino", value: m, color: CHART_COLORS.secondary },
    ];
    if (o > 0) rows.push({ name: "Outro", value: o, color: CHART_COLORS.neutral });
    return { rows: rows.filter((r) => r.value > 0), total: patients.length };
  }, [patients]);

  // Faturamento comparado (bars by day, current period)
  const revenueDaily = useMemo(() => {
    const days = eachDay(rangeStart, rangeEnd);
    return days.map((d) => {
      const iso = toISO(d);
      const total = tx
        .filter(
          (t) =>
            (t.date || "").slice(0, 10) === iso &&
            (t.type === "income" || t.type === "receita") &&
            t.status === "pago",
        )
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
      range,
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

  const { chartYMin, chartYMax, yaxisTickAmount } = useMemo(() => {
    let maxVal = 0;
    let minVal = 0;
    cashflow.forEach((d) => {
      if (d.entradas > maxVal) maxVal = d.entradas;
      if (d.saldo > maxVal) maxVal = d.saldo;
      if (d.saidas > maxVal) maxVal = d.saidas;
      if (d.saldo < minVal) minVal = d.saldo;
      if (-Math.abs(d.saidas) < minVal) minVal = -Math.abs(d.saidas);
    });

    if (maxVal === 0 && minVal === 0) {
      return { chartYMin: 0, chartYMax: 5000, yaxisTickAmount: 5 };
    }

    const step = maxVal > 50000 ? 10000 : maxVal > 10000 ? 5000 : 1000;
    const top = maxVal > 0 ? Math.ceil((maxVal * 1.15) / step) * step : 1000;
    const bottom = minVal < 0 ? Math.floor((minVal * 1.15) / step) * step : 0;
    const rangeSpan = top - bottom;
    const tickCount = Math.min(6, Math.max(4, Math.round(rangeSpan / step)));

    return {
      chartYMin: bottom,
      chartYMax: top,
      yaxisTickAmount: tickCount,
    };
  }, [cashflow]);

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
      .filter((t) => (t.type === "income" || t.type === "receita") && t.status === "pago")
      .reduce((s, r) => s + Number(r.amount), 0);
    const saidas = txInRange
      .filter((t) => (t.type === "expense" || t.type === "despesa") && t.status === "pago")
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
      color: CHART_COLORS.primarySoft,
      empty: "Sem agendamentos no período",
      isCurrency: false,
    },
    type: {
      title: "Agendamentos por tipo",
      data: perType,
      color: CHART_COLORS.primary,
      empty: "Sem agendamentos no período",
      isCurrency: false,
    },
    insurance: {
      title: "Agendamentos por status",
      data: perStatus,
      color: CHART_COLORS.secondary,
      empty: "Sem agendamentos no período",
      isCurrency: false,
    },
    cat: {
      title: "Movimentação financeira",
      data: perCategory,
      color: CHART_COLORS.success,
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
  const mode = useResolvedTheme();
  const monthName = new Date().toLocaleString("pt-BR", { month: "long" });
  const birthdaysCount = patients.filter(
    (p) => p.birth_date && parseISO(p.birth_date).getMonth() === new Date().getMonth(),
  ).length;
  const topStatus = statusData.rows.reduce<(typeof statusData.rows)[number] | null>(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  const busiestDay = busyDays.reduce((best, day) => (day.value > best.value ? day : best));
  const revenueTotal = revenueDaily.reduce((sum, day) => sum + day.value, 0);
  const reportRows = currentReport.data as { name: string; value: number }[];
  const topReport = reportRows[0];
  const reportSummary = !topReport
    ? currentReport.empty
    : `Maior: ${topReport.name}${
        currentReport.isCurrency
          ? showBalance
            ? ` (${BRL(topReport.value)})`
            : ""
          : ` (${topReport.value})`
      }`;
  const count = (value: number) => (loading ? "—" : value.toLocaleString("pt-BR"));

  return (
    <AppShell title="Dashboard">
      <RevealGroup className="page-container space-y-6 pb-12" stagger={0.08} delay={0.05}>
        <PageHeader
          title="Dashboard"
          description="Sua rotina de atendimento e os principais resultados da clínica."
          actions={
            <Button asChild variant="outline">
              <Link to="/agenda">Abrir agenda</Link>
            </Button>
          }
        />

        <RevealItem>
          <section aria-label="Resumo" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KPICard
              label="Agendamentos no período"
              value={count(statusData.total)}
              hint={rangeLabel}
              icon={<CalendarDays className="size-4" />}
            />
            <KPICard
              label="Próximas 24 horas"
              value={count(next24h.length)}
              hint={next24h.length === 1 ? "atendimento previsto" : "atendimentos previstos"}
              icon={<Clock className="size-4" />}
              accent="info"
            />
            <KPICard
              label="Pacientes cadastrados"
              value={count(patients.length)}
              hint="na base da clínica"
              icon={<Users className="size-4" />}
              accent="success"
            />
            <KPICard
              label="Aniversariantes do mês"
              value={count(birthdaysCount)}
              hint={monthName}
              icon={<Cake className="size-4" />}
              accent="warning"
            />
          </section>
        </RevealItem>

        {/* Agendamentos das próximas 24h + Recebimentos */}
        <RevealItem>
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card>
              <CardHeader
                title="Agendamentos das próximas 24h"
                subtitle={
                  next24h.length === 0
                    ? "Agenda livre por enquanto."
                    : `${next24h.length} agendamento${next24h.length === 1 ? "" : "s"}${
                        next24h.length > 6 ? " · mostrando os 6 primeiros" : ""
                      }`
                }
              />
              {next24h.length === 0 ? (
                <EmptyBlock
                  title="Agenda livre nas próximas 24 horas"
                  subtitle="Nenhum agendamento para as próximas 24 horas"
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {next24h.slice(0, 6).map((a) => {
                    const pat = patients.find((p) => p.id === a.patient_id);
                    const accent = a.color || CHART_COLORS.primary;
                    const name = pat?.name || a.title || "Agendamento";
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-3 py-2.5"
                        style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: accent }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                          {name}
                        </span>
                        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                          {a.start_time} - {a.end_time}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Recebimentos no período"
                subtitle={
                  financeQ.error
                    ? undefined
                    : showBalance
                      ? `${BRL(revenueTotal)} recebidos`
                      : "Valores ocultos"
                }
              />
              <div className="h-[240px]">
                {financeQ.error ? (
                  <p className="text-sm text-muted-foreground">Recebimentos indisponíveis.</p>
                ) : (
                  <ApexRevenueDaily data={revenueDaily} />
                )}
              </div>
            </Card>
          </section>
        </RevealItem>

        {/* Fluxo de caixa + Período/Resultado */}
        {financeQ.error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Financeiro indisponível: {errorMessage(financeQ.error)}
            <p>Indicadores financeiros ocultos; demais áreas permanecem disponíveis.</p>
            <button onClick={() => financeQ.refetch()} className="font-medium underline">
              Tentar novamente
            </button>
          </div>
        ) : (
          <RevealItem>
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <Card>
                <CardHeader
                  className="flex-wrap"
                  title="Fluxo de caixa"
                  subtitle="Entradas e saídas ao longo do período selecionado."
                  action={
                    <SegmentedControl
                      size="sm"
                      aria-label="Agrupamento do fluxo de caixa"
                      value={period}
                      onChange={setPeriod}
                      options={[
                        { value: "day", label: "Diária" },
                        { value: "week", label: "Semanal" },
                        { value: "month", label: "Mensal" },
                        { value: "year", label: "Anual" },
                      ]}
                    />
                  }
                />

                <div className="h-[270px] animate-fade-in" key={period}>
                  {loading ? (
                    <Skeleton />
                  ) : (
                    <Chart
                      key={`${period}-${cashflow.map((d) => d.date).join()}`}
                      type="line"
                      height={270}
                      summary="Gráfico de entradas, saídas e resultado de caixa no período."
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
                                name: "Resultado de caixa",
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
                          animations: { enabled: true, easing: "easeinout", speed: 700 },
                        },
                        colors: [CHART_COLORS.danger, CHART_COLORS.success, CHART_COLORS.secondary],
                        stroke: {
                          width: [0, 0, 3],
                          curve: "straight",
                          dashArray: [0, 0, 0],
                        },
                        markers: {
                          size: [0, 0, 6],
                          strokeWidth: 2,
                          strokeColors: [chartColor(CHART_COLORS.secondary, mode)],
                          colors: [mode === "dark" ? "#1c1c1e" : "#ffffff"],
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
                          strokeDashArray: 0,
                          padding: { left: 15, right: 10 },
                        },
                        xaxis: {
                          categories: cashflow.map((d) => d.label),
                          labels: { offsetY: 6 },
                        },
                        yaxis: {
                          min: chartYMin,
                          max: chartYMax,
                          tickAmount: yaxisTickAmount,
                          labels: {
                            offsetX: -12,
                            formatter: (v: number) => {
                              if (v === 0) return "R$ 0";
                              const abs = Math.abs(v);
                              const sign = v < 0 ? "-" : "";
                              if (abs >= 1_000_000) {
                                return `${sign}R$ ${(abs / 1_000_000).toFixed(1).replace(".0", "")}M`;
                              }
                              if (abs >= 1000) {
                                return `${sign}R$ ${(abs / 1000).toFixed(0)}k`;
                              }
                              return `${sign}R$ ${abs}`;
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
                <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border-soft pt-4 text-xs font-medium text-muted-foreground">
                  <LegendDot color={chartColor(CHART_COLORS.success, mode)} label="Entradas" />
                  <LegendDot color={chartColor(CHART_COLORS.danger, mode)} label="Saídas" />
                  <LegendDot
                    color={chartColor(CHART_COLORS.secondary, mode)}
                    label="Resultado de caixa"
                    line
                  />
                </div>
              </Card>

              <div className="flex h-full flex-col gap-5">
                <Card>
                  <CardHeader
                    className="mb-3"
                    title="Período"
                    subtitle="Intervalo usado nos gráficos e indicadores do painel."
                  />
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

                <Card className="flex flex-1 flex-col justify-between">
                  <div>
                    <CardHeader
                      className="mb-3"
                      title="Resultado de caixa"
                      subtitle="Valores pagos no período e o previsto."
                      action={
                        <button
                          type="button"
                          aria-label={
                            showBalance
                              ? "Ocultar valores financeiros"
                              : "Mostrar valores financeiros"
                          }
                          aria-pressed={!showBalance}
                          onClick={() => setShowBalance((v) => !v)}
                          className="grid size-8 place-items-center rounded-full text-primary transition-colors hover:bg-primary/10"
                        >
                          {showBalance ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                      }
                    />
                    <div className="flex flex-col space-y-1">
                      <div
                        className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${balance.saldo < 0 ? "text-destructive" : "text-success"}`}
                      >
                        {showBalance ? (
                          <StatNumber value={balance.saldo} format={BRL} />
                        ) : (
                          "R$ ••••••"
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        de{" "}
                        <span
                          className={`font-semibold ${balance.saldoPrev < 0 ? "text-destructive" : "text-success"}`}
                        >
                          {showBalance ? BRL(balance.saldoPrev) : "R$ ••••••"}
                        </span>{" "}
                        previstos
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-4 border-t border-border-soft pt-4">
                    <div className="flex flex-col space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">Entradas</div>
                      <div className="flex items-center gap-1.5 text-lg font-semibold tabular-nums text-success">
                        {showBalance ? (
                          <StatNumber value={balance.entradas} format={BRL} />
                        ) : (
                          "R$ ••••"
                        )}
                        <Link
                          to="/financeiro"
                          className="text-primary"
                          aria-label="Abrir entradas no financeiro"
                        >
                          <ExternalLink size={12} />
                        </Link>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        de{" "}
                        <span className="font-semibold tabular-nums">
                          {showBalance ? BRL(balance.entradasPrev) : "R$ ••••"}
                        </span>{" "}
                        previsto
                      </div>
                    </div>
                    <div className="flex flex-col space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">Saídas</div>
                      <div className="flex items-center gap-1.5 text-lg font-semibold tabular-nums text-destructive">
                        {showBalance ? (
                          <StatNumber
                            value={balance.saidas}
                            format={(v) => (v === 0 ? "R$ 0,00" : `-${BRL(v)}`)}
                          />
                        ) : (
                          "R$ ••••"
                        )}
                        <Link
                          to="/financeiro"
                          className="text-primary"
                          aria-label="Abrir saídas no financeiro"
                        >
                          <ExternalLink size={12} />
                        </Link>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        de{" "}
                        <span className="font-semibold tabular-nums">
                          {showBalance
                            ? balance.saidasPrev === 0
                              ? "R$ 0,00"
                              : `-${BRL(balance.saidasPrev)}`
                            : "R$ ••••"}
                        </span>{" "}
                        previsto
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </section>
          </RevealItem>
        )}

        {/* Status e sexo à esquerda, aniversariantes à direita */}
        <RevealItem>
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card>
                <CardHeader
                  title="Status por agendamento"
                  subtitle={
                    topStatus
                      ? `Mais frequente: ${topStatus.name} (${topStatus.value})`
                      : "Sem agendamentos no período"
                  }
                />
                <div className="relative h-[240px]">
                  <ApexDonut
                    rows={statusData.rows}
                    centerLabel={String(statusData.total)}
                    centerSub="Agendamentos"
                  />
                </div>
                <PieLegend rows={statusData.rows} />
              </Card>

              <Card>
                <CardHeader
                  title="Pacientes por sexo"
                  subtitle={`${genderData.total} paciente${genderData.total === 1 ? "" : "s"} cadastrado${genderData.total === 1 ? "" : "s"}`}
                />
                <div className="relative h-[240px]">
                  <ApexDonut
                    rows={genderData.rows}
                    centerLabel={String(genderData.total)}
                    centerSub="Pacientes"
                  />
                </div>
                <PieLegend rows={genderData.rows} />
              </Card>
            </div>

            <Card>
              <CardHeader title="Próximos aniversariantes" subtitle={`Em ${monthName}`} />
              {birthdaysThisMonth.length === 0 ? (
                <EmptyBlock
                  title="Não há nada aqui!"
                  subtitle={`Nenhum aniversariante em ${monthName}`}
                />
              ) : (
                <ul className="space-y-3">
                  {birthdaysThisMonth.map((p) => (
                    <li key={p.id} className="flex items-center gap-3">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {p.name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="flex-1 truncate text-sm text-foreground">{p.name}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {parseISO(p.birth_date!).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </RevealItem>

        {/* Relatórios */}
        <RevealItem>
          <section aria-labelledby="dashboard-reports-title">
            <h2 id="dashboard-reports-title" className="mb-3 text-xl font-semibold text-foreground">
              Relatórios
            </h2>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader title={currentReport.title} subtitle={reportSummary} />
                  <SegmentedControl
                    size="sm"
                    aria-label="Tipo de relatório"
                    value={reportTab}
                    onChange={setReportTab}
                    className="mb-3 w-full"
                    options={[
                      { value: "prof", label: "Profissional" },
                      { value: "type", label: "Tipo" },
                      { value: "insurance", label: "Status" },
                      { value: "cat", label: "Financeiro" },
                    ]}
                  />
                  <div className="h-[240px]">
                    {reportTab === "cat" && financeQ.error ? (
                      <p className="text-sm text-muted-foreground">
                        Dados financeiros indisponíveis.
                      </p>
                    ) : reportRows.length === 0 ? (
                      <EmptyBlock small title="Sem dados" subtitle={currentReport.empty} />
                    ) : (
                      <ApexBar
                        categories={reportRows.map((d) => d.name)}
                        values={reportRows.map((d) => d.value)}
                        color={currentReport.color}
                        isCurrency={currentReport.isCurrency}
                        height={240}
                      />
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    title="Dias mais movimentados"
                    subtitle={
                      busiestDay.value > 0
                        ? `Maior movimento: ${busiestDay.name} (${busiestDay.value})`
                        : "Sem agendamentos no período"
                    }
                  />
                  <div className="h-[280px]">
                    <ApexBar
                      categories={busyDays.map((d) => d.name)}
                      values={busyDays.map((d) => d.value)}
                      color={CHART_COLORS.primarySoft}
                      height={280}
                      showValueLabels
                    />
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Horários mais movimentados"
                  subtitle="Agendamentos por hora e dia da semana."
                />
                <div className="max-h-[300px] overflow-auto">
                  <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
                    <thead>
                      <tr>
                        <th scope="col" className="w-8">
                          <span className="sr-only">Hora</span>
                        </th>
                        {WEEKDAYS.map((day) => (
                          <th
                            key={day}
                            scope="col"
                            className="text-center text-xs font-medium text-muted-foreground"
                          >
                            {day}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heat.hours.map((h, r) => (
                        <tr key={h}>
                          <th
                            scope="row"
                            className="w-8 pr-2 text-left text-xs font-normal text-muted-foreground"
                          >
                            {h}h
                          </th>
                          {heat.grid[r].map((v, c) => {
                            const alpha = heat.max === 0 ? 0 : v / heat.max;
                            const bg =
                              v === 0
                                ? "var(--muted)"
                                : `color-mix(in srgb, var(--primary) ${Math.round((0.15 + alpha * 0.75) * 100)}%, transparent)`;
                            return (
                              <td key={c}>
                                <div
                                  className="mx-auto h-5 w-8 rounded-md"
                                  style={{ background: bg }}
                                  title={`${WEEKDAYS[c]}, ${h}h: ${v} agendamento${v === 1 ? "" : "s"}`}
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
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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
    <div
      className={`flex flex-col items-center justify-center px-4 text-center ${small ? "py-6" : "py-10"}`}
    >
      <div
        className="mb-3 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Inbox size={18} />
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
    </div>
  );
}
function Skeleton() {
  return <div className="mc-skeleton h-full w-full rounded-xl" />;
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
          className="inline-block h-[2px] w-5"
          style={{
            background: color,
            borderTop: dashed ? `2px dashed ${color}` : undefined,
            backgroundColor: dashed ? "transparent" : color,
          }}
        />
      ) : (
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
function PieLegend({ rows }: { rows: { name: string; value: number; color: string }[] }) {
  const mode = useResolvedTheme();
  if (!rows.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {rows.map((r) => (
        <span key={r.name} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: chartColor(r.color, mode) }}
          />
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
  const [active, setActive] = useState<string>("month");

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
  const optionClass = (selected: boolean) =>
    `flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
      selected
        ? "bg-primary/10 font-medium text-primary"
        : "text-foreground hover:bg-foreground/[0.05]"
    }`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className={`flex h-11 items-center justify-between rounded-full border bg-card px-1.5 transition-colors ${open ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
      >
        <button
          type="button"
          onClick={() => onShift(-1)}
          aria-label="Período anterior"
          className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft size={16} />
        </button>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-8 flex-1 rounded-full text-sm font-medium tabular-nums text-foreground hover:bg-muted"
          >
            {label}
          </button>
        </PopoverTrigger>
        <button
          type="button"
          onClick={() => onShift(1)}
          aria-label="Próximo período"
          className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <PopoverContent align="center" sideOffset={8} className="w-64 rounded-xl p-1">
        {mode === "presets" ? (
          <ul className="space-y-0.5">
            {options.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  onClick={() => pick(o.key)}
                  className={optionClass(active === o.key)}
                >
                  <span>{o.label}</span>
                  {active === o.key && <Check size={14} aria-hidden="true" />}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setMode("custom")}
                className={optionClass(active === "custom")}
              >
                <span>Customizado</span>
                {active === "custom" && <Check size={14} aria-hidden="true" />}
              </button>
            </li>
          </ul>
        ) : (
          <div className="space-y-2 p-2">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Início</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm text-foreground"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Fim</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm text-foreground"
              />
            </label>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setMode("presets")}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Voltar
              </button>
              <Button size="sm" className="h-8" onClick={applyCustom}>
                Aplicar
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ApexRevenueDaily({ data }: { data: { name: string; value: number }[] }) {
  const mode = useResolvedTheme();
  const categories = data.map((d) => d.name);
  const series = [{ name: "Faturamento", data: data.map((d) => d.value) }];
  const options: ApexOptions = {
    chart: {
      animations: { enabled: true, speed: 500 },
    },
    colors: [CHART_COLORS.primary],
    plotOptions: {
      bar: { borderRadius: 6, columnWidth: "55%", borderRadiusApplication: "end" },
    },
    dataLabels: { enabled: false },
    grid: { strokeDashArray: 0, xaxis: { lines: { show: false } } },
    xaxis: { categories },
    yaxis: {
      labels: {
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
        shade: mode,
        type: "vertical",
        gradientToColors: [chartColor(CHART_COLORS.primarySoft, mode)],
        stops: [0, 100],
        opacityFrom: 1,
        opacityTo: 0.85,
      },
    },
  };
  return (
    <Chart
      type="bar"
      options={options}
      series={series}
      height={240}
      summary="Gráfico de recebimentos por dia no período."
    />
  );
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
  const mode = useResolvedTheme();
  const empty = mode === "dark" ? "#2a2a2e" : "#ededf0";
  const data = rows.length ? rows : [{ name: "—", value: 1, color: empty }];
  const subColor = chartColor(CHART_COLORS.primary, mode);
  const options: ApexOptions = {
    chart: { animations: { enabled: true, speed: 500 } },
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
              color: subColor,
              fontSize: "12px",
              fontWeight: 500,
              formatter: () => centerSub,
            },
            value: {
              show: true,
              offsetY: -12,
              color: chartColor(CHART_COLORS.ink, mode),
              fontSize: "28px",
              fontWeight: 600,
              formatter: () => centerLabel,
            },
            total: {
              show: true,
              label: centerSub,
              color: subColor,
              fontSize: "12px",
              formatter: () => centerLabel,
            },
          },
        },
      },
    },
  };
  return (
    <Chart
      type="donut"
      options={options}
      series={data.map((r) => r.value)}
      height="100%"
      summary={`${centerLabel} ${centerSub.toLowerCase()}: ${
        rows.map((r) => `${r.name} ${r.value}`).join(", ") || "sem dados"
      }.`}
    />
  );
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
  const mode = useResolvedTheme();
  const options: ApexOptions = {
    chart: {
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
      style: {
        fontSize: "12px",
        colors: [mode === "dark" ? "#a1a1a6" : "#636368"],
        fontWeight: 500,
      },
      formatter: (v) => String(v),
    },
    grid: { strokeDashArray: 0, xaxis: { lines: { show: false } } },
    xaxis: { categories },
    yaxis: {
      labels: {
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

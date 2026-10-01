import AppShell from "@/components/AppShell";
import { Card, CardHeader, KPICard, StatNumber } from "@/components/ds";
import { Chart, CHART_COLORS, chartColor } from "@/components/ds/Chart";
import { CashFlowChartCard } from "@/components/finance/CashFlowChartCard";
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
import { mergeWithLocalPatients } from "@/lib/local-patients";
import { calcCashFlow } from "@/lib/finance";
import { companyService, patientsService } from "@/services/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ApexOptions } from "apexcharts";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  ExternalLink,
  Eye,
  EyeOff,
  Inbox,
  LayoutGrid,
  Smile,
  TriangleAlert,
  User,
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
  patient_name?: string | null;
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
  // Últimos 30 dias + próximos 30 dias: mostra o que já entrou (ex.: sinal pago) e o que está
  // previsto (ex.: restante da consulta) mesmo quando caem em meses diferentes.
  const base = new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 30);
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
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("week");
  const [range, setRange] = useState<[Date, Date]>(initialRange());
  const [showBalance, setShowBalance] = useState(true);
  const [reportTab, setReportTab] = useState<"prof" | "type" | "insurance" | "cat">("prof");
  const [financeVersion, setFinanceVersion] = useState(0);

  // Sincronização em tempo real do financeiro, agendamentos e pacientes
  useEffect(() => {
    // 1. Escuta alterações no localStorage (exclusão, estorno, novos agendamentos e lançamentos)
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("medcore_")) {
        setFinanceVersion((v) => v + 1);
        void qc.invalidateQueries({ queryKey: ["financial-snapshot"], refetchType: "all" });
        void qc.invalidateQueries({ queryKey: ["cash-flow-snapshot"], refetchType: "all" });
        void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "all" });
        void qc.invalidateQueries({ queryKey: ["dashboard", "events-appointments"], refetchType: "all" });
        void qc.invalidateQueries({ queryKey: ["dashboard", "patients"], refetchType: "all" });
      }
    };
    window.addEventListener("storage", handleStorage);

    // 2. Escuta eventos customizados disparados nas telas do sistema
    const handleCustomEvents = () => {
      setFinanceVersion((v) => v + 1);
      void qc.invalidateQueries({ queryKey: ["financial-snapshot"], refetchType: "all" });
      void qc.invalidateQueries({ queryKey: ["cash-flow-snapshot"], refetchType: "all" });
      void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "all" });
      void qc.invalidateQueries({ queryKey: ["dashboard", "events-appointments"], refetchType: "all" });
      void qc.invalidateQueries({ queryKey: ["dashboard", "patients"], refetchType: "all" });
    };
    window.addEventListener("medcore_events_updated", handleCustomEvents);
    window.addEventListener("medcore_local_title_saved", handleCustomEvents);
    window.addEventListener("medcore_patients_updated", handleCustomEvents);

    // 3. Realtime do Supabase para alterações no banco
    const ch = supabase
      .channel("dashboard-financial-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
        setFinanceVersion((v) => v + 1);
        void refreshFinance(qc);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "transaction_payments" }, () => {
        setFinanceVersion((v) => v + 1);
        void refreshFinance(qc);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        setFinanceVersion((v) => v + 1);
        void qc.invalidateQueries({ queryKey: ["dashboard", "events-appointments"] });
        void refreshFinance(qc);
      })
      .subscribe();

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("medcore_events_updated", handleCustomEvents);
      window.removeEventListener("medcore_local_title_saved", handleCustomEvents);
      window.removeEventListener("medcore_patients_updated", handleCustomEvents);
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const apptsQ = useQuery({
    queryKey: ["dashboard", "events-appointments"],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data: eventRows, error: eventsError } = await supabase
        .from("events")
        .select("id, title, description, starts_at, ends_at, assigned_to, case_id, patient_id, created_at")
        .order("starts_at", { ascending: true });
      if (eventsError) throw eventsError;
      const rawList: any[] = [...(eventRows ?? [])];

      // Consultas registradas apenas na tabela appointments (mesmo id do evento quando criadas pela agenda)
      const { data: apptRows, error: apptError } = await supabase
        .from("appointments")
        .select("id, date, start_time, end_time, patient_id, doctor_id, type, status, notes, created_at")
        .order("date", { ascending: true })
        .limit(200);
      if (apptError) throw apptError;
      const existingIds = new Set(rawList.map((e) => e.id));
      (apptRows ?? []).forEach((a: any) => {
        if (existingIds.has(a.id)) return;
        rawList.push({
          id: a.id,
          title: a.type || "Consulta",
          description: a.notes,
          starts_at: `${a.date}T${a.start_time || "08:00"}:00`,
          ends_at: `${a.date}T${a.end_time || a.start_time || "08:30"}:00`,
          assigned_to: a.doctor_id,
          patient_id: a.patient_id,
          status: a.status || "agendado",
          event_type: a.type || "atendimento",
          created_at: a.created_at,
        });
      });

      const allMerged = rawList;

      return allMerged.map((e) => {
        const meta = parseMeta(e.description);
        const startsAt = e.starts_at
          ? new Date(e.starts_at)
          : e.start_time
            ? new Date(e.start_time)
            : new Date();
        const endsAt = e.ends_at
          ? new Date(e.ends_at)
          : e.end_time
            ? new Date(e.end_time)
            : new Date(startsAt.getTime() + 30 * 60_000);

        const y = startsAt.getFullYear();
        const m = String(startsAt.getMonth() + 1).padStart(2, "0");
        const d = String(startsAt.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;

        const startStr =
          e.start_time && e.start_time.length === 5
            ? e.start_time
            : startsAt.toTimeString().slice(0, 5);
        const endStr =
          e.end_time && e.end_time.length === 5
            ? e.end_time
            : endsAt.toTimeString().slice(0, 5);

        return {
          id: e.id,
          patient_id: e.patient_id || meta?.clientId || e.case_id || null,
          patient_name: e.patient_name || null,
          doctor_id: e.assigned_to || e.doctor_id || null,
          date: dateStr,
          start_time: startStr,
          end_time: endStr,
          status: meta?.status || e.status || "agendado",
          type: meta?.type || e.event_type || "atendimento",
          color: meta?.color || e.color || CHART_COLORS.primary,
          title: e.title || e.patient_name || "Agendamento",
          when: startsAt,
        };
      }) as Appt[];
    },
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const patientsQ = useQuery({
    queryKey: ["dashboard", "patients"],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let list: Patient[] = [];
      try {
        const phpPat = await patientsService.getPatients({ limit: 500 });
        if (phpPat && Array.isArray(phpPat) && phpPat.length > 0) {
          list = phpPat.map((p) => ({
            id: p.id,
            name: p.name,
            gender: p.gender || null,
            birth_date: p.birth_date || null,
          })) as Patient[];
        }
      } catch {}
      if (list.length === 0) {
        const { data } = await supabase.from("patients").select("id,name,gender,birth_date");
        list = (data ?? []) as Patient[];
      }
      return mergeWithLocalPatients(list) as Patient[];
    },
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const financeQ = useQuery({
    queryKey: ["financial-snapshot"],
    queryFn: getFinancialSnapshot,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
    if (!financeQ.data) return [];
    return reportingRows(financeQ.data);
  }, [financeQ.data, financeVersion]);
  const doctors = doctorsQ.data ?? [];
  const loading =
    apptsQ.isLoading || patientsQ.isLoading || financeQ.isLoading || doctorsQ.isLoading;

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
    const normalizeKey = (s: string) => {
      const l = (s || "").toLowerCase();
      if (l === "agendado" || l === "scheduled") return "scheduled";
      if (l === "confirmado" || l === "confirmed") return "confirmed";
      if (l === "finalizado" || l === "completed" || l === "realizado") return "completed";
      if (l === "cancelado" || l === "cancelled") return "cancelled";
      if (l === "faltou" || l === "no_show") return "no_show";
      return l || "scheduled";
    };

    apptsInRange.forEach((a) => {
      const k = normalizeKey(a.status);
      map[k] = (map[k] ?? 0) + 1;
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

  // Próximas 24h a 36h: cobre todos os atendimentos previstos para hoje e amanhã
  const next24h = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endWindow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59, 999);

    return appts
      .map((a) => {
        let when = a.when;
        if (!when || isNaN(when.getTime())) {
          const [y, m, d] = (a.date || "").split("-").map(Number);
          const [hh, mm] = (a.start_time || "08:00").split(":").map(Number);
          when = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 8, mm ?? 0, 0);
        }
        return { ...a, when };
      })
      .filter((a) => {
        if (!a.when || isNaN(a.when.getTime())) return false;
        const st = (a.status || "").toLowerCase();
        if (st === "cancelado" || st === "cancelled") return false;
        return a.when >= startOfToday && a.when <= endWindow;
      })
      .sort((a, b) => a.when!.getTime() - b.when!.getTime());
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

  const hidden = "R$ ••••••";
  const reportIcons = { prof: User, type: ClipboardList, insurance: Smile, cat: LayoutGrid } as const;

  return (
    <AppShell title="Dashboard">
      <div className="page-container space-y-6 pb-12">
        {/* Linha 1: Fluxo de caixa | Filtros + Balanço */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <CashFlowChartCard
            rows={tx}
            range={range}
            period={period}
            onPeriodChange={setPeriod}
            loading={financeQ.isLoading}
            error={financeQ.error ? errorMessage(financeQ.error) : null}
            onRetry={() => void financeQ.refetch()}
            hideValues={!showBalance}
          />

          <div className="flex flex-col gap-3">
            <SectionTitle title="Filtros" />
            <div className="rounded-2xl bg-card p-4 shadow-xs">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Período</p>
              <PeriodPicker
                range={range}
                onChange={(r, p) => {
                  setRange(r);
                  if (p) setPeriod(p);
                }}
                onShift={(dir) => setRange(shiftRange(period, rangeStart, rangeEnd, dir))}
                label={rangeLabel}
              />
            </div>

            <SectionTitle title="Balanço" help="Valores pagos no período e o total previsto." />
            <div className="flex-1 rounded-2xl bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div
                    className={`text-xl font-semibold tabular-nums ${balance.saldo < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {showBalance ? <StatNumber value={balance.saldo} format={BRL} /> : hidden}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    de {showBalance ? BRL(balance.saldoPrev) : hidden} previsto
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={showBalance ? "Ocultar valores" : "Mostrar valores"}
                  aria-pressed={!showBalance}
                  onClick={() => setShowBalance((v) => !v)}
                  className="grid size-8 cursor-pointer place-items-center rounded-full text-primary hover:bg-primary/10"
                >
                  {showBalance ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-foreground">Entradas:</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-success">
                    {showBalance ? BRL(balance.entradas) : hidden}
                    <Link to="/financeiro" aria-label="Abrir entradas" className="text-primary">
                      <ExternalLink size={13} />
                    </Link>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    de {showBalance ? BRL(balance.entradasPrev) : hidden} previsto
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-foreground">Saídas:</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-destructive">
                    {showBalance ? (balance.saidas ? `-${BRL(balance.saidas)}` : BRL(0)) : hidden}
                    <Link to="/financeiro" aria-label="Abrir saídas" className="text-primary">
                      <ExternalLink size={13} />
                    </Link>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    de {showBalance ? (balance.saidasPrev ? `-${BRL(balance.saidasPrev)}` : BRL(0)) : hidden}{" "}
                    previsto
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Linha 2: Agendamentos das próximas 24h | Próximos aniversariantes */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-3">
            <SectionTitle title="Agendamentos das próximas 24h" />
            <div className="min-h-[150px] flex-1 rounded-2xl bg-card p-4 shadow-xs">
              {next24h.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum agendamento nas próximas 24 horas.
                </p>
              ) : (
                <ul className="space-y-2">
                  {next24h.slice(0, 6).map((a) => {
                    const pat = patients.find((p) => p.id === a.patient_id);
                    const name = (a as any).patient_name || pat?.name || a.title || "Agendamento";
                    const typeLabel = (a.type || "Atendimento").replace(/^\w/, (c) => c.toUpperCase());
                    const isToday = a.date === toISO(new Date());
                    return (
                      <li key={a.id}>
                        <Link
                          to="/agenda"
                          className="block rounded-md border-l-[3px] border-primary bg-primary/15 px-3 py-2 transition-colors hover:bg-primary/20"
                        >
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
                            <span className="truncate">{name}</span>
                          </span>
                          <span className="block text-xs text-foreground/80">{typeLabel}</span>
                          <span className="block text-xs tabular-nums text-foreground/80">
                            {!isToday && a.date ? `${a.date.slice(8, 10)}/${a.date.slice(5, 7)} · ` : ""}
                            {a.start_time} - {a.end_time}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <SectionTitle title="Próximos aniversariantes" />
            <div className="min-h-[150px] flex-1 rounded-2xl bg-card p-4 shadow-xs">
              {birthdaysThisMonth.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-6 text-center">
                  <TriangleAlert size={20} className="text-primary" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-foreground">Não há nada aqui!</p>
                  <p className="text-xs text-muted-foreground">Nenhum aniversariante em {monthName}</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {birthdaysThisMonth.map((p) => (
                    <li key={p.id} className="flex items-center gap-3">
                      <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {initialsOf(p.name)}
                      </span>
                      <span className="flex-1 truncate text-sm text-foreground">{p.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {parseISO(p.birth_date!).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* Relatórios */}
        <section className="space-y-3" aria-labelledby="dashboard-reports-title">
          <h2 id="dashboard-reports-title" className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
            Relatórios <Help text="Indicadores do período selecionado nos filtros." />
          </h2>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="overflow-hidden rounded-2xl bg-card shadow-xs">
              <div className="grid grid-cols-4 border-b border-border-soft" role="tablist" aria-label="Tipo de relatório">
                {(Object.keys(reportIcons) as (keyof typeof reportIcons)[]).map((key) => {
                  const Icon = reportIcons[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={reportTab === key}
                      aria-label={reportMap[key].title}
                      title={reportMap[key].title}
                      onClick={() => setReportTab(key)}
                      className={`grid h-10 cursor-pointer place-items-center border-b-2 transition-colors ${
                        reportTab === key
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon size={16} />
                    </button>
                  );
                })}
              </div>
              <div className="p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {currentReport.title} <Help text={reportSummary} />
                </h3>
                <div className="mt-3 h-[220px]">
                  {reportTab === "cat" && financeQ.error ? (
                    <p className="text-sm text-muted-foreground">Dados financeiros indisponíveis.</p>
                  ) : reportRows.length === 0 ? (
                    <p className="py-16 text-center text-sm text-muted-foreground">{currentReport.empty}</p>
                  ) : reportTab === "cat" ? (
                    <ApexBar
                      categories={reportRows.map((d) => d.name)}
                      values={reportRows.map((d) => d.value)}
                      color={CHART_COLORS.primarySoft}
                      isCurrency
                      height={220}
                    />
                  ) : (
                    <PillBars rows={reportRows} />
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-card p-4 shadow-xs">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                Dias mais movimentados{" "}
                <Help
                  text={
                    busiestDay.value > 0
                      ? `Maior movimento: ${busiestDay.name} (${busiestDay.value})`
                      : "Sem agendamentos no período"
                  }
                />
              </h3>
              <div className="mt-2 h-[260px]">
                <ApexBar
                  categories={busyDays.map((d) => d.name.charAt(0))}
                  values={busyDays.map((d) => d.value)}
                  color={CHART_COLORS.primarySoft}
                  height={260}
                  showValueLabels
                  hideYAxis
                />
              </div>
            </div>

            <div className="rounded-2xl bg-card p-4 shadow-xs">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                Horários mais movimentados <Help text="Agendamentos por hora e dia da semana." />
              </h3>
              <div className="mt-3 max-h-[250px] overflow-y-auto pr-1">
                <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Hora</th>
                      {WEEKDAYS.map((d) => (
                        <th key={d} scope="col">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heat.hours.map((h, r) => (
                      <tr key={h}>
                        <th scope="row" className="w-9 pr-1 text-left text-[11px] font-normal text-muted-foreground">
                          {String(h).padStart(2, "0")}h
                        </th>
                        {heat.grid[r].map((v, c) => {
                          const alpha = heat.max === 0 ? 0 : v / heat.max;
                          return (
                            <td key={c}>
                              <div
                                className="h-4 rounded-[3px]"
                                style={{
                                  background:
                                    v === 0
                                      ? "color-mix(in srgb, var(--muted-foreground) 12%, transparent)"
                                      : `color-mix(in srgb, var(--primary) ${Math.round((0.35 + alpha * 0.4) * 100)}%, transparent)`,
                                }}
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
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <DonutCard
              title="Status por agendamento"
              rows={statusData.rows}
              total={statusData.total}
              centerSub="Agendamentos"
              footer={`${statusData.total} agendamentos no período`}
            />
            <DonutCard
              title="Pacientes por sexo"
              rows={genderData.rows}
              total={genderData.total}
              centerSub="Pacientes"
              footer={`${genderData.total} pacientes no período`}
            />
            <div className="rounded-2xl bg-card p-4 shadow-xs">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                Faturamento comparado{" "}
                <Help text={showBalance ? `${BRL(revenueTotal)} recebidos no período` : "Valores ocultos"} />
              </h3>
              <div className="mt-2 h-[240px]">
                {financeQ.error ? (
                  <p className="text-sm text-muted-foreground">Recebimentos indisponíveis.</p>
                ) : (
                  <ApexRevenueDaily data={revenueDaily} />
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

// ---------- layout do modelo de referência ----------
const FLOW_COLORS = ["#22d061", "#aef0c4", "#ff3358", "#ffa3b3", "#3b82f6", "#9cc3fb"];
const DONUT_COLORS = ["#ffd96a", "#8b6dff", "#22d061", "#ff3358", "#3b82f6", "#a1a1aa"];

function niceAxis(max: number, min: number) {
  const span = Math.max(max - min, 1);
  const rough = span / 6;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const top = max > 0 ? Math.ceil((max * 1.1) / step) * step : step;
  const bottom = min < 0 ? Math.floor((min * 1.1) / step) * step : 0;
  return { min: bottom, max: top, ticks: Math.round((top - bottom) / step) };
}

function shortBRL(v: number) {
  if (v === 0) return "R$ 0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (abs >= 1000) return `${sign}R$ ${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return `${sign}R$ ${Math.round(abs)}`;
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function Help({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} role="img" className="inline-flex cursor-help text-muted-foreground">
      <CircleHelp size={15} />
    </span>
  );
}

function SectionTitle({ title, help }: { title: string; help?: string }) {
  return (
    <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
      {title}
      {help && <Help text={help} />}
    </h2>
  );
}

function LegendSquare({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block size-2.5 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Barras verticais em formato de pílula com as iniciais na base (agendamentos por profissional). */
function PillBars({ rows }: { rows: { name: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex h-full items-end justify-center gap-4 overflow-x-auto pb-1">
      {rows.slice(0, 8).map((r) => (
        <div key={r.name} className="flex h-full flex-col items-center justify-end gap-1.5" title={`${r.name}: ${r.value}`}>
          <div
            className="relative flex w-10 items-end justify-center rounded-full bg-primary/20"
            style={{ height: `calc((100% - 22px) * ${Math.max(r.value / max, 0.25)})` }}
          >
            <span className="mb-1 grid size-8 place-items-center rounded-full bg-card text-[10px] font-semibold text-foreground shadow-xs">
              {initialsOf(r.name) || "—"}
            </span>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function DonutCard({
  title,
  rows,
  total,
  centerSub,
  footer,
}: {
  title: string;
  rows: { name: string; value: number; color: string }[];
  total: number;
  centerSub: string;
  footer: string;
}) {
  const colored = rows.map((r, i) => ({ ...r, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  return (
    <div className="rounded-2xl bg-card p-4 shadow-xs">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {title}{" "}
        <Help text={colored.map((r) => `${r.name}: ${r.value}`).join(" · ") || "Sem dados no período"} />
      </h3>
      <div className="relative mt-2 h-[210px]">
        <ApexDonut rows={colored} centerLabel={String(total)} centerSub={centerSub} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{footer}</p>
    </div>
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
  const subColor = chartColor(CHART_COLORS.neutral, mode);
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
          size: "80%",
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
  hideYAxis,
}: {
  categories: string[];
  values: number[];
  color: string;
  isCurrency?: boolean;
  height?: number | string;
  showValueLabels?: boolean;
  hideYAxis?: boolean;
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
    grid: { show: !hideYAxis, strokeDashArray: 0, xaxis: { lines: { show: false } } },
    xaxis: { categories },
    yaxis: {
      show: !hideYAxis,
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

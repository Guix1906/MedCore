import { PageHeader } from "@/components/ui-app/PageHeader";
import { changeTreatmentStatus } from "@/features/acompanhamentos/ClinicalFollowup";
import {
  errorMessage,
  formatClinicalDate,
  localDate,
  PAYMENT_METHODS,
  paymentMethodLabel,
  protocolDeadline,
} from "@/features/acompanhamentos/followup-utils";
import type { DbRow } from "@/lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Activity,
  Calendar as CalIcon,
  User as UserIcon,
  ArrowRight,
  X,
  LayoutGrid,
  Kanban,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageCircle,
  FileText,
  TrendingUp,
  Sparkles,
  ChevronRight,
  Edit3,
  Trash2,
  ExternalLink,
  Save,
  PauseCircle,
  PlayCircle,
  DollarSign,
  Pill,
  Wallet,
  UserPlus,
  ChevronDown,
  Check,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { refreshFinance, getFinancialSnapshot } from "@/features/finance/finance-api";
import { isFreeBalance, remaining } from "@/features/finance/finance-math";
import { patientsService, companyService } from "@/services/api";
import { getStoredLocalPatients, mergeWithLocalPatients } from "@/lib/local-patients";
import { PatientModal } from "@/components/pacientes/PatientModal";
import { todayLocal, formatDateOnly } from "@/lib/date-utils";
import {
  WeightGoalFields,
  hasWeightGoal,
  saveWeightGoal,
  weightGoalForm,
} from "@/features/acompanhamentos/WeightGoal";

export const Route = createFileRoute("/_authenticated/acompanhamentos")({
  head: () => ({
    meta: [
      { title: "Acompanhamentos • MedCore" },
      {
        name: "description",
        content: "Gestão completa de tratamentos, fases clínicas e acompanhamentos.",
      },
    ],
  }),
  // Busca, filtros, ordem e visualização ficam na URL: voltar de um plano mantém a lista como estava
  validateSearch: (search: Record<string, unknown>): ListSearch => {
    const pick = <T extends string>(v: unknown, opts: readonly T[]): T | undefined =>
      opts.includes(v as T) ? (v as T) : undefined;
    return {
      q: typeof search.q === "string" && search.q ? search.q : undefined,
      status: pick(search.status, STATUS_FILTERS),
      filtro: pick(search.filtro, QUICK_FILTERS),
      ordem: pick(search.ordem, SORTS),
      view: pick(search.view, ["cards", "kanban"] as const),
      cidade: typeof search.cidade === "string" && search.cidade ? search.cidade : undefined,
    };
  },
  component: AcompanhamentosPage,
});

const STATUS_FILTERS = ["todos", "em_andamento", "pausado", "finalizado", "cancelado"] as const;
const QUICK_FILTERS = ["retorno", "terminando", "atrasado"] as const;
const SORTS = ["retorno", "recentes", "nome", "prazo"] as const;
type ListSearch = {
  q?: string;
  status?: (typeof STATUS_FILTERS)[number];
  filtro?: (typeof QUICK_FILTERS)[number];
  ordem?: (typeof SORTS)[number];
  view?: "cards" | "kanban";
  cidade?: string;
};

const NO_CITY = "Sem cidade";
const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);
/** Cidade do paciente do plano, normalizada: "barra do corda " = "Barra do Corda". */
const cityOf = (t: Treatment) => {
  const c = (t.patients?.city ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  if (!c) return NO_CITY;
  return c
    .split(" ")
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1)))
    .join(" ");
};
/** Chave sem acento: "Grajau" e "Grajaú" são a mesma cidade. */
const cityKey = (c: string) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sameCity = (a: string, b: string) =>
  a.localeCompare(b, "pt-BR", { sensitivity: "base" }) === 0;
const SORT_LABEL: Record<(typeof SORTS)[number], string> = {
  retorno: "Próximo retorno",
  prazo: "Fim do protocolo",
  recentes: "Mais recentes",
  nome: "Nome do paciente",
};

export type Treatment = {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  title: string;
  objective: string | null;
  start_date: string;
  end_date: string | null;
  status: "em_andamento" | "pausado" | "finalizado" | "cancelado";
  total_value: number;
  down_payment: number;
  discount: number;
  installments_count: number;
  payment_method: string | null;
  payment_type?: "a_vista" | "parcelado" | string | null;
  down_payment_method?: string | null;
  down_payment_due_date?: string | null;
  first_due_date?: string | null;
  color: string;
  return_days: number | null;
  next_return_date: string | null;
  notes: string | null;
  created_at: string;
  patients?: { name: string; phone?: string | null; city?: string | null } | null;
  doctors?: { name: string } | null;
};

// Fundo de status: 14% do token sobre qualquer superfície (claro ou escuro).
const tint = (token: string) => `color-mix(in srgb, var(${token}) 14%, transparent)`;

const STATUS_LABEL: Record<Treatment["status"], { label: string; bg: string; fg: string }> = {
  em_andamento: { label: "Em andamento", bg: tint("--success"), fg: "var(--success)" },
  pausado: { label: "Pausado", bg: tint("--warning"), fg: "var(--warning)" },
  finalizado: { label: "Finalizado", bg: tint("--info"), fg: "var(--info)" },
  cancelado: { label: "Cancelado", bg: tint("--destructive"), fg: "var(--destructive)" },
};

const COLORS = ["#8B47FF", "#6C4CF7", "#10B981", "#F59E0B", "#EC4899", "#0EA5E9", "#EF4444"];

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function parseBrlNumber(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  const s = String(val).trim();
  if (!s) return 0;
  if (s.includes(",")) {
    const cleaned = s.replace(/\./g, "").replace(",", ".");
    return Number(cleaned) || 0;
  }
  // "1.500" / "12.000.000" sem vírgula: pontos são separador de milhar
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, "")) || 0;
  return Number(s) || 0;
}

// Valor líquido contratado (bruto menos desconto): é o que o paciente efetivamente deve.
const netValue = (t: Pick<Treatment, "total_value" | "discount">) =>
  Math.max(0, Number(t.total_value || 0) - Number(t.discount || 0));

const daysBetween = (a: string | Date, b: string | Date) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

function computeProgress(t: Treatment) {
  if (t.status === "finalizado") return 100;
  const totalDays = t.end_date ? daysBetween(t.start_date, t.end_date) : (t.return_days ?? 90);
  if (totalDays <= 0) return 0;
  const passed = Math.max(0, daysBetween(t.start_date, new Date()));
  return Math.min(100, Math.round((passed / totalDays) * 100));
}

function AcompanhamentosPage() {
  const routerState = useRouterState();
  const isChildRoute = routerState.location.pathname !== "/acompanhamentos";

  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigateList = Route.useNavigate();
  const setSearch = (patch: Partial<ListSearch>) =>
    void navigateList({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  // A busca digitada fica local e vai para a URL com atraso, para não navegar a cada tecla
  const [q, setQ] = useState(search.q ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== q) setSearch({ q: q || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const statusFilter = search.status ?? "em_andamento";
  const quickFilter = search.filtro;
  const sortBy = search.ordem ?? "retorno";
  const viewMode = search.view ?? "cards";
  const setStatusFilter = (status: (typeof STATUS_FILTERS)[number]) =>
    setSearch({ status, filtro: undefined });
  const setViewMode = (view: "cards" | "kanban") => setSearch({ view });
  const [openNew, setOpenNew] = useState(false);
  const [selectedTreatment, setSelectedTreatment] = useState<Treatment | null>(null);

  const {
    data: rows = [],
    isLoading: loading,
    error: listError,
  } = useQuery({
    queryKey: ["treatments-list"],
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatments")
        .select("*, patients(name, phone, city), doctors(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = data as Treatment[];

      // Enriquecer com pacientes locais se patients vier null
      const localPats = getStoredLocalPatients();
      return list.map((t) => {
        if (!t.patients && t.patient_id) {
          const match = localPats.find((lp) => lp.id === t.patient_id);
          if (match) {
            return {
              ...t,
              patients: { name: match.name, phone: match.phone, city: (match as { city?: string | null }).city ?? null },
            };
          }
        }
        return t;
      });
    },
  });

  const { data: treatmentPaymentsMap = {} } = useQuery({
    queryKey: ["treatments-payments-summary"],
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const snap = await getFinancialSnapshot();
        const today = localDate();
        const map: Record<
          string,
          { paid: number; total: number; titlesCount: number; overdue: number }
        > = {};
        for (const t of snap.titles) {
          if (!t.treatment_id) continue;
          if (!map[t.treatment_id])
            map[t.treatment_id] = { paid: 0, total: 0, titlesCount: 0, overdue: 0 };
          map[t.treatment_id].paid += Number(t.paid_amount || 0);
          map[t.treatment_id].total += Number(t.amount || 0);
          map[t.treatment_id].titlesCount += 1;
          // Parcela com vencimento passado e saldo em aberto (saldo livre não atrasa)
          if (!isFreeBalance(t) && t.due_date && t.due_date < today)
            map[t.treatment_id].overdue += remaining(t);
        }
        return map;
      } catch (err) {
        console.warn("Erro ao buscar snapshot financeiro para acompanhamentos:", err);
        return {};
      }
    },
  });

  const load = () => {
    queryClient.invalidateQueries({ queryKey: ["treatments-list"] });
    queryClient.invalidateQueries({ queryKey: ["treatments-payments-summary"] });
    queryClient.invalidateQueries({ queryKey: ["treatment-alerts"] });
  };

  // Situações que pedem ação, calculadas dos próprios planos (mesma regra dos cards)
  const today = localDate();
  const in7days = todayLocal(7);
  const isReturnLate = (t: Treatment) =>
    t.status === "em_andamento" && !!t.next_return_date && t.next_return_date <= today;
  const isEnding = (t: Treatment) =>
    t.status === "em_andamento" && !!t.end_date && t.end_date >= today && t.end_date <= in7days;
  const isPaymentLate = (t: Treatment) =>
    t.status !== "cancelado" && (treatmentPaymentsMap[t.id]?.overdue ?? 0) > 0;
  const quickTests: Record<(typeof QUICK_FILTERS)[number], (t: Treatment) => boolean> = {
    retorno: isReturnLate,
    terminando: isEnding,
    atrasado: isPaymentLate,
  };

  const cityFilter = search.cidade;
  // Mesmos filtros da lista, menos a cidade: base da contagem "Planos por cidade"
  const passesStatus = (r: Treatment) => {
    if (quickFilter) return quickTests[quickFilter](r);
    return viewMode === "kanban" || statusFilter === "todos" || r.status === statusFilter;
  };

  const cityCounts = useMemo(() => {
    const map = new Map<string, { city: string; total: number; ativos: number }>();
    for (const r of rows) {
      if (!passesStatus(r)) continue;
      const city = cityOf(r);
      const key = cityKey(city);
      const c = map.get(key) ?? { city, total: 0, ativos: 0 };
      // Entre as grafias da mesma cidade, mostra a acentuada ("Grajaú")
      if (city !== c.city && city.normalize("NFD").length > c.city.normalize("NFD").length) c.city = city;
      c.total++;
      if (r.status === "em_andamento") c.ativos++;
      map.set(key, c);
    }
    return [...map.values()].sort(
      (a, b) =>
        Number(a.city === NO_CITY) - Number(b.city === NO_CITY) ||
        b.total - a.total ||
        a.city.localeCompare(b.city, "pt-BR"),
    );
  }, [rows, statusFilter, quickFilter, viewMode, treatmentPaymentsMap]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (cityFilter && !sameCity(cityOf(r), cityFilter)) return false;
      // Atalho de situação substitui o filtro de status (já considera só planos ativos)
      if (quickFilter) {
        if (!quickTests[quickFilter](r)) return false;
      } else if (
        // O Kanban já separa por situação: lá o filtro de status esconderia colunas inteiras
        viewMode !== "kanban" &&
        statusFilter !== "todos" &&
        r.status !== statusFilter
      )
        return false;
      if (!s) return true;
      return (
        r.title.toLowerCase().includes(s) ||
        r.patients?.name?.toLowerCase().includes(s) ||
        r.doctors?.name?.toLowerCase().includes(s) ||
        r.patients?.city?.toLowerCase().includes(s)
      );
    });
    const byDate = (a: string | null, b: string | null) => (a || "9999").localeCompare(b || "9999");
    return list.sort((a, b) =>
      sortBy === "nome"
        ? (a.patients?.name || "").localeCompare(b.patients?.name || "", "pt-BR")
        : sortBy === "recentes"
          ? b.created_at.localeCompare(a.created_at)
          : sortBy === "prazo"
            ? byDate(a.end_date, b.end_date)
            : byDate(a.next_return_date, b.next_return_date),
    );
  }, [rows, q, statusFilter, quickFilter, sortBy, viewMode, treatmentPaymentsMap, cityFilter]);

  const multipleDoctors = useMemo(
    () => new Set(rows.map((r) => r.doctor_id).filter(Boolean)).size > 1,
    [rows],
  );

  const kpis = useMemo(() => {
    const ativos = rows.filter((r) => r.status === "em_andamento").length;
    const retornos = rows.filter(isReturnLate).length;
    const terminando = rows.filter(isEnding).length;
    const atrasados = rows.filter(isPaymentLate).length;
    // A receber: líquido contratado menos o que já entrou, dos planos não cancelados
    const aReceber = rows
      .filter((r) => r.status !== "cancelado")
      .reduce((s, r) => s + Math.max(0, netValue(r) - (treatmentPaymentsMap[r.id]?.paid ?? 0)), 0);
    return { ativos, retornos, terminando, atrasados, aReceber };
  }, [rows, treatmentPaymentsMap]);

  // Agrupamento para Visão Kanban por situação operacional e prazo transcorrido
  const kanbanColumns = useMemo(() => {
    const c1: Treatment[] = [];
    const c2: Treatment[] = [];
    const c3: Treatment[] = [];
    const c4: Treatment[] = [];

    filtered.forEach((t) => {
      if (t.status === "cancelado") return;
      if (t.status === "finalizado") {
        c4.push(t);
      } else if (t.status === "pausado") {
        c3.push(t);
      } else {
        const prog = computeProgress(t);
        if (prog <= 50) c1.push(t);
        else c2.push(t);
      }
    });

    return [
      {
        id: "em_andamento_inicial",
        title: "Em Andamento (1ª metade)",
        subtitle: "Até 50% do prazo do plano",
        badge: `${c1.length}`,
        color: "var(--primary)",
        items: c1,
      },
      {
        id: "em_andamento_avancado",
        title: "Em Andamento (Reta final)",
        subtitle: "Mais de 50% do prazo do plano",
        badge: `${c2.length}`,
        color: "var(--info)",
        items: c2,
      },
      {
        id: "pausados",
        title: "Pausados & Em Espera",
        subtitle: "Pausado ou aguardando paciente",
        badge: `${c3.length}`,
        color: "var(--warning)",
        items: c3,
      },
      {
        id: "concluidos",
        title: "Concluídos & Alta",
        subtitle: "Protocolos finalizados",
        badge: `${c4.length}`,
        color: "var(--success)",
        items: c4,
      },
    ];
  }, [filtered]);

  const openWhatsAppPatient = (e: React.MouseEvent, t: Treatment) => {
    e.preventDefault();
    e.stopPropagation();
    const phone = t.patients?.phone?.replace(/\D/g, "");
    if (!phone) {
      toast.info("Paciente sem telefone cadastrado");
      return;
    }
    const msg = encodeURIComponent(
      `Olá ${t.patients?.name}! Entramos em contato da clínica sobre o seu acompanhamento "${t.title}". Como você está se sentindo?`,
    );
    window.open(`https://wa.me/55${phone}?text=${msg}`, "_blank");
  };

  if (isChildRoute) {
    return <Outlet />;
  }

  return (
    <AppShell title="Acompanhamentos">
      <div className="page-container space-y-5">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3">
          <PageHeader title="Acompanhamentos" icon={Activity} className="mb-0" />

          <div className="flex shrink-0 items-center gap-2">
            {/* Alternador Cards / Kanban: só ícones, para não quebrar linha */}
            <div className="flex items-center bg-muted p-1 rounded-xl" role="group" aria-label="Visualização">
              {(
                [
                  { id: "cards", icon: LayoutGrid, label: "Visão em cards" },
                  { id: "kanban", icon: Kanban, label: "Visão por fases (Kanban)" },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setViewMode(v.id)}
                  aria-pressed={viewMode === v.id}
                  aria-label={v.label}
                  title={v.label}
                  className={`grid size-8 place-items-center rounded-lg transition cursor-pointer ${
                    viewMode === v.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <v.icon size={16} />
                </button>
              ))}
            </div>

            <button
              onClick={() => setOpenNew(true)}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-md shadow-primary/20 active:scale-98 transition cursor-pointer whitespace-nowrap"
            >
              <Plus size={16} />
              <span>Novo</span>
            </button>
          </div>
        </div>

        {listError && (
          <p role="alert" className="text-destructive">
            Erro ao carregar acompanhamentos: {listError.message}
          </p>
        )}
        {/* Indicadores compactos: cada um é um atalho que filtra a lista */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {(
            [
              {
                id: "ativos",
                label: "Em andamento",
                value: String(kpis.ativos),
                tone: "text-foreground",
                active: !quickFilter && statusFilter === "em_andamento",
                onClick: () => setSearch({ status: "em_andamento", filtro: undefined }),
              },
              {
                id: "retorno",
                label: "Retorno vencido",
                value: String(kpis.retornos),
                tone: kpis.retornos ? "text-destructive" : "text-foreground",
                active: quickFilter === "retorno",
                onClick: () => setSearch({ filtro: quickFilter === "retorno" ? undefined : "retorno" }),
              },
              {
                id: "terminando",
                label: "Terminam em 7 dias",
                value: String(kpis.terminando),
                tone: kpis.terminando ? "text-warning" : "text-foreground",
                active: quickFilter === "terminando",
                onClick: () =>
                  setSearch({ filtro: quickFilter === "terminando" ? undefined : "terminando" }),
              },
              {
                id: "atrasado",
                label: kpis.atrasados ? `A receber · ${kpis.atrasados} em atraso` : "A receber dos planos",
                value: brl(kpis.aReceber),
                tone: kpis.atrasados ? "text-destructive" : "text-foreground",
                active: quickFilter === "atrasado",
                onClick: () => setSearch({ filtro: quickFilter === "atrasado" ? undefined : "atrasado" }),
              },
            ] as const
          ).map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={k.onClick}
              aria-pressed={k.active}
              className={`rounded-xl border bg-card px-3.5 py-2.5 text-left shadow-2xs transition cursor-pointer hover:border-primary/40 ${
                k.active ? "border-primary ring-2 ring-primary/20" : "border-border/80"
              }`}
            >
              <div className="truncate text-xs font-medium text-muted-foreground">{k.label}</div>
              <div className={`mt-0.5 truncate text-xl font-semibold tabular-nums ${k.tone}`}>
                {k.value}
              </div>
            </button>
          ))}
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar paciente ou plano…"
                aria-label="Buscar paciente ou plano"
                className="w-full h-10 pl-10 pr-3 rounded-xl bg-card border border-border focus:border-primary outline-none text-sm transition"
              />
            </div>
            {/* Cidade: cada opção mostra quantos planos há nela (respeita o filtro de situação) */}
            {cityCounts.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MapPin size={14} aria-hidden="true" />
                Cidade
                <select
                  value={
                    cityFilter
                      ? (cityCounts.find((c) => sameCity(c.city, cityFilter))?.city ?? cityFilter)
                      : ""
                  }
                  onChange={(e) => setSearch({ cidade: e.target.value || undefined })}
                  className={`h-10 max-w-[230px] rounded-xl border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary cursor-pointer ${
                    cityFilter ? "border-primary" : "border-border"
                  }`}
                >
                  <option value="">
                    Todas · {cityCounts.reduce((s, c) => s + c.total, 0)} planos
                  </option>
                  {cityCounts.map((c) => (
                    <option key={c.city} value={c.city}>
                      {c.city} · {c.total}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Ordenar
              <select
                value={sortBy}
                onChange={(e) => setSearch({ ordem: e.target.value as (typeof SORTS)[number] })}
                className="h-10 rounded-xl border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary cursor-pointer"
              >
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {quickFilter ? (
              <button
                type="button"
                onClick={() => setSearch({ filtro: undefined })}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white cursor-pointer"
              >
                {quickFilter === "retorno"
                  ? "Retorno vencido"
                  : quickFilter === "terminando"
                    ? "Terminam em 7 dias"
                    : "Com parcela em atraso"}
                <X size={13} aria-label="Limpar filtro" />
              </button>
            ) : viewMode === "kanban" ? null : (
              STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                  className={`h-8 shrink-0 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    statusFilter === s
                      ? "bg-primary text-white"
                      : "bg-muted text-foreground/80 hover:bg-surface-2"
                  }`}
                >
                  {s === "todos" ? "Todos" : STATUS_LABEL[s].label}
                  {s !== "todos" && (
                    <span className="ml-1 opacity-70">{rows.filter((r) => r.status === s).length}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* MODO CARDS / LISTA */}
        {/* ============================================================ */}
        {viewMode === "cards" && (
          <div>
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="h-48 rounded-2xl bg-card border border-border animate-pulse"
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 bg-card rounded-2xl border border-border/80 shadow-sm">
                <Activity
                  size={44}
                  className="mx-auto text-muted-foreground/60"
                  strokeWidth={1.5}
                />
                <div className="mt-3 text-base font-semibold text-foreground">
                  Nenhum acompanhamento encontrado
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Ajuste seus filtros de busca ou crie um novo acompanhamento.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
                {filtered.map((t, i) => {
                  const st = STATUS_LABEL[t.status] || STATUS_LABEL.em_andamento;
                  const prog = computeProgress(t);
                  return (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    >
                      <div
                        onClick={() => setSelectedTreatment(t)}
                        className="block bg-card rounded-2xl border border-border/80 p-5 hover:shadow-md hover:border-primary/30 transition-all group relative overflow-hidden cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="min-w-0">
                              {/* Paciente em destaque: os títulos dos planos costumam se repetir */}
                              <div className="text-[15px] font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                                {t.patients?.name ?? "Paciente não identificado"}
                              </div>
                              <div className="text-sm text-muted-foreground truncate mt-0.5">
                                {t.title}
                              </div>
                              <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin size={11} /> {cityOf(t)}
                              </div>
                            </div>
                          </div>
                          <span
                            className="text-xs font-semibold px-2.5 py-1 rounded whitespace-nowrap"
                            style={{ background: st.bg, color: st.fg }}
                          >
                            {st.label}
                          </span>
                        </div>

                        {/* Barra de Progresso com label */}
                        <div className="mt-4 pt-1">
                          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-1.5">
                            <span>Prazo transcorrido</span>
                            <span className="font-semibold text-foreground">
                              {prog}%
                              {t.status === "em_andamento" && t.end_date
                                ? (() => {
                                    const left = daysBetween(localDate(), t.end_date);
                                    return left > 0 ? ` · faltam ${left} dias` : " · prazo encerrado";
                                  })()
                                : ""}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${prog}%`, background: t.color || "#6d3ff5" }}
                            />
                          </div>
                        </div>

                        {/* Dados adicionais e Financeiro do Paciente */}
                        {(() => {
                          const payInfo = treatmentPaymentsMap[t.id];
                          const paidVal = payInfo ? payInfo.paid : 0;
                          const totalVal = netValue(t);
                          const openVal = Math.max(0, totalVal - paidVal);
                          const isFullyPaid = totalVal > 0 && paidVal >= totalVal;
                          const isPartial = totalVal > 0 && paidVal > 0 && paidVal < totalVal;

                          return (
                            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs bg-muted/48 p-3 rounded-xl">
                              <div>
                                <div className="text-muted-foreground text-[11px] font-semibold uppercase">
                                  Próx. retorno
                                </div>
                                {(() => {
                                  const late =
                                    t.status === "em_andamento" &&
                                    !!t.next_return_date &&
                                    t.next_return_date <= localDate();
                                  return (
                                    <div
                                      className={`font-semibold mt-0.5 flex items-center gap-1 ${late ? "text-destructive" : "text-foreground"}`}
                                    >
                                      <CalIcon size={12} className={late ? "text-destructive" : "text-primary"} />
                                      {t.next_return_date ? formatDateOnly(t.next_return_date) : "A definir"}
                                      {late && <span className="text-[11px] font-semibold">(vencido)</span>}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div>
                                <div className="text-muted-foreground text-[11px] font-semibold uppercase">
                                  {totalVal > 0 ? "Contratado" : "Prazo"}
                                </div>
                                <div className="text-foreground font-bold mt-0.5 flex items-center gap-1">
                                  {totalVal > 0 ? (
                                    <>
                                      <Wallet size={12} className="text-primary" />
                                      <span>{brl(totalVal)}</span>
                                    </>
                                  ) : (
                                    protocolDeadline(t.status, t.end_date)
                                  )}
                                </div>
                              </div>
                              {totalVal > 0 ? (
                                <div>
                                  <div className="text-muted-foreground text-[11px] font-semibold uppercase flex items-center justify-between">
                                    <span>Pago</span>
                                    {isFullyPaid ? (
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 font-bold">
                                        Quitado
                                      </span>
                                    ) : isPartial ? (
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-bold">
                                        Parcial
                                      </span>
                                    ) : (
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-muted text-muted-foreground font-semibold">
                                        Pendente
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-bold mt-0.5 flex items-center gap-1">
                                    <span
                                      className={
                                        paidVal > 0
                                          ? "text-emerald-600 dark:text-emerald-400"
                                          : "text-muted-foreground"
                                      }
                                    >
                                      {brl(paidVal)}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="text-muted-foreground text-[11px] font-semibold uppercase">
                                    Retorno
                                  </div>
                                  <div className="text-foreground font-medium mt-0.5">
                                    {t.return_days ? `${t.return_days} dias` : "A definir"}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Footer do Card com Ações Rápidas */}
                        <div className="mt-4 pt-3 border-t border-border-soft flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {t.patients?.phone && (
                              <button
                                type="button"
                                onClick={(e) => openWhatsAppPatient(e, t)}
                                className="h-7.5 px-2.5 rounded-lg bg-success/10 text-success hover:bg-success/15 text-xs font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                                title="Enviar mensagem no WhatsApp"
                              >
                                <MessageCircle size={13} />
                                <span>WhatsApp</span>
                              </button>
                            )}
                            {/* Médico só ajuda a distinguir quando a clínica tem mais de um */}
                            {multipleDoctors && t.doctors?.name && (
                              <span className="text-xs text-muted-foreground truncate max-w-[130px]">
                                Dr(a). {t.doctors.name}
                              </span>
                            )}
                          </div>

                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTreatment(t);
                            }}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-primary-soft group-hover:bg-primary text-primary group-hover:text-white text-sm font-semibold transition-all shadow-2xs"
                          >
                            <span>Gerenciar</span>
                            <ChevronRight
                              size={14}
                              className="group-hover:translate-x-0.5 transition-transform"
                            />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* MODO KANBAN / FASES CLÍNICAS */}
        {/* ============================================================ */}
        {viewMode === "kanban" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {kanbanColumns.map((col) => (
              <div
                key={col.id}
                className="bg-muted/54 rounded-2xl border border-border/80 p-3.5 flex flex-col min-h-[480px]"
              >
                {/* Header da Coluna */}
                <div className="flex items-center justify-between pb-3 border-b border-border/80 px-1">
                  <div>
                    <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full inline-block"
                        style={{ background: col.color }}
                      />
                      {col.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{col.subtitle}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-card text-foreground/80 text-xs font-semibold shadow-2xs">
                    {col.badge}
                  </span>
                </div>

                {/* Lista de cards da coluna */}
                <div className="space-y-3 mt-3 flex-1 overflow-y-auto max-h-[620px] pr-0.5">
                  {col.items.length === 0 ? (
                    <div className="text-center py-10 text-xs text-muted-foreground font-medium">
                      Nenhum tratamento nesta fase.
                    </div>
                  ) : (
                    col.items.map((t) => {
                      const prog = computeProgress(t);
                      return (
                        <div
                          key={t.id}
                          onClick={() => setSelectedTreatment(t)}
                          className="block bg-card rounded-xl border border-border/90 p-3.5 shadow-2xs hover:shadow-md hover:border-primary/50 transition group cursor-pointer"
                        >
                          <div className="text-sm font-semibold text-foreground truncate group-hover:text-primary">
                            {t.patients?.name ?? "Paciente não identificado"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate font-medium">
                            {t.title}
                          </div>

                          <div className="mt-3">
                            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-1">
                              <span>Prazo transcorrido</span>
                              <span>{prog}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${prog}%`, background: col.color }}
                              />
                            </div>
                          </div>

                          {(() => {
                            const payInfo = treatmentPaymentsMap[t.id];
                            const paidVal = payInfo ? payInfo.paid : 0;
                            const totalVal = netValue(t) || (payInfo ? payInfo.total : 0);
                            if (totalVal <= 0 && paidVal <= 0) return null;
                            const isFullyPaid = totalVal > 0 && paidVal >= totalVal;
                            const isPartial = totalVal > 0 && paidVal > 0 && paidVal < totalVal;

                            return (
                              <div className="mt-2.5 pt-2 border-t border-border-soft flex items-center justify-between text-xs">
                                <span className="text-muted-foreground font-medium">Pago / Total</span>
                                <div className="flex items-center gap-1 font-semibold">
                                  <span
                                    className={
                                      paidVal > 0
                                        ? "text-emerald-600 dark:text-emerald-400 font-bold"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {brl(paidVal)}
                                  </span>
                                  <span className="text-muted-foreground/60">/</span>
                                  <span className="text-foreground">{brl(totalVal)}</span>
                                  {isFullyPaid && (
                                    <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 font-bold">
                                      Quitado
                                    </span>
                                  )}
                                  {isPartial && (
                                    <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-bold">
                                      Parcial
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          <div className="mt-3 pt-2.5 border-t border-border-soft flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {protocolDeadline(t.status, t.end_date)}
                              </span>
                              {t.patients?.phone && (
                                <button
                                  type="button"
                                  onClick={(e) => openWhatsAppPatient(e, t)}
                                  className="text-success hover:text-success flex items-center gap-1 font-semibold cursor-pointer"
                                  title="WhatsApp"
                                >
                                  <MessageCircle size={12} />
                                  <span>WhatsApp</span>
                                </button>
                              )}
                            </div>
                            <span className="text-xs font-semibold text-primary group-hover:underline flex items-center">
                              Gerenciar <ChevronRight size={12} />
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openNew && <NewTreatmentModal onClose={() => setOpenNew(false)} onCreated={load} />}

      {selectedTreatment && (
        <TreatmentManageModal
          treatment={selectedTreatment}
          onClose={() => setSelectedTreatment(null)}
          onUpdated={load}
        />
      )}
    </AppShell>
  );
}

// ============== AUXILIARES FINANCEIROS PARA FLUXO DE CAIXA IMEDIATO ==============
const useFinancialAccounts = () => {
  return useQuery({
    queryKey: ["financial-accounts-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("financial_accounts")
        .select("id, name, type, active")
        .order("name");
      // Sem contas reais: lista vazia (a baixa exige conta cadastrada; ids fictícios falhariam no banco)
      return (data || []).filter((a) => a.active ?? true);
    },
    staleTime: 60000,
  });
};

async function recordImmediateTreatmentPayment({
  treatmentId,
  isDown,
  amount,
  paidDate,
  method,
  accountId,
  payerName,
}: {
  treatmentId: string;
  isDown: boolean;
  amount: number;
  paidDate: string;
  method: string;
  accountId: string;
  payerName: string;
}) {
  if (amount <= 0) return;

  // 1. Busca os títulos / transações geradas para o tratamento
  const { data: createdTxs } = await (supabase as any)
    .from("transactions")
    .select("id, amount, paid_amount, status, installment_id, installments:installment_id(number), description, company_id")
    .eq("treatment_id", treatmentId);

  if (!createdTxs || createdTxs.length === 0) throw new Error("O plano de pagamento ainda não gerou títulos financeiros.");

  // Identifica a transação correspondente (Entrada número 0 ou Parcela número 1 para à vista)
  const targetTx = createdTxs.find((tx: any) => {
    if (tx.status === "cancelado") return false;
    if (isDown) {
      return (
        tx.installments?.number === 0 ||
        tx.description?.toLowerCase().includes("entrada")
      );
    } else {
      return (
        tx.installments?.number === 1 ||
        !tx.description?.toLowerCase().includes("entrada")
      );
    }
  });

  if (!targetTx) throw new Error("Título financeiro do acompanhamento não encontrado.");

  // Se já estiver quitada, não duplica
  if (targetTx.status === "pago" || Number(targetTx.paid_amount) >= amount) {
    return;
  }

  if (!accountId) throw new Error("Selecione a conta financeira que recebeu o valor.");

  // Registra a baixa pelo fluxo oficial (atualiza título e parcela no banco)
  const { error } = await supabase.rpc("record_financial_payment", {
    p_id: crypto.randomUUID(),
    p_transaction_id: targetTx.id,
    p_amount: amount,
    p_paid_on: paidDate || todayLocal(),
    p_method: (method || "pix").toLowerCase(),
    p_account_id: accountId,
    p_payer_name: payerName,
  });
  if (error) throw error;
}

// ============== VENCIMENTOS DO PLANO (lista da janela do acompanhamento) ==============
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const DUE_TONES = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  free: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  late: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  soon: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  future: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
};

function PlanDueDates({ titles }: { titles: any[] }) {
  const today = localDate();
  const isFree = (t: any) =>
    (t.category || "").toLowerCase().includes("saldo livre") ||
    (t.description || "").toLowerCase().includes("saldo livre");
  const isDown = (t: any) => t.installments?.number === 0 || /entrada/i.test(t.description || "");
  const paidOf = (t: any) => Number(t.paid_amount ?? (t.status === "pago" ? t.amount : 0)) || 0;
  const isPaid = (t: any) =>
    t.status === "pago" || (paidOf(t) >= Number(t.amount) && Number(t.amount) > 0);

  // Parcelas substituídas numa repactuação ficam canceladas: saem da lista principal
  const active = titles
    .filter((t) => t.status !== "cancelado" && !t.deleted_at)
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
  const hidden = titles.length - active.length;
  // Numeração pela ordem de vencimento (após repactuação os números gravados ficam salteados)
  const parts = active.filter((t) => !isDown(t) && !isFree(t));
  const order = new Map(parts.map((t, idx) => [t.id, idx + 1]));
  const paidCount = active.filter(isPaid).length;
  const openTotal = active.reduce(
    (sum, t) => sum + Math.max(0, Number(t.amount || 0) - paidOf(t)),
    0,
  );
  const next = active.find((t) => !isPaid(t) && !isFree(t) && t.due_date);

  const situation = (t: any): { label: string; tone: keyof typeof DUE_TONES } => {
    if (isPaid(t)) return { label: "Pago", tone: "paid" };
    if (isFree(t) || !t.due_date) return { label: "Sem vencimento", tone: "free" };
    const days = daysBetween(today, t.due_date.slice(0, 10));
    if (days < 0) return { label: `Atrasada há ${-days} dia${days === -1 ? "" : "s"}`, tone: "late" };
    if (days === 0) return { label: "Vence hoje", tone: "soon" };
    if (days === 1) return { label: "Vence amanhã", tone: "soon" };
    if (days <= 30) return { label: `Vence em ${days} dias`, tone: days <= 7 ? "soon" : "future" };
    return { label: "A vencer", tone: "future" };
  };

  return (
    <div className="mt-2 pt-3 border-t border-border-soft space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Vencimentos do plano
        </span>
        <Link
          to="/financeiro"
          className="text-primary hover:underline text-xs font-semibold inline-flex items-center gap-1"
        >
          <span>Ir para Contas a Receber</span>
          <ExternalLink size={11} />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="p-2 rounded-lg bg-muted/40 border border-border-soft">
          <div className="text-muted-foreground">Pagas</div>
          <div className="font-semibold text-foreground tabular-nums">
            {paidCount} de {active.length}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-muted/40 border border-border-soft">
          <div className="text-muted-foreground">Em aberto</div>
          <div className="font-semibold text-foreground tabular-nums">{brl(openTotal)}</div>
        </div>
        <div className="p-2 rounded-lg bg-muted/40 border border-border-soft">
          <div className="text-muted-foreground">Próximo vencimento</div>
          <div className="font-semibold text-primary tabular-nums">
            {next ? formatClinicalDate(next.due_date) : "—"}
          </div>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
        {active.map((t) => {
          const due = isFree(t) || !t.due_date ? null : String(t.due_date).slice(0, 10);
          const [year, month, day] = due ? due.split("-") : [];
          const amount = Number(t.amount || 0);
          const paid = paidOf(t);
          const partial = paid > 0 && !isPaid(t);
          const label = isDown(t)
            ? "Entrada"
            : isFree(t)
              ? "Saldo livre"
              : `Parcela ${order.get(t.id)} de ${parts.length}`;
          const method =
            PAYMENT_METHODS[t.payment_method as keyof typeof PAYMENT_METHODS] || t.payment_method;
          const info = situation(t);
          return (
            <div
              key={t.id}
              className={`flex items-center gap-3 p-2 rounded-xl border transition ${
                next?.id === t.id
                  ? "border-primary/50 bg-primary-soft/40"
                  : "border-border-soft bg-muted/30 hover:bg-muted/60"
              }`}
            >
              <div className="w-14 shrink-0 rounded-lg bg-card border border-border px-1 py-1.5 text-center leading-none">
                {due ? (
                  <>
                    <div className="text-lg font-bold text-foreground tabular-nums">{day}</div>
                    <div className="mt-1 whitespace-nowrap text-[10px] font-semibold uppercase text-muted-foreground">
                      {MONTHS_SHORT[Number(month) - 1]}/{year.slice(2)}
                    </div>
                  </>
                ) : (
                  <div className="py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Livre
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{label}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {due ? `Vence ${formatClinicalDate(due)}` : "Sem data fixa"}
                  {method ? ` · ${method}` : ""}
                  {partial ? ` · pago ${brl(paid)} de ${brl(amount)}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-bold text-foreground tabular-nums">{brl(amount)}</div>
                <span
                  className={`mt-0.5 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-semibold ${DUE_TONES[info.tone]}`}
                >
                  {info.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {hidden > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {hidden} lançamento(s) cancelado(s) ou substituído(s) em repactuação não aparecem na lista.
        </p>
      )}
    </div>
  );
}

// ============== MODAL DE GERENCIAMENTO & EDIÇÃO DE ACOMPANHAMENTO ==============
function TreatmentManageModal({
  treatment,
  onClose,
  onUpdated,
}: {
  treatment: Treatment;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [doctors, setDoctors] = useState<{ id: string; name: string }[]>([]);

  const totalDays = treatment.end_date
    ? daysBetween(treatment.start_date, treatment.end_date)
    : (treatment.return_days ?? 90);
  const passedDays = Math.max(0, daysBetween(treatment.start_date, new Date()));
  const remainingDays = Math.max(0, totalDays - passedDays);
  const prog = computeProgress(treatment);
  const st = STATUS_LABEL[treatment.status] || STATUS_LABEL.em_andamento;

  const [form, setForm] = useState({
    title: treatment.title || "",
    objective: treatment.objective || "",
    doctor_id: treatment.doctor_id || "",
    status: treatment.status,
    start_date: treatment.start_date || todayLocal(),
    protocol_days: String(totalDays > 0 ? totalDays : 90),
    return_days: String(treatment.return_days || 30),
    color: treatment.color || COLORS[0],
    notes: treatment.notes || "",
  });

  const [weightGoal, setWeightGoal] = useState(() => weightGoalForm(treatment));
  const { data: treatmentTitles = [] } = useQuery({
    queryKey: ["treatment-manage-titles", treatment.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("*, installments:installment_id(*)")
        .eq("treatment_id", treatment.id)
        .order("due_date", { ascending: true });
      return (data as any[]) || [];
    },
  });

  const isInitiallyLivre = useMemo(() => {
    return (
      (treatment.notes && treatment.notes.includes("saldo_livre")) ||
      treatmentTitles.some((t: any) => {
        const desc = (t.description || "").toLowerCase();
        const cat = (t.category || "").toLowerCase();
        return desc.includes("saldo livre") || cat.includes("saldo livre");
      }) ||
      (treatment.payment_type === "parcelado" &&
        treatment.installments_count === 1 &&
        !treatment.first_due_date)
    );
  }, [treatment, treatmentTitles]);

  const { data: financialAccounts = [] } = useFinancialAccounts();

  const isDownAlreadyPaid = useMemo(() => {
    return treatmentTitles.some((t: any) => {
      if (t.status === "cancelado") return false;
      const isDown = t.installments?.number === 0 || t.description?.toLowerCase().includes("entrada");
      const isPaid = t.status === "pago" || (Number(t.paid_amount) >= Number(t.amount) && Number(t.amount) > 0);
      return isDown && isPaid;
    });
  }, [treatmentTitles]);

  const [hasFinance, setHasFinance] = useState(
    Number(treatment.total_value || 0) > 0,
  );

  const [financeForm, setFinanceForm] = useState({
    total: treatment.total_value ? String(treatment.total_value) : "",
    discount: treatment.discount ? String(treatment.discount) : "0",
    down: treatment.down_payment ? String(treatment.down_payment) : "0",
    downMethod: treatment.down_payment_method || "pix",
    downDue:
      treatment.down_payment_due_date ||
      treatment.start_date ||
      todayLocal(),
    downReceivedNow: true,
    downAccountId: "",
    modality: (isInitiallyLivre ? "livre" : "parcelado") as "parcelado" | "livre",
    method: treatment.payment_method || "pix",
    installments: String(treatment.installments_count || 1),
    firstDue:
      treatment.first_due_date ||
      todayLocal(30),
    aVistaReceivedNow: false,
    aVistaAccountId: "",
  });

  // Sincroniza modalidade se for identificada como livre após carregamento
  useEffect(() => {
    if (isInitiallyLivre && financeForm.modality !== "livre") {
      setFinanceForm((prev) => ({ ...prev, modality: "livre" }));
    }
  }, [isInitiallyLivre]);

  const financePreview = useMemo(() => {
    const total = parseBrlNumber(financeForm.total);
    const discount = parseBrlNumber(financeForm.discount);
    const down = parseBrlNumber(financeForm.down);
    const net = Math.max(0, total - discount);
    const balance = Math.max(0, net - down);
    return { total, discount, down, net, balance };
  }, [financeForm.total, financeForm.discount, financeForm.down]);

  const paymentStats = useMemo(() => {
    let paidTotal = 0;
    let pendingTotal = 0;
    let countPaid = 0;
    let countPending = 0;

    treatmentTitles.forEach((t: any) => {
      const amt = Number(t.amount || 0);
      const paid = Number(t.paid_amount ?? (t.status === "pago" ? amt : 0));
      if (t.status === "pago" || (paid >= amt && amt > 0)) {
        paidTotal += amt;
        countPaid++;
      } else {
        paidTotal += paid;
        pendingTotal += Math.max(0, amt - paid);
        countPending++;
      }
    });

    return { paidTotal, pendingTotal, countPaid, countPending };
  }, [treatmentTitles]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("doctors").select("id,name").order("name");
      setDoctors((data as unknown as { id: string; name: string }[]) ?? []);
    })();
  }, []);

  const handleQuickStatusChange = async (newStatus: Treatment["status"]) => {
    if (!(await changeTreatmentStatus(treatment.id, newStatus))) return;
    onUpdated();
    onClose();
  };

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: "Excluir Acompanhamento",
      description: `Deseja realmente excluir permanentemente o acompanhamento "${treatment.title}" de ${treatment.patients?.name || "este paciente"}? Esta ação não pode ser desfeita.`,
      confirmText: "Excluir permanentemente",
      destructive: true,
    });
    if (!ok) return;

    setSaving(true);
    try {
      // Exclusão segura via RPC delete_treatment que protege histórico de pagamentos e registros clínicos
      const { error: rpcError } = await supabase.rpc("delete_treatment", {
        p_id: treatment.id,
      });
      if (rpcError) {
        toast.error("Não foi possível excluir o acompanhamento", {
          description:
            rpcError.message ||
            "Se houver atendimentos ou títulos financeiros vinculados, cancele ou finalize o plano para preservar o histórico.",
        });
        return;
      }

      toast.success("Acompanhamento excluído com sucesso!");
      onUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir acompanhamento");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    let statusReason: string | undefined;
    if (form.status !== treatment.status) {
      const reason = window.prompt("Informe a justificativa da alteração de status:");
      if (reason === null) return;
      if (!reason.trim()) {
        toast.error("A justificativa é obrigatória.");
        return;
      }
      statusReason = reason.trim();
    }
    if (!form.title.trim()) {
      toast.error("O título é obrigatório");
      return;
    }
    if (
      !form.start_date ||
      !Number.isInteger(Number(form.protocol_days)) ||
      Number(form.protocol_days) < 1 ||
      !Number.isInteger(Number(form.return_days)) ||
      Number(form.return_days) < 1 ||
      Number(form.return_days) > 365
    ) {
      toast.error("Confira início, duração e intervalo de retorno (1 a 365 dias).");
      return;
    }

    const totalNum = hasFinance ? parseBrlNumber(financeForm.total) : 0;
    const discountNum = hasFinance ? parseBrlNumber(financeForm.discount) : 0;
    const downNum = hasFinance ? parseBrlNumber(financeForm.down) : 0;
    const isLivre = financeForm.modality === "livre";
    const countNum = isLivre ? 1 : Math.max(1, parseInt(financeForm.installments) || 1);

    if (hasFinance && totalNum > 0) {
      if (downNum > financePreview.net) {
        toast.error("O valor da entrada não pode ser superior ao total líquido com desconto.");
        return;
      }
      if (downNum > 0 && !financeForm.downDue) {
        toast.error("Informe a data de vencimento da entrada.");
        return;
      }
      if (!isLivre && financePreview.balance > 0 && !financeForm.firstDue) {
        toast.error("Informe o primeiro vencimento do saldo parcelado.");
        return;
      }
    }

    setSaving(true);
    // Recebido no ato: a baixa só aceita data de hoje ou anterior (o banco recusa data futura)
    // e o vencimento acompanha o recebimento, para o título não ficar esperando baixa.
    const today = todayLocal();
    const downNow = downNum > 0 && financeForm.downReceivedNow && !isDownAlreadyPaid;
    const aVistaNow =
      downNum === 0 && countNum === 1 && financeForm.modality === "parcelado" && financeForm.aVistaReceivedNow;
    const downDue = downNow && financeForm.downDue > today ? today : financeForm.downDue;
    const firstDue = aVistaNow && (!financeForm.firstDue || financeForm.firstDue > today) ? today : financeForm.firstDue;
    const startDateObj = new Date(form.start_date);
    const protocolDaysNum = Number(form.protocol_days) || 90;
    const endDateObj = new Date(startDateObj.getTime() + protocolDaysNum * 86400000);
    const endDateStr = endDateObj.toISOString().slice(0, 10);

    // As parcelas só são regeneradas quando as condições financeiras mudam. Se a regeneração
    // falhar (ex.: plano com recebimentos), o plano não pode ficar dizendo "7x" com 1 parcela.
    const rpcType = isLivre ? "parcelado" : countNum === 1 && downNum === 0 ? "a_vista" : "parcelado";
    const rpcCount = isLivre || (countNum === 1 && downNum === 0) ? 1 : countNum;
    // Plano com valor mas sem nenhum título ativo (ex.: geração anterior falhou) precisa gerar.
    const hasActiveTitles = treatmentTitles.some((t: any) => t.status !== "cancelado");
    const financeChanged =
      !hasActiveTitles ||
      Number(treatment.total_value || 0) !== totalNum ||
      Number(treatment.discount || 0) !== discountNum ||
      Number(treatment.down_payment || 0) !== downNum ||
      Number(treatment.installments_count || 1) !== rpcCount ||
      (treatment.payment_type || "") !== rpcType ||
      (treatment.payment_method || "pix") !== (financeForm.method || "pix") ||
      (downNum > 0 && (treatment.down_payment_due_date || "") !== downDue) ||
      (!isLivre && financePreview.balance > 0 && (treatment.first_due_date || "") !== firstDue);

    if (totalNum > 0 && financeChanged) {
      const { error: confErr } = await supabase.rpc("configure_treatment_payment", {
        p_treatment_id: treatment.id,
        p_total: totalNum,
        p_discount: discountNum,
        p_down: downNum,
        p_type: rpcType,
        p_down_method: downNum > 0 ? financeForm.downMethod : null,
        p_method: financeForm.method || "pix",
        p_count: rpcCount,
        p_down_due: downNum > 0 ? downDue : null,
        p_first_due: firstDue || null,
      });
      if (confErr) {
        setSaving(false);
        toast.error("Não foi possível alterar as parcelas do plano", {
          description: /recebimentos/i.test(confErr.message || "")
            ? "Este plano já tem recebimentos. Para mudar o parcelamento, use \"Repactuar\" na aba Financeiro do acompanhamento."
            : confErr.message,
        });
        return;
      }
    }

    const payload = {
      title: form.title.trim(),
      objective: form.objective.trim() || null,
      doctor_id: form.doctor_id || null,
      status: form.status,
      status_reason: statusReason,
      start_date: form.start_date,
      end_date: endDateStr,
      return_days: form.return_days ? Number(form.return_days) : null,
      color: form.color,
      notes: form.notes.trim() || null,
      total_value: totalNum,
      discount: discountNum,
      down_payment: downNum,
      installments_count: isLivre ? 1 : countNum,
      payment_type: isLivre ? "parcelado" : countNum === 1 && downNum === 0 ? "a_vista" : "parcelado",
      down_payment_method: downNum > 0 ? financeForm.downMethod : null,
      payment_method: financeForm.method,
      down_payment_due_date: downNum > 0 ? downDue : null,
      first_due_date: isLivre ? null : firstDue || null,
    };

    const { error } = await supabase.from("treatments").update(payload).eq("id", treatment.id);

    if (error) {
      setSaving(false);
      toast.error("Erro ao salvar alterações: " + (error?.message || ""));
      return;
    }
    // Meta de peso vai numa gravação separada: se o banco ainda não tem os campos, o resto salva
    const goalBefore = weightGoalForm(treatment);
    if (JSON.stringify(goalBefore) !== JSON.stringify(weightGoal)) {
      try {
        await saveWeightGoal(treatment.id, weightGoal);
      } catch (err) {
        toast.warning("A meta de peso não foi salva", { description: errorMessage(err) });
      }
    }

    // Configurar parcelas e entrada automaticamente no financeiro
    if (totalNum > 0) {
      try {
        if (financeChanged && isLivre && financePreview.balance > 0) {
          // Atualiza título de saldo livre
          const { error: labelErr } = await (supabase.rpc as any)("label_free_balance_title", {
            p_treatment_id: treatment.id,
            p_title: form.title.trim(),
          });
          if (labelErr) console.warn("Rótulo Saldo Livre não aplicado:", labelErr);
        }

        // Liquidação imediata no Fluxo de Caixa para Entrada ou À Vista
        if (downNum > 0 && financeForm.downReceivedNow && !isDownAlreadyPaid) {
          const patName = treatment.patients?.name || form.title || "Paciente";
          await recordImmediateTreatmentPayment({
            treatmentId: treatment.id,
            isDown: true,
            amount: downNum,
            paidDate: downDue,
            method: financeForm.downMethod,
            accountId: financeForm.downAccountId || financialAccounts[0]?.id || "",
            payerName: patName,
          });
        } else if (downNum === 0 && countNum === 1 && financeForm.modality === "parcelado" && financeForm.aVistaReceivedNow) {
          const patName = treatment.patients?.name || form.title || "Paciente";
          await recordImmediateTreatmentPayment({
            treatmentId: treatment.id,
            isDown: false,
            amount: totalNum - discountNum,
            paidDate: firstDue,
            method: financeForm.method,
            accountId: financeForm.aVistaAccountId || financialAccounts[0]?.id || "",
            payerName: patName,
          });
        }
      } catch (err) {
        toast.warning("Acompanhamento salvo, mas o recebimento não foi registrado", {
          description: `${errorMessage(err)}. Registre a baixa pelo Financeiro.`,
        });
      }
    }

    try {
      void refreshFinance(queryClient);
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["treatments-list"] }),
        queryClient.invalidateQueries({ queryKey: ["treatment-finance-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["treatment-manage-titles", treatment.id] }),
        queryClient.invalidateQueries({ queryKey: ["treatment-alerts"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["cash-flow-snapshot"] }),
      ]);
    } catch {}

    setSaving(false);
    toast.success("Acompanhamento e condições financeiras atualizados com sucesso!");
    setIsEditing(false);
    onUpdated();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[92vh] max-w-2xl flex-col gap-0 p-0 [&>button.absolute]:hidden"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-border-soft sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{treatment.title}</DialogTitle>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <UserIcon size={12} className="text-muted-foreground" />
                <span className="font-semibold">{treatment.patients?.name || "Paciente"}</span>
                <span>•</span>
                <span
                  className="px-2 py-0.5 rounded text-xs font-semibold"
                  style={{ background: st.bg, color: st.fg }}
                >
                  {st.label}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className={`h-8.5 px-3 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                isEditing
                  ? "bg-primary-soft text-primary"
                  : "bg-muted hover:bg-surface-2 text-foreground/80"
              }`}
              title={isEditing ? "Cancelar Edição" : "Editar Acompanhamento"}
            >
              <Edit3 size={14} />
              <span>{isEditing ? "Visualizar" : "Editar"}</span>
            </button>
            <button
              onClick={onClose}
              className="h-8.5 w-8.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground/80 flex items-center justify-center transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 flex-1">
          {isEditing ? (
            /* ================= MODO EDIÇÃO ================= */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Título do Acompanhamento *" className="md:col-span-2">
                <input
                  className={inputCls}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ex.: Emagrecimento Metabólico 90 dias / Reabilitação"
                />
              </Field>

              <Field label="Médico Responsável">
                <select
                  className={inputCls}
                  value={form.doctor_id}
                  onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}
                >
                  <option value="">— Nenhum —</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Status Atual">
                <select
                  className={inputCls}
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as Treatment["status"] })
                  }
                >
                  <option value="em_andamento">Em andamento</option>
                  <option value="pausado">Pausado</option>
                  <option value="finalizado">Finalizado</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </Field>

              <Field label="Objetivo Clínico" className="md:col-span-2">
                <textarea
                  rows={2}
                  className={inputCls}
                  value={form.objective}
                  onChange={(e) => setForm({ ...form, objective: e.target.value })}
                  placeholder="Meta clínica, parâmetros a atingir, redução de peso, cicatrização..."
                />
              </Field>
              <div className="md:col-span-2 rounded-xl border border-border p-3">
                <div className="mb-2 text-xs font-semibold text-foreground/80">
                  Peso inicial e meta de peso
                </div>
                <WeightGoalFields value={weightGoal} onChange={setWeightGoal} inputClass={inputCls} />
              </div>

              <Field label="Data de Início">
                <input
                  type="date"
                  className={inputCls}
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </Field>

              <Field label="Duração do Protocolo">
                <select
                  className={inputCls}
                  value={form.protocol_days}
                  onChange={(e) => setForm({ ...form, protocol_days: e.target.value })}
                >
                  <option value="30">30 dias (1 mês)</option>
                  <option value="60">60 dias (2 meses)</option>
                  <option value="90">90 dias (3 meses)</option>
                  <option value="120">120 dias (4 meses)</option>
                  <option value="180">180 dias (6 meses)</option>
                  <option value="365">365 dias (1 ano)</option>
                </select>
              </Field>

              <Field label="Intervalo de Retorno (dias)">
                <select
                  className={inputCls}
                  value={form.return_days}
                  onChange={(e) => setForm({ ...form, return_days: e.target.value })}
                >
                  {[15, 30, 45, 60, 90, 120, 180, 365].map((n) => (
                    <option key={n} value={n}>
                      {n} dias
                    </option>
                  ))}
                </select>
              </Field>

              {/* ================= SEÇÃO FINANCEIRA INTEGRADA ================= */}
              <div className="md:col-span-2 rounded-2xl border border-primary/25 bg-primary-soft/30 p-4 space-y-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        Condições Financeiras do Acompanhamento
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Defina o valor total, entrada e se o saldo será parcelado ou livre
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none bg-card px-2.5 py-1 rounded-lg border border-border">
                    <input
                      type="checkbox"
                      checked={hasFinance}
                      onChange={(e) => setHasFinance(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                    />
                    <span>Ativar cobrança no plano</span>
                  </label>
                </div>

                {hasFinance && (
                  <div className="space-y-3.5 pt-2 border-t border-primary/15 animate-in fade-in duration-200">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Field label="Valor Total (R$) *">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={inputCls}
                          placeholder="Ex.: 8000,00"
                          value={financeForm.total}
                          onChange={(e) => setFinanceForm({ ...financeForm, total: e.target.value })}
                        />
                      </Field>
                      <Field label="Desconto (R$)">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={inputCls}
                          placeholder="0,00"
                          value={financeForm.discount}
                          onChange={(e) =>
                            setFinanceForm({ ...financeForm, discount: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Modalidade do Saldo">
                        <select
                          className={inputCls}
                          value={financeForm.modality}
                          onChange={(e) =>
                            setFinanceForm({
                              ...financeForm,
                              modality: e.target.value as "parcelado" | "livre",
                            })
                          }
                        >
                          <option value="parcelado">Parcelado com vencimentos fixos</option>
                          <option value="livre">Pagamentos livres (Sem vencimento fixo)</option>
                        </select>
                      </Field>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Field label="Valor de Entrada (R$)">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={inputCls}
                          placeholder="Ex.: 1000,00"
                          value={financeForm.down}
                          onChange={(e) => setFinanceForm({ ...financeForm, down: e.target.value })}
                        />
                      </Field>
                      {parseBrlNumber(financeForm.down) > 0 && (
                        isDownAlreadyPaid ? (
                          <div className="sm:col-span-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                            <span>Entrada de {brl(parseBrlNumber(financeForm.down))} já quitada e lançada no Fluxo de Caixa.</span>
                          </div>
                        ) : (
                          <div className="sm:col-span-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                                <input
                                  type="checkbox"
                                  checked={financeForm.downReceivedNow}
                                  onChange={(e) =>
                                    setFinanceForm({ ...financeForm, downReceivedNow: e.target.checked })
                                  }
                                  className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                                />
                                <span>Entrada recebida à vista hoje (lançar no Fluxo de Caixa)</span>
                              </label>
                              {financeForm.downReceivedNow && (
                                <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                  Fluxo de Caixa
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <Field label="Forma da Entrada">
                                <select
                                  className={inputCls}
                                  value={financeForm.downMethod}
                                  onChange={(e) =>
                                    setFinanceForm({ ...financeForm, downMethod: e.target.value })
                                  }
                                >
                                  <option value="pix">PIX</option>
                                  <option value="dinheiro">Dinheiro</option>
                                  <option value="cartao_debito">Cartão de Débito</option>
                                  <option value="cartao_credito">Cartão de Crédito</option>
                                  <option value="transferencia">Transferência</option>
                                  <option value="boleto">Boleto Bancário</option>
                                </select>
                              </Field>

                              <Field label="Data de Recebimento">
                                <input
                                  type="date"
                                  className={inputCls}
                                  value={financeForm.downDue}
                                  onChange={(e) =>
                                    setFinanceForm({ ...financeForm, downDue: e.target.value })
                                  }
                                />
                              </Field>

                              <Field label="Conta de Entrada">
                                <select
                                  className={inputCls}
                                  value={financeForm.downAccountId || financialAccounts[0]?.id || ""}
                                  onChange={(e) =>
                                    setFinanceForm({ ...financeForm, downAccountId: e.target.value })
                                  }
                                >
                                  {financialAccounts.length === 0 && (
                                  <option value="">Cadastre uma conta no Financeiro</option>
                                )}
                                {financialAccounts.length === 0 && (
                                <option value="">Cadastre uma conta no Financeiro</option>
                              )}
                              {financialAccounts.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      {acc.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            </div>
                            {financeForm.downReceivedNow && (
                              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                                <CheckCircle2 size={13} className="shrink-0" />
                                A entrada entrará imediatamente no Fluxo de Caixa Realizado como receita no caixa da clínica.
                              </p>
                            )}
                          </div>
                        )
                      )}
                    </div>

                    {parseBrlNumber(financeForm.down) === 0 && parseInt(financeForm.installments) === 1 && financeForm.modality === "parcelado" && (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                            <input
                              type="checkbox"
                              checked={financeForm.aVistaReceivedNow}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, aVistaReceivedNow: e.target.checked })
                              }
                              className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                            />
                            <span>Pagamento à vista já recebido hoje (lançar no Fluxo de Caixa)</span>
                          </label>
                          {financeForm.aVistaReceivedNow && (
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              Fluxo de Caixa
                            </span>
                          )}
                        </div>

                        {financeForm.aVistaReceivedNow && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <Field label="Forma de Pagamento">
                              <select
                                className={inputCls}
                                value={financeForm.method}
                                onChange={(e) =>
                                  setFinanceForm({ ...financeForm, method: e.target.value })
                                }
                              >
                                <option value="pix">PIX</option>
                                <option value="dinheiro">Dinheiro</option>
                                <option value="cartao_debito">Cartão de Débito</option>
                                <option value="cartao_credito">Cartão de Crédito</option>
                                <option value="transferencia">Transferência</option>
                                <option value="boleto">Boleto Bancário</option>
                              </select>
                            </Field>

                            <Field label="Conta de Entrada">
                              <select
                                className={inputCls}
                                value={financeForm.aVistaAccountId || financialAccounts[0]?.id || ""}
                                onChange={(e) =>
                                  setFinanceForm({ ...financeForm, aVistaAccountId: e.target.value })
                                }
                              >
                                {financialAccounts.length === 0 && (
                                  <option value="">Cadastre uma conta no Financeiro</option>
                                )}
                                {financialAccounts.length === 0 && (
                                <option value="">Cadastre uma conta no Financeiro</option>
                              )}
                              {financialAccounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                        )}
                        {financeForm.aVistaReceivedNow && (
                          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                            <CheckCircle2 size={13} className="shrink-0" />
                            O valor total de {brl(financePreview.balance)} entrará imediatamente no Fluxo de Caixa como receita realizada.
                          </p>
                        )}
                      </div>
                    )}

                    {financePreview.balance > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label="Forma do Saldo Restante">
                          <select
                            className={inputCls}
                            value={financeForm.method}
                            onChange={(e) =>
                              setFinanceForm({ ...financeForm, method: e.target.value })
                            }
                          >
                            <option value="pix">PIX</option>
                            <option value="cartao_credito">Cartão de Crédito</option>
                            <option value="cartao_debito">Cartão de Débito</option>
                            <option value="boleto">Boleto Bancário</option>
                            <option value="dinheiro">Dinheiro</option>
                            <option value="transferencia">Transferência</option>
                          </select>
                        </Field>

                        {financeForm.modality === "parcelado" && (
                          <>
                            <Field label="Nº de Parcelas do Saldo">
                              <select
                                className={inputCls}
                                value={financeForm.installments}
                                onChange={(e) =>
                                  setFinanceForm({ ...financeForm, installments: e.target.value })
                                }
                              >
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 24].map((n) => (
                                  <option key={n} value={n}>
                                    {n}x{" "}
                                    {financePreview.balance > 0
                                      ? `de ${brl(financePreview.balance / n)}`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="1º Vencimento do Saldo">
                              <input
                                type="date"
                                className={inputCls}
                                value={financeForm.firstDue}
                                onChange={(e) =>
                                  setFinanceForm({ ...financeForm, firstDue: e.target.value })
                                }
                              />
                            </Field>
                          </>
                        )}

                        {financeForm.modality === "livre" && (
                          <div className="sm:col-span-2 flex items-center gap-2 p-3 bg-card rounded-xl border border-primary/20 text-xs text-primary font-medium">
                            <CheckCircle2 size={16} className="text-primary shrink-0" />
                            <span>
                              Saldo livre de {brl(financePreview.balance)} em aberto para baixas parciais avulsas, sem vencimento fixo e sem alarmes indevidos de atraso.
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Resumo visual do contrato */}
                    {financePreview.total > 0 && (
                      <div className="bg-card p-3.5 rounded-xl border border-border space-y-2 text-xs">
                        <div className="font-semibold text-foreground flex items-center justify-between">
                          <span>Resumo Financeiro do Acompanhamento:</span>
                          <span className="text-primary font-bold text-sm">
                            {brl(financePreview.net)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted-foreground pt-1.5 border-t border-border-soft">
                          <div>
                            Bruto: <strong className="text-foreground">{brl(financePreview.total)}</strong>
                          </div>
                          {financePreview.discount > 0 && (
                            <div>
                              Desconto: <strong className="text-destructive">-{brl(financePreview.discount)}</strong>
                            </div>
                          )}
                          {financePreview.down > 0 && (
                            <div>
                              Entrada: <strong className="text-success">{brl(financePreview.down)}</strong> ({financeForm.downMethod.toUpperCase()})
                            </div>
                          )}
                          <div>
                            Saldo Restante:{" "}
                            <strong className="text-primary">
                              {brl(financePreview.balance)}
                            </strong>{" "}
                            {financeForm.modality === "livre"
                              ? "(Pagamento livre / avulso)"
                              : `(${financeForm.installments}x de ${brl(
                                  financePreview.balance /
                                    Math.max(1, parseInt(financeForm.installments) || 1),
                                )} via ${financeForm.method.toUpperCase()})`}
                          </div>
                        </div>

                        {paymentStats.paidTotal > 0 && (
                          <div className="mt-2 p-2.5 rounded-lg bg-warning/10 border border-warning/20 text-warning-foreground text-xs flex items-center gap-2">
                            <AlertCircle size={15} className="text-warning shrink-0" />
                            <span>
                              Existem {brl(paymentStats.paidTotal)} já quitados neste plano. As parcelas já recebidas serão preservadas e as pendentes serão atualizadas.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <Field label="Cor de Identificação">
                <div className="flex flex-wrap gap-2 pt-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      className="h-7 w-7 rounded-full border-2 transition cursor-pointer"
                      style={{
                        background: c,
                        borderColor: form.color === c ? "var(--foreground)" : "transparent",
                      }}
                    />
                  ))}
                </div>
              </Field>

              <Field label="Observações Clínicas" className="md:col-span-2">
                <textarea
                  rows={2}
                  className={inputCls}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Anotações internas sobre o tratamento..."
                />
              </Field>
            </div>
          ) : (
            /* ================= MODO VISUALIZAÇÃO ================= */
            <div className="space-y-5">
              {/* Paciente & Médico Banner */}
              <div className="bg-muted/60 border border-border/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Paciente
                  </div>
                  <div className="text-base font-semibold text-foreground mt-0.5">
                    {treatment.patients?.name || "Paciente não identificado"}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {treatment.doctors?.name
                      ? `Médico responsável: Dr(a). ${treatment.doctors.name}`
                      : "Sem médico atribuído"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {treatment.patients?.phone && (
                    <button
                      type="button"
                      onClick={(e) => {
                        const phone = treatment.patients?.phone?.replace(/\D/g, "");
                        if (!phone) return;
                        const msg = encodeURIComponent(
                          `Olá ${treatment.patients?.name}! Entramos em contato da clínica sobre o seu acompanhamento "${treatment.title}".`,
                        );
                        window.open(`https://wa.me/55${phone}?text=${msg}`, "_blank");
                      }}
                      className="h-9 px-3 rounded-xl bg-success hover:bg-success/90 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                    >
                      <MessageCircle size={15} />
                      <span>WhatsApp</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Barra de Progresso e Prazos */}
              <div className="bg-card border border-border/80 rounded-2xl p-4.5 space-y-3">
                <div className="flex items-center justify-between text-sm font-semibold text-foreground/80">
                  <span className="flex items-center gap-1.5">
                    <TrendingUp size={16} className="text-primary" />
                    Prazo transcorrido
                  </span>
                  <span className="font-semibold text-primary">{prog}%</span>
                </div>

                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${prog}%`, background: treatment.color || "#6d3ff5" }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-border-soft text-xs">
                  <div>
                    <div className="text-muted-foreground text-xs font-semibold uppercase">
                      Início
                    </div>
                    <div className="font-semibold text-foreground mt-0.5">
                      {formatDateOnly(treatment.start_date)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs font-semibold uppercase">
                      Dias Corridos
                    </div>
                    <div className="font-semibold text-primary mt-0.5">{passedDays} dias</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs font-semibold uppercase">
                      Restantes
                    </div>
                    <div className="font-semibold text-foreground mt-0.5">{remainingDays} dias</div>
                  </div>
                </div>
              </div>

              {/* Card de Condições Financeiras do Acompanhamento */}
              <div className="bg-card border border-border/80 rounded-2xl p-4.5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        Condições Financeiras do Acompanhamento
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {Number(treatment.total_value) > 0
                          ? "Valores e parcelamento integrados com Contas a Receber"
                          : "Nenhum valor financeiro configurado para este plano"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setHasFinance(true);
                        setIsEditing(true);
                      }}
                      className="h-8 px-2.5 rounded-lg border border-primary/20 bg-primary-soft hover:bg-primary/20 text-primary text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Edit3 size={13} />
                      <span>{Number(treatment.total_value) > 0 ? "Alterar Valores" : "Inserir Valores"}</span>
                    </button>
                  </div>
                </div>

                {Number(treatment.total_value) > 0 ? (
                  <div className="space-y-3">
                    {/* Grid de Métricas Financeiras */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-3 rounded-xl bg-muted/50 border border-border-soft">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">
                          Total Contratado
                        </div>
                        <div className="text-sm font-bold text-foreground mt-0.5">
                          {brl(treatment.total_value)}
                        </div>
                        {Number(treatment.discount) > 0 && (
                          <div className="text-[11px] text-destructive font-medium mt-0.5">
                            Desc: -{brl(treatment.discount)}
                          </div>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-muted/50 border border-border-soft">
                        <div className="text-xs font-semibold text-muted-foreground uppercase flex items-center justify-between">
                          <span>Entrada</span>
                          {Number(treatment.down_payment) > 0 && (
                            <span
                              className={`whitespace-nowrap text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                isDownAlreadyPaid
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                  : "bg-warning/15 text-warning"
                              }`}
                            >
                              {isDownAlreadyPaid ? "No Caixa" : "Pendente"}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                          {Number(treatment.down_payment) > 0 ? brl(treatment.down_payment) : "Sem entrada"}
                        </div>
                        {Number(treatment.down_payment) > 0 && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {paymentMethodLabel(treatment.down_payment_method || "pix")}
                          </div>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-muted/50 border border-border-soft">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">
                          Saldo Restante
                        </div>
                        <div className="text-sm font-bold text-primary mt-0.5">
                          {brl(
                            Math.max(
                              0,
                              (treatment.total_value || 0) -
                                (treatment.discount || 0) -
                                (treatment.down_payment || 0),
                            ),
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {isInitiallyLivre ? "Saldo Livre" : `${treatment.installments_count || 1}x parcelas`}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-muted/50 border border-border-soft">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">
                          Status Recebimento
                        </div>
                        <div className="text-sm font-bold text-foreground mt-0.5">
                          {paymentStats.paidTotal > 0
                            ? brl(paymentStats.paidTotal)
                            : "Pendente"}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {paymentStats.countPaid > 0
                            ? `${paymentStats.countPaid} recebido(s)`
                            : "Aguardando baixa"}
                        </div>
                      </div>
                    </div>

                    {/* Vencimentos do plano: parcela, data e situação de cada lançamento */}
                    {treatmentTitles.length > 0 && <PlanDueDates titles={treatmentTitles} />}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-muted/40 border border-dashed border-border text-center space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Este acompanhamento ainda não possui valor contratado, entrada ou parcelas registradas.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setHasFinance(true);
                        setIsEditing(true);
                      }}
                      className="h-8 px-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                    >
                      <Plus size={13} />
                      <span>Inserir Condições Financeiras</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Objetivo e Notas */}
              {treatment.objective && (
                <div className="bg-primary-soft/50 border border-primary/15 rounded-2xl p-4">
                  <div className="text-xs font-semibold text-primary uppercase tracking-wider">
                    Objetivo Clínico
                  </div>
                  <p className="text-sm text-foreground/80 mt-1 leading-relaxed">
                    {treatment.objective}
                  </p>
                </div>
              )}

              {treatment.notes && (
                <div className="bg-muted/60 border border-border/80 rounded-2xl p-4">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Observações Internas
                  </div>
                  <p className="text-sm text-foreground/80 mt-1 leading-relaxed">
                    {treatment.notes}
                  </p>
                </div>
              )}

              {/* Alteração Rápida de Status */}
              <div className="pt-2 border-t border-border-soft">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                  Alterar Status do Acompanhamento
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["em_andamento", "pausado", "finalizado", "cancelado"] as const).map(
                    (statusKey) => (
                      <button
                        key={statusKey}
                        type="button"
                        onClick={() => handleQuickStatusChange(statusKey)}
                        className={`h-8.5 px-3 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                          treatment.status === statusKey
                            ? "ring-2 ring-primary ring-offset-1 font-semibold"
                            : "hover:opacity-80 opacity-60"
                        }`}
                        style={{
                          background: STATUS_LABEL[statusKey].bg,
                          color: STATUS_LABEL[statusKey].fg,
                        }}
                      >
                        {statusKey === "em_andamento" && <PlayCircle size={14} />}
                        {statusKey === "pausado" && <PauseCircle size={14} />}
                        {statusKey === "finalizado" && <CheckCircle2 size={14} />}
                        {statusKey === "cancelado" && <AlertCircle size={14} />}
                        <span>{STATUS_LABEL[statusKey].label}</span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-border-soft flex items-center justify-between gap-3 sticky bottom-0 bg-card">
          <div>
            {!isEditing ? (
              <button
                type="button"
                onClick={handleDelete}
                className="h-10 px-3 rounded-lg text-destructive hover:bg-destructive/10 text-sm font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                title="Excluir Acompanhamento"
              >
                <Trash2 size={16} />
                <span>Excluir</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="h-10 px-4 rounded-xl bg-muted hover:bg-surface-2 text-foreground/80 text-sm font-semibold transition cursor-pointer"
              >
                Cancelar
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate({
                      to: "/acompanhamentos/$id",
                      params: { id: treatment.id },
                      search: { tab: "financeiro" },
                    });
                  }}
                  className="h-10 px-3.5 rounded-xl border border-primary/25 bg-primary-soft hover:bg-primary/20 text-primary text-sm font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                  title="Acessar o financeiro deste acompanhamento"
                >
                  <Wallet size={15} />
                  <span>Financeiro</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate({ to: "/acompanhamentos/$id", params: { id: treatment.id }, search: { tab: undefined } });
                  }}
                  className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-md shadow-primary/20 inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Pill size={15} />
                  <span>Página completa</span>
                  <ExternalLink size={14} />
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveEdit}
                className="h-10 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-sm inline-flex items-center gap-1.5 transition active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                <Save size={15} />
                <span>{saving ? "Salvando…" : "Salvar Alterações"}</span>
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============== MODAL NOVO ACOMPANHAMENTO ==============
function NewTreatmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [patients, setPatients] = useState<
    { id: string; name: string; phone?: string | null; cpf?: string | null }[]
  >([]);
  const [doctors, setDoctors] = useState<{ id: string; name: string }[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [patientSearch, setPatientSearch] = useState("");
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);

  const [form, setForm] = useState({
    patient_id: "",
    doctor_id: "",
    title: "",
    objective: "",
    start_date: todayLocal(),
    protocol_days: "90",
    return_days: "30",
    color: COLORS[0],
    notes: "",
  });

  const { data: financialAccounts = [] } = useFinancialAccounts();
  const [weightGoal, setWeightGoal] = useState(() => weightGoalForm());
  const [hasFinance, setHasFinance] = useState(true);
  const [financeForm, setFinanceForm] = useState({
    total: "",
    discount: "0",
    down: "0",
    downMethod: "pix",
    downDue: todayLocal(),
    downReceivedNow: true,
    downAccountId: "",
    modality: "parcelado" as "parcelado" | "livre",
    method: "pix",
    installments: "1",
    firstDue: todayLocal(30),
    aVistaReceivedNow: false,
    aVistaAccountId: "",
  });

  const financePreview = useMemo(() => {
    const total = parseBrlNumber(financeForm.total);
    const discount = parseBrlNumber(financeForm.discount);
    const down = parseBrlNumber(financeForm.down);
    const net = Math.max(0, total - discount);
    const balance = Math.max(0, net - down);
    return { total, discount, down, net, balance };
  }, [financeForm.total, financeForm.discount, financeForm.down]);

  const [saving, setSaving] = useState(false);

  const loadPatientsAndDoctors = async () => {
    setLoadingPatients(true);
    let pats: { id: string; name: string; phone?: string | null; cpf?: string | null }[] = [];

    // 1. Tenta API PHP / Central
    try {
      const phpPat = await patientsService.getPatients({ limit: 500 });
      if (phpPat && Array.isArray(phpPat) && phpPat.length > 0) {
        pats = phpPat.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone || null,
          cpf: p.cpf || null,
        }));
      }
    } catch {}

    // 2. Tenta Supabase
    if (pats.length === 0) {
      try {
        const { data } = await supabase
          .from("patients")
          .select("id,name,phone,cpf")
          .order("name")
          .limit(500);
        if (data && data.length > 0) pats = data as any;
      } catch {}
    }

    // 3. Mescla com pacientes salvos localmente
    const merged = mergeWithLocalPatients<{
      id: string;
      name: string;
      phone?: string | null;
      cpf?: string | null;
    }>(pats);
    merged.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setPatients(merged);
    setLoadingPatients(false);

    // Carrega médicos
    let docs: { id: string; name: string }[] = [];
    try {
      const phpDocs = await companyService.getDoctors();
      if (phpDocs && Array.isArray(phpDocs) && phpDocs.length > 0) {
        docs = phpDocs;
      }
    } catch {}
    if (docs.length === 0) {
      try {
        const { data: docData } = await supabase
          .from("doctors")
          .select("id,name")
          .order("name")
          .limit(200);
        if (docData && docData.length > 0) docs = docData as any;
      } catch {}
    }
    setDoctors(docs);
  };

  useEffect(() => {
    loadPatientsAndDoctors();
  }, []);

  const filteredPatients = useMemo(() => {
    const s = patientSearch.trim().toLowerCase();
    if (!s) return patients;
    return patients.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(s)) ||
        (p.cpf && p.cpf.replace(/\D/g, "").includes(s)) ||
        (p.phone && p.phone.replace(/\D/g, "").includes(s)),
    );
  }, [patients, patientSearch]);

  const selectedPatient = useMemo(() => {
    return patients.find((p) => p.id === form.patient_id);
  }, [patients, form.patient_id]);

  const submit = async () => {
    if (!form.patient_id || !form.title) {
      toast.error("Paciente e título são obrigatórios");
      return;
    }
    if (
      !form.start_date ||
      !Number.isInteger(Number(form.protocol_days)) ||
      Number(form.protocol_days) < 1 ||
      !Number.isInteger(Number(form.return_days)) ||
      Number(form.return_days) < 1 ||
      Number(form.return_days) > 365
    ) {
      toast.error("Confira início, duração e intervalo de retorno (1 a 365 dias).");
      return;
    }

    const totalNum = hasFinance ? financePreview.total : 0;
    const discountNum = hasFinance ? financePreview.discount : 0;
    const downNum = hasFinance ? financePreview.down : 0;
    const isLivre = financeForm.modality === "livre";
    const countNum = isLivre ? 1 : Math.max(1, parseInt(financeForm.installments) || 1);

    if (hasFinance && totalNum > 0) {
      if (downNum > financePreview.net) {
        toast.error("O valor da entrada não pode ser superior ao total líquido com desconto.");
        return;
      }
      if (downNum > 0 && !financeForm.downDue) {
        toast.error("Informe a data de vencimento da entrada.");
        return;
      }
      if (!isLivre && financePreview.balance > 0 && !financeForm.firstDue) {
        toast.error("Informe o primeiro vencimento do saldo parcelado.");
        return;
      }
    }

    setSaving(true);
    // Recebido no ato: a baixa só aceita data de hoje ou anterior (o banco recusa data futura)
    // e o vencimento acompanha o recebimento, para o título não ficar esperando baixa.
    const today = todayLocal();
    const downNow = downNum > 0 && financeForm.downReceivedNow;
    const aVistaNow =
      downNum === 0 && countNum === 1 && financeForm.modality === "parcelado" && financeForm.aVistaReceivedNow;
    const downDue = downNow && financeForm.downDue > today ? today : financeForm.downDue;
    const firstDue = aVistaNow && (!financeForm.firstDue || financeForm.firstDue > today) ? today : financeForm.firstDue;
    const startDateObj = new Date(form.start_date);
    const protocolDaysNum = Number(form.protocol_days) || 90;
    const endDateObj = new Date(startDateObj.getTime() + protocolDaysNum * 86400000);
    const endDateStr = endDateObj.toISOString().slice(0, 10);

    const payload = {
      patient_id: form.patient_id,
      doctor_id: form.doctor_id || null,
      title: form.title,
      objective: form.objective || null,
      start_date: form.start_date,
      end_date: endDateStr,
      return_days: form.return_days ? Number(form.return_days) : null,
      color: form.color,
      notes: form.notes || null,
      total_value: totalNum,
      discount: discountNum,
      down_payment: downNum,
      installments_count: isLivre ? 1 : countNum,
      payment_type: isLivre ? "parcelado" : (countNum === 1 && downNum === 0 ? "a_vista" : "parcelado"),
      down_payment_method: downNum > 0 ? financeForm.downMethod : null,
      payment_method: financeForm.method,
      down_payment_due_date: downNum > 0 ? downDue : null,
      first_due_date: firstDue || null,
    };

    const { data, error } = await supabase.from("treatments").insert(payload).select("id").single();
    if (error || !data) {
      setSaving(false);
      toast.error("Erro ao criar acompanhamento: " + (error?.message || ""));
      return;
    }
    if (hasWeightGoal(weightGoal)) {
      try {
        await saveWeightGoal(data.id, weightGoal);
      } catch (err) {
        toast.warning("Acompanhamento criado, mas a meta de peso não foi salva", {
          description: errorMessage(err),
        });
      }
    }

    // Configurar parcelas e entrada automaticamente no financeiro
    if (totalNum > 0) {
      try {
        const { error: confErr } = await supabase.rpc("configure_treatment_payment", {
          p_treatment_id: data.id,
          p_total: totalNum,
          p_discount: discountNum,
          p_down: downNum,
          p_type: isLivre ? "parcelado" : (countNum === 1 && downNum === 0 ? "a_vista" : "parcelado"),
          p_down_method: downNum > 0 ? financeForm.downMethod : null,
          p_method: financeForm.method || "pix",
          p_count: isLivre || (countNum === 1 && downNum === 0) ? 1 : countNum,
          p_down_due: downNum > 0 ? downDue : null,
          p_first_due: firstDue || null,
        });

        if (confErr) {
          console.error("Erro ao configurar parcelas via RPC:", confErr);
          toast.warning("Acompanhamento criado, mas as parcelas não foram geradas no financeiro", {
            description: `${confErr.message || "Erro desconhecido"}. Abra o acompanhamento e salve as condições de pagamento novamente.`,
          });
        } else if (isLivre && financePreview.balance > 0) {
          // Atualiza título de saldo livre
          const { error: labelErr } = await (supabase.rpc as any)("label_free_balance_title", {
            p_treatment_id: data.id,
            p_title: form.title,
          });
          if (labelErr) console.warn("Rótulo Saldo Livre não aplicado:", labelErr);
        }

        // Liquidação imediata no Fluxo de Caixa para Entrada ou À Vista
        if (downNum > 0 && financeForm.downReceivedNow) {
          const patName = patients.find((p) => p.id === form.patient_id)?.name || form.title || "Paciente";
          await recordImmediateTreatmentPayment({
            treatmentId: data.id,
            isDown: true,
            amount: downNum,
            paidDate: downDue,
            method: financeForm.downMethod,
            accountId: financeForm.downAccountId || financialAccounts[0]?.id || "",
            payerName: patName,
          });
        } else if (downNum === 0 && countNum === 1 && financeForm.modality === "parcelado" && financeForm.aVistaReceivedNow) {
          const patName = patients.find((p) => p.id === form.patient_id)?.name || form.title || "Paciente";
          await recordImmediateTreatmentPayment({
            treatmentId: data.id,
            isDown: false,
            amount: totalNum - discountNum,
            paidDate: firstDue,
            method: financeForm.method,
            accountId: financeForm.aVistaAccountId || financialAccounts[0]?.id || "",
            payerName: patName,
          });
        }
      } catch (err) {
        toast.warning("Acompanhamento salvo, mas o recebimento não foi registrado", {
          description: `${errorMessage(err)}. Registre a baixa pelo Financeiro.`,
        });
      }
    }

    try {
      void refreshFinance(queryClient);
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["treatments-list"] }),
        queryClient.invalidateQueries({ queryKey: ["treatment-finance-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["treatment-alerts"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["cash-flow-snapshot"] }),
      ]);
    } catch {}

    setSaving(false);
    if (downNum > 0 && financeForm.downReceivedNow) {
      toast.success(`Acompanhamento criado e entrada de ${brl(downNum)} lançada no Fluxo de Caixa com sucesso!`);
    } else if (downNum === 0 && countNum === 1 && financeForm.modality === "parcelado" && financeForm.aVistaReceivedNow) {
      toast.success(`Acompanhamento criado e valor de ${brl(totalNum - discountNum)} lançado no Fluxo de Caixa com sucesso!`);
    } else if (totalNum > 0) {
      toast.success("Acompanhamento criado e integrado ao Contas a Receber com sucesso!");
    } else {
      toast.success("Acompanhamento criado com sucesso!");
    }
    onCreated();
    onClose();
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (open) return;
          setIsPatientDropdownOpen(false);
          onClose();
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-2xl gap-0 p-0 [&>button.absolute]:hidden">
          <div className="flex items-center justify-between px-6 py-4.5 border-b border-border-soft sticky top-0 bg-card z-10">
            <div>
              <DialogTitle className="text-base">Novo Acompanhamento Clínico</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Defina o paciente, protocolo, cronograma e parâmetros iniciais.
              </DialogDescription>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground/80 flex items-center justify-center transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Seletor Inteligente de Paciente */}
            <div className="relative md:col-span-1">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-foreground/80">Paciente *</label>
                <button
                  type="button"
                  onClick={() => setShowNewPatientModal(true)}
                  className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus size={13} />+ Novo Paciente
                </button>
              </div>

              {selectedPatient ? (
                <div className="flex items-center justify-between h-10 px-3 rounded-xl bg-primary-soft/70 border border-primary/25">
                  <div className="flex items-center gap-2 truncate">
                    <UserIcon size={15} className="text-primary shrink-0" />
                    <span className="text-sm font-semibold text-primary-hover truncate">
                      {selectedPatient.name}
                    </span>
                    {selectedPatient.phone && (
                      <span className="text-xs text-primary truncate hidden sm:inline">
                        • {selectedPatient.phone}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setForm((f) => ({ ...f, patient_id: "" }));
                      setIsPatientDropdownOpen(true);
                    }}
                    className="text-xs font-semibold text-primary hover:text-primary-hover ml-2 shrink-0 cursor-pointer"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsPatientDropdownOpen((v) => !v)}
                    className={`w-full h-10 px-3 rounded-xl border text-left flex items-center justify-between text-sm transition cursor-pointer ${
                      isPatientDropdownOpen
                        ? "border-primary bg-card ring-2 ring-primary/15"
                        : "border-border bg-muted/60 text-foreground/80 hover:bg-muted/70"
                    }`}
                  >
                    <span className="text-muted-foreground">
                      {loadingPatients
                        ? "Carregando pacientes..."
                        : "Selecione ou busque um paciente…"}
                    </span>
                    <ChevronDown size={15} className="text-muted-foreground shrink-0" />
                  </button>

                  {isPatientDropdownOpen && (
                    <div className="absolute left-0 right-0 top-11 z-50 space-y-1.5 rounded-2xl border border-hairline bg-glass-strong p-2 shadow-(--glass-shadow-lg) glass-blur-strong animate-in fade-in zoom-in-95">
                      <div className="relative">
                        <Search
                          size={14}
                          className="absolute left-2.5 top-2.5 text-muted-foreground"
                        />
                        <input
                          autoFocus
                          type="text"
                          value={patientSearch}
                          onChange={(e) => setPatientSearch(e.target.value)}
                          placeholder="Buscar paciente por nome, CPF ou telefone..."
                          className="w-full h-8.5 pl-8 pr-3 rounded-lg bg-muted/60 border border-border text-xs focus:outline-none focus:border-primary text-foreground"
                        />
                      </div>

                      <div className="max-h-48 overflow-y-auto space-y-0.5 pt-1">
                        {loadingPatients ? (
                          <div className="p-3 text-center text-xs text-muted-foreground">
                            Carregando lista de pacientes...
                          </div>
                        ) : filteredPatients.length === 0 ? (
                          <div className="p-3 text-center text-xs text-muted-foreground space-y-2">
                            <div>Nenhum paciente encontrado</div>
                            <button
                              type="button"
                              onClick={() => {
                                setIsPatientDropdownOpen(false);
                                setShowNewPatientModal(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition cursor-pointer"
                            >
                              <UserPlus size={12} />
                              Cadastrar "{patientSearch || "Novo Paciente"}"
                            </button>
                          </div>
                        ) : (
                          filteredPatients.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setForm((f) => ({ ...f, patient_id: p.id }));
                                setIsPatientDropdownOpen(false);
                                setPatientSearch("");
                              }}
                              className="w-full p-2 rounded-xl text-left hover:bg-primary-soft/70 transition flex items-center justify-between group cursor-pointer"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground group-hover:text-primary truncate">
                                  {p.name}
                                </div>
                                <div className="text-xs text-muted-foreground flex items-center gap-2">
                                  {p.cpf && <span>CPF: {p.cpf}</span>}
                                  {p.phone && <span>Tel: {p.phone}</span>}
                                </div>
                              </div>
                              {form.patient_id === p.id && (
                                <Check size={14} className="text-primary shrink-0" />
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Field label="Médico responsável">
              <select
                className={inputCls}
                value={form.doctor_id}
                onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}
              >
                <option value="">— Selecione o profissional —</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Título do Acompanhamento *" className="md:col-span-2">
              <input
                className={inputCls}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex.: Emagrecimento Metabólico 90 dias / Reabilitação / Pós-Operatório"
              />
            </Field>
            <Field label="Objetivo Clínico" className="md:col-span-2">
              <textarea
                rows={2}
                className={inputCls}
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
                placeholder="Meta clínica, parâmetros a atingir, redução de peso, cicatrização..."
              />
            </Field>
            <div className="md:col-span-2 rounded-xl border border-border p-3">
              <div className="mb-2 text-xs font-semibold text-foreground/80">
                Peso inicial e meta de peso
              </div>
              <WeightGoalFields value={weightGoal} onChange={setWeightGoal} inputClass={inputCls} />
            </div>
            <Field label="Data de início">
              <input
                type="date"
                className={inputCls}
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </Field>
            <Field label="Duração do Protocolo">
              <select
                className={inputCls}
                value={form.protocol_days}
                onChange={(e) => setForm({ ...form, protocol_days: e.target.value })}
              >
                <option value="30">30 dias (1 mês)</option>
                <option value="60">60 dias (2 meses)</option>
                <option value="90">90 dias (3 meses)</option>
                <option value="120">120 dias (4 meses)</option>
                <option value="180">180 dias (6 meses)</option>
                <option value="365">365 dias (1 ano)</option>
              </select>
            </Field>
            <Field label="Retorno automático (dias)">
              <select
                className={inputCls}
                value={form.return_days}
                onChange={(e) => setForm({ ...form, return_days: e.target.value })}
              >
                {[15, 30, 45, 60, 90, 120, 180, 365].map((n) => (
                  <option key={n} value={n}>
                    {n} dias
                  </option>
                ))}
              </select>
            </Field>
            {/* ================= SEÇÃO FINANCEIRA INTEGRADA ================= */}
            <div className="md:col-span-2 rounded-2xl border border-primary/25 bg-primary-soft/30 p-4 space-y-3.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      Condições Financeiras do Acompanhamento
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Gera automaticamente os lançamentos e parcelas no Contas a Receber
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none bg-card px-2.5 py-1 rounded-lg border border-border">
                  <input
                    type="checkbox"
                    checked={hasFinance}
                    onChange={(e) => setHasFinance(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <span>Definir valores agora</span>
                </label>
              </div>

              {hasFinance && (
                <div className="space-y-3.5 pt-2 border-t border-primary/15 animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Valor Total (R$) *">
                      <input
                        type="text"
                        inputMode="decimal"
                        className={inputCls}
                        placeholder="Ex.: 8000,00"
                        value={financeForm.total}
                        onChange={(e) => setFinanceForm({ ...financeForm, total: e.target.value })}
                      />
                    </Field>
                    <Field label="Desconto (R$)">
                      <input
                        type="text"
                        inputMode="decimal"
                        className={inputCls}
                        placeholder="0,00"
                        value={financeForm.discount}
                        onChange={(e) =>
                          setFinanceForm({ ...financeForm, discount: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Modalidade do Saldo">
                      <select
                        className={inputCls}
                        value={financeForm.modality}
                        onChange={(e) =>
                          setFinanceForm({
                            ...financeForm,
                            modality: e.target.value as "parcelado" | "livre",
                          })
                        }
                      >
                        <option value="parcelado">Parcelado com vencimentos fixos</option>
                        <option value="livre">Pagamentos livres (Sem vencimento fixo)</option>
                      </select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Valor de Entrada (R$)">
                      <input
                        type="text"
                        inputMode="decimal"
                        className={inputCls}
                        placeholder="Ex.: 1000,00"
                        value={financeForm.down}
                        onChange={(e) => setFinanceForm({ ...financeForm, down: e.target.value })}
                      />
                    </Field>
                    {parseBrlNumber(financeForm.down) > 0 && (
                      <div className="sm:col-span-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                            <input
                              type="checkbox"
                              checked={financeForm.downReceivedNow}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, downReceivedNow: e.target.checked })
                              }
                              className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                            />
                            <span>Entrada recebida à vista hoje (lançar no Fluxo de Caixa)</span>
                          </label>
                          {financeForm.downReceivedNow && (
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              Fluxo de Caixa
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <Field label="Forma da Entrada">
                            <select
                              className={inputCls}
                              value={financeForm.downMethod}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, downMethod: e.target.value })
                              }
                            >
                              <option value="pix">PIX</option>
                              <option value="dinheiro">Dinheiro</option>
                              <option value="cartao_debito">Cartão de Débito</option>
                              <option value="cartao_credito">Cartão de Crédito</option>
                              <option value="transferencia">Transferência</option>
                              <option value="boleto">Boleto Bancário</option>
                            </select>
                          </Field>

                          <Field label="Data de Recebimento">
                            <input
                              type="date"
                              className={inputCls}
                              value={financeForm.downDue}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, downDue: e.target.value })
                              }
                            />
                          </Field>

                          <Field label="Conta de Entrada">
                            <select
                              className={inputCls}
                              value={financeForm.downAccountId || financialAccounts[0]?.id || ""}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, downAccountId: e.target.value })
                              }
                            >
                              {financialAccounts.length === 0 && (
                                <option value="">Cadastre uma conta no Financeiro</option>
                              )}
                              {financialAccounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        {financeForm.downReceivedNow && (
                          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                            <CheckCircle2 size={13} className="shrink-0" />
                            A entrada entrará imediatamente no Fluxo de Caixa Realizado como receita no caixa da clínica.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {parseBrlNumber(financeForm.down) === 0 && parseInt(financeForm.installments) === 1 && financeForm.modality === "parcelado" && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                          <input
                            type="checkbox"
                            checked={financeForm.aVistaReceivedNow}
                            onChange={(e) =>
                              setFinanceForm({ ...financeForm, aVistaReceivedNow: e.target.checked })
                            }
                            className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                          />
                          <span>Pagamento à vista já recebido hoje (lançar no Fluxo de Caixa)</span>
                        </label>
                        {financeForm.aVistaReceivedNow && (
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            Fluxo de Caixa
                          </span>
                        )}
                      </div>

                      {financeForm.aVistaReceivedNow && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <Field label="Forma de Pagamento">
                            <select
                              className={inputCls}
                              value={financeForm.method}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, method: e.target.value })
                              }
                            >
                              <option value="pix">PIX</option>
                              <option value="dinheiro">Dinheiro</option>
                              <option value="cartao_debito">Cartão de Débito</option>
                              <option value="cartao_credito">Cartão de Crédito</option>
                              <option value="transferencia">Transferência</option>
                              <option value="boleto">Boleto Bancário</option>
                            </select>
                          </Field>

                          <Field label="Conta de Entrada">
                            <select
                              className={inputCls}
                              value={financeForm.aVistaAccountId || financialAccounts[0]?.id || ""}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, aVistaAccountId: e.target.value })
                              }
                            >
                              {financialAccounts.length === 0 && (
                                <option value="">Cadastre uma conta no Financeiro</option>
                              )}
                              {financialAccounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      )}
                      {financeForm.aVistaReceivedNow && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="shrink-0" />
                          O valor total de {brl(financePreview.balance)} entrará imediatamente no Fluxo de Caixa como receita realizada.
                        </p>
                      )}
                    </div>
                  )}

                  {financePreview && financePreview.balance > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Field label="Forma do Saldo Restante">
                        <select
                          className={inputCls}
                          value={financeForm.method}
                          onChange={(e) =>
                            setFinanceForm({ ...financeForm, method: e.target.value })
                          }
                        >
                          <option value="pix">PIX</option>
                          <option value="cartao_credito">Cartão de Crédito</option>
                          <option value="cartao_debito">Cartão de Débito</option>
                          <option value="boleto">Boleto Bancário</option>
                          <option value="dinheiro">Dinheiro</option>
                          <option value="transferencia">Transferência</option>
                        </select>
                      </Field>

                      {financeForm.modality === "parcelado" && (
                        <>
                          <Field label="Nº de Parcelas do Saldo">
                            <select
                              className={inputCls}
                              value={financeForm.installments}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, installments: e.target.value })
                              }
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 24].map((n) => (
                                <option key={n} value={n}>
                                  {n}x{" "}
                                  {financePreview.balance > 0
                                    ? `de ${brl(financePreview.balance / n)}`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="1º Vencimento do Saldo">
                            <input
                              type="date"
                              className={inputCls}
                              value={financeForm.firstDue}
                              onChange={(e) =>
                                setFinanceForm({ ...financeForm, firstDue: e.target.value })
                              }
                            />
                          </Field>
                        </>
                      )}

                      {financeForm.modality === "livre" && (
                        <div className="sm:col-span-2 flex items-center gap-2 p-3 bg-card rounded-xl border border-primary/20 text-xs text-primary font-medium">
                          <CheckCircle2 size={16} className="text-primary shrink-0" />
                          <span>
                            Saldo livre de {brl(financePreview.balance)} em aberto para baixas parciais avulsas, sem vencimento fixo e sem alarmes indevidos de atraso.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resumo visual do contrato */}
                  {financePreview.total > 0 && (
                    <div className="p-3 bg-card rounded-xl border border-border text-xs flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        Entrada: <strong className="text-foreground">{brl(financePreview.down)}</strong> · Saldo a receber:{" "}
                        <strong className="text-primary">{brl(financePreview.balance)}</strong>
                        {financeForm.modality === "parcelado" && financePreview.balance > 0 && (
                          <span> ({financeForm.installments}x com 1º vencimento em {new Date(financeForm.firstDue + "T12:00:00").toLocaleDateString("pt-BR")})</span>
                        )}
                        {financeForm.modality === "livre" && financePreview.balance > 0 && (
                          <span> (sem vencimento fixado)</span>
                        )}
                      </span>
                      <span className="font-semibold text-foreground">
                        Total Líquido: {brl(financePreview.net)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <Field label="Cor de identificação">
              <div className="flex flex-wrap gap-2 pt-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className="h-7 w-7 rounded-full border-2 transition cursor-pointer"
                    style={{
                      background: c,
                      borderColor: form.color === c ? "var(--foreground)" : "transparent",
                    }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Observações iniciais" className="md:col-span-2">
              <textarea
                rows={2}
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Anotações internas..."
              />
            </Field>
          </div>

          <div className="px-6 py-4 border-t border-border-soft flex justify-end gap-2.5 sticky bottom-0 bg-card">
            <button
              onClick={onClose}
              className="h-10 px-4 rounded-lg bg-muted hover:bg-surface-2 text-foreground/80 text-sm font-semibold transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              disabled={saving}
              onClick={submit}
              className="h-10 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-sm transition active:scale-98 disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Salvando…" : "Criar acompanhamento"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {showNewPatientModal && (
        <PatientModal
          open={showNewPatientModal}
          onClose={() => setShowNewPatientModal(false)}
          onSaved={(newPat) => {
            if (newPat && newPat.id) {
              setPatients((prev) => [newPat, ...prev.filter((p) => p.id !== newPat.id)]);
              setForm((f) => ({ ...f, patient_id: newPat.id }));
            } else {
              loadPatientsAndDoctors();
            }
            setShowNewPatientModal(false);
          }}
        />
      )}
    </>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-xl bg-muted/60 border border-border focus:border-primary focus:bg-card outline-none text-sm text-foreground transition";

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-semibold text-foreground/80 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

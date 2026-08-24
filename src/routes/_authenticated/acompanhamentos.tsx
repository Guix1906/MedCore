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
  UserPlus,
  ChevronDown,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { patientsService, companyService } from "@/services/api";
import { getStoredLocalPatients, mergeWithLocalPatients } from "@/lib/local-patients";
import { PatientModal } from "@/components/pacientes/PatientModal";

export const Route = createFileRoute("/_authenticated/acompanhamentos")({
  head: () => ({
    meta: [
      { title: "Acompanhamentos • MedCore" },
      { name: "description", content: "Gestão completa de tratamentos, fases clínicas e acompanhamentos." },
    ],
  }),
  component: AcompanhamentosPage,
});

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
  color: string;
  return_days: number | null;
  next_return_date: string | null;
  notes: string | null;
  created_at: string;
  patients?: { name: string; phone?: string | null } | null;
  doctors?: { name: string } | null;
};

const STATUS_LABEL: Record<Treatment["status"], { label: string; bg: string; fg: string }> = {
  em_andamento: { label: "Em andamento", bg: "#DCFCE7", fg: "#166534" },
  pausado: { label: "Pausado", bg: "#FEF3C7", fg: "#92400E" },
  finalizado: { label: "Finalizado", bg: "#DBEAFE", fg: "#1E40AF" },
  cancelado: { label: "Cancelado", bg: "#FEE2E2", fg: "#991B1B" },
};

const COLORS = ["#8B47FF", "#6C4CF7", "#10B981", "#F59E0B", "#EC4899", "#0EA5E9", "#EF4444"];

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | Treatment["status"]>("todos");
  const [viewMode, setViewMode] = useState<"cards" | "kanban">("cards");
  const [openNew, setOpenNew] = useState(false);
  const [selectedTreatment, setSelectedTreatment] = useState<Treatment | null>(null);

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["treatments-list"],
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatments")
        .select("*, patients(name, phone), doctors(name)")
        .order("created_at", { ascending: false });
      if (error) toast.error("Erro ao carregar acompanhamentos");
      return (data ?? []) as unknown as Treatment[];
    },
  });

  const load = () => {
    queryClient.invalidateQueries({ queryKey: ["treatments-list"] });
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "todos" && r.status !== statusFilter) return false;
      if (!s) return true;
      return (
        r.title.toLowerCase().includes(s) ||
        r.patients?.name?.toLowerCase().includes(s) ||
        r.doctors?.name?.toLowerCase().includes(s)
      );
    });
  }, [rows, q, statusFilter]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const ativos = rows.filter((r) => r.status === "em_andamento").length;
    const finalizados = rows.filter((r) => r.status === "finalizado").length;
    const receita = rows
      .filter((r) => r.status !== "cancelado")
      .reduce((s, r) => s + Number(r.total_value || 0), 0);
    return { total, ativos, finalizados, receita };
  }, [rows]);

  // Agrupamento para Visão Kanban por fases clínicas
  const kanbanColumns = useMemo(() => {
    const f1: Treatment[] = [];
    const f2: Treatment[] = [];
    const f3: Treatment[] = [];
    const f4: Treatment[] = [];

    filtered.forEach((t) => {
      if (t.status === "finalizado") {
        f4.push(t);
      } else if (t.status === "pausado") {
        f3.push(t);
      } else {
        const prog = computeProgress(t);
        if (prog <= 25) f1.push(t);
        else if (prog <= 70) f2.push(t);
        else f3.push(t);
      }
    });

    return [
      {
        id: "fase1",
        title: "1. Diagnóstico & Início",
        subtitle: "Até 25% do protocolo",
        badge: `${f1.length}`,
        color: "#8B47FF",
        items: f1,
      },
      {
        id: "fase2",
        title: "2. Intervenção Ativa",
        subtitle: "25% a 70% do protocolo",
        badge: `${f2.length}`,
        color: "#0EA5E9",
        items: f2,
      },
      {
        id: "fase3",
        title: "3. Manutenção & Retornos",
        subtitle: "Fase final ou pausado",
        badge: `${f3.length}`,
        color: "#F59E0B",
        items: f3,
      },
      {
        id: "fase4",
        title: "4. Concluído / Alta",
        subtitle: "Protocolos finalizados",
        badge: `${f4.length}`,
        color: "#10B981",
        items: f4,
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
      `Olá ${t.patients?.name}! Entramos em contato da clínica sobre o seu acompanhamento "${t.title}". Como você está se sentindo?`
    );
    window.open(`https://wa.me/55${phone}?text=${msg}`, "_blank");
  };

  if (isChildRoute) {
    return <Outlet />;
  }

  return (
    <AppShell>
      <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
        {/* Cabeçalho */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#111827] tracking-tight">
                Acompanhamentos
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700">
                Copiloto Clínico
              </span>
            </div>
            <p className="text-[13.5px] text-[#6B7280] mt-1">
              Fases de tratamento, cronograma de medicamentos, linha do tempo e financeiro.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Alternador Cards / Kanban */}
            <div className="flex items-center bg-[#F3F4F6] p-1 rounded-xl border border-black/[0.04]">
              <button
                onClick={() => setViewMode("cards")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition cursor-pointer ${
                  viewMode === "cards"
                    ? "bg-white text-[#111827] shadow-sm"
                    : "text-[#6B7280] hover:text-[#111827]"
                }`}
                title="Visão em Cards"
              >
                <LayoutGrid size={15} />
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition cursor-pointer ${
                  viewMode === "kanban"
                    ? "bg-white text-[#111827] shadow-sm"
                    : "text-[#6B7280] hover:text-[#111827]"
                }`}
                title="Visão em Fases / Kanban"
              >
                <Kanban size={15} />
                <span className="hidden sm:inline">Fases / Kanban</span>
              </button>
            </div>

            <button
              onClick={() => setOpenNew(true)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#8B47FF] hover:bg-[#7A3AE6] text-white text-[13.5px] font-bold shadow-md shadow-purple-500/20 active:scale-98 transition cursor-pointer"
            >
              <Plus size={16} />
              <span>Novo acompanhamento</span>
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {[
            { label: "Total cadastrados", value: kpis.total, color: "#8B47FF", icon: Activity },
            { label: "Em andamento", value: kpis.ativos, color: "#10B981", icon: TrendingUp },
            { label: "Finalizados", value: kpis.finalizados, color: "#1E40AF", icon: CheckCircle2 },
            { label: "Valor sob gestão", value: brl(kpis.receita), color: "#F59E0B", icon: Sparkles },
          ].map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div
                key={k.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-2xl border border-slate-200/80 p-4.5 shadow-sm flex items-center justify-between"
              >
                <div>
                  <div className="text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                    {k.label}
                  </div>
                  <div
                    className="text-[22px] font-extrabold text-[#111827] mt-1"
                    style={{ color: typeof k.value === "number" ? k.color : "#111827" }}
                  >
                    {k.value}
                  </div>
                </div>
                <div
                  className="h-11 w-11 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: k.color + "15", color: k.color }}
                >
                  <Icon size={20} />
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-sm flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por paciente, médico ou título do tratamento…"
              className="w-full h-10 pl-10 pr-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-purple-500 focus:bg-white outline-none text-[13.5px] transition"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(["todos", "em_andamento", "pausado", "finalizado", "cancelado"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`h-9 px-3 rounded-xl text-[12.5px] font-semibold transition cursor-pointer ${
                  statusFilter === s
                    ? "bg-[#8B47FF] text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {s === "todos" ? "Todos" : STATUS_LABEL[s].label}
              </button>
            ))}
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
                    className="h-48 rounded-2xl bg-white border border-slate-200 animate-pulse"
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
                <Activity size={44} className="mx-auto text-slate-300" strokeWidth={1.5} />
                <div className="mt-3 text-[16px] font-bold text-slate-800">
                  Nenhum acompanhamento encontrado
                </div>
                <div className="text-[13px] text-slate-500 mt-1">
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
                        className="block bg-white rounded-2xl border border-slate-200/80 p-5 hover:shadow-xl hover:border-purple-300 hover:-translate-y-0.5 transition-all group relative overflow-hidden cursor-pointer"
                      >
                        {/* Indicador de progresso no topo do card */}
                        <div className="absolute top-0 left-0 right-0 h-1 bg-slate-100">
                          <div
                            className="h-full transition-all duration-700"
                            style={{
                              width: `${prog}%`,
                              background: t.color || "#8B47FF",
                            }}
                          />
                        </div>

                        <div className="flex items-start justify-between gap-3 mt-1">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="h-11 w-11 shrink-0 rounded-2xl flex items-center justify-center shadow-xs"
                              style={{ background: (t.color || "#8B47FF") + "18", color: t.color || "#8B47FF" }}
                            >
                              <Activity size={20} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[15px] font-bold text-[#0F172A] truncate group-hover:text-purple-700 transition-colors">
                                {t.title}
                              </div>
                              <div className="text-[12.5px] text-slate-600 truncate flex items-center gap-1.5 mt-0.5">
                                <UserIcon size={13} className="text-slate-400" />
                                <span className="font-semibold">{t.patients?.name ?? "—"}</span>
                              </div>
                            </div>
                          </div>
                          <span
                            className="text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
                            style={{ background: st.bg, color: st.fg }}
                          >
                            {st.label}
                          </span>
                        </div>

                        {/* Barra de Progresso com label */}
                        <div className="mt-4 pt-1">
                          <div className="flex items-center justify-between text-[11.5px] font-semibold text-slate-600 mb-1.5">
                            <span>Progresso do protocolo</span>
                            <span className="font-bold text-slate-900">{prog}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${prog}%`, background: t.color || "#8B47FF" }}
                            />
                          </div>
                        </div>

                        {/* Dados adicionais */}
                        <div className="mt-4 grid grid-cols-2 gap-3 text-[12.5px] bg-slate-50/80 p-3 rounded-xl">
                          <div>
                            <div className="text-slate-400 text-[11px] font-semibold uppercase">Início</div>
                            <div className="text-slate-800 font-semibold mt-0.5 flex items-center gap-1">
                              <CalIcon size={12} className="text-purple-600" />
                              {new Date(t.start_date).toLocaleDateString("pt-BR")}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-[11px] font-semibold uppercase">Valor</div>
                            <div className="text-slate-900 font-bold mt-0.5">
                              {brl(Number(t.total_value))}
                            </div>
                          </div>
                        </div>

                        {/* Footer do Card com Ações Rápidas */}
                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {t.patients?.phone && (
                              <button
                                type="button"
                                onClick={(e) => openWhatsAppPatient(e, t)}
                                className="h-7.5 px-2.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11.5px] font-bold inline-flex items-center gap-1 transition cursor-pointer"
                                title="Enviar mensagem no WhatsApp"
                              >
                                <MessageCircle size={13} />
                                <span>WhatsApp</span>
                              </button>
                            )}
                            <span className="text-[11.5px] text-slate-500 truncate max-w-[130px]">
                              {t.doctors?.name ? `Dr(a). ${t.doctors.name}` : ""}
                            </span>
                          </div>

                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTreatment(t);
                            }}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-purple-50 group-hover:bg-purple-600 text-purple-700 group-hover:text-white text-[12.5px] font-bold transition-all shadow-2xs"
                          >
                            <span>Gerenciar</span>
                            <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
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
                className="bg-slate-50/90 rounded-2xl border border-slate-200/80 p-3.5 flex flex-col min-h-[480px]"
              >
                {/* Header da Coluna */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 px-1">
                  <div>
                    <div className="text-[13.5px] font-bold text-slate-900 flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full inline-block"
                        style={{ background: col.color }}
                      />
                      {col.title}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{col.subtitle}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 text-[11px] font-bold shadow-2xs">
                    {col.badge}
                  </span>
                </div>

                {/* Lista de cards da coluna */}
                <div className="space-y-3 mt-3 flex-1 overflow-y-auto max-h-[620px] pr-0.5">
                  {col.items.length === 0 ? (
                    <div className="text-center py-10 text-[12px] text-slate-400 font-medium">
                      Nenhum tratamento nesta fase.
                    </div>
                  ) : (
                    col.items.map((t) => {
                      const prog = computeProgress(t);
                      return (
                        <div
                          key={t.id}
                          onClick={() => setSelectedTreatment(t)}
                          className="block bg-white rounded-xl border border-slate-200/90 p-3.5 shadow-2xs hover:shadow-md hover:border-purple-400 transition group cursor-pointer"
                        >
                          <div className="text-[13.5px] font-bold text-slate-900 truncate group-hover:text-purple-700">
                            {t.title}
                          </div>
                          <div className="text-[12px] text-slate-600 mt-1 flex items-center gap-1 truncate font-medium">
                            <UserIcon size={12} className="text-slate-400" />
                            {t.patients?.name ?? "—"}
                          </div>

                          <div className="mt-3">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                              <span>Progresso</span>
                              <span>{prog}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${prog}%`, background: col.color }}
                              />
                            </div>
                          </div>

                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11.5px]">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">
                                {brl(Number(t.total_value))}
                              </span>
                              {t.patients?.phone && (
                                <button
                                  type="button"
                                  onClick={(e) => openWhatsAppPatient(e, t)}
                                  className="text-emerald-600 hover:text-emerald-800 flex items-center gap-1 font-semibold cursor-pointer"
                                  title="WhatsApp"
                                >
                                  <MessageCircle size={12} />
                                  <span>WhatsApp</span>
                                </button>
                              )}
                            </div>
                            <span className="text-[11px] font-bold text-purple-600 group-hover:underline flex items-center">
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
    start_date: treatment.start_date || new Date().toISOString().slice(0, 10),
    protocol_days: String(totalDays > 0 ? totalDays : 90),
    return_days: String(treatment.return_days || 30),
    total_value: String(treatment.total_value || "").replace(".", ","),
    down_payment: String(treatment.down_payment || "").replace(".", ","),
    discount: String(treatment.discount || "").replace(".", ","),
    installments_count: String(treatment.installments_count || 1),
    payment_method: treatment.payment_method || "pix",
    color: treatment.color || COLORS[0],
    notes: treatment.notes || "",
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("doctors").select("id,name").order("name");
      setDoctors((data as unknown as { id: string; name: string }[]) ?? []);
    })();
  }, []);

  const handleQuickStatusChange = async (newStatus: Treatment["status"]) => {
    const { error } = await supabase
      .from("treatments")
      .update({ status: newStatus })
      .eq("id", treatment.id);
    if (error) {
      toast.error("Erro ao alterar status");
      return;
    }
    toast.success(`Status alterado para "${STATUS_LABEL[newStatus].label}"`);
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

    const { error } = await supabase.from("treatments").delete().eq("id", treatment.id);
    if (error) {
      toast.error("Erro ao excluir acompanhamento");
      return;
    }
    toast.success("Acompanhamento excluído com sucesso!");
    onUpdated();
    onClose();
  };

  const handleSaveEdit = async () => {
    if (!form.title.trim()) {
      toast.error("O título é obrigatório");
      return;
    }
    setSaving(true);
    const startDateObj = new Date(form.start_date);
    const protocolDaysNum = Number(form.protocol_days) || 90;
    const endDateObj = new Date(startDateObj.getTime() + protocolDaysNum * 86400000);
    const endDateStr = endDateObj.toISOString().slice(0, 10);

    const payload = {
      title: form.title.trim(),
      objective: form.objective.trim() || null,
      doctor_id: form.doctor_id || null,
      status: form.status,
      start_date: form.start_date,
      end_date: endDateStr,
      total_value: parseBRL(form.total_value),
      down_payment: parseBRL(form.down_payment),
      discount: parseBRL(form.discount),
      installments_count: Math.max(1, Number(form.installments_count) || 1),
      payment_method: form.payment_method,
      return_days: form.return_days ? Number(form.return_days) : null,
      color: form.color,
      notes: form.notes.trim() || null,
    };

    const { error } = await supabase
      .from("treatments")
      .update(payload)
      .eq("id", treatment.id);

    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar alterações");
      return;
    }
    toast.success("Acompanhamento atualizado com sucesso!");
    setIsEditing(false);
    onUpdated();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto border border-slate-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-10 w-10 shrink-0 rounded-2xl flex items-center justify-center"
              style={{ background: (treatment.color || "#8B47FF") + "18", color: treatment.color || "#8B47FF" }}
            >
              <Activity size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-[16px] font-bold text-slate-900 truncate">
                {treatment.title}
              </div>
              <div className="text-[12px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                <UserIcon size={12} className="text-slate-400" />
                <span className="font-semibold">{treatment.patients?.name || "Paciente"}</span>
                <span>•</span>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold"
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
              className={`h-8.5 px-3 rounded-xl text-[12.5px] font-bold flex items-center gap-1.5 transition cursor-pointer ${
                isEditing
                  ? "bg-purple-100 text-purple-700"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700"
              }`}
              title={isEditing ? "Cancelar Edição" : "Editar Acompanhamento"}
            >
              <Edit3 size={14} />
              <span>{isEditing ? "Visualizar" : "Editar"}</span>
            </button>
            <button
              onClick={onClose}
              className="h-8.5 w-8.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition cursor-pointer"
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
                  onChange={(e) => setForm({ ...form, status: e.target.value as Treatment["status"] })}
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

              <Field label="Valor Total (R$)">
                <input
                  inputMode="decimal"
                  className={inputCls}
                  value={form.total_value}
                  onChange={(e) => setForm({ ...form, total_value: onlyDecimal(e.target.value) })}
                  placeholder="0,00"
                />
              </Field>

              <Field label="Entrada (R$)">
                <input
                  inputMode="decimal"
                  className={inputCls}
                  value={form.down_payment}
                  onChange={(e) => setForm({ ...form, down_payment: onlyDecimal(e.target.value) })}
                  placeholder="0,00"
                />
              </Field>

              <Field label="Desconto (R$)">
                <input
                  inputMode="decimal"
                  className={inputCls}
                  value={form.discount}
                  onChange={(e) => setForm({ ...form, discount: onlyDecimal(e.target.value) })}
                  placeholder="0,00"
                />
              </Field>

              <Field label="Nº de Parcelas">
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className={inputCls}
                  value={form.installments_count}
                  onChange={(e) =>
                    setForm({ ...form, installments_count: e.target.value.replace(/\D/g, "") })
                  }
                  placeholder="1"
                />
              </Field>

              <Field label="Forma de Pagamento">
                <select
                  className={inputCls}
                  value={form.payment_method}
                  onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                >
                  <option value="pix">Pix</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao_credito">Cartão de crédito</option>
                  <option value="cartao_debito">Cartão de débito</option>
                  <option value="boleto">Boleto</option>
                  <option value="transferencia">Transferência</option>
                </select>
              </Field>

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
                        borderColor: form.color === c ? "#111827" : "transparent",
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
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Paciente
                  </div>
                  <div className="text-[16px] font-bold text-slate-900 mt-0.5">
                    {treatment.patients?.name || "Paciente não identificado"}
                  </div>
                  <div className="text-[12.5px] text-slate-500 mt-0.5">
                    {treatment.doctors?.name ? `Médico responsável: Dr(a). ${treatment.doctors.name}` : "Sem médico atribuído"}
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
                          `Olá ${treatment.patients?.name}! Entramos em contato da clínica sobre o seu acompanhamento "${treatment.title}".`
                        );
                        window.open(`https://wa.me/55${phone}?text=${msg}`, "_blank");
                      }}
                      className="h-9 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                    >
                      <MessageCircle size={15} />
                      <span>WhatsApp</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Barra de Progresso e Prazos */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4.5 space-y-3">
                <div className="flex items-center justify-between text-[13px] font-semibold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <TrendingUp size={16} className="text-purple-600" />
                    Progresso do Tratamento
                  </span>
                  <span className="font-bold text-purple-700">{prog}%</span>
                </div>

                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${prog}%`, background: treatment.color || "#8B47FF" }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-100 text-[12px]">
                  <div>
                    <div className="text-slate-400 text-[10.5px] font-bold uppercase">Início</div>
                    <div className="font-bold text-slate-800 mt-0.5">
                      {new Date(treatment.start_date).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[10.5px] font-bold uppercase">Dias Corridos</div>
                    <div className="font-bold text-purple-700 mt-0.5">{passedDays} dias</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[10.5px] font-bold uppercase">Restantes</div>
                    <div className="font-bold text-slate-800 mt-0.5">{remainingDays} dias</div>
                  </div>
                </div>
              </div>

              {/* Informações Financeiras */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
                  <div className="text-[11px] font-bold text-slate-400 uppercase">Valor Total</div>
                  <div className="text-[16px] font-extrabold text-slate-900 mt-1">
                    {brl(Number(treatment.total_value))}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
                  <div className="text-[11px] font-bold text-slate-400 uppercase">Entrada</div>
                  <div className="text-[16px] font-extrabold text-emerald-600 mt-1">
                    {brl(Number(treatment.down_payment))}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
                  <div className="text-[11px] font-bold text-slate-400 uppercase">Parcelas</div>
                  <div className="text-[16px] font-extrabold text-slate-900 mt-1">
                    {treatment.installments_count || 1}x
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
                  <div className="text-[11px] font-bold text-slate-400 uppercase">Pagamento</div>
                  <div className="text-[14px] font-bold text-purple-700 mt-1 capitalize">
                    {treatment.payment_method?.replace("_", " ") || "Pix"}
                  </div>
                </div>
              </div>

              {/* Objetivo e Notas */}
              {treatment.objective && (
                <div className="bg-purple-50/50 border border-purple-100 rounded-2xl p-4">
                  <div className="text-[11px] font-bold text-purple-700 uppercase tracking-wider">
                    Objetivo Clínico
                  </div>
                  <p className="text-[13px] text-slate-700 mt-1 leading-relaxed">
                    {treatment.objective}
                  </p>
                </div>
              )}

              {treatment.notes && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Observações Internas
                  </div>
                  <p className="text-[13px] text-slate-700 mt-1 leading-relaxed">
                    {treatment.notes}
                  </p>
                </div>
              )}

              {/* Alteração Rápida de Status */}
              <div className="pt-2 border-t border-slate-100">
                <div className="text-[11.5px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
                  Alterar Status do Acompanhamento
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["em_andamento", "pausado", "finalizado", "cancelado"] as const).map((statusKey) => (
                    <button
                      key={statusKey}
                      type="button"
                      onClick={() => handleQuickStatusChange(statusKey)}
                      className={`h-8.5 px-3 rounded-xl text-[12px] font-bold transition cursor-pointer flex items-center gap-1.5 ${
                        treatment.status === statusKey
                          ? "ring-2 ring-purple-600 ring-offset-1 font-extrabold"
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
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 sticky bottom-0 bg-white">
          <div>
            {!isEditing ? (
              <button
                type="button"
                onClick={handleDelete}
                className="h-10 px-3 rounded-xl text-rose-600 hover:bg-rose-50 text-[13px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                title="Excluir Acompanhamento"
              >
                <Trash2 size={16} />
                <span>Excluir</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-semibold transition cursor-pointer"
              >
                Cancelar
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isEditing ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate({ to: "/acompanhamentos/$id", params: { id: treatment.id } });
                }}
                className="h-10 px-4 rounded-xl bg-[#8B47FF] hover:bg-[#7A3AE6] text-white text-[13px] font-bold shadow-md shadow-purple-500/20 inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <Pill size={15} />
                <span>Abrir página completa</span>
                <ExternalLink size={14} />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveEdit}
                className="h-10 px-5 rounded-xl bg-[#8B47FF] hover:bg-[#7A3AE6] text-white text-[13px] font-bold shadow-sm inline-flex items-center gap-1.5 transition active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                <Save size={15} />
                <span>{saving ? "Salvando…" : "Salvar Alterações"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============== MODAL NOVO ACOMPANHAMENTO ==============
function NewTreatmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [patients, setPatients] = useState<{ id: string; name: string; phone?: string | null; cpf?: string | null }[]>([]);
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
    start_date: new Date().toISOString().slice(0, 10),
    protocol_days: "90",
    total_value: "",
    down_payment: "",
    discount: "",
    installments_count: "1",
    payment_method: "pix",
    return_days: "30",
    color: COLORS[0],
    notes: "",
  });
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
        const { data } = await supabase.from("patients").select("id,name,phone,cpf").order("name").limit(500);
        if (data && data.length > 0) pats = data as any;
      } catch {}
    }

    // 3. Mescla com pacientes salvos localmente
    const merged = mergeWithLocalPatients(pats as any);
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
        const { data: docData } = await supabase.from("doctors").select("id,name").order("name").limit(200);
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
        (p.phone && p.phone.replace(/\D/g, "").includes(s))
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
    setSaving(true);
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
      total_value: parseBRL(form.total_value),
      down_payment: parseBRL(form.down_payment),
      discount: parseBRL(form.discount),
      installments_count: Math.max(1, Number(form.installments_count) || 1),
      payment_method: form.payment_method,
      return_days: form.return_days ? Number(form.return_days) : null,
      color: form.color,
      notes: form.notes || null,
    };
    const { data, error } = await supabase.from("treatments").insert(payload).select("id").single();
    if (error || !data) {
      setSaving(false);
      toast.error("Erro ao criar acompanhamento");
      return;
    }
    // Gerar parcelas
    if (payload.installments_count > 0 && payload.total_value > 0) {
      await supabase.rpc("generate_treatment_installments", { p_treatment_id: data.id });
    }
    setSaving(false);
    toast.success("Acompanhamento criado com sucesso!");
    onCreated();
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        onClick={() => {
          setIsPatientDropdownOpen(false);
          onClose();
        }}
      >
        <div
          className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto border border-slate-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 sticky top-0 bg-white z-10">
            <div>
              <div className="text-[16px] font-bold text-slate-900">Novo Acompanhamento Clínico</div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                Defina o paciente, protocolo, cronograma e parâmetros iniciais.
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Seletor Inteligente de Paciente */}
            <div className="relative md:col-span-1">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-bold text-slate-700">Paciente *</label>
                <button
                  type="button"
                  onClick={() => setShowNewPatientModal(true)}
                  className="text-[11.5px] font-semibold text-[#8B47FF] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus size={13} />
                  + Novo Paciente
                </button>
              </div>

              {selectedPatient ? (
                <div className="flex items-center justify-between h-10 px-3 rounded-xl bg-purple-50/70 border border-purple-200">
                  <div className="flex items-center gap-2 truncate">
                    <UserIcon size={15} className="text-[#8B47FF] shrink-0" />
                    <span className="text-[13px] font-bold text-purple-900 truncate">
                      {selectedPatient.name}
                    </span>
                    {selectedPatient.phone && (
                      <span className="text-[11px] text-purple-600 truncate hidden sm:inline">
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
                    className="text-[11.5px] font-semibold text-purple-700 hover:text-purple-900 ml-2 shrink-0 cursor-pointer"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsPatientDropdownOpen((v) => !v)}
                    className={`w-full h-10 px-3 rounded-xl border text-left flex items-center justify-between text-[13px] transition cursor-pointer ${
                      isPatientDropdownOpen
                        ? "border-[#8B47FF] bg-white ring-2 ring-[#8B47FF]/15"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100/70"
                    }`}
                  >
                    <span className="text-slate-400">
                      {loadingPatients ? "Carregando pacientes..." : "Selecione ou busque um paciente…"}
                    </span>
                    <ChevronDown size={15} className="text-slate-400 shrink-0" />
                  </button>

                  {isPatientDropdownOpen && (
                    <div className="absolute left-0 right-0 top-11 z-50 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 space-y-1.5 animate-in fade-in zoom-in-95">
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                        <input
                          autoFocus
                          type="text"
                          value={patientSearch}
                          onChange={(e) => setPatientSearch(e.target.value)}
                          placeholder="Buscar paciente por nome, CPF ou telefone..."
                          className="w-full h-8.5 pl-8 pr-3 rounded-lg bg-slate-50 border border-slate-200 text-[12px] focus:outline-none focus:border-[#8B47FF] text-slate-800"
                        />
                      </div>

                      <div className="max-h-48 overflow-y-auto space-y-0.5 pt-1">
                        {loadingPatients ? (
                          <div className="p-3 text-center text-[12px] text-slate-400">
                            Carregando lista de pacientes...
                          </div>
                        ) : filteredPatients.length === 0 ? (
                          <div className="p-3 text-center text-[12px] text-slate-500 space-y-2">
                            <div>Nenhum paciente encontrado</div>
                            <button
                              type="button"
                              onClick={() => {
                                setIsPatientDropdownOpen(false);
                                setShowNewPatientModal(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#8B47FF] text-white text-[11.5px] font-bold hover:bg-[#7A3AE6] transition cursor-pointer"
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
                              className="w-full p-2 rounded-xl text-left hover:bg-purple-50/70 transition flex items-center justify-between group cursor-pointer"
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-semibold text-slate-800 group-hover:text-[#8B47FF] truncate">
                                  {p.name}
                                </div>
                                <div className="text-[11px] text-slate-400 flex items-center gap-2">
                                  {p.cpf && <span>CPF: {p.cpf}</span>}
                                  {p.phone && <span>Tel: {p.phone}</span>}
                                </div>
                              </div>
                              {form.patient_id === p.id && (
                                <Check size={14} className="text-[#8B47FF] shrink-0" />
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
          <Field label="Valor total (R$)">
            <input
              inputMode="decimal"
              className={inputCls}
              value={form.total_value}
              onChange={(e) => setForm({ ...form, total_value: onlyDecimal(e.target.value) })}
              placeholder="0,00"
            />
          </Field>
          <Field label="Entrada (R$)">
            <input
              inputMode="decimal"
              className={inputCls}
              value={form.down_payment}
              onChange={(e) => setForm({ ...form, down_payment: onlyDecimal(e.target.value) })}
              placeholder="0,00"
            />
          </Field>
          <Field label="Desconto (R$)">
            <input
              inputMode="decimal"
              className={inputCls}
              value={form.discount}
              onChange={(e) => setForm({ ...form, discount: onlyDecimal(e.target.value) })}
              placeholder="0,00"
            />
          </Field>
          <Field label="Nº de parcelas">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              className={inputCls}
              value={form.installments_count}
              onChange={(e) =>
                setForm({ ...form, installments_count: e.target.value.replace(/\D/g, "") })
              }
              onBlur={(e) =>
                setForm((f) => ({
                  ...f,
                  installments_count:
                    e.target.value === "" ? "1" : String(Math.max(1, Number(e.target.value))),
                }))
              }
              placeholder="1"
            />
          </Field>
          <Field label="Forma de pagamento">
            <select
              className={inputCls}
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              <option value="pix">Pix</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="cartao_credito">Cartão de crédito</option>
              <option value="cartao_debito">Cartão de débito</option>
              <option value="boleto">Boleto</option>
              <option value="transferencia">Transferência</option>
            </select>
          </Field>
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
                    borderColor: form.color === c ? "#111827" : "transparent",
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

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2.5 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-semibold transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={submit}
            className="h-10 px-5 rounded-xl bg-[#8B47FF] hover:bg-[#7A3AE6] text-white text-[13px] font-bold shadow-sm transition active:scale-98 disabled:opacity-50 cursor-pointer"
          >
            {saving ? "Salvando…" : "Criar acompanhamento"}
          </button>
        </div>
      </div>
    </div>

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
  "w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-[#8B47FF] focus:bg-white outline-none text-[13px] text-slate-800 transition";

function onlyDecimal(v: string) {
  const s = v.replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const parts = s.split(",");
  return parts.length <= 2 ? s : parts[0] + "," + parts.slice(1).join("");
}
function parseBRL(v: string) {
  if (!v) return 0;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

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
      <label className="text-[12px] font-bold text-slate-700 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

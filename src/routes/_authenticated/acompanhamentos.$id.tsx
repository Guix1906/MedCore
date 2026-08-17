import type { DbRow, Json, IconType } from "@/lib/types";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Activity,
  Calendar as CalIcon,
  User as UserIcon,
  Pill,
  Wallet,
  Plus,
  Clock,
  Sun,
  Sunset,
  Moon,
  CheckCircle2,
  PauseCircle,
  Trash2,
  Edit3,
  X,
  Send,
  Sparkles,
  FileText,
  Camera,
  Image as ImageIcon,
  Check,
  AlertCircle,
  MessageCircle,
  TrendingUp,
  Sliders,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/acompanhamentos/$id")({
  head: () => ({ meta: [{ title: "Acompanhamento Clínico • MedCore" }] }),
  component: TreatmentDetailPage,
});

type Treatment = DbRow;
type Medication = DbRow;
type Installment = DbRow;

type ClinicalEvolution = {
  id: string;
  date: string;
  doctor_name?: string;
  notes: string;
  parameters?: string;
  next_step?: string;
};

type ComparisonPhoto = {
  id: string;
  title: string;
  beforeUrl: string;
  beforeDate: string;
  afterUrl: string;
  afterDate: string;
};

const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  em_andamento: { label: "Em andamento", bg: "#DCFCE7", fg: "#166534" },
  pausado: { label: "Pausado", bg: "#FEF3C7", fg: "#92400E" },
  finalizado: { label: "Finalizado", bg: "#DBEAFE", fg: "#1E40AF" },
  cancelado: { label: "Cancelado", bg: "#FEE2E2", fg: "#991B1B" },
};

const INSTALLMENT_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  pago: { label: "Pago", bg: "#DCFCE7", fg: "#166534" },
  pendente: { label: "Pendente", bg: "#FEF3C7", fg: "#92400E" },
  atrasado: { label: "Atrasado", bg: "#FEE2E2", fg: "#991B1B" },
  cancelado: { label: "Cancelado", bg: "#E5E7EB", fg: "#374151" },
  renegociado: { label: "Renegociado", bg: "#EDE9FE", fg: "#5B21B6" },
};

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const daysBetween = (a: string | Date, b: string | Date) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

function TreatmentDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [tab, setTab] = useState<"resumo" | "medicacoes" | "evolucao" | "financeiro">("resumo");
  const [loading, setLoading] = useState(true);

  // Evoluções Clínicas & Fotos locais persistidas no acompanhamento
  const [evolutions, setEvolutions] = useState<ClinicalEvolution[]>([
    {
      id: "ev-1",
      date: new Date().toLocaleDateString("pt-BR"),
      doctor_name: "Dr. Responsável",
      notes: "Consulta de início de protocolo. Paciente orientado sobre horários das medicações e hidratação.",
      parameters: "Pressão: 120/80 mmHg • Peso: 72.4 kg",
      next_step: "Avaliação de retorno em 30 dias com exames de controle.",
    },
  ]);

  const [photos, setPhotos] = useState<ComparisonPhoto[]>([
    {
      id: "ph-1",
      title: "Registro de Evolução Clínica",
      beforeUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=500&auto=format&fit=crop&q=80",
      beforeDate: "Dia 1 (Início)",
      afterUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=500&auto=format&fit=crop&q=80",
      afterDate: "Dia 30 (Atual)",
    },
  ]);

  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, m, i] = await Promise.all([
      supabase
        .from("treatments")
        .select("*, patients(name, phone), doctors(name)")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("treatment_medications").select("*").eq("treatment_id", id).order("created_at"),
      supabase.from("treatment_installments").select("*").eq("treatment_id", id).order("number"),
    ]);
    if (cancelledRef.current) return;
    setTreatment(t.data);
    setMeds((m.data as DbRow[]) ?? []);
    setInstallments((i.data as DbRow[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  if (loading || !treatment) {
    return (
      <AppShell>
        <div className="p-8 max-w-[1400px] mx-auto">
          <div className="h-8 w-64 rounded-lg bg-slate-100 animate-pulse mb-6" />
          <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
        </div>
      </AppShell>
    );
  }

  const st = STATUS_LABEL[treatment.status] || STATUS_LABEL.em_andamento;
  const totalDays = treatment.end_date
    ? daysBetween(treatment.start_date, treatment.end_date)
    : (treatment.return_days ?? 90);
  const passedDays = Math.max(0, daysBetween(treatment.start_date, new Date()));
  const remainingDays = Math.max(0, totalDays - passedDays);
  const progress = totalDays > 0 ? Math.min(100, Math.round((passedDays / totalDays) * 100)) : 0;

  const paid = installments
    .filter((p) => p.status === "pago")
    .reduce((s, p) => s + Number(p.amount), 0);
  const pending = installments
    .filter((p) => ["pendente", "atrasado"].includes(p.status))
    .reduce((s, p) => s + Number(p.amount), 0);
  const activeMeds = meds.filter((m) => m.status === "ativo").length;
  const pendingInstallments = installments.filter((p) =>
    ["pendente", "atrasado"].includes(p.status),
  ).length;

  const setStatus = async (status: string) => {
    const { error } = await supabase.from("treatments").update({ status }).eq("id", id);
    if (error) return toast.error("Erro ao atualizar status");
    toast.success("Status atualizado");
    load();
  };

  // Envio de Cronograma via WhatsApp formatado por turnos
  const sendWhatsAppSchedule = () => {
    const phone = treatment.patients?.phone?.replace(/\D/g, "");
    if (!phone) {
      toast.error("O paciente não possui número de telefone/WhatsApp cadastrado.");
      return;
    }

    const activeList = meds.filter((m) => m.status === "ativo");
    let msg = `Olá *${treatment.patients?.name}*! 👋\n\n`;
    msg += `Aqui está o seu *Cronograma de Medicações* para o acompanhamento *"${treatment.title}"*:\n\n`;

    if (activeList.length === 0) {
      msg += `📌 Nenhuma medicação ativa no momento.\n`;
    } else {
      const morning = activeList.filter((m) => m.period === "manha");
      const afternoon = activeList.filter((m) => m.period === "tarde");
      const night = activeList.filter((m) => m.period === "noite");
      const daily = activeList.filter((m) => !["manha", "tarde", "noite"].includes(m.period));

      if (morning.length > 0) {
        msg += `🌅 *MANHÃ:*\n`;
        morning.forEach((m) => {
          msg += `• *${m.name}* - ${m.dose || ""}${m.unit || ""} (${m.frequency || "1x ao dia"})\n`;
          if (m.notes) msg += `  _${m.notes}_\n`;
        });
        msg += `\n`;
      }
      if (afternoon.length > 0) {
        msg += `☀️ *TARDE:*\n`;
        afternoon.forEach((m) => {
          msg += `• *${m.name}* - ${m.dose || ""}${m.unit || ""} (${m.frequency || "1x ao dia"})\n`;
          if (m.notes) msg += `  _${m.notes}_\n`;
        });
        msg += `\n`;
      }
      if (night.length > 0) {
        msg += `🌙 *NOITE:*\n`;
        night.forEach((m) => {
          msg += `• *${m.name}* - ${m.dose || ""}${m.unit || ""} (${m.frequency || "1x ao dia"})\n`;
          if (m.notes) msg += `  _${m.notes}_\n`;
        });
        msg += `\n`;
      }
      if (daily.length > 0) {
        msg += `📋 *USO CONTÍNUO / OUTROS:*\n`;
        daily.forEach((m) => {
          msg += `• *${m.name}* - ${m.dose || ""}${m.unit || ""} (${m.frequency || "Conforme prescrição"})\n`;
          if (m.notes) msg += `  _${m.notes}_\n`;
        });
        msg += `\n`;
      }
    }

    if (treatment.next_return_date) {
      msg += `🗓️ *Próximo Retorno Agendado:* ${new Date(treatment.next_return_date).toLocaleDateString("pt-BR")}\n\n`;
    }
    msg += `Qualquer dúvida ou reação, entre em contato conosco. Tenha um excelente tratamento! 🩺✨`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/55${phone}?text=${encoded}`, "_blank");
  };

  return (
    <AppShell>
      <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-5">
        {/* Top bar com Voltar & Atalhos */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => navigate({ to: "/acompanhamentos" })}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 hover:text-purple-700 transition cursor-pointer"
          >
            <ArrowLeft size={14} /> Voltar para acompanhamentos
          </button>

          <div className="flex items-center gap-2">
            <Link
              to="/prontuario"
              search={{ patientName: treatment.patients?.name, patientId: treatment.patient_id } as any}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 text-[12.5px] font-bold transition"
            >
              <FileText size={14} />
              <span>Abrir Prontuário do Paciente</span>
            </Link>

            <button
              onClick={sendWhatsAppSchedule}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-bold shadow-sm transition active:scale-98 cursor-pointer"
            >
              <Send size={13} />
              <span>Enviar Cronograma (WhatsApp)</span>
            </button>
          </div>
        </div>

        {/* Header do Acompanhamento */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 md:p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 shadow-xs"
                style={{ background: (treatment.color || "#8B47FF") + "20", color: treatment.color || "#8B47FF" }}
              >
                <Activity size={26} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-[20px] md:text-[22px] font-bold text-[#0F172A] truncate">
                    {treatment.title}
                  </h1>
                  <span
                    className="text-[11.5px] font-bold px-3 py-1 rounded-full"
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="text-[13px] text-slate-500 mt-1 flex items-center gap-3.5 flex-wrap font-medium">
                  <span className="inline-flex items-center gap-1.5 text-slate-800 font-semibold">
                    <UserIcon size={14} className="text-purple-600" /> {treatment.patients?.name}
                  </span>
                  {treatment.doctors?.name && (
                    <span className="text-slate-600">• Dr(a). {treatment.doctors.name}</span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <CalIcon size={14} className="text-slate-400" /> Início:{" "}
                    {new Date(treatment.start_date).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>
            </div>

            {/* Ações de Status */}
            <div className="flex flex-wrap gap-2">
              {treatment.status === "em_andamento" && (
                <button
                  onClick={() => setStatus("pausado")}
                  className="h-9 px-3.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-[12.5px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <PauseCircle size={15} /> Pausar
                </button>
              )}
              {treatment.status === "pausado" && (
                <button
                  onClick={() => setStatus("em_andamento")}
                  className="h-9 px-3.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[12.5px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <CheckCircle2 size={15} /> Retomar
                </button>
              )}
              {treatment.status !== "finalizado" && treatment.status !== "cancelado" && (
                <button
                  onClick={() => setStatus("finalizado")}
                  className="h-9 px-3.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 text-[12.5px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <CheckCircle2 size={15} /> Concluir Protocolo
                </button>
              )}
            </div>
          </div>

          {treatment.objective && (
            <div className="mt-4 pt-3.5 border-t border-slate-100 text-[13px] text-slate-700 leading-relaxed bg-slate-50/70 p-3 rounded-xl">
              <span className="font-bold text-slate-900">Objetivo Clínico:</span> {treatment.objective}
            </div>
          )}
        </div>

        {/* Barra de Abas */}
        <div className="flex items-center gap-2 border-b border-slate-200">
          {(
            [
              { id: "resumo", label: "Resumo & IA", icon: Activity },
              { id: "medicacoes", label: "Medicações", icon: Pill },
              { id: "evolucao", label: "Evolução & Fotos", icon: Camera },
              { id: "financeiro", label: "Financeiro", icon: Wallet },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative inline-flex items-center gap-2 h-11 px-4 text-[13.5px] font-bold transition cursor-pointer ${
                  active ? "text-[#8B47FF]" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                <Icon size={16} />
                <span>{t.label}</span>
                {t.id === "resumo" && (
                  <Sparkles size={13} className={active ? "text-purple-600" : "text-slate-400"} />
                )}
                {active && (
                  <motion.div
                    layoutId="tab-underline-detail"
                    className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#8B47FF] rounded-full"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Conteúdo das Abas */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {tab === "resumo" && (
              <ResumoTab
                treatment={treatment}
                kpis={{
                  remainingDays,
                  passedDays,
                  totalDays,
                  progress,
                  activeMeds,
                  pendingInstallments,
                  paid,
                  pending,
                  nextReturn: treatment.next_return_date,
                  totalValue: Number(treatment.total_value),
                }}
              />
            )}
            {tab === "medicacoes" && (
              <MedicacoesTab
                treatmentId={id}
                patientPhone={treatment.patients?.phone}
                meds={meds}
                reload={load}
                onSendWhatsApp={sendWhatsAppSchedule}
              />
            )}
            {tab === "evolucao" && (
              <EvolucaoTab
                evolutions={evolutions}
                setEvolutions={setEvolutions}
                photos={photos}
                setPhotos={setPhotos}
              />
            )}
            {tab === "financeiro" && (
              <FinanceiroTab treatment={treatment} installments={installments} reload={load} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </AppShell>
  );
}

// ============== ABA 1: RESUMO & COPILOTO IA ==============
function ResumoTab({
  treatment,
  kpis,
}: {
  treatment: DbRow;
  kpis: {
    remainingDays: number;
    passedDays: number;
    totalDays: number;
    progress: number;
    activeMeds: number;
    pendingInstallments: number;
    paid: number;
    pending: number;
    nextReturn?: string | null;
    totalValue: number;
  };
}) {
  const cards = [
    {
      label: "Dias restantes",
      value: `${kpis.remainingDays} dias`,
      sub: `${kpis.progress}% do ciclo concluído (${kpis.passedDays} de ${kpis.totalDays} dias)`,
      color: "#8B47FF",
    },
    {
      label: "Próximo retorno",
      value: kpis.nextReturn ? new Date(kpis.nextReturn).toLocaleDateString("pt-BR") : "A definir",
      sub: kpis.nextReturn ? "Retorno agendado" : "Sem data marcada",
      color: "#0EA5E9",
    },
    {
      label: "Medicações ativas",
      value: `${kpis.activeMeds} itens`,
      sub: "No cronograma do paciente",
      color: "#10B981",
    },
    {
      label: "Parcelas pendentes",
      value: `${kpis.pendingInstallments} parcelas`,
      sub: brl(kpis.pending),
      color: "#F59E0B",
    },
    {
      label: "Valor recebido",
      value: brl(kpis.paid),
      sub: `de ${brl(kpis.totalValue)}`,
      color: "#059669",
    },
    {
      label: "Saldo a receber",
      value: brl(kpis.pending),
      sub: "Fluxo financeiro pendente",
      color: "#EF4444",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Card do Copiloto Clínico IA */}
      <div
        className="rounded-3xl p-5 md:p-6 text-slate-900 border border-purple-100 shadow-sm relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #FAF5FF 0%, #FFFFFF 60%, #F0FDFA 100%)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-r from-[#FF7A59] via-[#D946EF] to-[#6366F1] text-white flex items-center justify-center shadow-sm">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">
                Copiloto de Acompanhamento IA
              </h3>
              <p className="text-[12px] text-slate-500">
                Síntese clínica e status de adesão do paciente
              </p>
            </div>
          </div>

          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800">
            Análise em Tempo Real
          </span>
        </div>

        <div className="mt-4 p-4 rounded-2xl bg-white/90 border border-purple-100/70 text-[13px] text-slate-700 leading-relaxed space-y-2">
          <p>
            📍 <b>Status do Tratamento:</b> O paciente encontra-se no{" "}
            <b>dia {kpis.passedDays} de {kpis.totalDays}</b> ({kpis.progress}% da meta atingida).
            Possui <b>{kpis.activeMeds} medicação(ões) ativa(s)</b> no cronograma diário.
          </p>
          <p>
            💳 <b>Adesão Financeira:</b> {kpis.pendingInstallments === 0 ? (
              <span className="text-emerald-700 font-bold">100% quitado / sem pendências.</span>
            ) : (
              <span>
                Possui <b>{kpis.pendingInstallments} parcela(s) pendente(s)</b> ({brl(kpis.pending)} a receber).
              </span>
            )}
          </p>
          <p>
            🩺 <b>Próximo Passo Clínico:</b>{" "}
            {kpis.nextReturn ? (
              <span>
                Retorno marcado para <b>{new Date(kpis.nextReturn).toLocaleDateString("pt-BR")}</b>.
                Recomenda-se avaliar a adesão medicamentosa e registrar fotos de evolução na aba dedicada.
              </span>
            ) : (
              <span>
                Não há retorno agendado. Recomenda-se definir uma data de retorno para o checkpoint dos 30 dias.
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Grid de KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm"
          >
            <div className="text-[11.5px] font-bold uppercase tracking-wider text-slate-400">
              {c.label}
            </div>
            <div className="text-[24px] font-extrabold mt-1.5" style={{ color: c.color }}>
              {c.value}
            </div>
            <div className="text-[12px] text-slate-500 mt-1 font-medium">{c.sub}</div>
            {c.label === "Dias restantes" && (
              <div className="mt-3.5 h-2 rounded-full bg-slate-100 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${kpis.progress}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ background: c.color }}
                />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ============== ABA 2: MEDICAÇÕES & CRONOGRAMA ==============
const PERIOD_ICON: Record<string, IconType> = { manha: Sun, tarde: Sunset, noite: Moon };
const PERIOD_LABEL: Record<string, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
  diario: "Diário",
  semanal: "Semanal",
  mensal: "Mensal",
};

function MedicacoesTab({
  treatmentId,
  patientPhone,
  meds,
  reload,
  onSendWhatsApp,
}: {
  treatmentId: string;
  patientPhone?: string | null;
  meds: DbRow[];
  reload: () => void;
  onSendWhatsApp: () => void;
}) {
  const [filter, setFilter] = useState<string>("todos");
  const [openNew, setOpenNew] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "todos") return meds;
    if (filter === "suspensos") return meds.filter((m) => m.status === "suspenso");
    return meds.filter((m) => m.period === filter);
  }, [meds, filter]);

  const filters = [
    { id: "todos", label: "Todas" },
    { id: "manha", label: "Manhã" },
    { id: "tarde", label: "Tarde" },
    { id: "noite", label: "Noite" },
    { id: "diario", label: "Diário" },
    { id: "suspensos", label: "Suspensas" },
  ];

  const toggle = async (m: DbRow) => {
    const newStatus = m.status === "ativo" ? "suspenso" : "ativo";
    await supabase.from("treatment_medications").update({ status: newStatus }).eq("id", m.id);
    toast.success(newStatus === "ativo" ? "Medicação reativada" : "Medicação suspensa");
    reload();
  };

  const remove = async (m: DbRow) => {
    const ok = await confirmDialog({
      title: "Remover medicação?",
      description: `"${m.name}" será removida do cronograma.`,
      confirmText: "Remover",
      destructive: true,
    });
    if (!ok) return;
    await supabase.from("treatment_medications").delete().eq("id", m.id);
    toast.success("Medicação removida");
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`h-8.5 px-3.5 rounded-xl text-[12.5px] font-semibold transition cursor-pointer ${
                filter === f.id
                  ? "bg-[#8B47FF] text-white shadow-xs"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSendWhatsApp}
            className="h-10 px-3.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[12.5px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
          >
            <Send size={14} />
            <span>Disparar no WhatsApp</span>
          </button>

          <button
            onClick={() => setOpenNew(true)}
            className="h-10 px-4 rounded-xl bg-[#8B47FF] hover:bg-[#7A3AE6] text-white text-[13px] font-bold inline-flex items-center gap-1.5 shadow-sm transition cursor-pointer"
          >
            <Plus size={15} /> Nova medicação
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200/80 shadow-sm">
          <Pill size={44} className="mx-auto text-slate-300" strokeWidth={1.5} />
          <div className="mt-3 text-[16px] font-bold text-slate-800">Nenhuma medicação no filtro</div>
          <div className="text-[13px] text-slate-500 mt-1">
            Adicione medicações e organize por horários do dia.
          </div>
        </div>
      ) : (
        <div className="relative pl-5">
          <div className="absolute left-1.5 top-0 bottom-0 w-px bg-slate-200" />
          <div className="space-y-3">
            {filtered.map((m, i) => {
              const PIcon = PERIOD_ICON[m.period] ?? Clock;
              const suspenso = m.status !== "ativo";
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="relative"
                >
                  <div className="absolute -left-[13px] top-5 h-3.5 w-3.5 rounded-full bg-white border-2 border-[#8B47FF]" />
                  <div
                    className={`bg-white rounded-2xl border border-slate-200/90 p-4.5 shadow-sm transition ${
                      suspenso ? "opacity-60 bg-slate-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0">
                          <PIcon size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-[15px] font-bold text-[#0F172A]">
                              {m.name}
                            </div>
                            {m.period && (
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700">
                                {PERIOD_LABEL[m.period] ?? m.period}
                              </span>
                            )}
                            {suspenso && (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                                Suspenso
                              </span>
                            )}
                          </div>

                          <div className="text-[13px] text-slate-600 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-medium">
                            {m.dose && (
                              <span>
                                <b className="text-slate-800">Dose:</b> {m.dose}
                                {m.unit ? ` ${m.unit}` : ""}
                              </span>
                            )}
                            {m.route && (
                              <span>
                                <b className="text-slate-800">Via:</b> {m.route}
                              </span>
                            )}
                            {m.frequency && (
                              <span>
                                <b className="text-slate-800">Frequência:</b> {m.frequency}
                              </span>
                            )}
                          </div>

                          {m.notes && (
                            <div className="text-[12.5px] text-slate-700 mt-2 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                              <span className="font-semibold text-slate-800">Orientação:</span> {m.notes}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-1">
                        <button
                          onClick={() => toggle(m)}
                          className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition cursor-pointer"
                          title={suspenso ? "Reativar" : "Suspender"}
                        >
                          {suspenso ? <CheckCircle2 size={16} /> : <PauseCircle size={16} />}
                        </button>
                        <button
                          onClick={() => remove(m)}
                          className="h-8 w-8 rounded-lg hover:bg-rose-50 flex items-center justify-center text-rose-600 transition cursor-pointer"
                          title="Remover"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {openNew && (
        <NewMedicationModal
          treatmentId={treatmentId}
          onClose={() => setOpenNew(false)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function NewMedicationModal({
  treatmentId,
  onClose,
  onSaved,
}: {
  treatmentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: "",
    dose: "",
    unit: "mg",
    route: "Oral",
    frequency: "1x ao dia",
    period: "manha",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!f.name) return toast.error("Informe o nome da medicação");
    setSaving(true);
    const { error } = await supabase.from("treatment_medications").insert({
      treatment_id: treatmentId,
      name: f.name,
      dose: f.dose || null,
      unit: f.unit || null,
      route: f.route || null,
      frequency: f.frequency || null,
      period: f.period || null,
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      notes: f.notes || null,
      status: "ativo",
    });
    setSaving(false);
    if (error) return toast.error("Erro ao salvar medicação");
    toast.success("Medicação adicionada ao cronograma!");
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100">
          <div className="text-[16px] font-bold text-slate-900">Nova Medicação no Cronograma</div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-3.5">
          <div className="col-span-2">
            <Lbl>Nome da Medicação *</Lbl>
            <input
              className={inp}
              placeholder="Ex.: Ozempic, Roacutan, Losartana..."
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div>
            <Lbl>Dose</Lbl>
            <input
              className={inp}
              placeholder="Ex.: 50, 0.5, 1"
              value={f.dose}
              onChange={(e) => setF({ ...f, dose: e.target.value })}
            />
          </div>
          <div>
            <Lbl>Unidade</Lbl>
            <select
              className={inp}
              value={f.unit}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
            >
              {["mg", "ml", "g", "mcg", "UI", "gotas", "cápsula(s)", "comprimido(s)", "ampola"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <Lbl>Via de Administração</Lbl>
            <select
              className={inp}
              value={f.route}
              onChange={(e) => setF({ ...f, route: e.target.value })}
            >
              {["Oral", "Sublingual", "Subcutânea", "Intramuscular", "Tópica", "Inalatória"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <Lbl>Frequência</Lbl>
            <input
              className={inp}
              placeholder="Ex.: 1x ao dia, 8/8h"
              value={f.frequency}
              onChange={(e) => setF({ ...f, frequency: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Lbl>Turno / Período do Dia</Lbl>
            <select
              className={inp}
              value={f.period}
              onChange={(e) => setF({ ...f, period: e.target.value })}
            >
              {[
                ["manha", "🌅 Manhã"],
                ["tarde", "☀️ Tarde"],
                ["noite", "🌙 Noite"],
                ["diario", "📋 Diário / Contínuo"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <Lbl>Instruções / Recomendações de Uso</Lbl>
            <textarea
              rows={2}
              className={inp}
              placeholder="Ex.: Tomar em jejum com água; não ingerir bebidas alcoólicas..."
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 bg-white">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl bg-slate-100 text-[13px] font-semibold text-slate-700"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={submit}
            className="h-10 px-5 rounded-xl bg-[#8B47FF] hover:bg-[#7A3AE6] text-white text-[13px] font-bold disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Adicionar ao Cronograma"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== ABA 3: EVOLUÇÃO & FOTOS (NOVA) ==============
function EvolucaoTab({
  evolutions,
  setEvolutions,
  photos,
  setPhotos,
}: {
  evolutions: ClinicalEvolution[];
  setEvolutions: React.Dispatch<React.SetStateAction<ClinicalEvolution[]>>;
  photos: ComparisonPhoto[];
  setPhotos: React.Dispatch<React.SetStateAction<ComparisonPhoto[]>>;
}) {
  const [newNote, setNewNote] = useState("");
  const [newParams, setNewParams] = useState("");
  const [newNextStep, setNewNextStep] = useState("");
  const [openAddNote, setOpenAddNote] = useState(false);

  const handleAddEvolution = () => {
    if (!newNote.trim()) return toast.error("Preencha as notas da evolução clínica");
    const item: ClinicalEvolution = {
      id: `ev-${Date.now()}`,
      date: new Date().toLocaleDateString("pt-BR"),
      doctor_name: "Dr. Responsável",
      notes: newNote,
      parameters: newParams || undefined,
      next_step: newNextStep || undefined,
    };
    setEvolutions([item, ...evolutions]);
    setNewNote("");
    setNewParams("");
    setNewNextStep("");
    setOpenAddNote(false);
    toast.success("Evolução registrada!");
  };

  return (
    <div className="space-y-6">
      {/* 1. Comparador de Fotos Antes & Depois */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 md:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-[16px] font-bold text-slate-900 flex items-center gap-2">
              <Camera className="text-purple-600" size={18} />
              Galeria de Evolução & Comparador Antes / Depois
            </h3>
            <p className="text-[12.5px] text-slate-500">
              Acompanhamento fotográfico visual do protocolo.
            </p>
          </div>

          <button
            type="button"
            onClick={() => toast.info("Upload de nova foto de acompanhamento")}
            className="h-9 px-3.5 rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 text-[12.5px] font-bold inline-flex items-center gap-1.5 transition"
          >
            <Camera size={14} /> Adicionar Foto
          </button>
        </div>

        {/* Display do Comparador */}
        {photos.map((p) => (
          <div key={p.id} className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 flex flex-col">
              <div className="px-3.5 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[12px] font-bold text-slate-700">
                <span>Antes (Início)</span>
                <span className="text-slate-500">{p.beforeDate}</span>
              </div>
              <div className="h-64 overflow-hidden relative">
                <img
                  src={p.beforeUrl}
                  alt="Antes"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-purple-200 overflow-hidden bg-purple-50/50 flex flex-col">
              <div className="px-3.5 py-2 bg-purple-100 border-b border-purple-200 flex items-center justify-between text-[12px] font-bold text-purple-900">
                <span>Depois (Atual / Retorno)</span>
                <span className="text-purple-700">{p.afterDate}</span>
              </div>
              <div className="h-64 overflow-hidden relative">
                <img
                  src={p.afterUrl}
                  alt="Depois"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 2. Linha do Tempo de Evoluções Clínicas */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 md:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-[16px] font-bold text-slate-900 flex items-center gap-2">
              <FileText className="text-purple-600" size={18} />
              Registro de Evoluções e Retornos Clínicos
            </h3>
            <p className="text-[12.5px] text-slate-500">
              Histórico de apontamentos médicos em cada consulta de acompanhamento.
            </p>
          </div>

          <button
            onClick={() => setOpenAddNote(!openAddNote)}
            className="h-9 px-3.5 rounded-xl bg-[#8B47FF] hover:bg-[#7A3AE6] text-white text-[12.5px] font-bold inline-flex items-center gap-1.5 transition"
          >
            <Plus size={14} /> Registrar Nova Evolução
          </button>
        </div>

        {/* Formulário inline para nova evolução */}
        {openAddNote && (
          <div className="p-4.5 rounded-2xl bg-purple-50/70 border border-purple-200 space-y-3 animate-in fade-in">
            <h4 className="text-[13.5px] font-bold text-purple-900">Nova Nota de Evolução</h4>
            <textarea
              rows={3}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Descreva as queixas do retorno, melhora dos sintomas, tolerância às medicações..."
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-[13px] outline-none focus:border-purple-600"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={newParams}
                onChange={(e) => setNewParams(e.target.value)}
                placeholder="Parâmetros clínicos (ex: Pressão, Peso, Exames)..."
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none"
              />
              <input
                value={newNextStep}
                onChange={(e) => setNewNextStep(e.target.value)}
                placeholder="Conduta para o próximo retorno..."
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setOpenAddNote(false)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-slate-600 hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddEvolution}
                className="px-4 py-1.5 rounded-lg bg-purple-600 text-white text-[12px] font-bold shadow-xs"
              >
                Salvar Evolução
              </button>
            </div>
          </div>
        )}

        {/* Lista de notas */}
        <div className="space-y-3 pt-2">
          {evolutions.map((ev) => (
            <div key={ev.id} className="p-4 rounded-2xl border border-slate-200/90 bg-slate-50/60 space-y-2">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-bold text-slate-900">{ev.doctor_name || "Médico Responsável"}</span>
                <span className="text-purple-600 font-semibold">{ev.date}</span>
              </div>
              <p className="text-[13px] text-slate-700 leading-relaxed">{ev.notes}</p>
              {ev.parameters && (
                <div className="text-[12px] font-medium text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg inline-block">
                  📊 {ev.parameters}
                </div>
              )}
              {ev.next_step && (
                <div className="text-[12px] text-slate-600 italic">
                  👉 Próxima etapa: {ev.next_step}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============== ABA 4: FINANCEIRO ==============
function FinanceiroTab({
  treatment,
  installments,
  reload,
}: {
  treatment: Json;
  installments: DbRow[];
  reload: () => void;
}) {
  const [regen, setRegen] = useState(false);
  const paid = installments
    .filter((p) => p.status === "pago")
    .reduce((s, p) => s + Number(p.amount), 0);
  const pending = installments
    .filter((p) => ["pendente", "atrasado"].includes(p.status))
    .reduce((s, p) => s + Number(p.amount), 0);

  const markPaid = async (row: DbRow) => {
    const { error } = await supabase
      .from("treatment_installments")
      .update({
        status: "pago",
        paid_date: new Date().toISOString().slice(0, 10),
      })
      .eq("id", row.id);
    if (error) return toast.error("Erro ao registrar pagamento");
    toast.success("Parcela registrada como PAGA!");
    reload();
  };

  const regenerate = async () => {
    setRegen(true);
    const { error } = await supabase.rpc("generate_treatment_installments", {
      p_treatment_id: treatment.id,
    });
    setRegen(false);
    if (error) return toast.error("Erro ao gerar parcelas");
    toast.success("Parcelas geradas com sucesso!");
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Valor total", value: brl(Number(treatment.total_value)), color: "#111827" },
          { label: "Entrada", value: brl(Number(treatment.down_payment)), color: "#0EA5E9" },
          { label: "Total recebido", value: brl(paid), color: "#059669" },
          { label: "Saldo pendente", value: brl(pending), color: "#EF4444" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-200/80 p-4.5 shadow-sm">
            <div className="text-[11.5px] font-bold uppercase tracking-wider text-slate-400">
              {c.label}
            </div>
            <div className="text-[20px] font-bold mt-1.5" style={{ color: c.color }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100">
          <div>
            <div className="text-[15px] font-bold text-[#0F172A]">Parcelas do Protocolo</div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              Gestão de cobrança e recebimento vinculada ao tratamento.
            </div>
          </div>
          {installments.length === 0 && (
            <button
              onClick={regenerate}
              disabled={regen}
              className="h-9 px-4 rounded-xl bg-[#8B47FF] text-white text-[12.5px] font-bold shadow-xs disabled:opacity-50"
            >
              {regen ? "Gerando…" : "Gerar parcelas"}
            </button>
          )}
        </div>

        {installments.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-slate-500 font-medium">
            Nenhuma parcela gerada ainda. Clique em "Gerar parcelas" acima.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-5 py-3 font-semibold">#</th>
                <th className="px-5 py-3 font-semibold">Vencimento</th>
                <th className="px-5 py-3 font-semibold">Valor</th>
                <th className="px-5 py-3 font-semibold">Data do Pagamento</th>
                <th className="px-5 py-3 font-semibold">Situação</th>
                <th className="text-right px-5 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((row) => {
                const overdue = row.status === "pendente" && new Date(row.due_date) < new Date();
                const st = INSTALLMENT_BADGE[overdue ? "atrasado" : row.status];
                const dias =
                  row.status === "pendente" && overdue ? daysBetween(row.due_date, new Date()) : 0;
                return (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition">
                    <td className="px-5 py-3 font-bold text-slate-800">{row.number}ª</td>
                    <td className="px-5 py-3 text-slate-700">
                      {new Date(row.due_date).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-5 py-3 font-bold text-slate-900">{brl(Number(row.amount))}</td>
                    <td className="px-5 py-3 text-slate-500">
                      {row.paid_date ? new Date(row.paid_date).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                        style={{ background: st.bg, color: st.fg }}
                      >
                        {st.label}
                      </span>
                      {dias > 0 && (
                        <span className="text-[11px] font-bold text-rose-600 ml-2">
                          {dias}d de atraso
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {row.status !== "pago" && row.status !== "cancelado" && (
                        <button
                          onClick={() => markPaid(row)}
                          className="h-8 px-3 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[12px] font-bold transition cursor-pointer"
                        >
                          Baixar Parcela
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inp =
  "w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-[#8B47FF] focus:bg-white outline-none text-[13px] text-slate-800 transition";

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="text-[12px] font-bold text-slate-700 block mb-1.5">{children}</label>;
}

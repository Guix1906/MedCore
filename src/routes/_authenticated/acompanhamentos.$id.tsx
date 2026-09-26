import { useQuery, useQueryClient } from "@tanstack/react-query";
import ClinicalFollowup, {
  changeTreatmentStatus,
} from "@/features/acompanhamentos/ClinicalFollowup";
import MedicationUsePanel from "@/features/acompanhamentos/MedicationUsePanel";
import { PlanPayments } from "@/features/acompanhamentos/TreatmentFinance";
import { getFinancialSnapshot } from "@/features/finance/finance-api";
import { isFreeBalance } from "@/features/finance/finance-math";
import {
  currency,
  formatClinicalDate,
  protocolDeadline,
} from "@/features/acompanhamentos/followup-utils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/acompanhamentos/$id")({
  head: () => ({ meta: [{ title: "Acompanhamento Clínico • MedCore" }] }),
  component: TreatmentDetailPage,
});

type Treatment = DbRow;
type Medication = DbRow;

const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  em_andamento: {
    label: "Em andamento",
    bg: "color-mix(in srgb, var(--success) 14%, transparent)",
    fg: "var(--success)",
  },
  pausado: {
    label: "Pausado",
    bg: "color-mix(in srgb, var(--warning) 14%, transparent)",
    fg: "var(--warning)",
  },
  finalizado: {
    label: "Finalizado",
    bg: "color-mix(in srgb, var(--info) 14%, transparent)",
    fg: "var(--info)",
  },
  cancelado: {
    label: "Cancelado",
    bg: "color-mix(in srgb, var(--destructive) 14%, transparent)",
    fg: "var(--destructive)",
  },
};

const daysBetween = (a: string | Date, b: string | Date) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

function TreatmentDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [tab, setTab] = useState<"resumo" | "medicacoes" | "evolucao" | "financeiro">("resumo");
  const [loading, setLoading] = useState(true);

  const queryClient = useQueryClient();
  const [loadError, setLoadError] = useState("");

  const { data: financialPlans = [] } = useQuery({
    queryKey: ["treatment-finance-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_financial_plans");
      if (error) return [];
      return (data as unknown as any[]) || [];
    },
  });
  const currentPlan = financialPlans.find((p) => p.id === id);

  const financeSnapshot = useQuery({
    queryKey: ["financial-snapshot"],
    queryFn: getFinancialSnapshot,
  });

  const planTitles = useMemo(() => {
    if (!financeSnapshot.data?.titles) return [];
    return financeSnapshot.data.titles.filter((t) => t.treatment_id === id);
  }, [financeSnapshot.data?.titles, id]);

  const planFinancials = useMemo(() => {
    const total = treatment ? Number(treatment.total_value || 0) : 0;
    const paid = planTitles.reduce((acc, t) => acc + Number(t.paid_amount || 0), 0);
    const open = Math.max(0, total - paid);
    const hasFreeBalance = planTitles.some(
      (t) => isFreeBalance(t) && Number(t.paid_amount || 0) < Number(t.amount || 0),
    );
    const nextPending = planTitles
      .filter(
        (t) =>
          t.status !== "cancelado" &&
          Number(t.paid_amount || 0) < Number(t.amount || 0) &&
          !isFreeBalance(t),
      )
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

    return {
      total,
      paid,
      open,
      hasFreeBalance,
      nextDueDate: nextPending?.due_date || null,
      hasPlan: Boolean(currentPlan || total > 0 || planTitles.length > 0),
    };
  }, [treatment, planTitles, currentPlan]);

  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [t, m] = await Promise.all([
        supabase
          .from("treatments")
          .select("*, patients(name, phone), doctors(name)")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("treatment_medications")
          .select("*")
          .eq("treatment_id", id)
          .order("created_at"),
      ]);
      if (cancelledRef.current) return;
      if (t.error || m.error) {
        setLoadError((t.error || m.error)!.message);
        setLoading(false);
        return;
      }
      if (!t.data) setLoadError("Acompanhamento não encontrado.");
      await queryClient.invalidateQueries({ queryKey: ["treatment-medication-uses", id] });
      setTreatment(t.data);
      setMeds((m.data as DbRow[]) ?? []);
    } catch (error) {
      if (!cancelledRef.current)
        setLoadError(error instanceof Error ? error.message : "Erro ao carregar acompanhamento.");
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [id, queryClient]);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  if (loadError)
    return (
      <AppShell title="Detalhes do acompanhamento">
        <div role="alert" className="p-8 text-destructive">
          {loadError}
          <button className="ml-4 underline" onClick={load}>
            Tentar novamente
          </button>
        </div>
      </AppShell>
    );

  if (loading || !treatment) {
    return (
      <AppShell title="Detalhes do acompanhamento">
        <div className="p-8 max-w-[1400px] mx-auto">
          <div className="h-8 w-64 rounded-lg bg-muted animate-pulse mb-6" />
          <div className="h-40 rounded-2xl bg-muted animate-pulse" />
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

  const activeMeds = meds.filter((m) => m.status === "ativo").length;
  const setStatus = async (status: string) => {
    if (await changeTreatmentStatus(id, status)) {
      await queryClient.invalidateQueries({ queryKey: ["treatment-alerts"] });
      await queryClient.invalidateQueries({ queryKey: ["treatments-list"] });
      load();
    }
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
      msg += `🗓️ *Previsão do Próximo Retorno:* ${new Date(treatment.next_return_date).toLocaleDateString("pt-BR")} (estimativa do plano — consulte a recepção para agendar o horário)\n\n`;
    }
    msg += `Qualquer dúvida ou reação, entre em contato conosco. Tenha um excelente tratamento! 🩺✨`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/55${phone}?text=${encoded}`, "_blank");
  };

  return (
    <AppShell title="Detalhes do acompanhamento">
      <div className="page-container space-y-5">
        {/* Top bar com Voltar & Atalhos */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => navigate({ to: "/acompanhamentos" })}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition cursor-pointer"
          >
            <ArrowLeft size={14} /> Voltar para acompanhamentos
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/prontuario"
              search={
                { patientName: treatment.patients?.name, patientId: treatment.patient_id } as any
              }
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-primary/25 bg-primary-soft hover:bg-primary-soft text-primary text-sm font-semibold transition"
            >
              <FileText size={14} />
              <span>Abrir Prontuário do Paciente</span>
            </Link>

            <button
              onClick={sendWhatsAppSchedule}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-success hover:bg-success/90 text-white text-sm font-semibold shadow-sm transition active:scale-98 cursor-pointer"
            >
              <Send size={13} />
              <span>Enviar Cronograma (WhatsApp)</span>
            </button>
          </div>
        </div>

        {/* Header do Acompanhamento */}
        <div className="bg-card rounded-xl border border-border/90 p-5 md:p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 shadow-xs"
                style={{
                  background: (treatment.color || "#6d3ff5") + "20",
                  color: treatment.color || "#6d3ff5",
                }}
              >
                <Activity size={26} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl md:text-[28px] font-semibold text-foreground">
                    {treatment.title}
                  </h1>
                  <span
                    className="text-xs font-semibold px-3 py-1 rounded-full"
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3.5 flex-wrap font-medium">
                  <span className="inline-flex items-center gap-1.5 text-foreground font-semibold">
                    <UserIcon size={14} className="text-primary" /> {treatment.patients?.name}
                  </span>
                  {treatment.doctors?.name && (
                    <span className="text-muted-foreground">• Dr(a). {treatment.doctors.name}</span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <CalIcon size={14} className="text-muted-foreground" /> Início:{" "}
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
                  className="h-9 px-3.5 rounded-xl bg-warning/10 hover:bg-warning/15 text-warning text-sm font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <PauseCircle size={15} /> Pausar
                </button>
              )}
              {treatment.status === "pausado" && (
                <button
                  onClick={() => setStatus("em_andamento")}
                  className="h-9 px-3.5 rounded-xl bg-success/10 hover:bg-success/15 text-success text-sm font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <CheckCircle2 size={15} /> Retomar
                </button>
              )}
              {treatment.status !== "finalizado" && treatment.status !== "cancelado" && (
                <button
                  onClick={() => setStatus("finalizado")}
                  className="h-9 px-3.5 rounded-xl bg-info/10 hover:bg-info/15 text-info text-sm font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <CheckCircle2 size={15} /> Concluir Protocolo
                </button>
              )}
            </div>
          </div>

          {treatment.objective && (
            <div className="mt-4 pt-3.5 border-t border-border-soft text-sm text-foreground/80 leading-relaxed bg-muted/42 p-3 rounded-xl">
              <span className="font-semibold text-foreground">Objetivo Clínico:</span>{" "}
              {treatment.objective}
            </div>
          )}
        </div>

        {/* Barra de Abas */}
        <div className="flex max-w-full items-center gap-2 overflow-x-auto border-b border-border">
          {(
            [
              { id: "resumo", label: "Resumo", icon: Activity },
              { id: "medicacoes", label: "Medicações", icon: Pill },
              { id: "evolucao", label: "Evolução & Fotos", icon: Camera },
              { id: "financeiro", label: "Financeiro do Plano", icon: Wallet },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative inline-flex shrink-0 whitespace-nowrap items-center gap-2 h-11 px-4 text-sm font-semibold transition cursor-pointer ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={16} />
                <span>{t.label}</span>
                {t.id === "resumo" && (
                  <Sparkles
                    size={13}
                    className={active ? "text-primary" : "text-muted-foreground"}
                  />
                )}
                {active && (
                  <motion.div
                    layoutId="tab-underline-detail"
                    className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full"
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
                  nextReturn: treatment.next_return_date,
                }}
                financials={planFinancials}
                onOpenFinance={() => setTab("financeiro")}
              />
            )}
            {tab === "medicacoes" && (
              <>
                <MedicacoesTab
                  treatmentId={id}
                  patientPhone={treatment.patients?.phone}
                  meds={meds}
                  reload={load}
                  onSendWhatsApp={sendWhatsAppSchedule}
                />
                <MedicationUsePanel treatmentId={id} />
              </>
            )}
            {tab === "evolucao" && (
              <ClinicalFollowup
                key={id}
                treatmentId={id}
                objective={treatment.objective}
                startDate={treatment.start_date}
                status={treatment.status}
                endDate={treatment.end_date}
                nextReturn={treatment.next_return_date}
                returnDays={treatment.return_days}
                onSaved={load}
              />
            )}
            {tab === "financeiro" && (
              <div className="bg-card rounded-xl border border-border/90 p-5 md:p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-soft">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Wallet className="h-5 w-5 text-primary" />
                      Financeiro do Acompanhamento
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Entrada, parcelas e histórico de recebimentos vinculados a este plano.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Contratado:{" "}
                      <strong className="text-foreground">{currency(planFinancials.total)}</strong>
                    </span>
                    <span className="text-muted-foreground/60">•</span>
                    <span className="text-xs font-semibold text-success">
                      Recebido: <strong>{currency(planFinancials.paid)}</strong>
                    </span>
                    <span className="text-muted-foreground/60">•</span>
                    <span className="text-xs font-semibold text-warning">
                      Saldo: <strong>{currency(planFinancials.open)}</strong>
                    </span>
                  </div>
                </div>

                {currentPlan ? (
                  <PlanPayments plan={currentPlan} />
                ) : (
                  <div className="py-12 text-center space-y-3">
                    <div className="h-12 w-12 rounded-2xl bg-primary-soft text-primary flex items-center justify-center mx-auto">
                      <Wallet size={24} />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      Condições financeiras não configuradas
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Este plano ainda não possui parcelas ou entrada configuradas no Financeiro.
                    </p>
                    <Link
                      to="/financeiro"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition cursor-pointer"
                    >
                      <span>Configurar no Financeiro Geral</span>
                      <ChevronRight size={15} />
                    </Link>
                  </div>
                )}
              </div>
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
  financials,
  onOpenFinance,
}: {
  treatment: DbRow;
  kpis: {
    remainingDays: number;
    passedDays: number;
    totalDays: number;
    progress: number;
    activeMeds: number;
    nextReturn?: string | null;
  };
  financials: {
    total: number;
    paid: number;
    open: number;
    hasFreeBalance?: boolean;
    nextDueDate: string | null;
    hasPlan: boolean;
  };
  onOpenFinance: () => void;
}) {
  const cards = [
    {
      label: "Dias restantes",
      value: `${kpis.remainingDays} dias`,
      sub: `${kpis.progress}% do prazo (${kpis.passedDays} de ${kpis.totalDays} dias)`,
      color: "var(--primary)",
    },
    {
      label: "Próximo retorno previsto",
      value: kpis.nextReturn ? formatClinicalDate(kpis.nextReturn) : "A definir",
      sub: kpis.nextReturn ? "Previsão clínica" : "Sem data marcada",
      color: "var(--info)",
    },
    {
      label: "Medicações ativas",
      value: `${kpis.activeMeds} itens`,
      sub: "No cronograma do paciente",
      color: "var(--success)",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Resumo Financeiro Direto no Plano */}
      <div className="bg-card rounded-xl p-5 md:p-6 border border-border/90 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-soft">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center">
              <Wallet size={18} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">
                Financeiro do Acompanhamento
              </h3>
              <p className="text-xs text-muted-foreground">
                Condições contratadas e saldos deste plano
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {financials.open > 0 && (
              <button
                type="button"
                onClick={onOpenFinance}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition hover:bg-primary-hover"
              >
                <span>Receber Pagamento</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenFinance}
              className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/15 sm:self-auto"
            >
              <span>Gerenciar Condições</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <div className="p-3 bg-muted/60 rounded-xl border border-border-soft">
            <span className="text-xs font-semibold text-muted-foreground uppercase block">
              Contratado
            </span>
            <span className="text-base font-semibold text-foreground">
              {currency(financials.total)}
            </span>
          </div>
          <div className="p-3 bg-success/6 rounded-xl border border-success/12">
            <span className="text-xs font-semibold text-success uppercase block">
              Total Recebido
            </span>
            <span className="text-base font-semibold text-success">
              {currency(financials.paid)}
            </span>
          </div>
          <div className="p-3 bg-warning/6 rounded-xl border border-warning/12">
            <span className="text-xs font-semibold text-warning uppercase block">
              Saldo em Aberto
            </span>
            <span className="text-base font-semibold text-warning">
              {currency(financials.open)}
            </span>
          </div>
          <div className="p-3 bg-muted/60 rounded-xl border border-border-soft">
            <span className="text-xs font-semibold text-muted-foreground uppercase block">
              Vencimento / Modalidade
            </span>
            <span className="text-sm font-semibold text-foreground">
              {financials.hasFreeBalance
                ? "Pagamentos Livres (Sem vencimento)"
                : financials.nextDueDate
                  ? formatClinicalDate(financials.nextDueDate)
                  : "Em dia / Sem pendências"}
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm font-semibold">
        {protocolDeadline(treatment.status, treatment.end_date)} —{" "}
        {formatClinicalDate(treatment.end_date)}
      </p>

      {/* Card do Copiloto Clínico IA */}
      <div className="relative overflow-hidden rounded-xl border border-primary/15 bg-card p-5 text-foreground shadow-xs md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff7a59,#d946ef_50%,#6366f1)] text-white shadow-sm">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">
                Resumo do acompanhamento
              </h3>
              <p className="text-xs text-muted-foreground">Prazos e medicações cadastradas</p>
            </div>
          </div>

          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-primary-soft text-primary-hover">
            Dados do plano
          </span>
        </div>

        <div className="mt-4 p-4 rounded-2xl bg-card/90 border border-primary/11 text-sm text-foreground/80 leading-relaxed space-y-2">
          <p>
            📍 <b>Status do Tratamento:</b> O paciente encontra-se no{" "}
            <b>
              dia {kpis.passedDays} de {kpis.totalDays}
            </b>{" "}
            ({kpis.progress}% do prazo transcorrido). Possui{" "}
            <b>{kpis.activeMeds} medicação(ões) ativa(s)</b> no cronograma diário.
          </p>
          <p>
            🩺 <b>Próximo Passo Clínico:</b>{" "}
            {kpis.nextReturn ? (
              <span>
                Retorno previsto para <b>{formatClinicalDate(kpis.nextReturn)}</b> (estimativa
                clínica). Recomenda-se avaliar a adesão medicamentosa e registrar fotos de evolução
                na aba dedicada.
              </span>
            ) : (
              <span>
                Sem retorno previsto cadastrado. Recomenda-se definir uma data estimada de retorno
                para o checkpoint clínico.
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
            className="bg-card rounded-2xl border border-border/80 p-5 shadow-sm"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {c.label}
            </div>
            <div className="text-2xl font-semibold mt-1.5" style={{ color: c.color }}>
              {c.value}
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-medium">{c.sub}</div>
            {c.label === "Dias restantes" && (
              <div className="mt-3.5 h-2 rounded-full bg-muted overflow-hidden">
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
    const { error } = await supabase
      .from("treatment_medications")
      .update({ status: newStatus })
      .eq("id", m.id);
    if (error) {
      toast.error(error.message);
      return;
    }
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
    const { error } = await supabase.from("treatment_medications").delete().eq("id", m.id);
    if (error) {
      toast.error(
        "Não foi possível excluir. Medicações com uso registrado devem ser suspensas: " +
          error.message,
      );
      return;
    }
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
              className={`h-8.5 px-3.5 rounded-xl text-sm font-semibold transition cursor-pointer ${
                filter === f.id
                  ? "bg-primary text-white shadow-xs"
                  : "bg-card border border-border text-foreground/80 hover:bg-muted/60"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSendWhatsApp}
            className="h-10 px-3.5 rounded-full bg-success/10 hover:bg-success/15 text-success text-sm font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
          >
            <Send size={14} />
            <span>Disparar no WhatsApp</span>
          </button>

          <button
            onClick={() => setOpenNew(true)}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm transition cursor-pointer"
          >
            <Plus size={15} /> Nova medicação
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-xl border border-border/80 shadow-sm">
          <Pill size={44} className="mx-auto text-muted-foreground/60" strokeWidth={1.5} />
          <div className="mt-3 text-base font-semibold text-foreground">
            Nenhuma medicação no filtro
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            Adicione medicações e organize por horários do dia.
          </div>
        </div>
      ) : (
        <div className="relative pl-5">
          <div className="absolute left-1.5 top-0 bottom-0 w-px bg-surface-2" />
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
                  <div className="absolute -left-[13px] top-5 h-3.5 w-3.5 rounded-full bg-card border-2 border-primary" />
                  <div
                    className={`bg-card rounded-2xl border border-border/90 p-4.5 shadow-sm transition ${
                      suspenso ? "opacity-60 bg-muted/60" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                          <PIcon size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-[15px] font-semibold text-foreground">
                              {m.name}
                            </div>
                            {m.period && (
                              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary-soft text-primary">
                                {PERIOD_LABEL[m.period] ?? m.period}
                              </span>
                            )}
                            {suspenso && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                                Suspenso
                              </span>
                            )}
                          </div>

                          <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-medium">
                            {m.dose && (
                              <span>
                                <b className="text-foreground">Dose:</b> {m.dose}
                                {m.unit ? ` ${m.unit}` : ""}
                              </span>
                            )}
                            {m.route && (
                              <span>
                                <b className="text-foreground">Via:</b> {m.route}
                              </span>
                            )}
                            {m.frequency && (
                              <span>
                                <b className="text-foreground">Frequência:</b> {m.frequency}
                              </span>
                            )}
                          </div>

                          {m.notes && (
                            <div className="text-sm text-foreground/80 mt-2 bg-muted/60 rounded-xl p-2.5 border border-border-soft">
                              <span className="font-semibold text-foreground">Orientação:</span>{" "}
                              {m.notes}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-1">
                        <button
                          onClick={() => toggle(m)}
                          className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition cursor-pointer"
                          title={suspenso ? "Reativar" : "Suspender"}
                        >
                          {suspenso ? <CheckCircle2 size={16} /> : <PauseCircle size={16} />}
                        </button>
                        <button
                          onClick={() => remove(m)}
                          className="h-8 w-8 rounded-lg hover:bg-destructive/10 flex items-center justify-center text-destructive transition cursor-pointer"
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-border-soft px-6 py-4">
          <DialogTitle className="text-base">Nova Medicação no Cronograma</DialogTitle>
          <DialogDescription className="sr-only">
            Dados da medicação que entra no cronograma do acompanhamento.
          </DialogDescription>
        </DialogHeader>
        <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
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
              {["mg", "ml", "g", "mcg", "UI", "gotas", "cápsula(s)", "comprimido(s)", "ampola"].map(
                (u) => (
                  <option key={u}>{u}</option>
                ),
              )}
            </select>
          </div>
          <div>
            <Lbl>Via de Administração</Lbl>
            <select
              className={inp}
              value={f.route}
              onChange={(e) => setF({ ...f, route: e.target.value })}
            >
              {["Oral", "Sublingual", "Subcutânea", "Intramuscular", "Tópica", "Inalatória"].map(
                (r) => (
                  <option key={r}>{r}</option>
                ),
              )}
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
          <div className="sm:col-span-2">
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
          <div className="sm:col-span-2">
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
        <div className="px-6 py-4 border-t border-border-soft flex justify-end gap-2 bg-card">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-full bg-muted text-sm font-semibold text-foreground/80"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={submit}
            className="h-10 px-5 rounded-full bg-primary hover:bg-primary-hover text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Adicionar ao Cronograma"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const inp =
  "w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary";

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-foreground/80 block mb-1.5">{children}</label>
  );
}

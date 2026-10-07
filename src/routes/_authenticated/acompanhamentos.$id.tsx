import { useQuery, useQueryClient } from "@tanstack/react-query";
import ClinicalFollowup, {
  changeTreatmentStatus,
} from "@/features/acompanhamentos/ClinicalFollowup";
import InjectablesWorkspace from "@/features/acompanhamentos/InjectablesWorkspace";
import { PlanPayments } from "@/features/acompanhamentos/TreatmentFinance";
import { getFinancialSnapshot } from "@/features/finance/finance-api";
import { isFreeBalance, remaining } from "@/features/finance/finance-math";
import TreatmentSummary from "@/features/acompanhamentos/TreatmentSummary";
import {
  currency,
  formatClinicalDate,
  isWeightLossTreatment,
  localDate,
  protocolDeadline,
} from "@/features/acompanhamentos/followup-utils";
import type { DbRow, Json } from "@/lib/types";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Activity,
  Calendar as CalIcon,
  User as UserIcon,
  Wallet,
  CheckCircle2,
  PauseCircle,
  Edit3,
  Send,
  Sparkles,
  FileText,
  Camera,
  Image as ImageIcon,
  Check,
  MessageCircle,
  TrendingUp,
  Sliders,
  ChevronRight,
  ExternalLink,
  Syringe,
} from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatDateOnly } from "@/lib/date-utils";

export const Route = createFileRoute("/_authenticated/acompanhamentos/$id")({
  head: () => ({ meta: [{ title: "Acompanhamento Clínico • MedCore" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (typeof search.tab === "string" ? search.tab : undefined) as
      | "resumo"
      | "injetaveis"
      | "medicacoes"
      | "evolucao"
      | "financeiro"
      | undefined,
  }),
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
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [tab, setTab] = useState<"resumo" | "injetaveis" | "medicacoes" | "evolucao" | "financeiro">(
    search.tab === "medicacoes" ? "injetaveis" : search.tab || "resumo",
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (search.tab && ["resumo", "injetaveis", "medicacoes", "evolucao", "financeiro"].includes(search.tab)) {
      setTab(search.tab === "medicacoes" ? "injetaveis" : search.tab);
    }
  }, [search.tab]);

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

  // Número da parcela pela ordem de vencimento (após repactuação os números gravados ficam salteados)
  const installmentOrder = useMemo(
    () =>
      new Map(
        planTitles
          .filter((t) => t.status !== "cancelado" && !/entrada/i.test(t.description || "") && !isFreeBalance(t))
          .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
          .map((t, i) => [t.id, i + 1] as [string, number]),
      ),
    [planTitles],
  );

  const treatmentPayments = useMemo(() => {
    if (!financeSnapshot.data?.payments || planTitles.length === 0) return [];
    const titleMap = new Map(planTitles.map((t) => [t.id, t]));
    return financeSnapshot.data.payments
      .filter((p) => titleMap.has(p.transaction_id) && !p.reversed_at)
      .map((p) => ({
        ...p,
        title: titleMap.get(p.transaction_id)!,
        accountName:
          financeSnapshot.data?.accounts?.find((a) => a.id === p.account_id)?.name || "Conta Clínica",
      }))
      .sort((a, b) => (b.paid_on || "").localeCompare(a.paid_on || ""));
  }, [financeSnapshot.data?.payments, financeSnapshot.data?.accounts, planTitles]);

  const planFinancials = useMemo(() => {
    // Líquido (bruto - desconto): senão um plano com desconto nunca aparece quitado
    const total = treatment
      ? Math.max(0, Number(treatment.total_value || 0) - Number(treatment.discount || 0))
      : 0;
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
  // Só a primeira carga do plano mostra o esqueleto. Recargas após excluir/salvar atualizam
  // no lugar: trocar a página pelo esqueleto desmontava a aba e voltava ao topo.
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
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
      loadedRef.current = true;
    } catch (error) {
      if (!cancelledRef.current)
        setLoadError(error instanceof Error ? error.message : "Erro ao carregar acompanhamento.");
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [id, queryClient]);

  useEffect(() => {
    cancelledRef.current = false;
    loadedRef.current = false; // outro plano: volta a mostrar o esqueleto
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
      const weekly = activeList.filter((m) => m.period === "semanal");
      const morning = activeList.filter((m) => m.period === "manha");
      const afternoon = activeList.filter((m) => m.period === "tarde");
      const night = activeList.filter((m) => m.period === "noite");
      const daily = activeList.filter(
        (m) => !["manha", "tarde", "noite", "semanal"].includes(m.period),
      );

      if (weekly.length > 0) {
        msg += `💉 *INJETÁVEIS / PROTOCOLO SEMANAL:*\n`;
        weekly.forEach((m) => {
          const dateStr = m.start_date
            ? ` (${new Date(m.start_date + "T12:00:00").toLocaleDateString("pt-BR")})`
            : "";
          msg += `• *${m.name}* - ${m.dose || ""}${m.unit || ""} (${m.frequency || "Semanal"})${dateStr}\n`;
          if (m.notes) msg += `  _${m.notes}_\n`;
        });
        msg += `\n`;
      }

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
      msg += `🗓️ *Previsão do Próximo Retorno:* ${formatDateOnly(treatment.next_return_date)} (estimativa do plano — consulte a recepção para agendar o horário)\n\n`;
    }
    msg += `Qualquer dúvida ou reação, entre em contato conosco. Tenha um excelente tratamento! 🩺✨`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/55${phone}?text=${encoded}`, "_blank");
  };

  const isEmagrecimento = isWeightLossTreatment(treatment);

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
                    {formatDateOnly(treatment.start_date)}
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
              { id: "resumo" as const, label: "Resumo", icon: Activity },
              {
                id: "injetaveis" as const,
                label: isEmagrecimento ? "Injetáveis" : "Injetáveis & Cronograma",
                icon: Syringe,
              },
              { id: "evolucao" as const, label: "Evolução & Fotos", icon: Camera },
              { id: "financeiro" as const, label: "Financeiro do Plano", icon: Wallet },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id || (t.id === "injetaveis" && tab === "medicacoes");
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
                payments={treatmentPayments}
                onOpenFinance={() => setTab("financeiro")}
                installmentOrder={installmentOrder}
                meds={meds}
                paymentOverdue={planTitles
                  .filter((t) => !isFreeBalance(t) && t.due_date && t.due_date < localDate())
                  .reduce((s, t) => s + remaining(t), 0)}
              />
            )}
            {(tab === "injetaveis" || tab === "medicacoes") && (
              <InjectablesWorkspace
                treatmentId={id}
                treatmentStatus={treatment.status}
                planStartDate={treatment.start_date}
                meds={meds}
                reload={load}
                onSendWhatsApp={sendWhatsAppSchedule}
                isEmagrecimento={isEmagrecimento}
              />
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
  payments,
  onOpenFinance,
  installmentOrder,
  meds,
  paymentOverdue,
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
  payments: Array<DbRow & { title: DbRow; accountName?: string }>;
  onOpenFinance: () => void;
  installmentOrder: Map<string, number>;
  meds: DbRow[];
  paymentOverdue: number;
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

        {/* Detalhamento dos Valores Já Pagos pelo Paciente */}
        <div className="pt-3 border-t border-border-soft space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <span>Valores Já Pagos pelo Paciente ({payments.length})</span>
            </div>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              Total Recebido: {currency(financials.paid)}
            </span>
          </div>

          {payments.length === 0 ? (
            <div className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/40 border border-border-soft flex items-center justify-between">
              <span>Nenhum pagamento registrado ainda para este acompanhamento.</span>
              {financials.open > 0 && (
                <button
                  type="button"
                  onClick={onOpenFinance}
                  className="text-primary hover:underline font-semibold cursor-pointer"
                >
                  Registrar primeiro pagamento &rarr;
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {payments.map((p) => {
                const methodStr = (p.payment_method || "").toLowerCase();
                const methodLabel =
                  methodStr === "pix"
                    ? "PIX"
                    : methodStr === "cartao_credito"
                      ? "Cartão de Crédito"
                      : methodStr === "cartao_debito"
                        ? "Cartão de Débito"
                        : methodStr === "boleto"
                          ? "Boleto"
                          : methodStr === "dinheiro"
                            ? "Dinheiro"
                            : methodStr === "transferencia"
                              ? "Transferência"
                              : p.payment_method || "Outro";

                const parcela = p.title?.id ? installmentOrder.get(p.title.id) : undefined;
                const desc = /entrada/i.test(p.title?.description || "")
                  ? "Entrada do Plano"
                  : parcela
                    ? `Parcela ${parcela} de ${installmentOrder.size}`
                    : p.title?.description || "Pagamento";

                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-card border border-border/80 text-xs shadow-2xs hover:border-emerald-500/30 transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs">
                        ✓
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{desc}</div>
                        <div className="text-2xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <span>Data: {formatClinicalDate(p.paid_on)}</span>
                          <span>•</span>
                          <span className="font-medium text-foreground/80">{methodLabel}</span>
                          {p.accountName && (
                            <>
                              <span>•</span>
                              <span>{p.accountName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {currency(Number(p.amount) || 0)}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold inline-block mt-0.5">
                        Liquidado
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <p className="text-sm font-semibold">
        {protocolDeadline(treatment.status, treatment.end_date)} —{" "}
        {formatClinicalDate(treatment.end_date)}
      </p>

      <TreatmentSummary treatment={treatment} meds={meds} paymentOverdue={paymentOverdue} />

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

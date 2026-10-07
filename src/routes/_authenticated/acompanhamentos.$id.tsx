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

  // Protocolo semanal tem uma linha por semana ("Nome (Sem. 3)"): conta como uma medicação só
  const activeMeds = new Set(
    meds
      .filter((m) => m.status === "ativo")
      .map((m) => String(m.name || "").replace(/\s+\(Sem\.\s*\d+\)$/, "")),
  ).size;
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
      <div className="page-container space-y-4">
        {/* Cabeçalho compacto: identificação do plano + ações numa faixa só */}
        <div className="rounded-xl border border-border/90 bg-card px-5 py-3.5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <button
                onClick={() => navigate({ to: "/acompanhamentos" })}
                className="mb-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-primary cursor-pointer"
              >
                <ArrowLeft size={12} /> Acompanhamentos
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">{treatment.title}</h1>
                <span
                  className="rounded px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: st.bg, color: st.fg }}
                >
                  {st.label}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <UserIcon size={13} className="text-primary" /> {treatment.patients?.name}
                </span>
                {treatment.doctors?.name && <span>Dr(a). {treatment.doctors.name}</span>}
                <span className="inline-flex items-center gap-1">
                  <CalIcon size={13} /> Início {formatDateOnly(treatment.start_date)}
                </span>
                {treatment.objective && (
                  <span className="max-w-[420px] truncate" title={treatment.objective}>
                    <b className="font-semibold text-foreground/80">Objetivo:</b> {treatment.objective}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/prontuario"
                search={
                  { patientName: treatment.patients?.name, patientId: treatment.patient_id } as any
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-foreground/80 transition hover:bg-muted"
              >
                <FileText size={14} /> Prontuário
              </Link>
              <button
                onClick={sendWhatsAppSchedule}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-success transition hover:bg-success/10 cursor-pointer"
                title="Enviar cronograma pelo WhatsApp"
              >
                <Send size={13} /> Cronograma
              </button>
              {treatment.status === "em_andamento" && (
                <button
                  onClick={() => setStatus("pausado")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-warning transition hover:bg-warning/10 cursor-pointer"
                >
                  <PauseCircle size={15} /> Pausar
                </button>
              )}
              {treatment.status === "pausado" && (
                <button
                  onClick={() => setStatus("em_andamento")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-success transition hover:bg-success/10 cursor-pointer"
                >
                  <CheckCircle2 size={15} /> Retomar
                </button>
              )}
              {treatment.status !== "finalizado" && treatment.status !== "cancelado" && (
                <button
                  onClick={() => setStatus("finalizado")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary-hover cursor-pointer"
                >
                  <CheckCircle2 size={15} /> Concluir protocolo
                </button>
              )}
            </div>
          </div>
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
                className={`relative inline-flex shrink-0 whitespace-nowrap items-center gap-2 h-10 px-4 text-sm font-semibold transition cursor-pointer ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={16} />
                <span>{t.label}</span>
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
  const today = localDate();
  const returnLate = !!kpis.nextReturn && kpis.nextReturn < today;
  const paidPct = financials.total > 0 ? Math.min(100, Math.round((financials.paid / financials.total) * 100)) : 0;
  const methodLabel = (m?: string | null) =>
    ({
      pix: "PIX",
      cartao_credito: "Cartão de crédito",
      cartao_debito: "Cartão de débito",
      boleto: "Boleto",
      dinheiro: "Dinheiro",
      transferencia: "Transferência",
    })[(m || "").toLowerCase()] ||
    m ||
    "Outro";
  const paymentLabel = (p: DbRow & { title: DbRow }) => {
    if (/entrada/i.test(p.title?.description || "")) return "Entrada";
    const n = p.title?.id ? installmentOrder.get(p.title.id) : undefined;
    return n ? `Parcela ${n} de ${installmentOrder.size}` : p.title?.description || "Pagamento";
  };

  // Painel em duas colunas para caber na tela sem rolar: clínico à esquerda, prazo e financeiro à direita
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <TreatmentSummary treatment={treatment} meds={meds} paymentOverdue={paymentOverdue} />
      </div>

      <div className="space-y-4">
        {/* Prazo do protocolo */}
        <section className="space-y-3 rounded-xl border border-border/90 bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Prazo do protocolo</h3>
            <span className="text-xs text-muted-foreground">
              {protocolDeadline(treatment.status, treatment.end_date)}
            </span>
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {kpis.remainingDays} <span className="text-sm font-medium text-muted-foreground">dias restantes</span>
              </span>
              <span className="text-xs text-muted-foreground">{kpis.progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${kpis.progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Dia {kpis.passedDays} de {kpis.totalDays} · termina {formatClinicalDate(treatment.end_date)}
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-border-soft pt-2.5 text-sm">
            <span className="text-muted-foreground">Próximo retorno</span>
            <span className={`font-semibold ${returnLate ? "text-destructive" : "text-foreground"}`}>
              {kpis.nextReturn ? formatClinicalDate(kpis.nextReturn) : "A definir"}
              {returnLate ? " (atrasado)" : ""}
            </span>
          </div>
        </section>

        {/* Financeiro do plano */}
        <section className="space-y-3 rounded-xl border border-border/90 bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Financeiro</h3>
            <button
              type="button"
              onClick={onOpenFinance}
              className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              {financials.open > 0 ? "Receber" : "Detalhes"} <ChevronRight size={13} />
            </button>
          </div>
          {financials.total > 0 ? (
            <>
              <div>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span>
                    <b className="tabular-nums text-success">{currency(financials.paid)}</b>
                    <span className="text-muted-foreground"> de {currency(financials.total)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{paidPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-success" style={{ width: `${paidPct}%` }} />
                </div>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Em aberto</dt>
                  <dd className={`font-semibold tabular-nums ${financials.open > 0 ? "text-warning" : "text-foreground"}`}>
                    {currency(financials.open)}
                  </dd>
                </div>
                {paymentOverdue > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Em atraso</dt>
                    <dd className="font-semibold tabular-nums text-destructive">{currency(paymentOverdue)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Próximo vencimento</dt>
                  <dd className="font-semibold text-foreground">
                    {financials.hasFreeBalance
                      ? "Saldo livre"
                      : financials.nextDueDate
                        ? formatClinicalDate(financials.nextDueDate)
                        : "—"}
                  </dd>
                </div>
              </dl>
              {payments.length > 0 && (
                <div className="border-t border-border-soft pt-2.5">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    Últimos pagamentos ({payments.length})
                  </p>
                  <ul className="space-y-1.5">
                    {payments.slice(0, 3).map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-2 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{paymentLabel(p)}</span>
                          <span className="block truncate text-muted-foreground">
                            {formatClinicalDate(p.paid_on)} · {methodLabel(p.payment_method)}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-success">
                          {currency(Number(p.amount) || 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sem valores configurados para este plano.</p>
          )}
        </section>
      </div>
    </div>
  );
}

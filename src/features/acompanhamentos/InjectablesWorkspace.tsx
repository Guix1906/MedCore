import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar as CalIcon,
  Pill,
  Plus,
  Clock,
  Sun,
  Sunset,
  Moon,
  CheckCircle2,
  PauseCircle,
  Trash2,
  Send,
  Syringe,
  FlaskConical,
  Layers,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DbRow, IconType } from "@/lib/types";
import { formatClinicalDate, localDate } from "./followup-utils";
import MedicationUsePanel, { RegisterApplicationDialog } from "./MedicationUsePanel";
import { useTreatmentMedicationUses } from "./use-treatment-medication-uses";

// ============== INJETÁVEIS & CRONOGRAMA ==============
// Usado na aba "Injetáveis" do acompanhamento e na aba "Injetáveis" do prontuário do paciente.

const PERIOD_ICON: Record<string, IconType> = {
  manha: Sun,
  tarde: Sunset,
  noite: Moon,
  diario: Clock,
  semanal: Syringe,
  mensal: CalIcon,
};
const PERIOD_LABEL: Record<string, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
  diario: "Diário",
  semanal: "Semanal / Injetável",
  mensal: "Mensal",
};

function cleanDose(raw?: string | null) {
  if (!raw) return "";
  return raw.replace("[NÃO TOMOU]", "").replace("[SUSPENSA]", "").replace("[ADIADA]", "").trim();
}

const isAppliedUse = (u: DbRow) =>
  !u.dose?.includes("[NÃO TOMOU]") &&
  !u.dose?.includes("[SUSPENSA]") &&
  !u.dose?.includes("[ADIADA]");

const occurrenceLabel = (u: DbRow) =>
  u.dose?.includes("[NÃO TOMOU]")
    ? "Não tomou"
    : u.dose?.includes("[SUSPENSA]")
      ? "Suspensa"
      : "Adiada";

// Semanas salvas juntas têm o mesmo created_at; desempata pelo nome ("Sem. 2" antes de "Sem. 10").
const byScheduleOrder = (a: DbRow, b: DbRow) =>
  String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
  String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR", { numeric: true });

export default function InjectablesWorkspace({
  treatmentId,
  treatmentStatus,
  planStartDate,
  meds: rawMeds,
  reload,
  onSendWhatsApp,
  isEmagrecimento,
}: {
  treatmentId: string;
  treatmentStatus?: string | null;
  planStartDate?: string | null;
  meds: DbRow[];
  reload: () => void;
  onSendWhatsApp?: () => void;
  isEmagrecimento: boolean;
}) {
  const [filter, setFilter] = useState<string>("todos");
  const [openNew, setOpenNew] = useState(false);
  const [showApplyPanel, setShowApplyPanel] = useState(false);
  const [registering, setRegistering] = useState<DbRow | null>(null);

  const usesQuery = useTreatmentMedicationUses(treatmentId);

  const meds = useMemo(() => [...rawMeds].sort(byScheduleOrder), [rawMeds]);
  const allUses = useMemo(() => usesQuery.data ?? [], [usesQuery.data]);
  const appliedUses = allUses.filter(isAppliedUse);
  const lastApplied = appliedUses[0];
  // O banco só aceita registro com plano em andamento.
  const planActive = !treatmentStatus || treatmentStatus === "em_andamento";
  const today = localDate();

  const usesByMedication = useMemo(() => {
    const map = new Map<string, DbRow[]>();
    for (const u of allUses) {
      const list = map.get(u.medication_id) ?? [];
      list.push(u);
      map.set(u.medication_id, list);
    }
    return map;
  }, [allUses]);

  const filtered = useMemo(() => {
    if (filter === "todos") return meds;
    if (filter === "suspensos") return meds.filter((m) => m.status === "suspenso");
    if (filter === "injetaveis") {
      return meds.filter(
        (m) =>
          m.period === "semanal" ||
          m.route?.toLowerCase().includes("subcut") ||
          m.route?.toLowerCase().includes("intra") ||
          m.name.toLowerCase().includes("tirzepatida") ||
          m.name.toLowerCase().includes("semaglutida") ||
          m.name.toLowerCase().includes("mounjaro") ||
          m.name.toLowerCase().includes("ozempic"),
      );
    }
    if (filter === "manipulados") {
      return meds.filter(
        (m) =>
          m.unit === "dose" ||
          m.name.toLowerCase().includes("fórmula") ||
          m.name.toLowerCase().includes("manipulado") ||
          (m.notes && m.notes.length > 30),
      );
    }
    return meds.filter((m) => m.period === filter);
  }, [meds, filter]);

  const filters = [
    { id: "todos", label: "Todas" },
    { id: "injetaveis", label: "Injetáveis / Semanal" },
    { id: "manipulados", label: "Manipulados" },
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
    <div className="space-y-6">
      {/* ============================================================ */}
      {/* 1. SEÇÃO DE INJETÁVEIS ADMINISTRADOS AO PACIENTE */}
      {/* ============================================================ */}
      <section className="bg-card rounded-2xl border border-border/90 p-5 md:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-soft">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Syringe size={20} />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-foreground flex items-center gap-2">
                <span>
                  {isEmagrecimento
                    ? "Injetáveis Administrados (Protocolo de Emagrecimento)"
                    : "Injetáveis Administrados ao Paciente"}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                  {appliedUses.length} dose(s) aplicada(s)
                </span>
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controle de doses tomadas, via subcutânea/IM, baixas no estoque da clínica e
                interrupções.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowApplyPanel(!showApplyPanel)}
              className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                showApplyPanel
                  ? "bg-muted text-foreground hover:bg-muted/80"
                  : "bg-primary text-white hover:bg-primary-hover shadow-2xs"
              }`}
            >
              <Syringe size={14} />
              <span>{showApplyPanel ? "Ocultar Registro" : "Registrar Aplicação"}</span>
            </button>

            <button
              type="button"
              onClick={() => setOpenNew(true)}
              className="h-9 px-3.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus size={14} />
              <span>Novo Injetável / Manipulado</span>
            </button>
          </div>
        </div>

        {/* KPIs de Injetáveis */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 bg-emerald-500/6 rounded-xl border border-emerald-500/15">
            <span className="text-2xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
              Doses Tomadas / Aplicadas
            </span>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
              <CheckCircle2 size={18} />
              <span>{appliedUses.length} doses</span>
            </div>
            <span className="text-2xs text-muted-foreground mt-0.5 block">
              Histórico confirmado do paciente
            </span>
          </div>

          <div className="p-3.5 bg-primary/6 rounded-xl border border-primary/15">
            <span className="text-2xs font-semibold text-primary uppercase tracking-wider block">
              Último Injetável Aplicado
            </span>
            <div className="text-sm font-bold text-foreground mt-1 truncate">
              {lastApplied
                ? `${lastApplied.medication_name} (${cleanDose(lastApplied.dose)})`
                : "Nenhuma aplicação ainda"}
            </div>
            <span className="text-2xs text-muted-foreground mt-0.5 block">
              {lastApplied
                ? `Em ${new Date(lastApplied.used_at).toLocaleDateString("pt-BR")} às ${new Date(lastApplied.used_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                : "Aguardando 1ª aplicação"}
            </span>
          </div>

          <div className="p-3.5 bg-amber-500/6 rounded-xl border border-amber-500/15">
            <span className="text-2xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">
              Itens no Cronograma
            </span>
            <div className="text-xl font-bold text-foreground mt-1 flex items-center gap-1.5">
              <Layers size={18} className="text-amber-500" />
              <span>{meds.filter((m) => m.status === "ativo").length} prescrições</span>
            </div>
            <span className="text-2xs text-muted-foreground mt-0.5 block">
              {meds.filter((m) => m.period === "semanal").length} escalonamento(s) semanais
            </span>
          </div>
        </div>

        {/* Painel expansível de registro de aplicação */}
        {showApplyPanel && (
          <div className="pt-2">
            <MedicationUsePanel treatmentId={treatmentId} />
          </div>
        )}

        {/* Histórico detalhado dos injetáveis tomados */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Syringe size={13} className="text-primary" />
              <span>Histórico de Injetáveis do Paciente</span>
            </h3>
            <span className="text-xs text-muted-foreground">
              {allUses.length} registro(s) encontrado(s)
            </span>
          </div>

          {allUses.length === 0 ? (
            <div className="p-8 text-center bg-muted/30 rounded-xl border border-dashed border-border text-muted-foreground space-y-2">
              <Syringe size={32} className="mx-auto text-muted-foreground/60" />
              <p className="text-sm font-semibold text-foreground">
                Nenhum injetável registrado para este paciente até o momento.
              </p>
              <p className="text-xs max-w-md mx-auto">
                Registre cada aplicação (como Tirzepatida, Semaglutida ou Lipolíticos) com dose em
                mg, data e confirmação de estoque da clínica.
              </p>
              <button
                type="button"
                onClick={() => setShowApplyPanel(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition cursor-pointer"
              >
                <Plus size={13} />
                <span>Registrar Primeira Aplicação</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {allUses.map((u) => {
                const rawDose = u.dose || "";
                const isNaoTomou = rawDose.includes("[NÃO TOMOU]");
                const isSuspensa = rawDose.includes("[SUSPENSA]");
                const isAdiada = rawDose.includes("[ADIADA]");
                const doseClean = cleanDose(rawDose);

                return (
                  <div
                    key={u.id}
                    className={`p-3 rounded-xl border text-xs transition ${
                      isNaoTomou
                        ? "bg-rose-500/5 border-rose-500/25"
                        : isSuspensa
                          ? "bg-purple-500/5 border-purple-500/25"
                          : isAdiada
                            ? "bg-amber-500/5 border-amber-500/25"
                            : "bg-card border-border/80 shadow-2xs hover:border-emerald-500/30"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isNaoTomou ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                            <XCircle size={11} /> Não Tomou
                          </span>
                        ) : isSuspensa ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30">
                            <AlertCircle size={11} /> Suspensa
                          </span>
                        ) : isAdiada ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            <Clock size={11} /> Adiada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 size={11} /> Aplicada
                          </span>
                        )}

                        <span className="text-sm font-bold text-foreground">
                          {u.medication_name}
                        </span>

                        {doseClean && (
                          <span className="px-2 py-0.5 rounded-md bg-primary-soft text-primary font-semibold text-2xs">
                            {doseClean}
                          </span>
                        )}

                        {u.route && (
                          <span className="text-muted-foreground font-medium">• {u.route}</span>
                        )}
                      </div>

                      <span className="text-xs text-muted-foreground font-medium">
                        {new Date(u.used_at).toLocaleDateString("pt-BR")} às{" "}
                        {new Date(u.used_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
                      <span>
                        {u.inventory_item_id
                          ? `Consumo da clínica: ${u.quantity} un baixada(s) do estoque`
                          : isNaoTomou || isSuspensa || isAdiada
                            ? "Sem consumo de estoque (interrupção/pausa registrada)"
                            : "Uso externo / frasco do próprio paciente"}
                      </span>

                      {u.notes && (
                        <span className="text-foreground/80 italic font-medium">
                          Obs: {u.notes}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ============================================================ */}
      {/* 2. SEÇÃO DE CRONOGRAMA & PRESCRIÇÕES */}
      {/* ============================================================ */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Pill size={18} className="text-primary" />
              <span>Cronograma Prescrito & Protocolos</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Injetáveis semanais escalonados, fórmulas manipuladas e medicações orais do paciente.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onSendWhatsApp && (
              <button
                type="button"
                onClick={onSendWhatsApp}
                className="h-9 px-3.5 rounded-full bg-success/10 hover:bg-success/15 text-success text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <Send size={13} />
                <span>Disparar no WhatsApp</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setOpenNew(true)}
              className="h-9 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition cursor-pointer"
            >
              <Plus size={14} /> Nova Medicação / Injetável
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`h-8 px-3 rounded-xl text-xs font-semibold transition cursor-pointer ${
                filter === f.id
                  ? "bg-primary text-white shadow-2xs"
                  : "bg-card border border-border text-foreground/80 hover:bg-muted/60"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-xl border border-border/80 shadow-xs space-y-2">
            <Pill size={40} className="mx-auto text-muted-foreground/60" strokeWidth={1.5} />
            <div className="text-sm font-semibold text-foreground">
              Nenhuma prescrição no filtro selecionado
            </div>
            <div className="text-xs text-muted-foreground max-w-sm mx-auto">
              Adicione injetáveis semanais com doses em mg ou cadastre fórmulas manipuladas
              personalizadas.
            </div>
            <button
              type="button"
              onClick={() => setOpenNew(true)}
              className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition cursor-pointer"
            >
              <Plus size={13} />
              <span>Cadastrar Prescrição</span>
            </button>
          </div>
        ) : (
          <div className="relative pl-5">
            <div className="absolute left-1.5 top-0 bottom-0 w-px bg-border" />
            <div className="space-y-3">
              {filtered.map((m, i) => {
                const PIcon = PERIOD_ICON[m.period] ?? Clock;
                const suspenso = m.status !== "ativo";
                const isSemanal = m.period === "semanal";
                const isManipulado =
                  m.unit === "dose" ||
                  m.name?.toLowerCase().includes("fórmula") ||
                  m.name?.toLowerCase().includes("manipulado");
                const medUses = usesByMedication.get(m.id) ?? [];
                // Cada semana do protocolo é uma aplicação: depois de aplicada, o botão sai.
                const weekDone = isSemanal && medUses.some(isAppliedUse);

                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="relative"
                  >
                    <div className="absolute -left-[13px] top-5 h-3.5 w-3.5 rounded-full bg-card border-2 border-primary" />
                    <div
                      className={`bg-card rounded-2xl border border-border/90 p-4 shadow-2xs transition ${
                        suspenso ? "opacity-60 bg-muted/60" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                              isSemanal
                                ? "bg-primary/10 text-primary"
                                : isManipulado
                                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                                  : "bg-primary-soft text-primary"
                            }`}
                          >
                            {isSemanal ? (
                              <Syringe size={18} />
                            ) : isManipulado ? (
                              <FlaskConical size={18} />
                            ) : (
                              <PIcon size={18} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[15px] font-bold text-foreground">
                                {m.name}
                              </span>

                              {isSemanal && (
                                <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                                  💉 Injetável / Semanal
                                </span>
                              )}

                              {isManipulado && (
                                <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                                  🧪 Manipulado
                                </span>
                              )}

                              {m.period && !isSemanal && (
                                <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-primary-soft text-primary">
                                  {PERIOD_LABEL[m.period] ?? m.period}
                                </span>
                              )}

                              {suspenso && (
                                <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                                  Suspenso
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-medium">
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
                              {m.start_date && (
                                <span>
                                  <b className="text-foreground">Início:</b>{" "}
                                  {new Date(m.start_date + "T12:00:00").toLocaleDateString("pt-BR")}
                                </span>
                              )}
                            </div>

                            {m.notes && (
                              <div className="text-xs text-foreground/80 mt-2 bg-muted/50 rounded-xl p-2.5 border border-border-soft whitespace-pre-wrap font-sans">
                                <span className="font-bold text-foreground">
                                  Instruções / Composição:
                                </span>{" "}
                                {m.notes}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggle(m)}
                            className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition cursor-pointer"
                            title={suspenso ? "Reativar" : "Suspender"}
                          >
                            {suspenso ? <CheckCircle2 size={16} /> : <PauseCircle size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(m)}
                            className="h-8 w-8 rounded-lg hover:bg-destructive/10 flex items-center justify-center text-destructive transition cursor-pointer"
                            title="Remover"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {!suspenso && (
                        <div className="mt-3 pt-3 border-t border-border-soft flex flex-wrap items-center justify-between gap-2">
                          <ApplicationStatus med={m} uses={medUses} today={today} />
                          {!weekDone && (
                            <button
                              type="button"
                              disabled={!planActive}
                              onClick={() => setRegistering(m)}
                              title={
                                planActive
                                  ? undefined
                                  : "Retome o plano (em andamento) para registrar aplicações"
                              }
                              className="h-8 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Syringe size={13} />
                              <span>Registrar aplicação</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {openNew && (
        <NewMedicationModal
          treatmentId={treatmentId}
          isEmagrecimento={isEmagrecimento}
          planStartDate={planStartDate}
          planActive={planActive}
          onClose={() => setOpenNew(false)}
          onSaved={() => {
            reload();
            usesQuery.refetch();
          }}
        />
      )}

      {registering && (
        <RegisterApplicationDialog
          treatmentId={treatmentId}
          medication={{
            id: registering.id,
            name: registering.name,
            dose: registering.dose,
            unit: registering.unit,
            route: registering.route,
            start_date: registering.start_date,
          }}
          onClose={() => setRegistering(null)}
        />
      )}
    </div>
  );
}

const STATUS_TONE = {
  done: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  today: "bg-primary/10 text-primary border-primary/25",
  idle: "bg-muted text-muted-foreground border-border",
};

/** Situação do item no cronograma: aplicada, ocorrência, atrasada, hoje ou prevista. */
function ApplicationStatus({ med, uses, today }: { med: DbRow; uses: DbRow[]; today: string }) {
  const isSemanal = med.period === "semanal";
  const applied = uses.find(isAppliedUse);
  const latest = uses[0];
  const day = (u: DbRow) => new Date(u.used_at).toLocaleDateString("pt-BR");

  let tone: keyof typeof STATUS_TONE = "idle";
  let label = "Nenhuma aplicação registrada";
  if (isSemanal && applied) {
    tone = "done";
    label = `Aplicada em ${day(applied)}`;
  } else if (latest) {
    tone = isAppliedUse(latest) ? "done" : "warn";
    label = isAppliedUse(latest)
      ? `Última aplicação em ${day(latest)}`
      : `${occurrenceLabel(latest)} em ${day(latest)}`;
  } else if (isSemanal && med.start_date) {
    if (med.start_date < today) {
      tone = "warn";
      label = `Atrasada — prevista para ${formatClinicalDate(med.start_date)}`;
    } else if (med.start_date === today) {
      tone = "today";
      label = "Aplicação prevista para hoje";
    } else {
      label = `Prevista para ${formatClinicalDate(med.start_date)}`;
    }
  }

  const Icon = tone === "done" ? CheckCircle2 : tone === "warn" ? AlertCircle : Clock;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold border ${STATUS_TONE[tone]}`}
    >
      <Icon size={11} />
      {label}
    </span>
  );
}

// ============== MODAL COM ABAS: MANIPULADOS, PROTOCOLO SEMANAL (TIRZEPATIDA) E PADRÃO ==============

// Dose (mg) de cada semana. O de 12 semanas sobe 2,5 mg a cada 4 semanas e é o padrão do modal.
const WEEK_PRESETS: Record<4 | 8 | 12, string[]> = {
  4: ["2.5", "2.5", "5.0", "5.0"],
  8: ["2.5", "2.5", "5.0", "5.0", "7.5", "7.5", "10.0", "10.0"],
  12: ["2.5", "2.5", "2.5", "2.5", "5.0", "5.0", "5.0", "5.0", "7.5", "7.5", "7.5", "7.5"],
};

function NewMedicationModal({
  treatmentId,
  isEmagrecimento,
  planStartDate,
  planActive = true,
  onClose,
  onSaved,
}: {
  treatmentId: string;
  isEmagrecimento?: boolean;
  planStartDate?: string | null;
  planActive?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [modalTab, setModalTab] = useState<"manipulados" | "escalonada" | "padrao">(
    isEmagrecimento ? "escalonada" : "manipulados",
  );
  const [saving, setSaving] = useState(false);

  // 1. Estado da Aba Manipulados
  const [manipulado, setManipulado] = useState({
    name: "",
    composition: "",
    route: "Oral",
    period: "manha",
    frequency: "1x ao dia",
    startDate: new Date().toISOString().slice(0, 10),
  });

  // 2. Estado da Aba Protocolo Semanal (Tirzepatida / Injetáveis com doses em mg variáveis por semana)
  interface WeekStep {
    week: number;
    date: string;
    mg: string;
    // Semana já tomada pelo paciente (plano adiantado): registrada no histórico ao salvar
    applied?: boolean;
  }
  const addDays = (baseIso: string, days: number) => {
    const d = new Date(baseIso + "T12:00:00");
    d.setDate(d.getDate() + days);
    return localDate(d);
  };
  const buildWeeks = (doses: string[], startIso: string): WeekStep[] =>
    doses.map((mg, i) => ({ week: i + 1, date: addDays(startIso, i * 7), mg }));

  const todayIso = localDate();
  const [escalonada, setEscalonada] = useState({
    medName: "Tirzepatida (Mounjaro)",
    route: "Subcutânea",
    notes: "Aplicar via subcutânea no abdômen ou coxa, revezando os locais de aplicação.",
  });
  const [weeks, setWeeks] = useState<WeekStep[]>(() => buildWeeks(WEEK_PRESETS[12], todayIso));
  // Presets recalculam as datas a partir da Semana 1 já escolhida.
  const applyPreset = (doses: string[]) => setWeeks(buildWeeks(doses, weeks[0]?.date || todayIso));

  const updateWeek = (weekNum: number, field: "date" | "mg", val: string) => {
    setWeeks((prev) => prev.map((w) => (w.week === weekNum ? { ...w, [field]: val } : w)));
  };

  const toggleApplied = (weekNum: number) => {
    setWeeks((prev) => prev.map((w) => (w.week === weekNum ? { ...w, applied: !w.applied } : w)));
  };

  // Mesmas regras de record_treatment_medication_use: plano ativo, data até hoje e não
  // anterior ao início do plano. Devolve o motivo do bloqueio ou null.
  const applyBlock = (w: WeekStep): string | null => {
    if (!planActive) return "O plano precisa estar em andamento para registrar aplicações.";
    if (!w.date) return "Informe a data da semana.";
    if (w.date > localDate()) return "Semana futura: registre a aplicação quando ela acontecer.";
    if (planStartDate && w.date < planStartDate.slice(0, 10)) {
      return `Data anterior ao início do plano (${formatClinicalDate(planStartDate)}). Ajuste o início do plano para registrar.`;
    }
    return null;
  };

  // Hoje usa o horário atual (o banco recusa horário futuro); dias anteriores, meio-dia.
  const usedAtFor = (date: string) =>
    date === localDate() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString();

  const addNextWeek = () => {
    const last = weeks[weeks.length - 1];
    const nextNum = (last?.week || 0) + 1;
    const nextDate = last ? addDays(last.date, 7) : todayIso;
    const nextMg = last ? last.mg : "2.5";
    setWeeks((prev) => [...prev, { week: nextNum, date: nextDate, mg: nextMg }]);
  };

  const removeWeek = (weekNum: number) => {
    if (weeks.length <= 1) return;
    setWeeks((prev) =>
      prev.filter((w) => w.week !== weekNum).map((w, idx) => ({ ...w, week: idx + 1 })),
    );
  };

  // 3. Estado da Aba Padrão
  const [padrao, setPadrao] = useState({
    name: "",
    dose: "",
    unit: "mg",
    route: "Oral",
    frequency: "1x ao dia",
    period: "manha",
    start_date: todayIso,
    end_date: "",
    notes: "",
  });

  // Submissão Manipulados
  const submitManipulado = async () => {
    if (!manipulado.name.trim()) {
      return toast.error("Informe o nome da fórmula manipulada.");
    }
    if (!manipulado.composition.trim()) {
      return toast.error("Insira o texto com a composição / fórmula manipulada.");
    }
    setSaving(true);
    const { error } = await supabase.from("treatment_medications").insert({
      treatment_id: treatmentId,
      name: manipulado.name.trim(),
      dose: "Conforme fórmula",
      unit: "dose",
      route: manipulado.route || "Oral",
      frequency: manipulado.frequency || "1x ao dia",
      period: manipulado.period || "manha",
      start_date: manipulado.startDate || null,
      notes: manipulado.composition.trim(),
      status: "ativo",
    });
    setSaving(false);
    if (error) return toast.error("Erro ao salvar manipulado: " + error.message);
    toast.success("Manipulado adicionado ao cronograma!");
    onSaved();
    onClose();
  };

  // Submissão Protocolo Semanal (Tirzepatida)
  const submitEscalonada = async () => {
    if (!escalonada.medName.trim()) {
      return toast.error("Informe o nome do injetável.");
    }
    if (weeks.length === 0) {
      return toast.error("Adicione ao menos uma semana de protocolo.");
    }
    setSaving(true);
    const weekName = (w: WeekStep) => `${escalonada.medName.trim()} (Sem. ${w.week})`;
    const rows = weeks.map((w) => ({
      treatment_id: treatmentId,
      name: weekName(w),
      dose: String(w.mg).trim(),
      unit: "mg",
      route: escalonada.route || "Subcutânea",
      frequency: "1x por semana",
      period: "semanal",
      start_date: w.date || null,
      notes: `Semana ${w.week} do protocolo de ${escalonada.medName.trim()} (${w.mg}mg). ${escalonada.notes.trim()}`,
      status: "ativo",
    }));

    const { data: created, error } = await supabase
      .from("treatment_medications")
      .insert(rows)
      .select("id, name");
    if (error) {
      setSaving(false);
      return toast.error("Erro ao salvar escalonamento: " + error.message);
    }

    // Semanas que o paciente já tomou: entram no histórico de aplicações, sem baixa de estoque
    const appliedWeeks = weeks.filter((w) => w.applied && !applyBlock(w));
    const failed: number[] = [];
    for (const w of appliedWeeks) {
      const med = created?.find((m) => m.name === weekName(w));
      if (!med) {
        failed.push(w.week);
        continue;
      }
      const { error: useError } = await supabase.rpc("record_treatment_medication_use", {
        p_id: crypto.randomUUID(),
        p_medication_id: med.id,
        p_dose: `${String(w.mg).trim()} mg`,
        p_used_at: usedAtFor(w.date),
        p_route: escalonada.route || "Subcutânea",
        p_notes: "Aplicação já realizada, registrada no cadastro do protocolo semanal.",
        p_inventory_item_id: null,
        p_quantity: null,
      });
      if (useError) failed.push(w.week);
    }
    setSaving(false);

    const registered = appliedWeeks.length - failed.length;
    toast.success(
      `${weeks.length} semanas de ${escalonada.medName} salvas no cronograma!` +
        (registered > 0 ? ` ${registered} aplicação(ões) registrada(s) no histórico.` : ""),
    );
    if (failed.length > 0) {
      toast.warning("Algumas aplicações não foram registradas", {
        description: `Semana(s) ${failed.join(", ")}: use "Registrar aplicação" na semana do cronograma para lançar.`,
      });
    }
    onSaved();
    onClose();
  };

  // Submissão Padrão
  const submitPadrao = async () => {
    if (!padrao.name.trim()) return toast.error("Informe o nome da medicação");
    setSaving(true);
    const { error } = await supabase.from("treatment_medications").insert({
      treatment_id: treatmentId,
      name: padrao.name.trim(),
      dose: padrao.dose || null,
      unit: padrao.unit || null,
      route: padrao.route || null,
      frequency: padrao.frequency || null,
      period: padrao.period || null,
      start_date: padrao.start_date || null,
      end_date: padrao.end_date || null,
      notes: padrao.notes || null,
      status: "ativo",
    });
    setSaving(false);
    if (error) return toast.error("Erro ao salvar medicação: " + error.message);
    toast.success("Medicação adicionada ao cronograma!");
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b border-border-soft px-6 py-4 bg-card">
          <DialogTitle className="text-base flex items-center gap-2">
            <Plus size={18} className="text-primary" />
            <span>Cadastrar Prescrição no Cronograma</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Escolha entre fórmula manipulada, protocolo semanal com escalonamento de mg ou medicação
            padrão.
          </DialogDescription>

          {/* Abas do Modal */}
          <div className="flex items-center gap-1.5 pt-3">
            <button
              type="button"
              onClick={() => setModalTab("manipulados")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                modalTab === "manipulados"
                  ? "bg-purple-600 text-white shadow-2xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <FlaskConical size={14} />
              <span>Manipulados</span>
            </button>

            <button
              type="button"
              onClick={() => setModalTab("escalonada")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                modalTab === "escalonada"
                  ? "bg-primary text-white shadow-2xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Syringe size={14} />
              <span>Semanal (Tirzepatida)</span>
            </button>

            <button
              type="button"
              onClick={() => setModalTab("padrao")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                modalTab === "padrao"
                  ? "bg-foreground text-background shadow-2xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Pill size={14} />
              <span>Padrão</span>
            </button>
          </div>
        </DialogHeader>

        {/* ============================================================ */}
        {/* ABA 1: MANIPULADOS */}
        {/* ============================================================ */}
        {modalTab === "manipulados" && (
          <div className="p-5 sm:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-700 dark:text-purple-300">
              <span className="font-bold flex items-center gap-1.5 mb-0.5">
                <FlaskConical size={13} />
                Fórmulas & Compostos Manipulados
              </span>
              Digite manualmente a formulação completa, os ativos e as miligramas para salvar
              diretamente no cronograma do paciente.
            </div>

            <div>
              <Lbl>Nome da Fórmula / Manipulado *</Lbl>
              <input
                className={inp}
                placeholder="Ex.: Fórmula Moderadora de Apetite & Termogênica"
                value={manipulado.name}
                onChange={(e) => setManipulado({ ...manipulado, name: e.target.value })}
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  "Fórmula Emagrecedora & Termogênica",
                  "Composto Lipolítico & Diurético",
                  "Pool de Aminoácidos & Coenzimas",
                  "Modulador de Ansiedade Noturno",
                ].map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => setManipulado({ ...manipulado, name: sug })}
                    className="text-2xs px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground/80 font-medium cursor-pointer"
                  >
                    + {sug}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Lbl>Composição & Fórmula Completa (Inserir manualmente) *</Lbl>
              <textarea
                rows={5}
                className={inp}
                placeholder="Insira manualmente os componentes da fórmula com dosagens em mg/mcg/g...&#10;Ex.:&#10;Morosil 500mg&#10;Picolinato de Cromo 250mcg&#10;Cafeína Anidra 100mg&#10;Excipiente qsp 1 cápsula.&#10;Posologia: Tomar 1 cápsula pela manhã em jejum."
                value={manipulado.composition}
                onChange={(e) => setManipulado({ ...manipulado, composition: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Lbl>Via de Administração</Lbl>
                <select
                  className={inp}
                  value={manipulado.route}
                  onChange={(e) => setManipulado({ ...manipulado, route: e.target.value })}
                >
                  {["Oral", "Sublingual", "Tópica", "Injetável", "Retal", "Inalatória"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <Lbl>Turno / Período</Lbl>
                <select
                  className={inp}
                  value={manipulado.period}
                  onChange={(e) => setManipulado({ ...manipulado, period: e.target.value })}
                >
                  <option value="manha">🌅 Manhã</option>
                  <option value="tarde">☀️ Tarde</option>
                  <option value="noite">🌙 Noite</option>
                  <option value="diario">📋 Diário / Contínuo</option>
                </select>
              </div>

              <div>
                <Lbl>Data de Início</Lbl>
                <input
                  type="date"
                  className={inp}
                  value={manipulado.startDate}
                  onChange={(e) => setManipulado({ ...manipulado, startDate: e.target.value })}
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-border-soft">
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 rounded-xl bg-muted text-xs font-semibold text-foreground/80 hover:bg-muted/80"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitManipulado}
                className="h-10 px-5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-2xs disabled:opacity-50 flex items-center gap-1.5"
              >
                <FlaskConical size={14} />
                <span>{saving ? "Salvando..." : "Salvar Manipulado"}</span>
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* ABA 2: PROTOCOLO SEMANAL (TIRZEPATIDA / ESCALONAMENTO DE MG) */}
        {/* ============================================================ */}
        {modalTab === "escalonada" && (
          <div className="p-5 sm:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-xs text-primary">
              <span className="font-bold flex items-center gap-1.5 mb-0.5">
                <Syringe size={13} />
                Escalonamento Semanal de Injetáveis (Doses Variáveis por Semana)
              </span>
              Cadastre datas e miligramas (mg) semana a semana para Tirzepatida, Semaglutida ou
              outros injetáveis com titulação progressiva de dose. Paciente com o plano adiantado?
              Use "Registrar aplicação" nas semanas que ele já tomou.
            </div>

            <div>
              <Lbl>Nome da Medicação / Injetável *</Lbl>
              <input
                className={inp}
                placeholder="Ex.: Tirzepatida (Mounjaro), Semaglutida (Ozempic)..."
                value={escalonada.medName}
                onChange={(e) => setEscalonada({ ...escalonada, medName: e.target.value })}
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  "Tirzepatida (Mounjaro)",
                  "Semaglutida (Ozempic)",
                  "Semaglutida (Wegovy)",
                  "Liraglutida (Saxenda)",
                ].map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => setEscalonada({ ...escalonada, medName: sug })}
                    className="text-2xs px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground/80 font-medium cursor-pointer"
                  >
                    + {sug}
                  </button>
                ))}
              </div>
            </div>

            {/* Presets rápidos */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground pt-1">
              <span className="font-semibold uppercase tracking-wider">
                Configuração das Semanas (Datas & Miligramas)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => applyPreset(WEEK_PRESETS[4])}
                  className="text-primary hover:underline font-semibold cursor-pointer"
                >
                  Preset 4 Sem. (2.5 &rarr; 5mg)
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => applyPreset(WEEK_PRESETS[8])}
                  className="text-primary hover:underline font-semibold cursor-pointer"
                >
                  Preset 8 Semanas
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => applyPreset(WEEK_PRESETS[12])}
                  className="text-primary hover:underline font-semibold cursor-pointer"
                >
                  Preset 12 Semanas
                </button>
              </div>
            </div>

            {/* Lista de Semanas */}
            <div className="space-y-2.5 bg-muted/40 p-3.5 rounded-2xl border border-border-soft">
              {weeks.map((w) => (
                <div
                  key={w.week}
                  className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-card rounded-xl border border-border/80 shadow-2xs"
                >
                  <div className="flex items-center gap-2 min-w-[90px]">
                    <span className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                      {w.week}
                    </span>
                    <span className="text-xs font-bold text-foreground">Semana {w.week}</span>
                  </div>

                  {/* Campo de Data */}
                  <div className="flex-1 min-w-[130px]">
                    <input
                      type="date"
                      className="w-full text-xs rounded-lg border border-border px-2.5 py-1.5 focus:border-primary focus:outline-none"
                      value={w.date}
                      onChange={(e) => updateWeek(w.week, "date", e.target.value)}
                    />
                  </div>

                  {/* Campo de Miligramas com quick chips */}
                  <div className="flex items-center gap-1.5 min-w-[140px]">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="w-20 text-xs font-bold text-center rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none"
                      value={w.mg}
                      onChange={(e) => updateWeek(w.week, "mg", e.target.value)}
                    />
                    <span className="text-xs font-bold text-foreground">mg</span>

                    <div className="hidden sm:flex items-center gap-1 ml-1">
                      {["2.5", "5.0", "7.5", "10"].map((quickMg) => (
                        <button
                          key={quickMg}
                          type="button"
                          onClick={() => updateWeek(w.week, "mg", quickMg)}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold transition cursor-pointer ${
                            w.mg === quickMg
                              ? "bg-primary text-white"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {quickMg}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Botão de remover semana */}
                  {weeks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeWeek(w.week)}
                      className="h-7 w-7 rounded-lg hover:bg-destructive/10 text-destructive flex items-center justify-center transition cursor-pointer"
                      title="Remover esta semana"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}

                  {/* Aplicação já tomada (planos adiantados): vai para o histórico ao salvar */}
                  {(() => {
                    const block = applyBlock(w);
                    const isFuture = !!w.date && w.date > localDate();
                    const applied = !!w.applied && !block;
                    return (
                      <div className="basis-full flex flex-wrap items-center gap-2 border-t border-border-soft pt-2">
                        <button
                          type="button"
                          disabled={!!block}
                          title={block || undefined}
                          onClick={() => toggleApplied(w.week)}
                          className={`h-7 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                            applied
                              ? "bg-success text-white hover:bg-success/90"
                              : "border border-success/40 bg-success/5 text-success hover:bg-success/10"
                          }`}
                        >
                          {applied ? <CheckCircle2 size={13} /> : <Syringe size={13} />}
                          <span>{applied ? "Aplicação registrada" : "Registrar aplicação"}</span>
                        </button>
                        {applied && (
                          <span className="text-[11px] text-success">
                            Entra no histórico ao salvar, sem baixa de estoque. Clique de novo para
                            desfazer.
                          </span>
                        )}
                        {isFuture && (
                          <span className="text-[11px] text-muted-foreground">Semana futura</span>
                        )}
                        {block && !isFuture && (
                          <span className="text-[11px] text-warning">{block}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}

              <button
                type="button"
                onClick={addNextWeek}
                className="w-full py-2.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} />
                <span>+ Adicionar Próxima Semana (+7 dias)</span>
              </button>
            </div>

            <div>
              <Lbl>Orientações Gerais de Aplicação</Lbl>
              <textarea
                rows={2}
                className={inp}
                placeholder="Ex.: Aplicar via subcutânea no abdômen ou coxa, revezando os locais a cada semana."
                value={escalonada.notes}
                onChange={(e) => setEscalonada({ ...escalonada, notes: e.target.value })}
              />
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-border-soft">
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 rounded-xl bg-muted text-xs font-semibold text-foreground/80 hover:bg-muted/80"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitEscalonada}
                className="h-10 px-5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-2xs disabled:opacity-50 flex items-center gap-1.5"
              >
                <Syringe size={14} />
                <span>
                  {saving
                    ? "Salvando..."
                    : `Salvar Escalonamento (${weeks.length} Semanas${
                        weeks.some((w) => w.applied && !applyBlock(w))
                          ? ` · ${weeks.filter((w) => w.applied && !applyBlock(w)).length} aplicada(s)`
                          : ""
                      })`}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* ABA 3: PADRÃO */}
        {/* ============================================================ */}
        {modalTab === "padrao" && (
          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
            <div className="sm:col-span-2">
              <Lbl>Nome da Medicação *</Lbl>
              <input
                className={inp}
                placeholder="Ex.: Roacutan, Losartana, Metformina..."
                value={padrao.name}
                onChange={(e) => setPadrao({ ...padrao, name: e.target.value })}
              />
            </div>
            <div>
              <Lbl>Dose</Lbl>
              <input
                className={inp}
                placeholder="Ex.: 50, 0.5, 1"
                value={padrao.dose}
                onChange={(e) => setPadrao({ ...padrao, dose: e.target.value })}
              />
            </div>
            <div>
              <Lbl>Unidade</Lbl>
              <select
                className={inp}
                value={padrao.unit}
                onChange={(e) => setPadrao({ ...padrao, unit: e.target.value })}
              >
                {[
                  "mg",
                  "ml",
                  "g",
                  "mcg",
                  "UI",
                  "gotas",
                  "cápsula(s)",
                  "comprimido(s)",
                  "ampola",
                ].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <Lbl>Via de Administração</Lbl>
              <select
                className={inp}
                value={padrao.route}
                onChange={(e) => setPadrao({ ...padrao, route: e.target.value })}
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
                value={padrao.frequency}
                onChange={(e) => setPadrao({ ...padrao, frequency: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Lbl>Turno / Período do Dia</Lbl>
              <select
                className={inp}
                value={padrao.period}
                onChange={(e) => setPadrao({ ...padrao, period: e.target.value })}
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
                value={padrao.notes}
                onChange={(e) => setPadrao({ ...padrao, notes: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2 pt-2 flex justify-end gap-2 border-t border-border-soft">
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 rounded-xl bg-muted text-xs font-semibold text-foreground/80 hover:bg-muted/80"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitPadrao}
                className="h-10 px-5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-2xs disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Adicionar ao Cronograma"}
              </button>
            </div>
          </div>
        )}
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

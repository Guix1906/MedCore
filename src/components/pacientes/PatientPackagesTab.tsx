import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Package,
  Plus,
  Calendar,
  User,
  Clock,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  XCircle,
  ChevronRight,
  ExternalLink,
  DollarSign,
  Activity,
  FileText,
  Stethoscope,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  currency,
  formatClinicalDate,
  localDate,
  PAYMENT_METHODS,
} from "@/features/acompanhamentos/followup-utils";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PatientPackagesTabProps {
  patientId: string;
  patientName: string;
}

export type TreatmentItem = {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  title: string;
  objective: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  total_value: number;
  down_payment: number;
  discount: number;
  installments_count: number;
  payment_method: string | null;
  color: string | null;
  return_days: number | null;
  next_return_date: string | null;
  notes: string | null;
  created_at: string;
  doctors?: { name: string } | null;
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  em_andamento: {
    label: "Em andamento",
    bg: "bg-success/10 border-success/25",
    text: "text-success",
    icon: Activity,
  },
  pausado: {
    label: "Pausado",
    bg: "bg-warning/10 border-warning/25",
    text: "text-warning",
    icon: PauseCircle,
  },
  finalizado: {
    label: "Finalizado",
    bg: "bg-info/10 border-info/25",
    text: "text-info",
    icon: CheckCircle2,
  },
  cancelado: {
    label: "Cancelado",
    bg: "bg-destructive/10 border-destructive/25",
    text: "text-destructive",
    icon: XCircle,
  },
};

export function PatientPackagesTab({ patientId, patientName }: PatientPackagesTabProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("todos");

  // Fetch treatments for this patient
  const {
    data: treatments = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["patient-treatments", patientId],
    queryFn: async () => {
      if (!patientId) return [];
      const { data, error } = await supabase
        .from("treatments")
        .select("*, doctors(name)")
        .eq("patient_id", patientId)
        .order("start_date", { ascending: false });

      if (error) {
        console.error("Erro ao carregar tratamentos:", error);
        return [];
      }
      return (data as unknown as TreatmentItem[]) || [];
    },
    enabled: !!patientId,
  });

  // Fetch doctors list for modal
  const { data: doctors = [] } = useQuery({
    queryKey: ["doctors-list"],
    queryFn: async () => {
      const { data } = await supabase.from("doctors").select("id, name").order("name");
      return data || [];
    },
  });

  // Query financial snapshot for accounts list
  const { data: financeData } = useQuery({
    queryKey: ["financial-snapshot"],
    queryFn: getFinancialSnapshot,
    staleTime: 60_000,
  });

  // Form state for New Treatment / Package
  const [title, setTitle] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [startDate, setStartDate] = useState(localDate());
  const [protocolDays, setProtocolDays] = useState("months_3");
  const [customEndDate, setCustomEndDate] = useState("");
  const [totalValue, setTotalValue] = useState("");
  const [downPayment, setDownPayment] = useState("");
  const [downStatus, setDownStatus] = useState<"received_now" | "pending">("received_now");
  const [downMethod, setDownMethod] = useState("pix");
  const [downAccountId, setDownAccountId] = useState("");
  const [remainingModality, setRemainingModality] = useState<"parcelado" | "livre">("livre");
  const [installmentsCount, setInstallmentsCount] = useState("3");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [remainingMethod, setRemainingMethod] = useState("pix");
  const [objective, setObjective] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Compute metrics
  const metrics = useMemo(() => {
    const total = treatments.length;
    const inProgress = treatments.filter((t) => t.status === "em_andamento").length;
    const completed = treatments.filter((t) => t.status === "finalizado").length;
    const totalValueSum = treatments.reduce((acc, t) => acc + Number(t.total_value || 0), 0);
    return { total, inProgress, completed, totalValueSum };
  }, [treatments]);

  // Filtered treatments
  const filteredTreatments = useMemo(() => {
    if (statusFilter === "todos") return treatments;
    return treatments.filter((t) => t.status === statusFilter);
  }, [treatments, statusFilter]);

  const handleOpenModal = () => {
    setTitle("");
    setDoctorId(doctors[0]?.id || "");
    const today = localDate();
    setStartDate(today);
    setProtocolDays("months_3");
    setCustomEndDate("");
    setTotalValue("");
    setDownPayment("");
    setDownStatus("received_now");
    setDownMethod("pix");
    setDownAccountId(financeData?.accounts?.find((a) => a.active)?.id || "");
    setRemainingModality("livre");
    setInstallmentsCount("3");
    setFirstDueDate(today);
    setRemainingMethod("pix");
    setObjective("");
    setNotes("");
    setModalOpen(true);
  };

  const handleSaveTreatment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Informe o nome do pacote ou tratamento.");
      return;
    }

    setIsSaving(true);
    try {
      const [y, m, d] = startDate.split("-").map(Number);
      let endDateStr: string;
      if (protocolDays.startsWith("months_")) {
        const months = Number(protocolDays.replace("months_", ""));
        const targetDate = new Date(y, m - 1 + months, d);
        endDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
      } else if (protocolDays === "custom" && customEndDate) {
        endDateStr = customEndDate;
      } else {
        const days = Number(protocolDays) || 90;
        const targetDate = new Date(y, m - 1, d);
        targetDate.setDate(targetDate.getDate() + days);
        endDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
      }

      const val = parseFloat(totalValue.replace(/\./g, "").replace(",", ".")) || 0;
      const down = parseFloat(downPayment.replace(/\./g, "").replace(",", ".")) || 0;
      const balance = Math.max(0, val - down);
      const isLivre = remainingModality === "livre";
      const count = isLivre ? 1 : Number(installmentsCount) || 1;
      const mainMethod = down > 0 ? downMethod : balance > 0 ? remainingMethod : "pix";

      const payload = {
        patient_id: patientId,
        doctor_id: doctorId || null,
        title: title.trim(),
        objective: objective.trim() || null,
        start_date: startDate,
        end_date: endDateStr,
        return_days: 30,
        total_value: val,
        down_payment: down,
        discount: 0,
        installments_count: count,
        payment_method: mainMethod,
        color: "#8B47FF",
        status: "em_andamento",
        notes:
          (notes.trim() ? notes.trim() + "\n" : "") +
          (isLivre ? "[modalidade:saldo_livre]" : "[modalidade:parcelado]"),
      };

      const { data, error } = await supabase
        .from("treatments")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      // Se houver valor financeiro informado, gera as cobranças oficiais no Financeiro
      if (val > 0 && data?.id) {
        let pType: "a_vista" | "parcelado" = "parcelado";
        let pCount = count;
        let pFirstDue = startDate;

        if (balance <= 0) {
          pType = "a_vista";
          pCount = 1;
          pFirstDue = startDate;
        } else if (isLivre) {
          pType = "parcelado";
          pCount = 1;
          pFirstDue = endDateStr;
        } else {
          pType = count > 1 ? "parcelado" : down > 0 ? "parcelado" : "a_vista";
          pCount = count;
          pFirstDue = firstDueDate || startDate;
        }

        try {
          const { error: finError } = await supabase.rpc("configure_treatment_payment", {
            p_treatment_id: data.id,
            p_total: val,
            p_discount: 0,
            p_down: down,
            p_type: pType,
            p_down_method: down > 0 ? downMethod : null,
            p_method: balance > 0 ? remainingMethod : downMethod,
            p_count: pCount,
            p_down_due: down > 0 ? startDate : null,
            p_first_due: pFirstDue,
          });

          if (finError) {
            console.warn("Aviso ao gerar parcelas financeiras:", finError);
            toast.info(
              "Plano criado. As condições financeiras podem ser conferidas na aba Financeiro.",
            );
          } else {
            // Ajustar títulos gerados: Saldo Livre e Baixa imediata de Entrada recebida
            const { data: createdTxs } = await supabase
              .from("transactions")
              .select("id, installment_id, description, installments:installment_id(number)")
              .eq("treatment_id", data.id);

            if (createdTxs) {
              // 1. Se for modalidade de Saldo Livre, identificar o título do saldo e marcá-lo como Saldo Livre
              if (isLivre && balance > 0) {
                const balanceTx = createdTxs.find(
                  (tx: any) =>
                    tx.installments?.number !== 0 && !tx.description?.includes("Entrada"),
                );
                if (balanceTx) {
                  await supabase
                    .from("transactions")
                    .update({
                      description: `Acompanhamento: ${title.trim()} - Saldo Livre (Sem vencimento definido)`,
                      category: "Saldo Livre",
                    })
                    .eq("id", balanceTx.id);
                }
              }

              // 2. Se a entrada foi marcada como "Recebido agora", registrar a baixa oficial
              if (down > 0 && downStatus === "received_now") {
                const downTx = createdTxs.find(
                  (tx: any) => tx.installments?.number === 0 || tx.description?.includes("Entrada"),
                );
                if (downTx && downAccountId) {
                  const { error: payErr } = await supabase.rpc("record_financial_payment", {
                    p_id: crypto.randomUUID(),
                    p_transaction_id: downTx.id,
                    p_amount: down,
                    p_paid_on: startDate,
                    p_method: downMethod,
                    p_account_id: downAccountId,
                    p_payer_name: patientName || null,
                  });
                  if (payErr) {
                    console.warn("Aviso ao liquidar entrada recebida:", payErr);
                  }
                }
              }
            }

            await refreshFinance(qc);
          }
        } catch (rpcErr) {
          console.warn("Falha na chamada da RPC de parcelamento:", rpcErr);
        }
      }

      await refetch();
      await qc.invalidateQueries({ queryKey: ["patient-clinical-history"] });
      await qc.invalidateQueries({ queryKey: ["treatments-list"] });
      await qc.invalidateQueries({ queryKey: ["financial-snapshot"] });

      toast.success(
        val > 0
          ? "Plano contratado e cobranças geradas no Financeiro!"
          : "Plano de tratamento registrado com sucesso!",
      );
      setModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar pacote de tratamento");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span>Carregando pacotes e tratamentos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border-soft">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Pacotes & Planos de Tratamento
          </h2>
          <p className="text-sm text-muted-foreground">
            Controle de protocolos contínuos, sessões contratadas e evolução clínica do paciente.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-xs hover:shadow transition-all cursor-pointer shrink-0"
        >
          <Plus size={16} />
          <span>Novo Pacote / Tratamento</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Total de Pacotes
            </span>
            <div className="h-8 w-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center">
              <Package size={16} />
            </div>
          </div>
          <p className="text-2xl font-semibold text-foreground">{metrics.total}</p>
          <p className="text-xs text-muted-foreground">
            Valor total: <strong>{currency(metrics.totalValueSum)}</strong>
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-success uppercase tracking-wider">
              Em Andamento
            </span>
            <div className="h-8 w-8 rounded-lg bg-success/10 text-success flex items-center justify-center">
              <Activity size={16} />
            </div>
          </div>
          <p className="text-2xl font-semibold text-success">{metrics.inProgress}</p>
          <p className="text-xs text-muted-foreground">Protocolos ativos no momento</p>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-info uppercase tracking-wider">
              Concluídos
            </span>
            <div className="h-8 w-8 rounded-lg bg-info/10 text-info flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <p className="text-2xl font-semibold text-info">{metrics.completed}</p>
          <p className="text-xs text-muted-foreground">Tratamentos finalizados com sucesso</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-muted rounded-xl w-fit overflow-x-auto">
        {(
          [
            { id: "todos", label: "Todos os pacotes" },
            { id: "em_andamento", label: "Em andamento" },
            { id: "pausado", label: "Pausados" },
            { id: "finalizado", label: "Finalizados" },
          ] as const
        ).map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setStatusFilter(filter.id)}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap",
              statusFilter === filter.id
                ? "bg-card text-primary shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Treatments List */}
      <div className="space-y-3.5">
        {filteredTreatments.length === 0 ? (
          <div className="text-center py-16 bg-muted/36 rounded-2xl border border-dashed border-border">
            <Package className="h-10 w-10 text-muted-foreground/60 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground/80">Nenhum pacote registrado</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {treatments.length === 0
                ? "Este paciente ainda não possui nenhum pacote ou acompanhamento clínico ativo."
                : "Nenhum pacote corresponde ao filtro selecionado."}
            </p>
            {treatments.length === 0 && (
              <button
                type="button"
                onClick={handleOpenModal}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline cursor-pointer"
              >
                <Plus size={14} />
                <span>Adicionar primeiro pacote</span>
              </button>
            )}
          </div>
        ) : (
          filteredTreatments.map((item) => {
            const st = STATUS_CONFIG[item.status] || STATUS_CONFIG.em_andamento;
            const StatusIcon = st.icon;

            return (
              <div
                key={item.id}
                className="p-5 rounded-2xl bg-card border border-border shadow-xs hover:border-primary/25 transition-all space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h4 className="text-[15px] font-semibold text-foreground">{item.title}</h4>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                            st.bg,
                            st.text,
                          )}
                        >
                          <StatusIcon size={12} />
                          <span>{st.label}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                        {item.doctors?.name && (
                          <span className="flex items-center gap-1">
                            <Stethoscope size={13} className="text-primary" />
                            <span>Dr(a). {item.doctors.name}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar size={13} className="text-muted-foreground" />
                          <span>
                            {formatClinicalDate(item.start_date)}
                            {item.end_date && ` → ${formatClinicalDate(item.end_date)}`}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border-soft">
                    <div className="text-left sm:text-right">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">
                        Valor Contratado
                      </p>
                      <p className="text-[15px] font-semibold text-primary">
                        {currency(item.total_value)}
                      </p>
                      {item.installments_count > 1 && (
                        <p className="text-xs text-muted-foreground">
                          {item.installments_count}x de{" "}
                          {currency(item.total_value / item.installments_count)}
                        </p>
                      )}
                    </div>

                    <Link
                      to={`/acompanhamentos/${item.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-soft hover:bg-primary-soft text-primary text-sm font-semibold transition-all cursor-pointer shrink-0"
                    >
                      <span>Abrir Acompanhamento</span>
                      <ChevronRight size={14} />
                    </Link>
                  </div>
                </div>

                {item.objective && (
                  <div className="p-3 bg-muted/60 rounded-xl text-sm text-muted-foreground border border-border-soft">
                    <strong className="text-foreground">Objetivo Clínico:</strong> {item.objective}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Novo Pacote / Tratamento */}
      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open && !isSaving) setModalOpen(false);
        }}
      >
        <DialogContent className="max-w-xl" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader className="flex-row items-center gap-2.5 space-y-0 border-b border-border-soft pb-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <Package size={18} />
            </div>
            <div>
              <DialogTitle className="text-base">Novo Pacote / Plano de Tratamento</DialogTitle>
              <DialogDescription className="text-xs">
                Vincular protocolo clínico ou pacote ao paciente
              </DialogDescription>
            </div>
          </DialogHeader>

          <form onSubmit={handleSaveTreatment} className="space-y-4">
            {/* Paciente Vinculado */}
            <div className="p-3 bg-muted/60 rounded-xl border border-border/80 flex items-center gap-2.5 text-foreground/80 text-sm">
              <User size={16} className="text-primary shrink-0" />
              <span>
                Paciente: <strong>{patientName}</strong>
              </span>
            </div>

            {/* Nome do Pacote/Tratamento */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">
                Nome do Pacote / Tratamento <span className="text-destructive">*</span>
              </label>
              <input
                required
                placeholder="Ex: Harmonização Facial (5 sessões), Protocolo Capilar, Ortodontia..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
              />
            </div>

            {/* Data de Início e Profissional */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">
                  Data de Início <span className="text-destructive">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">
                  Profissional / Médico
                </label>
                <select
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                >
                  <option value="">Selecione o profissional...</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      Dr(a). {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Vigência / Duração do Plano */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">
                Vigência do Plano de Acompanhamento
              </label>
              <select
                value={protocolDays}
                onChange={(e) => setProtocolDays(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
              >
                <option value="months_1">1 mês de calendário</option>
                <option value="months_2">2 meses de calendário</option>
                <option value="months_3">3 meses de calendário (ex: 16/06 a 16/09)</option>
                <option value="months_6">6 meses de calendário</option>
                <option value="months_12">12 meses (1 ano)</option>
                <option value="30">30 dias corridos</option>
                <option value="60">60 dias corridos</option>
                <option value="90">90 dias corridos</option>
                <option value="custom">Data de término personalizada…</option>
              </select>

              {protocolDays === "custom" && (
                <div className="pt-2">
                  <label className="text-xs font-semibold text-primary">
                    Data Final Acordada <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full mt-1 px-3.5 py-2.5 rounded-xl border border-primary/35 bg-primary-soft/40 text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                  />
                </div>
              )}
            </div>

            {/* Condições Financeiras: Valores, Entrada, Parcelas e Forma */}
            <div className="p-4 bg-muted/48 rounded-2xl border border-border/80 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet size={14} className="text-primary" />
                  Condições Financeiras do Contrato
                </span>
                {(() => {
                  const v = parseFloat(totalValue.replace(/\./g, "").replace(",", ".")) || 0;
                  const d = parseFloat(downPayment.replace(/\./g, "").replace(",", ".")) || 0;
                  const b = Math.max(0, v - d);
                  return v > 0 ? (
                    <span className="text-xs font-semibold text-muted-foreground">
                      Saldo a receber:{" "}
                      <strong className={b > 0 ? "text-primary" : "text-success"}>
                        {currency(b)}
                      </strong>
                    </span>
                  ) : null;
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground/80">
                    Valor Total Contratado (R$) <span className="text-destructive">*</span>
                  </label>
                  <input
                    placeholder="0,00"
                    value={totalValue}
                    onChange={(e) => setTotalValue(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card border border-border text-sm text-foreground font-semibold focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground/80">
                    Entrada / Pagamento Inicial (R$)
                  </label>
                  <input
                    placeholder="0,00 (opcional)"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card border border-border text-sm text-foreground font-semibold focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Bloco de Entrada detalhada quando informada */}
              {(() => {
                const d = parseFloat(downPayment.replace(/\./g, "").replace(",", ".")) || 0;
                if (d <= 0) return null;

                return (
                  <div className="p-3.5 bg-card rounded-xl border border-primary/15 shadow-xs space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-primary-hover">
                        Situação da Entrada ({currency(d)})
                      </label>
                      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
                        <button
                          type="button"
                          onClick={() => setDownStatus("received_now")}
                          className={cn(
                            "px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                            downStatus === "received_now"
                              ? "bg-success text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          ✓ Pagamento recebido agora
                        </button>
                        <button
                          type="button"
                          onClick={() => setDownStatus("pending")}
                          className={cn(
                            "px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                            downStatus === "pending"
                              ? "bg-warning text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          ⏳ Entrada prevista
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground">
                          Forma de Pagamento da Entrada
                        </label>
                        <select
                          value={downMethod}
                          onChange={(e) => setDownMethod(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-sm text-foreground outline-none focus:border-primary"
                        >
                          <option value="pix">Pix</option>
                          <option value="dinheiro">Dinheiro</option>
                          <option value="cartao_credito">Cartão de Crédito</option>
                          <option value="cartao_debito">Cartão de Débito</option>
                          <option value="transferencia">Transferência Bancária</option>
                          <option value="boleto">Boleto</option>
                        </select>
                      </div>

                      {downStatus === "received_now" ? (
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground">
                            Conta de Destino da Baixa
                          </label>
                          <select
                            value={downAccountId}
                            onChange={(e) => setDownAccountId(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-sm text-foreground outline-none focus:border-primary"
                          >
                            {(financeData?.accounts || [])
                              .filter((a) => a.active)
                              .map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} ({acc.bank_name || "Caixa"})
                                </option>
                              ))}
                          </select>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground">
                            Previsão de Recebimento
                          </label>
                          <p className="text-xs text-muted-foreground py-1.5">
                            Ficará pendente com vencimento na data inicial (
                            {formatClinicalDate(startDate)}).
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Modalidade do Saldo Restante */}
              {(() => {
                const v = parseFloat(totalValue.replace(/\./g, "").replace(",", ".")) || 0;
                const d = parseFloat(downPayment.replace(/\./g, "").replace(",", ".")) || 0;
                const b = Math.max(0, v - d);

                if (v <= 0) return null;
                if (b <= 0) {
                  return (
                    <div className="p-3 bg-success/10 rounded-xl border border-success/25 text-success text-sm">
                      ✓ <strong>Plano 100% coberto pela entrada.</strong> O valor total será
                      baixado/quitado na contratação.
                    </div>
                  );
                }

                return (
                  <div className="space-y-2.5 pt-1">
                    <label className="text-xs font-semibold text-foreground/80 block">
                      Como será pago o saldo restante ({currency(b)})?
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Opção B: Pagamentos livres */}
                      <div
                        onClick={() => setRemainingModality("livre")}
                        className={cn(
                          "p-3 rounded-xl border-2 cursor-pointer transition-all space-y-1.5",
                          remainingModality === "livre"
                            ? "border-primary bg-primary-soft/50 shadow-xs"
                            : "border-border bg-card hover:border-input",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                            Pagamentos livres
                          </span>
                          <span
                            className={cn(
                              "h-4 w-4 rounded-full border-2 flex items-center justify-center text-xs",
                              remainingModality === "livre"
                                ? "border-primary bg-primary text-white"
                                : "border-input",
                            )}
                          >
                            {remainingModality === "livre" && "✓"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-tight">
                          Sem datas fixas. Paciente paga aos poucos nas visitas. Não gera cobranças
                          vencidas nem parcelas artificiais.
                        </p>
                      </div>

                      {/* Opção A: Parcelado com vencimentos */}
                      <div
                        onClick={() => setRemainingModality("parcelado")}
                        className={cn(
                          "p-3 rounded-xl border-2 cursor-pointer transition-all space-y-1.5",
                          remainingModality === "parcelado"
                            ? "border-primary bg-primary-soft/50 shadow-xs"
                            : "border-border bg-card hover:border-input",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                            Parcelas com vencimento
                          </span>
                          <span
                            className={cn(
                              "h-4 w-4 rounded-full border-2 flex items-center justify-center text-xs",
                              remainingModality === "parcelado"
                                ? "border-primary bg-primary text-white"
                                : "border-input",
                            )}
                          >
                            {remainingModality === "parcelado" && "✓"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-tight">
                          Datas e valores pré-definidos no calendário financeiro da clínica.
                        </p>
                      </div>
                    </div>

                    {/* Campos específicos da modalidade Parcelada */}
                    {remainingModality === "parcelado" && (
                      <div className="p-3 bg-card rounded-xl border border-border grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground">
                            Nº de Parcelas
                          </label>
                          <select
                            value={installmentsCount}
                            onChange={(e) => setInstallmentsCount(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border text-sm text-foreground outline-none focus:border-primary"
                          >
                            {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                              <option key={n} value={n}>
                                {n}x de {currency(b / n)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground">
                            1º Vencimento
                          </label>
                          <input
                            type="date"
                            required
                            value={firstDueDate}
                            onChange={(e) => setFirstDueDate(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border text-sm text-foreground outline-none focus:border-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground">
                            Forma Prevista
                          </label>
                          <select
                            value={remainingMethod}
                            onChange={(e) => setRemainingMethod(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border text-sm text-foreground outline-none focus:border-primary"
                          >
                            <option value="pix">Pix</option>
                            <option value="cartao_credito">Cartão de Crédito</option>
                            <option value="cartao_debito">Cartão de Débito</option>
                            <option value="boleto">Boleto Bancário</option>
                            <option value="dinheiro">Dinheiro</option>
                            <option value="transferencia">Transferência</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Objetivo Clínico */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">
                Objetivo Clínico / Procedimento
              </label>
              <input
                placeholder="Ex: Melhora do contorno facial, redução de rugas estáticas..."
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-soft">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-semibold shadow-sm transition-all cursor-pointer"
              >
                <Plus size={14} />
                <span>{isSaving ? "Salvando..." : "Criar Pacote"}</span>
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

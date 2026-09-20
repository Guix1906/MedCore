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
  X,
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
    bg: "bg-emerald-50 border-emerald-200",
    text: "text-emerald-700",
    icon: Activity,
  },
  pausado: {
    label: "Pausado",
    bg: "bg-amber-50 border-amber-200",
    text: "text-amber-700",
    icon: PauseCircle,
  },
  finalizado: {
    label: "Finalizado",
    bg: "bg-blue-50 border-blue-200",
    text: "text-blue-700",
    icon: CheckCircle2,
  },
  cancelado: {
    label: "Cancelado",
    bg: "bg-rose-50 border-rose-200",
    text: "text-rose-700",
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
            toast.info("Plano criado. As condições financeiras podem ser conferidas na aba Financeiro.");
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
                  (tx: any) => tx.installments?.number !== 0 && !tx.description?.includes("Entrada"),
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
      <div className="flex items-center justify-center py-20 text-slate-500 text-sm gap-2">
        <div className="h-4 w-4 rounded-full border-2 border-purple-600 border-t-transparent animate-spin" />
        <span>Carregando pacotes e tratamentos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100">
        <div>
          <h2 className="text-[17px] font-bold text-slate-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-purple-600" />
            Pacotes & Planos de Tratamento
          </h2>
          <p className="text-[13px] text-slate-500">
            Controle de protocolos contínuos, sessões contratadas e evolução clínica do paciente.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[13px] font-bold shadow-xs hover:shadow transition-all cursor-pointer shrink-0"
        >
          <Plus size={16} />
          <span>Novo Pacote / Tratamento</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
              Total de Pacotes
            </span>
            <div className="h-8 w-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Package size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900">{metrics.total}</p>
          <p className="text-[11.5px] text-slate-400">
            Valor total: <strong>{currency(metrics.totalValueSum)}</strong>
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-emerald-600 uppercase tracking-wider">
              Em Andamento
            </span>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Activity size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-600">{metrics.inProgress}</p>
          <p className="text-[11.5px] text-slate-400">Protocolos ativos no momento</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-blue-600 uppercase tracking-wider">
              Concluídos
            </span>
            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-blue-600">{metrics.completed}</p>
          <p className="text-[11.5px] text-slate-400">Tratamentos finalizados com sucesso</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl w-fit overflow-x-auto">
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
              "px-3.5 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap",
              statusFilter === filter.id
                ? "bg-white text-purple-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Treatments List */}
      <div className="space-y-3.5">
        {filteredTreatments.length === 0 ? (
          <div className="text-center py-16 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
            <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <p className="text-[14px] font-bold text-slate-700">Nenhum pacote registrado</p>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              {treatments.length === 0
                ? "Este paciente ainda não possui nenhum pacote ou acompanhamento clínico ativo."
                : "Nenhum pacote corresponde ao filtro selecionado."}
            </p>
            {treatments.length === 0 && (
              <button
                type="button"
                onClick={handleOpenModal}
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-purple-600 hover:underline cursor-pointer"
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
                className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-purple-200 transition-all space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h4 className="text-[15px] font-bold text-slate-900">{item.title}</h4>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border",
                            st.bg,
                            st.text,
                          )}
                        >
                          <StatusIcon size={12} />
                          <span>{st.label}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[12px] text-slate-500 mt-1 flex-wrap">
                        {item.doctors?.name && (
                          <span className="flex items-center gap-1">
                            <Stethoscope size={13} className="text-purple-600" />
                            <span>Dr(a). {item.doctors.name}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar size={13} className="text-slate-400" />
                          <span>
                            {formatClinicalDate(item.start_date)}
                            {item.end_date && ` → ${formatClinicalDate(item.end_date)}`}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">Valor Contratado</p>
                      <p className="text-[15px] font-black text-purple-700">
                        {currency(item.total_value)}
                      </p>
                      {item.installments_count > 1 && (
                        <p className="text-[11px] text-slate-400">
                          {item.installments_count}x de {currency(item.total_value / item.installments_count)}
                        </p>
                      )}
                    </div>

                    <Link
                      to={`/acompanhamentos/${item.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 text-[12.5px] font-bold transition-all cursor-pointer shrink-0"
                    >
                      <span>Abrir Acompanhamento</span>
                      <ChevronRight size={14} />
                    </Link>
                  </div>
                </div>

                {item.objective && (
                  <div className="p-3 bg-slate-50 rounded-xl text-[12.5px] text-slate-600 border border-slate-100">
                    <strong className="text-slate-800">Objetivo Clínico:</strong> {item.objective}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Novo Pacote / Tratamento */}
      {modalOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <Package size={18} />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-900">
                    Novo Pacote / Plano de Tratamento
                  </h3>
                  <p className="text-[12px] text-slate-500">
                    Vincular protocolo clínico ou pacote ao paciente
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTreatment} className="space-y-4">
              {/* Paciente Vinculado */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center gap-2.5 text-slate-700 text-[13px]">
                <User size={16} className="text-purple-600 shrink-0" />
                <span>
                  Paciente: <strong>{patientName}</strong>
                </span>
              </div>

              {/* Nome do Pacote/Tratamento */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-slate-700">
                  Nome do Pacote / Tratamento <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  placeholder="Ex: Harmonização Facial (5 sessões), Protocolo Capilar, Ortodontia..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                />
              </div>

              {/* Data de Início e Profissional */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">
                    Data de Início <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">
                    Profissional / Médico
                  </label>
                  <select
                    value={doctorId}
                    onChange={(e) => setDoctorId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
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
                <label className="text-[12px] font-bold text-slate-700">
                  Vigência do Plano de Acompanhamento
                </label>
                <select
                  value={protocolDays}
                  onChange={(e) => setProtocolDays(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
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
                    <label className="text-[12px] font-bold text-purple-700">
                      Data Final Acordada <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full mt-1 px-3.5 py-2.5 rounded-xl border border-purple-300 bg-purple-50/40 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                    />
                  </div>
                )}
              </div>

              {/* Condições Financeiras: Valores, Entrada, Parcelas e Forma */}
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Wallet size={14} className="text-purple-600" />
                    Condições Financeiras do Contrato
                  </span>
                  {(() => {
                    const v = parseFloat(totalValue.replace(/\./g, "").replace(",", ".")) || 0;
                    const d = parseFloat(downPayment.replace(/\./g, "").replace(",", ".")) || 0;
                    const b = Math.max(0, v - d);
                    return v > 0 ? (
                      <span className="text-[12px] font-bold text-slate-600">
                        Saldo a receber:{" "}
                        <strong className={b > 0 ? "text-purple-700" : "text-emerald-600"}>
                          {currency(b)}
                        </strong>
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <label className="text-[12px] font-bold text-slate-700">
                      Valor Total Contratado (R$) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      placeholder="0,00"
                      value={totalValue}
                      onChange={(e) => setTotalValue(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-[13px] text-slate-800 font-semibold focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[12px] font-bold text-slate-700">
                      Entrada / Pagamento Inicial (R$)
                    </label>
                    <input
                      placeholder="0,00 (opcional)"
                      value={downPayment}
                      onChange={(e) => setDownPayment(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-[13px] text-slate-800 font-semibold focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Bloco de Entrada detalhada quando informada */}
                {(() => {
                  const d = parseFloat(downPayment.replace(/\./g, "").replace(",", ".")) || 0;
                  if (d <= 0) return null;

                  return (
                    <div className="p-3.5 bg-white rounded-xl border border-purple-100 shadow-xs space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <label className="text-[12px] font-bold text-purple-900">
                          Situação da Entrada ({currency(d)})
                        </label>
                        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                          <button
                            type="button"
                            onClick={() => setDownStatus("received_now")}
                            className={cn(
                              "px-2.5 py-1 text-[11.5px] font-bold rounded-md transition-all cursor-pointer",
                              downStatus === "received_now"
                                ? "bg-emerald-600 text-white shadow-xs"
                                : "text-slate-600 hover:text-slate-900",
                            )}
                          >
                            ✓ Pagamento recebido agora
                          </button>
                          <button
                            type="button"
                            onClick={() => setDownStatus("pending")}
                            className={cn(
                              "px-2.5 py-1 text-[11.5px] font-bold rounded-md transition-all cursor-pointer",
                              downStatus === "pending"
                                ? "bg-amber-600 text-white shadow-xs"
                                : "text-slate-600 hover:text-slate-900",
                            )}
                          >
                            ⏳ Entrada prevista
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[11.5px] font-bold text-slate-600">
                            Forma de Pagamento da Entrada
                          </label>
                          <select
                            value={downMethod}
                            onChange={(e) => setDownMethod(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[12.5px] text-slate-800 outline-none focus:border-purple-600"
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
                            <label className="text-[11.5px] font-bold text-slate-600">
                              Conta de Destino da Baixa
                            </label>
                            <select
                              value={downAccountId}
                              onChange={(e) => setDownAccountId(e.target.value)}
                              className="w-full px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[12.5px] text-slate-800 outline-none focus:border-purple-600"
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
                            <label className="text-[11.5px] font-bold text-slate-600">
                              Previsão de Recebimento
                            </label>
                            <p className="text-[12px] text-slate-500 py-1.5">
                              Ficará pendente com vencimento na data inicial ({formatClinicalDate(startDate)}).
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
                      <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 text-[12.5px]">
                        ✓ <strong>Plano 100% coberto pela entrada.</strong> O valor total será baixado/quitado na contratação.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2.5 pt-1">
                      <label className="text-[12px] font-bold text-slate-700 block">
                        Como será pago o saldo restante ({currency(b)})?
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Opção B: Pagamentos livres */}
                        <div
                          onClick={() => setRemainingModality("livre")}
                          className={cn(
                            "p-3 rounded-xl border-2 cursor-pointer transition-all space-y-1.5",
                            remainingModality === "livre"
                              ? "border-purple-600 bg-purple-50/50 shadow-xs"
                              : "border-slate-200 bg-white hover:border-slate-300",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[12.5px] font-bold text-slate-900 flex items-center gap-1.5">
                              Pagamentos livres
                            </span>
                            <span
                              className={cn(
                                "h-4 w-4 rounded-full border-2 flex items-center justify-center text-[10px]",
                                remainingModality === "livre"
                                  ? "border-purple-600 bg-purple-600 text-white"
                                  : "border-slate-300",
                              )}
                            >
                              {remainingModality === "livre" && "✓"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-tight">
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
                              ? "border-purple-600 bg-purple-50/50 shadow-xs"
                              : "border-slate-200 bg-white hover:border-slate-300",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[12.5px] font-bold text-slate-900 flex items-center gap-1.5">
                              Parcelas com vencimento
                            </span>
                            <span
                              className={cn(
                                "h-4 w-4 rounded-full border-2 flex items-center justify-center text-[10px]",
                                remainingModality === "parcelado"
                                  ? "border-purple-600 bg-purple-600 text-white"
                                  : "border-slate-300",
                              )}
                            >
                              {remainingModality === "parcelado" && "✓"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-tight">
                            Datas e valores pré-definidos no calendário financeiro da clínica.
                          </p>
                        </div>
                      </div>

                      {/* Campos específicos da modalidade Parcelada */}
                      {remainingModality === "parcelado" && (
                        <div className="p-3 bg-white rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11.5px] font-bold text-slate-600">
                              Nº de Parcelas
                            </label>
                            <select
                              value={installmentsCount}
                              onChange={(e) => setInstallmentsCount(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[12.5px] text-slate-800 outline-none focus:border-purple-600"
                            >
                              {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                                <option key={n} value={n}>
                                  {n}x de {currency(b / n)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11.5px] font-bold text-slate-600">
                              1º Vencimento
                            </label>
                            <input
                              type="date"
                              required
                              value={firstDueDate}
                              onChange={(e) => setFirstDueDate(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[12.5px] text-slate-800 outline-none focus:border-purple-600"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11.5px] font-bold text-slate-600">
                              Forma Prevista
                            </label>
                            <select
                              value={remainingMethod}
                              onChange={(e) => setRemainingMethod(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[12.5px] text-slate-800 outline-none focus:border-purple-600"
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
                <label className="text-[12px] font-bold text-slate-700">
                  Objetivo Clínico / Procedimento
                </label>
                <input
                  placeholder="Ex: Melhora do contorno facial, redução de rugas estáticas..."
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[13px] font-bold shadow-sm transition-all cursor-pointer"
                >
                  <Plus size={14} />
                  <span>{isSaving ? "Salvando..." : "Criar Pacote"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

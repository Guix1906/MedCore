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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  currency,
  formatClinicalDate,
  localDate,
  PAYMENT_METHODS,
} from "@/features/acompanhamentos/followup-utils";
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

  // Form state for New Treatment / Package
  const [title, setTitle] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [startDate, setStartDate] = useState(localDate());
  const [protocolDays, setProtocolDays] = useState("90");
  const [totalValue, setTotalValue] = useState("");
  const [downPayment, setDownPayment] = useState("");
  const [installmentsCount, setInstallmentsCount] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState("pix");
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
    setStartDate(localDate());
    setProtocolDays("90");
    setTotalValue("");
    setDownPayment("");
    setInstallmentsCount("1");
    setPaymentMethod("pix");
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
      const startD = new Date(startDate);
      const days = Number(protocolDays) || 90;
      const endD = new Date(startD.getTime() + days * 86400000);
      const endDateStr = endD.toISOString().slice(0, 10);

      const val = parseFloat(totalValue.replace(/\./g, "").replace(",", ".")) || 0;
      const down = parseFloat(downPayment.replace(/\./g, "").replace(",", ".")) || 0;

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
        installments_count: Number(installmentsCount) || 1,
        payment_method: paymentMethod,
        color: "#8B47FF",
        status: "em_andamento",
        notes: notes.trim() || null,
      };

      const { data, error } = await supabase
        .from("treatments")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      await refetch();
      await qc.invalidateQueries({ queryKey: ["patient-clinical-history"] });
      await qc.invalidateQueries({ queryKey: ["treatments-list"] });

      toast.success("Pacote/Tratamento adicionado com sucesso!");
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

              {/* Médico Responsável & Duração */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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

                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">
                    Duração do Protocolo (dias)
                  </label>
                  <select
                    value={protocolDays}
                    onChange={(e) => setProtocolDays(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  >
                    <option value="30">30 dias (1 mês)</option>
                    <option value="60">60 dias (2 meses)</option>
                    <option value="90">90 dias (3 meses)</option>
                    <option value="180">180 dias (6 meses)</option>
                    <option value="365">365 dias (1 ano)</option>
                  </select>
                </div>
              </div>

              {/* Valores & Parcelas */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">Valor Total (R$)</label>
                  <input
                    placeholder="0,00"
                    value={totalValue}
                    onChange={(e) => setTotalValue(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">Entrada (R$)</label>
                  <input
                    placeholder="0,00"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">Parcelas</label>
                  <select
                    value={installmentsCount}
                    onChange={(e) => setInstallmentsCount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  >
                    {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </div>
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

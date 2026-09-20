import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wallet,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Receipt,
  Search,
  Building2,
  Calendar,
  DollarSign,
  User,
  X,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { remaining, titleStatus } from "@/features/finance/finance-math";
import type { FinancialTitle } from "@/features/finance/finance-schema";
import PaymentHistory from "@/features/finance/PaymentHistory";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
  moneyCents,
} from "@/features/acompanhamentos/followup-utils";
import { cn } from "@/lib/utils";

interface PatientFinanceTabProps {
  patientId: string;
  patientName: string;
}

export function PatientFinanceTab({ patientId, patientName }: PatientFinanceTabProps) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["financial-snapshot"],
    queryFn: getFinancialSnapshot,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "aberto" | "pago" | "vencido">("todos");
  const [selectedTitle, setSelectedTitle] = useState<FinancialTitle | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Form states for Novo Lançamento
  const [titleId, setTitleId] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<"receita" | "despesa">("receita");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(localDate());
  const [competenceDate, setCompetenceDate] = useState(localDate());
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Consulta / Procedimento");
  const [scope, setScope] = useState<string>("");
  const [payer, setPayer] = useState(patientName);
  const [isSaving, setIsSaving] = useState(false);

  const data = query.data;
  const scopes = data?.scopes || [];

  // Set default scope
  const activeScope = scope || (scopes[0]?.id || "legacy");

  // Filter titles for this patient
  const patientTitles = useMemo(() => {
    if (!data?.titles) return [];
    return data.titles.filter((t) => {
      const matchId = patientId && t.patient_id === patientId;
      const matchName =
        patientName &&
        t.patient_name &&
        t.patient_name.trim().toLowerCase() === patientName.trim().toLowerCase();
      return matchId || matchName;
    });
  }, [data?.titles, patientId, patientName]);

  // Compute metrics
  const metrics = useMemo(() => {
    let totalBilled = 0;
    let totalPaid = 0;
    let totalOpen = 0;

    for (const t of patientTitles) {
      if (t.status === "cancelado") continue;
      if (t.type === "receita") {
        totalBilled += Number(t.amount || 0);
        totalPaid += Number(t.paid_amount || 0);
        totalOpen += remaining(t);
      }
    }

    return { totalBilled, totalPaid, totalOpen };
  }, [patientTitles]);

  // Filtered titles by search and status
  const filteredTitles = useMemo(() => {
    const today = localDate();
    return patientTitles.filter((t) => {
      // Search
      if (search.trim()) {
        const queryTerm = search.toLowerCase();
        const desc = (t.description || "").toLowerCase();
        const cat = (t.category || "").toLowerCase();
        if (!desc.includes(queryTerm) && !cat.includes(queryTerm)) return false;
      }

      // Status
      if (statusFilter === "aberto") {
        return remaining(t) > 0 && t.status !== "cancelado" && t.due_date >= today;
      }
      if (statusFilter === "pago") {
        return remaining(t) <= 0 && t.status !== "cancelado";
      }
      if (statusFilter === "vencido") {
        return remaining(t) > 0 && t.status !== "cancelado" && t.due_date < today;
      }

      return true;
    });
  }, [patientTitles, search, statusFilter]);

  const handleOpenModal = () => {
    setTitleId(crypto.randomUUID());
    setType("receita");
    setAmount("");
    setDueDate(localDate());
    setCompetenceDate(localDate());
    setDescription("");
    setCategory("Consulta / Procedimento");
    setPayer(patientName);
    setScope(scopes[0]?.id || "legacy");
    setModalOpen(true);
  };

  const handleSaveTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = moneyCents(amount) / 100;
    if (val <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    if (!description.trim()) {
      toast.error("Informe a descrição do lançamento.");
      return;
    }

    setIsSaving(true);
    try {
      const companyId = activeScope === "legacy" ? null : activeScope;
      const { error } = await supabase.rpc("create_financial_title", {
        p_id: titleId,
        p_type: type,
        p_amount: val,
        p_due_date: dueDate,
        p_description: description.trim(),
        p_patient_id: patientId || null,
        p_payer_name: payer.trim() || patientName,
        p_category: category.trim() || null,
        p_competence_date: competenceDate || null,
        p_company_id: companyId,
      });

      if (error) throw error;

      await refreshFinance(qc);
      toast.success("Lançamento financeiro registrado com sucesso!");
      setModalOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (query.isPending) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500 text-sm gap-2">
        <div className="h-4 w-4 rounded-full border-2 border-purple-600 border-t-transparent animate-spin" />
        <span>Carregando extrato financeiro do paciente...</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center gap-2">
        <AlertCircle size={18} />
        <span>{errorMessage(query.error)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100">
        <div>
          <h2 className="text-[17px] font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-purple-600" />
            Extrato Financeiro do Paciente
          </h2>
          <p className="text-[13px] text-slate-500">
            Histórico de títulos a receber, baixas de pagamentos e pendências financeiras.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[13px] font-bold shadow-xs hover:shadow transition-all cursor-pointer shrink-0"
        >
          <Plus size={16} />
          <span>Novo Lançamento</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
              Total Cobrado
            </span>
            <div className="h-8 w-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Receipt size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900">{currency(metrics.totalBilled)}</p>
          <p className="text-[11.5px] text-slate-400">Total de serviços e tratamentos</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-emerald-600 uppercase tracking-wider">
              Total Pago
            </span>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-600">{currency(metrics.totalPaid)}</p>
          <p className="text-[11.5px] text-slate-400">Valores já liquidados/recebidos</p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-amber-600 uppercase tracking-wider">
              Saldo em Aberto
            </span>
            <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-amber-600">{currency(metrics.totalOpen)}</p>
          <p className="text-[11.5px] text-slate-400">Parcelas e títulos pendentes</p>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por descrição ou categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-[13px] bg-slate-50 rounded-xl border border-slate-200 focus:bg-white focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl w-full sm:w-auto overflow-x-auto">
          {(
            [
              { id: "todos", label: "Todos" },
              { id: "aberto", label: "Em aberto" },
              { id: "pago", label: "Pagos" },
              { id: "vencido", label: "Vencidos" },
            ] as const
          ).map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={cn(
                "px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap",
                statusFilter === filter.id
                  ? "bg-white text-purple-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Titles List */}
      <div className="space-y-3">
        {filteredTitles.length === 0 ? (
          <div className="text-center py-16 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
            <Receipt className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <p className="text-[14px] font-bold text-slate-700">Nenhum título financeiro encontrado</p>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              {patientTitles.length === 0
                ? "Este paciente ainda não possui cobranças ou receitas registradas."
                : "Nenhum título corresponde aos filtros aplicados."}
            </p>
            {patientTitles.length === 0 && (
              <button
                type="button"
                onClick={handleOpenModal}
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-purple-600 hover:underline cursor-pointer"
              >
                <Plus size={14} />
                <span>Registrar primeiro lançamento</span>
              </button>
            )}
          </div>
        ) : (
          filteredTitles.map((t) => {
            const isPaid = remaining(t) <= 0 && t.status !== "cancelado";
            const isCancelled = t.status === "cancelado";
            const isOverdue = !isPaid && !isCancelled && t.due_date < localDate();
            const isOpen = !isPaid && !isCancelled && !isOverdue;

            return (
              <div
                key={t.id}
                className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-xs hover:border-purple-200 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                      isPaid
                        ? "bg-emerald-50 text-emerald-600"
                        : isOverdue
                          ? "bg-rose-50 text-rose-600"
                          : isCancelled
                            ? "bg-slate-100 text-slate-400"
                            : "bg-purple-50 text-purple-600",
                    )}
                  >
                    {isPaid ? (
                      <CheckCircle2 size={18} />
                    ) : isOverdue ? (
                      <AlertCircle size={18} />
                    ) : isCancelled ? (
                      <XCircle size={18} />
                    ) : (
                      <ArrowDownLeft size={18} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-[14.5px] font-bold text-slate-900">
                        {t.description || "Lançamento sem descrição"}
                      </h4>
                      {/* Badge de status */}
                      <span
                        className={cn(
                          "px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider",
                          isPaid && "bg-emerald-100/70 text-emerald-700",
                          isOpen && "bg-blue-100/70 text-blue-700",
                          isOverdue && "bg-rose-100/70 text-rose-700",
                          isCancelled && "bg-slate-200 text-slate-600",
                        )}
                      >
                        {isPaid
                          ? "Pago"
                          : isOverdue
                            ? "Vencido"
                            : isCancelled
                              ? "Cancelado"
                              : "Em aberto"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[12px] text-slate-500 mt-1 flex-wrap">
                      <span>Vencimento: {formatClinicalDate(t.due_date)}</span>
                      {t.competence_date && (
                        <span>• Competência: {formatClinicalDate(t.competence_date)}</span>
                      )}
                      {t.category && <span>• Categoria: {t.category}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right">
                    <p className="text-[11px] font-bold text-slate-400 uppercase">Valor</p>
                    <p className="text-[15px] font-black text-slate-900">{currency(t.amount)}</p>
                    <p className="text-[11.5px] text-slate-500">
                      Liquidado:{" "}
                      <strong className="text-emerald-600">{currency(t.paid_amount)}</strong>
                      {remaining(t) > 0 && (
                        <span>
                          {" "}
                          • Saldo:{" "}
                          <strong className="text-amber-600">{currency(remaining(t))}</strong>
                        </span>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedTitle(t)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 text-[12.5px] font-bold transition-all cursor-pointer"
                  >
                    <Receipt size={14} />
                    <span>Baixas e Histórico</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Baixas & Histórico */}
      {selectedTitle && data && (
        <PaymentHistory
          title={selectedTitle}
          data={data}
          onClose={() => setSelectedTitle(null)}
        />
      )}

      {/* Modal de Novo Lançamento Financeiro */}
      {modalOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <Wallet size={18} />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-900">Novo Lançamento Financeiro</h3>
                  <p className="text-[12px] text-slate-500">Vincular cobrança ou título ao paciente</p>
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

            <form onSubmit={handleSaveTitle} className="space-y-4">
              {/* Paciente Vinculado (Informativo) */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center gap-2.5 text-slate-700 text-[13px]">
                <User size={16} className="text-purple-600 shrink-0" />
                <span>
                  Paciente: <strong>{patientName}</strong>
                </span>
              </div>

              {/* Valor & Vencimento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">
                    Valor (R$) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-slate-400">
                      R$
                    </span>
                    <input
                      required
                      inputMode="decimal"
                      placeholder="0,00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-[14px] font-bold text-slate-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">
                    Data de Vencimento <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Descrição */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-slate-700">
                  Descrição <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  placeholder="Ex: Consulta Médica, Aplicação Toxina Botulínica, Sessão 1..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                />
              </div>

              {/* Categoria & Competência */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">Categoria</label>
                  <input
                    placeholder="Ex: Consultas, Procedimentos, Exames..."
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-slate-700">Competência</label>
                  <input
                    type="date"
                    value={competenceDate}
                    onChange={(e) => setCompetenceDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Pagador / Responsável */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-slate-700">
                  Nome do Pagador / Responsável Financeiro
                </label>
                <input
                  placeholder="Nome do pagador..."
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
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
                  <span>{isSaving ? "Salvando..." : "Criar Lançamento"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

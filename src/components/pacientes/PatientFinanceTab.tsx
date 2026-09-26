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
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { isFreeBalance, remaining, titleStatus } from "@/features/finance/finance-math";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [statusFilter, setStatusFilter] = useState<
    "todos" | "aberto" | "pago" | "vencido" | "saldo_livre"
  >("todos");
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
  const activeScope = scope || scopes[0]?.id || "legacy";

  // Filter titles for this patient (estritamente por patientId para evitar homônimos)
  const patientTitles = useMemo(() => {
    if (!data?.titles) return [];
    return data.titles.filter((t) => {
      if (patientId) {
        return t.patient_id === patientId;
      }
      return (
        Boolean(patientName) &&
        Boolean(t.patient_name) &&
        t.patient_name!.trim().toLowerCase() === patientName.trim().toLowerCase()
      );
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
        return (
          remaining(t) > 0 && t.status !== "cancelado" && (isFreeBalance(t) || t.due_date >= today)
        );
      }
      if (statusFilter === "saldo_livre") {
        return remaining(t) > 0 && t.status !== "cancelado" && isFreeBalance(t);
      }
      if (statusFilter === "pago") {
        return remaining(t) <= 0 && t.status !== "cancelado";
      }
      if (statusFilter === "vencido") {
        return (
          remaining(t) > 0 && t.status !== "cancelado" && !isFreeBalance(t) && t.due_date < today
        );
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
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span>Carregando extrato financeiro do paciente...</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/25 text-destructive text-sm flex items-center gap-2">
        <AlertCircle size={18} />
        <span>{errorMessage(query.error)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border-soft">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Extrato Financeiro do Paciente
          </h2>
          <p className="text-sm text-muted-foreground">
            Histórico de títulos a receber, baixas de pagamentos e pendências financeiras.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenModal}
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-xs hover:shadow transition-all cursor-pointer shrink-0"
        >
          <span>Novo Lançamento</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Total Cobrado
            </span>
            <div className="h-8 w-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center">
              <Receipt size={16} />
            </div>
          </div>
          <p className="text-2xl font-semibold text-foreground">{currency(metrics.totalBilled)}</p>
          <p className="text-xs text-muted-foreground">Total de serviços e tratamentos</p>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-success uppercase tracking-wider">
              Total Pago
            </span>
            <div className="h-8 w-8 rounded-lg bg-success/10 text-success flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <p className="text-2xl font-semibold text-success">{currency(metrics.totalPaid)}</p>
          <p className="text-xs text-muted-foreground">Valores já liquidados/recebidos</p>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-warning uppercase tracking-wider">
              Saldo em Aberto
            </span>
            <div className="h-8 w-8 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
              <Clock size={16} />
            </div>
          </div>
          <p className="text-2xl font-semibold text-warning">{currency(metrics.totalOpen)}</p>
          <p className="text-xs text-muted-foreground">Parcelas e títulos pendentes</p>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Buscar por descrição ou categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-muted/60 rounded-xl border border-border focus:bg-card focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-muted rounded-xl w-full sm:w-auto overflow-x-auto">
          {(
            [
              { id: "todos", label: "Todos" },
              { id: "aberto", label: "Em aberto" },
              { id: "saldo_livre", label: "Saldos sem vencimento" },
              { id: "pago", label: "Pagos" },
              { id: "vencido", label: "Vencidos" },
            ] as const
          ).map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap",
                statusFilter === filter.id
                  ? "bg-card text-primary shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
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
          <div className="text-center py-16 bg-muted/36 rounded-2xl border border-dashed border-border">
            <Receipt className="h-10 w-10 text-muted-foreground/60 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground/80">
              Nenhum título financeiro encontrado
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {patientTitles.length === 0
                ? "Este paciente ainda não possui cobranças ou receitas registradas."
                : "Nenhum título corresponde aos filtros aplicados."}
            </p>
            {patientTitles.length === 0 && (
              <button
                type="button"
                onClick={handleOpenModal}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline cursor-pointer"
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
            const isFree = isFreeBalance(t);
            const isOverdue = !isPaid && !isCancelled && !isFree && t.due_date < localDate();
            const isOpen = !isPaid && !isCancelled && !isOverdue;

            return (
              <div
                key={t.id}
                className="p-4 rounded-2xl bg-card border border-border/90 shadow-xs hover:border-primary/25 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                      isPaid
                        ? "bg-success/10 text-success"
                        : isFree
                          ? "bg-primary-soft text-primary"
                          : isOverdue
                            ? "bg-destructive/10 text-destructive"
                            : isCancelled
                              ? "bg-muted text-muted-foreground"
                              : "bg-primary-soft text-primary",
                    )}
                  >
                    {isPaid ? (
                      <CheckCircle2 size={18} />
                    ) : isFree ? (
                      <Clock size={18} />
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
                      <h4 className="text-sm font-semibold text-foreground">
                        {t.description || "Lançamento sem descrição"}
                      </h4>
                      {/* Badge de status */}
                      <span
                        className={cn(
                          "px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider",
                          isPaid && "bg-success/11 text-success",
                          isFree && !isPaid && "bg-primary-soft/70 text-primary",
                          isOpen && !isFree && "bg-info/11 text-info",
                          isOverdue && "bg-destructive/11 text-destructive",
                          isCancelled && "bg-surface-2 text-muted-foreground",
                        )}
                      >
                        {isPaid
                          ? "Pago"
                          : isFree
                            ? "Saldo sem vencimento"
                            : isOverdue
                              ? "Vencido"
                              : isCancelled
                                ? "Cancelado"
                                : "Em aberto"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                      <span>
                        {isFree ? (
                          <strong className="text-primary font-semibold">
                            Sem vencimento fixo
                          </strong>
                        ) : (
                          `Vencimento: ${formatClinicalDate(t.due_date)}`
                        )}
                      </span>
                      {t.competence_date && (
                        <span>• Competência: {formatClinicalDate(t.competence_date)}</span>
                      )}
                      {t.category && <span>• Categoria: {t.category}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border-soft">
                  <div className="text-left md:text-right">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Valor</p>
                    <p className="text-[15px] font-semibold text-foreground">
                      {currency(t.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Liquidado: <strong className="text-success">{currency(t.paid_amount)}</strong>
                      {remaining(t) > 0 && (
                        <span>
                          {" "}
                          • Saldo:{" "}
                          <strong className="text-warning">{currency(remaining(t))}</strong>
                        </span>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedTitle(t)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer",
                      isFree && remaining(t) > 0
                        ? "bg-primary hover:bg-primary-hover text-white shadow-xs"
                        : "bg-primary-soft hover:bg-primary-soft text-primary",
                    )}
                  >
                    <Receipt size={14} />
                    <span>
                      {isFree && remaining(t) > 0 ? "Receber Pagamento" : "Baixas e Histórico"}
                    </span>
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
          title={data.titles.find((t) => t.id === selectedTitle.id) || selectedTitle}
          data={data}
          onClose={() => setSelectedTitle(null)}
        />
      )}

      {/* Modal de Novo Lançamento Financeiro */}
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
              <Wallet size={18} />
            </div>
            <div>
              <DialogTitle className="text-base">Novo Lançamento Financeiro</DialogTitle>
              <DialogDescription className="text-xs">
                Vincular cobrança ou título ao paciente
              </DialogDescription>
            </div>
          </DialogHeader>

          <form onSubmit={handleSaveTitle} className="space-y-4">
            {/* Paciente Vinculado (Informativo) */}
            <div className="p-3 bg-muted/60 rounded-xl border border-border/80 flex items-center gap-2.5 text-foreground/80 text-sm">
              <User size={16} className="text-primary shrink-0" />
              <span>
                Paciente: <strong>{patientName}</strong>
              </span>
            </div>

            {/* Valor & Vencimento */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">
                  Valor (R$) <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                    R$
                  </span>
                  <input
                    required
                    inputMode="decimal"
                    placeholder="0,00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-border text-sm font-semibold text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">
                  Data de Vencimento <span className="text-destructive">*</span>
                </label>
                <input
                  required
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                />
              </div>
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">
                Descrição <span className="text-destructive">*</span>
              </label>
              <input
                required
                placeholder="Ex: Consulta Médica, Aplicação Toxina Botulínica, Sessão 1..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
              />
            </div>

            {/* Categoria & Competência */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">Categoria</label>
                <input
                  placeholder="Ex: Consultas, Procedimentos, Exames..."
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">Competência</label>
                <input
                  type="date"
                  value={competenceDate}
                  onChange={(e) => setCompetenceDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
                />
              </div>
            </div>

            {/* Pagador / Responsável */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">
                Nome do Pagador / Responsável Financeiro
              </label>
              <input
                placeholder="Nome do pagador..."
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
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
                <span>{isSaving ? "Salvando..." : "Criar Lançamento"}</span>
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

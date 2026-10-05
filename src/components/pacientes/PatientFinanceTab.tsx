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
  HelpCircle,
  Info,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
    "todos" | "a_receber" | "aberto" | "pago" | "vencido"
  >("todos");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
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
    const today = localDate();
    let totalBilled = 0;
    let totalPaid = 0;
    let totalOpen = 0;
    let totalToReceive = 0;
    let totalOverdue = 0;

    for (const t of patientTitles) {
      if (t.status === "cancelado") continue;
      if (t.type === "receita") {
        const rest = remaining(t);
        totalBilled += Number(t.amount || 0);
        totalPaid += Number(t.paid_amount || 0);
        totalOpen += rest;
        if (rest > 0 && !isFreeBalance(t) && t.due_date < today) totalOverdue += rest;
        else totalToReceive += rest;
      }
    }

    return { totalBilled, totalPaid, totalOpen, totalToReceive, totalOverdue };
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
      if (statusFilter === "a_receber") {
        return (
          remaining(t) > 0 && t.status !== "cancelado" && (isFreeBalance(t) || t.due_date >= today)
        );
      }
      if (statusFilter === "aberto") {
        return remaining(t) > 0 && t.status !== "cancelado";
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

  const pageCount = Math.max(1, Math.ceil(filteredTitles.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTitles = filteredTitles.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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

      {/* Busca */}
      <div className="flex justify-end">
        <div className="relative w-full sm:w-80">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Buscar"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 text-sm bg-card rounded-xl border border-border focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all"
          />
        </div>
      </div>

      {/* Indicadores (clique para filtrar) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 rounded-2xl border border-border bg-card overflow-hidden">
        {(
          [
            { id: "pago", label: "Realizado", dot: "bg-success", tone: "border-success from-success/0 to-success/12", value: metrics.totalPaid, help: "Valores já recebidos do paciente." },
            { id: "a_receber", label: "A receber", dot: "bg-info", tone: "border-info from-info/0 to-info/12", value: metrics.totalToReceive, help: "Saldos pendentes que ainda não venceram." },
            { id: "aberto", label: "Em aberto", dot: "bg-warning", tone: "border-warning from-warning/0 to-warning/12", value: metrics.totalOpen, help: "Todo saldo pendente, vencido ou não." },
            { id: "vencido", label: "Em atraso", dot: "bg-destructive", tone: "border-destructive from-destructive/0 to-destructive/12", value: metrics.totalOverdue, help: "Saldos pendentes com vencimento passado." },
            { id: "todos", label: "Total do período", dot: "bg-primary", tone: "border-primary from-primary/0 to-primary/12", value: metrics.totalBilled, help: "Soma de todas as cobranças não canceladas." },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setStatusFilter(m.id);
              setPage(1);
            }}
            className={cn(
              "group/metric relative text-left px-5 py-4 transition-colors cursor-pointer",
              m.tone,
            )}
          >
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 bg-gradient-to-b border-b-[3px] transition-opacity duration-300",
                m.tone,
                statusFilter === m.id ? "opacity-100" : "opacity-0 group-hover/metric:opacity-100",
              )}
            />
            <span className="relative flex items-center gap-2 text-sm text-foreground/80">
              <span className={cn("h-2 w-2 rounded-full", m.dot)} />
              {m.label}
              <span title={m.help} className="text-muted-foreground cursor-help">
                <HelpCircle size={14} />
              </span>
            </span>
            <span className="relative mt-1 block pl-4 text-lg font-semibold text-foreground">
              {currency(m.value)}
            </span>
          </button>
        ))}
      </div>
      {/* Titles List */}
      <div className="space-y-3">
        {filteredTitles.length === 0 ? (
          <div className="text-center py-16 bg-muted/36 rounded-2xl border border-dashed border-border">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Info size={20} />
            </div>
            <p className="text-[15px] font-semibold text-foreground">Hmm, está vazio por aqui!</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {patientTitles.length === 0
                ? "Nenhum registro encontrado."
                : "Nenhum registro encontrado para os filtros aplicados."}
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
          pagedTitles.map((t) => {
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

      {/* Paginação */}
      <div className="flex items-center justify-between gap-3">
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary cursor-pointer"
          aria-label="Itens por página"
        >
          {[10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n} por página
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">
            {currentPage} de {pageCount}
          </span>
          {(
            [
              { icon: ChevronsLeft, to: 1, label: "Primeira página", off: currentPage <= 1 },
              { icon: ChevronLeft, to: currentPage - 1, label: "Página anterior", off: currentPage <= 1 },
              { icon: ChevronRight, to: currentPage + 1, label: "Próxima página", off: currentPage >= pageCount },
              { icon: ChevronsRight, to: pageCount, label: "Última página", off: currentPage >= pageCount },
            ] as const
          ).map(({ icon: Icon, to, label, off }) => (
            <button
              key={label}
              type="button"
              disabled={off}
              onClick={() => setPage(to)}
              aria-label={label}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground hover:bg-primary-soft hover:text-primary disabled:opacity-50 disabled:hover:bg-muted disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-not-allowed"
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
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

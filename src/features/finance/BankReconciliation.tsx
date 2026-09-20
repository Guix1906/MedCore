import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  FileText,
  RotateCw,
  Upload,
  Info,
  Calendar,
  Search,
  CheckCircle2,
  Clock,
  Check,
  X,
  Trash2,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Building2,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import type { OperationsSnapshot } from "./operations-schema";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import { readOfxFile } from "./ofx";

export interface OfxBatchLine {
  id: string;
  external_id: string;
  date: string;
  amount: number;
  description: string;
  reconciled: boolean;
  ignored?: boolean;
  matched_title_id?: string;
  matched_title_name?: string;
  notes?: string;
}

export interface OfxBatch {
  id: string;
  fileName: string;
  importedAt: string;
  importMonth: string; // YYYY-MM
  bank: string;
  account: string;
  targetAccountId?: string;
  periodStart: string;
  periodEnd: string;
  status: "em_andamento" | "finalizada";
  lines: OfxBatchLine[];
  totalCredits: number;
  totalDebits: number;
}

const STORAGE_KEY = "medcore_ofx_batches_v1";

function formatMonthLabel(monthValue: string): string {
  if (!monthValue || !monthValue.includes("-")) return "----- de ----";
  const [year, month] = monthValue.split("-");
  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const idx = Number.parseInt(month, 10) - 1;
  const name = monthNames[idx] || month;
  return `${name} de ${year}`;
}

export default function BankReconciliation({
  finance,
  ops,
  onOpenTitles,
  onRefresh,
  refreshing,
}: {
  finance: FinanceSnapshot;
  ops?: OperationsSnapshot;
  onOpenTitles?: (type: FinancialTitle["type"]) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [batches, setBatches] = useState<OfxBatch[]>([]);
  const [statusFilter, setStatusFilter] = useState<"todas" | "em_andamento" | "finalizadas">("todas");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [isRefreshingLocal, setIsRefreshingLocal] = useState(false);

  // Import Dialog State
  const [importOpen, setImportOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetAccount, setTargetAccount] = useState<string>("");
  const [isReadingOfx, setIsReadingOfx] = useState(false);
  const [ofxPreview, setOfxPreview] = useState<Awaited<ReturnType<typeof readOfxFile>> | null>(null);
  const [parseError, setParseError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active Batch Conference Modal State
  const [activeBatch, setActiveBatch] = useState<OfxBatch | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [lineFilter, setLineFilter] = useState<"todas" | "pendentes" | "conferidas" | "ignoradas">("todas");

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setBatches(parsed);
        }
      }
    } catch {
      // ignore parse error
    }
  }, []);

  // Save to localStorage
  const saveBatches = (newBatches: OfxBatch[]) => {
    setBatches(newBatches);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newBatches));
    } catch {
      // ignore
    }
  };

  const handleRefresh = () => {
    setIsRefreshingLocal(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setBatches(parsed);
        }
      }
    } catch {
      // ignore
    }
    onRefresh?.();
    setTimeout(() => {
      setIsRefreshingLocal(false);
      toast.success("Dados atualizados com sucesso.");
    }, 400);
  };

  // Handle OFX file selection
  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    setIsReadingOfx(true);
    setParseError("");
    setOfxPreview(null);
    try {
      const parsed = await readOfxFile(file);
      setOfxPreview(parsed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao ler arquivo OFX.";
      setParseError(msg);
    } finally {
      setIsReadingOfx(false);
    }
  };

  // Confirm Import
  const handleConfirmImport = () => {
    if (!ofxPreview || !selectedFile) return;

    const now = new Date();
    const importMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const sortedLines = [...ofxPreview.lines].sort((a, b) => a.date.localeCompare(b.date));
    const periodStart = sortedLines[0]?.date ?? "";
    const periodEnd = sortedLines[sortedLines.length - 1]?.date ?? "";

    let totalCredits = 0;
    let totalDebits = 0;

    const lines: OfxBatchLine[] = ofxPreview.lines.map((l, index) => {
      if (l.amount > 0) totalCredits += l.amount;
      else totalDebits += Math.abs(l.amount);

      return {
        id: l.external_id || `line-${index}-${Date.now()}`,
        external_id: l.external_id,
        date: l.date,
        amount: l.amount,
        description: l.description,
        reconciled: false,
      };
    });

    const newBatch: OfxBatch = {
      id: `batch-${Date.now()}`,
      fileName: selectedFile.name,
      importedAt: now.toISOString(),
      importMonth,
      bank: ofxPreview.bank || "Banco não informado",
      account: ofxPreview.account || "Conta não identificada",
      targetAccountId: targetAccount || undefined,
      periodStart,
      periodEnd,
      status: "em_andamento",
      lines,
      totalCredits,
      totalDebits,
    };

    const updated = [newBatch, ...batches];
    saveBatches(updated);
    toast.success(`Extrato importado com sucesso! ${lines.length} lançamentos extraídos.`);
    setImportOpen(false);
    setSelectedFile(null);
    setOfxPreview(null);
    setTargetAccount("");
    // Open for conference immediately
    setActiveBatch(newBatch);
  };

  // Batch actions
  const handleDeleteBatch = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Deseja realmente excluir este lote de conferência local?")) return;
    const updated = batches.filter((b) => b.id !== id);
    saveBatches(updated);
    if (activeBatch?.id === id) setActiveBatch(null);
    toast.info("Lote de conferência removido.");
  };

  const handleToggleBatchStatus = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = batches.map((b) => {
      if (b.id === id) {
        const nextStatus = b.status === "finalizada" ? "em_andamento" : "finalizada";
        return { ...b, status: nextStatus as "em_andamento" | "finalizada" };
      }
      return b;
    });
    saveBatches(updated);
    if (activeBatch?.id === id) {
      setActiveBatch(updated.find((b) => b.id === id) || null);
    }
  };

  // Line actions in active batch
  const handleToggleLineReconciled = (lineId: string) => {
    if (!activeBatch) return;
    const updatedLines = activeBatch.lines.map((l) => {
      if (l.id === lineId) {
        return { ...l, reconciled: !l.reconciled, ignored: false };
      }
      return l;
    });

    const isAllDone = updatedLines.every((l) => l.reconciled || l.ignored);
    const updatedBatch: OfxBatch = {
      ...activeBatch,
      lines: updatedLines,
      status: isAllDone ? "finalizada" : activeBatch.status,
    };

    setActiveBatch(updatedBatch);
    saveBatches(batches.map((b) => (b.id === updatedBatch.id ? updatedBatch : b)));
  };

  const handleToggleLineIgnored = (lineId: string) => {
    if (!activeBatch) return;
    const updatedLines = activeBatch.lines.map((l) => {
      if (l.id === lineId) {
        return { ...l, ignored: !l.ignored, reconciled: false };
      }
      return l;
    });

    const isAllDone = updatedLines.every((l) => l.reconciled || l.ignored);
    const updatedBatch: OfxBatch = {
      ...activeBatch,
      lines: updatedLines,
      status: isAllDone ? "finalizada" : activeBatch.status,
    };

    setActiveBatch(updatedBatch);
    saveBatches(batches.map((b) => (b.id === updatedBatch.id ? updatedBatch : b)));
  };

  const handleMarkAllLines = (reconciled: boolean) => {
    if (!activeBatch) return;
    const updatedLines = activeBatch.lines.map((l) => ({
      ...l,
      reconciled,
      ignored: false,
    }));
    const updatedBatch: OfxBatch = {
      ...activeBatch,
      lines: updatedLines,
      status: reconciled ? "finalizada" : "em_andamento",
    };
    setActiveBatch(updatedBatch);
    saveBatches(batches.map((b) => (b.id === updatedBatch.id ? updatedBatch : b)));
    toast.success(
      reconciled ? "Todos os lançamentos foram marcados como conferidos." : "Conferência desfeita."
    );
  };

  // Filtered batches
  const filteredBatches = useMemo(() => {
    return batches.filter((b) => {
      if (statusFilter === "em_andamento" && b.status !== "em_andamento") return false;
      if (statusFilter === "finalizadas" && b.status !== "finalizada") return false;
      if (selectedMonth) {
        const matchesMonth =
          b.importMonth === selectedMonth ||
          b.importedAt.startsWith(selectedMonth) ||
          b.periodStart.startsWith(selectedMonth);
        if (!matchesMonth) return false;
      }
      return true;
    });
  }, [batches, statusFilter, selectedMonth]);

  // Suggestion helper for active batch
  const findSuggestion = (line: OfxBatchLine) => {
    const lineDate = line.date;
    const lineAmount = Math.abs(line.amount);
    const isCredit = line.amount > 0;

    // Check system titles
    const match = finance.titles.find((t) => {
      const typeMatch = isCredit ? t.type === "receita" : t.type === "despesa";
      if (!typeMatch) return false;
      const titleAmount = Math.abs(t.amount);
      const titlePaid = Math.abs(t.paid_amount);
      const amountMatch =
        Math.abs(titleAmount - lineAmount) < 0.05 || Math.abs(titlePaid - lineAmount) < 0.05;
      const dateMatch = t.due_date === lineDate || t.date === lineDate;
      return amountMatch && (dateMatch || Math.abs(titleAmount - lineAmount) < 0.01);
    });

    return match;
  };

  return (
    <div className="space-y-4">
      {/* Header matching media_1789940209124.png exactly */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50/80 text-blue-600 shadow-xs">
            <FileSpreadsheet className="h-6 w-6 stroke-[1.75]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Conferência OFX
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {batches.length} lote(s) · Importe seus arquivos bancários (.OFX) para conciliação das contas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Atualizar dados"
            onClick={handleRefresh}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900 active:scale-95"
          >
            <RotateCw
              className={cn(
                "h-4 w-4 transition-transform",
                (refreshing || isRefreshingLocal) && "animate-spin text-blue-600"
              )}
            />
          </button>
          <Button
            type="button"
            onClick={() => {
              setImportOpen(true);
              setSelectedFile(null);
              setOfxPreview(null);
              setParseError("");
            }}
            className="flex h-9 items-center gap-2 rounded-xl bg-[#5046e5] px-4 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#4338ca] active:scale-95"
          >
            <Upload className="h-4 w-4" />
            <span>Importar extratos</span>
          </Button>
        </div>
      </div>

      {/* Informational Banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-[#eff6ff] p-4 text-left shadow-xs">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-blue-950 sm:text-sm">
            Conciliação e conferência de extratos OFX
          </h4>
          <p className="text-xs leading-relaxed text-blue-900/80">
            O assistente lê e extrai os lançamentos do arquivo .ofx para conferência manual. As
            conferências ficam salvas apenas neste navegador, não comprovam vínculo com lançamentos
            do sistema e não alteram automaticamente o saldo das contas bancárias nem liquidam
            baixas diretas no banco de dados.
          </p>
        </div>
      </div>

      {/* Filters and Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Status segmented pills */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200/70 bg-slate-100/90 p-1 shadow-2xs">
          {(
            [
              { id: "todas", label: "Todas" },
              { id: "em_andamento", label: "Em andamento" },
              { id: "finalizadas", label: "Finalizadas" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all",
                statusFilter === tab.id
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Month selector with exact ----- de ---- display */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">Mês da Importação</span>
          <div className="relative">
            <div className="flex h-9 min-w-[170px] items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-xs">
              <span className={cn(!selectedMonth && "text-slate-400 font-mono")}>
                {selectedMonth ? formatMonthLabel(selectedMonth) : "----- de ----"}
              </span>
              <div className="flex items-center gap-1">
                {selectedMonth && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMonth("");
                    }}
                    className="rounded-full p-0.5 text-slate-400 hover:text-slate-600"
                    title="Limpar filtro de mês"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <Calendar className="h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            </div>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
              title="Filtrar por mês da importação"
            />
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-3.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            LOTES DE CONFERÊNCIA LOCAL ({filteredBatches.length})
          </h3>
          {filteredBatches.length > 0 && (
            <span className="text-xs text-slate-400">
              {filteredBatches.filter((b) => b.status === "finalizada").length} de{" "}
              {filteredBatches.length} finalizado(s)
            </span>
          )}
        </div>

        {filteredBatches.length === 0 ? (
          /* Empty State exactly matching media_1789940209124.png */
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <FileSpreadsheet className="h-12 w-12 text-slate-300 stroke-[1.25]" />
            <h4 className="mt-3 text-base font-semibold text-slate-800">
              Nenhum extrato OFX importado
            </h4>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              Clique em "Importar extratos" para carregar seus arquivos bancários e iniciar a conferência local.
            </p>
          </div>
        ) : (
          /* Batches list */
          <div className="divide-y divide-slate-100">
            {filteredBatches.map((batch) => {
              const totalLines = batch.lines.length;
              const reconciledCount = batch.lines.filter((l) => l.reconciled).length;
              const ignoredCount = batch.lines.filter((l) => l.ignored).length;
              const progressPct =
                totalLines > 0 ? Math.round(((reconciledCount + ignoredCount) / totalLines) * 100) : 0;
              const targetAcc = finance.accounts.find((a) => a.id === batch.targetAccountId);

              return (
                <div
                  key={batch.id}
                  onClick={() => setActiveBatch(batch)}
                  className="flex flex-col gap-4 p-5 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between cursor-pointer"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-slate-900 truncate">
                        {batch.fileName}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "rounded-md text-[11px] font-medium",
                          batch.status === "finalizada"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        )}
                      >
                        {batch.status === "finalizada" ? "Finalizada" : "Em andamento"}
                      </Badge>
                      {targetAcc && (
                        <Badge variant="outline" className="text-[11px] text-slate-600">
                          {targetAcc.name}
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>
                        Banco: <strong className="text-slate-700">{batch.bank}</strong>
                      </span>
                      <span>
                        Conta: <strong className="text-slate-700">{batch.account}</strong>
                      </span>
                      <span>
                        Período:{" "}
                        <strong className="text-slate-700">
                          {formatClinicalDate(batch.periodStart)} a {formatClinicalDate(batch.periodEnd)}
                        </strong>
                      </span>
                      <span>
                        Importado:{" "}
                        <strong className="text-slate-700">
                          {new Date(batch.importedAt).toLocaleDateString("pt-BR")}{" "}
                          {new Date(batch.importedAt).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </strong>
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="pt-1 flex items-center gap-3 max-w-md">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            batch.status === "finalizada" ? "bg-emerald-500" : "bg-blue-600"
                          )}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap">
                        {reconciledCount} de {totalLines} conferidos ({progressPct}%)
                      </span>
                    </div>
                  </div>

                  {/* Right side sums and buttons */}
                  <div className="flex flex-wrap items-center gap-4 sm:flex-col sm:items-end">
                    <div className="flex items-center gap-3 text-xs">
                      <div className="text-emerald-600 font-medium">
                        + {currency(batch.totalCredits)}
                      </div>
                      <div className="text-rose-600 font-medium">
                        - {currency(batch.totalDebits)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveBatch(batch)}
                        className="h-8 gap-1 rounded-lg text-xs font-semibold text-blue-600 border-blue-200 hover:bg-blue-50"
                      >
                        <span>Conferir</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={
                          batch.status === "finalizada"
                            ? "Reabrir conferência"
                            : "Marcar como finalizada"
                        }
                        onClick={(e) => handleToggleBatchStatus(batch.id, e)}
                        className="h-8 w-8 p-0 text-slate-500 hover:text-slate-800"
                      >
                        {batch.status === "finalizada" ? (
                          <RotateCw className="h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Excluir lote"
                        onClick={(e) => handleDeleteBatch(batch.id, e)}
                        className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Import OFX Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Importar extrato OFX
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Selecione o arquivo .OFX exportado do seu banco (até 2 MB). Os lançamentos serão extraídos para conferência local.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* File drop / picker */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-colors text-center",
                selectedFile
                  ? "border-blue-400 bg-blue-50/40"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-50"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".ofx,application/x-ofx,text/plain"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0])}
              />
              <Upload className="h-8 w-8 text-blue-600 stroke-[1.5]" />
              <p className="mt-2 text-xs font-semibold text-slate-800">
                {selectedFile ? selectedFile.name : "Clique para selecionar o arquivo .OFX"}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB`
                  : "Formatos suportados: .ofx gerados por bancos brasileiros em BRL"}
              </p>
            </div>

            {/* Account linking */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Vincular à conta bancária no sistema (opcional)
              </label>
              <select
                value={targetAccount}
                onChange={(e) => setTargetAccount(e.target.value)}
                className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Sem vinculação direta</option>
                {finance.accounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.type})
                    </option>
                  ))}
              </select>
            </div>

            {isReadingOfx && (
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <RotateCw className="h-4 w-4 animate-spin" />
                <span>Processando extrato OFX...</span>
              </div>
            )}

            {parseError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            {ofxPreview && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Banco detectado:</span>
                  <strong className="text-slate-900">{ofxPreview.bank || "Não informado"}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Conta do arquivo:</span>
                  <strong className="text-slate-900">{ofxPreview.account}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Lançamentos encontrados:</span>
                  <strong className="text-slate-900">{ofxPreview.lines.length} movimentos</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Período:</span>
                  <strong className="text-slate-900">
                    {formatClinicalDate(
                      [...ofxPreview.lines].sort((a, b) => a.date.localeCompare(b.date))[0]?.date
                    )}{" "}
                    a{" "}
                    {formatClinicalDate(
                      [...ofxPreview.lines].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
                    )}
                  </strong>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportOpen(false)}
              className="rounded-xl text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!ofxPreview || isReadingOfx}
              onClick={handleConfirmImport}
              className="rounded-xl bg-[#5046e5] hover:bg-[#4338ca] text-white text-xs font-semibold"
            >
              Importar e Iniciar Conferência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conference Modal / Drawer for Active Batch */}
      {activeBatch && (
        <Dialog open={!!activeBatch} onOpenChange={(open) => !open && setActiveBatch(null)}>
          <DialogContent className="sm:max-w-4xl max-h-[92vh] flex flex-col p-0 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900">
                      Conferência: {activeBatch.fileName}
                    </h2>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "rounded-md text-[11px]",
                        activeBatch.status === "finalizada"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      )}
                    >
                      {activeBatch.status === "finalizada" ? "Finalizada" : "Em andamento"}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Banco: <strong>{activeBatch.bank}</strong> · Conta: <strong>{activeBatch.account}</strong> · Período:{" "}
                    <strong>
                      {formatClinicalDate(activeBatch.periodStart)} a {formatClinicalDate(activeBatch.periodEnd)}
                    </strong>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMarkAllLines(true)}
                    className="h-8 text-xs font-semibold rounded-lg text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Marcar todos conferidos
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMarkAllLines(false)}
                    className="h-8 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-50"
                  >
                    Desmarcar todos
                  </Button>
                </div>
              </div>

              {/* Progress & Quick stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <div className="bg-slate-50 rounded-xl p-3">
                  <span className="text-[11px] text-slate-500">Total de movimentos</span>
                  <p className="text-base font-bold text-slate-900">{activeBatch.lines.length}</p>
                </div>
                <div className="bg-emerald-50/60 rounded-xl p-3">
                  <span className="text-[11px] text-emerald-700">Conferidos</span>
                  <p className="text-base font-bold text-emerald-700">
                    {activeBatch.lines.filter((l) => l.reconciled).length}
                  </p>
                </div>
                <div className="bg-amber-50/60 rounded-xl p-3">
                  <span className="text-[11px] text-amber-700">Pendentes</span>
                  <p className="text-base font-bold text-amber-700">
                    {activeBatch.lines.filter((l) => !l.reconciled && !l.ignored).length}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <span className="text-[11px] text-slate-500">Ignorados</span>
                  <p className="text-base font-bold text-slate-600">
                    {activeBatch.lines.filter((l) => l.ignored).length}
                  </p>
                </div>
              </div>

              {/* Filter & Search inside batch */}
              <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-100">
                <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100/70 p-0.5">
                  {(
                    [
                      { id: "todas", label: "Todas" },
                      { id: "pendentes", label: "Pendentes" },
                      { id: "conferidas", label: "Conferidas" },
                      { id: "ignoradas", label: "Ignoradas" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setLineFilter(f.id)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        lineFilter === f.id
                          ? "bg-white text-slate-900 shadow-2xs font-semibold"
                          : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="Buscar na descrição ou valor..."
                    value={lineSearch}
                    onChange={(e) => setLineSearch(e.target.value)}
                    className="h-8 pl-8 text-xs rounded-xl"
                  />
                </div>
              </div>
            </div>

            {/* Scrollable list of lines */}
            <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
              {activeBatch.lines
                .filter((l) => {
                  if (lineFilter === "pendentes" && (l.reconciled || l.ignored)) return false;
                  if (lineFilter === "conferidas" && !l.reconciled) return false;
                  if (lineFilter === "ignoradas" && !l.ignored) return false;
                  if (lineSearch) {
                    const q = lineSearch.toLowerCase();
                    const matchDesc = l.description.toLowerCase().includes(q);
                    const matchAmount = l.amount.toString().includes(q);
                    const matchId = l.external_id.toLowerCase().includes(q);
                    if (!matchDesc && !matchAmount && !matchId) return false;
                  }
                  return true;
                })
                .map((line) => {
                  const suggestion = findSuggestion(line);
                  return (
                    <div
                      key={line.id}
                      className={cn(
                        "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-colors",
                        line.reconciled
                          ? "bg-emerald-50/30 border-emerald-200/80"
                          : line.ignored
                            ? "bg-slate-50 border-slate-200 opacity-60"
                            : "bg-white border-slate-200/80 hover:border-slate-300 shadow-2xs"
                      )}
                    >
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-800">
                            {formatClinicalDate(line.date)}
                          </span>
                          <span className="text-xs text-slate-700 font-medium truncate">
                            {line.description}
                          </span>
                          {line.external_id && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              ID: {line.external_id}
                            </span>
                          )}
                        </div>

                        {/* System match suggestion */}
                        {suggestion && (
                          <div className="flex items-center gap-1.5 text-[11px] text-blue-700 bg-blue-50/70 px-2.5 py-1 rounded-lg border border-blue-100 max-w-fit">
                            <Info className="h-3 w-3 shrink-0" />
                            <span>
                              Sugestão no sistema: <strong>{suggestion.description || suggestion.category || "Título"}</strong> ({currency(suggestion.amount)})
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Amount and actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <span
                          className={cn(
                            "text-xs sm:text-sm font-bold tabular-nums",
                            line.amount > 0 ? "text-emerald-600" : "text-rose-600"
                          )}
                        >
                          {line.amount > 0 ? "+" : ""} {currency(line.amount)}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => handleToggleLineReconciled(line.id)}
                            className={cn(
                              "h-7 px-2.5 rounded-lg text-xs font-medium transition-all",
                              line.reconciled
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                : "bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200"
                            )}
                          >
                            <Check className="h-3 w-3 mr-1" />
                            {line.reconciled ? "Conferido" : "Conferir"}
                          </Button>

                          <Button
                            size="sm"
                            type="button"
                            variant="ghost"
                            onClick={() => handleToggleLineIgnored(line.id)}
                            className={cn(
                              "h-7 px-2 rounded-lg text-xs",
                              line.ignored
                                ? "text-slate-900 bg-slate-200"
                                : "text-slate-400 hover:text-slate-600"
                            )}
                            title={line.ignored ? "Restaurar" : "Ignorar movimento"}
                          >
                            Ignorar
                          </Button>

                          {onOpenTitles && !line.reconciled && (
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                setActiveBatch(null);
                                onOpenTitles(line.amount > 0 ? "receita" : "despesa");
                              }}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-blue-600"
                              title={`Localizar conta a ${line.amount > 0 ? "receber" : "pagar"}`}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

              {activeBatch.lines.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-10">
                  Nenhum movimento encontrado no extrato.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Lote salvo localmente no navegador.
              </span>
              <Button
                type="button"
                onClick={() => setActiveBatch(null)}
                className="rounded-xl text-xs"
              >
                Concluir e Fechar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

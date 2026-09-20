import React, { useState, useMemo } from "react";
import {
  ArrowDownLeft,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Search,
  RotateCw,
  Plus,
  TrendingDown,
  Receipt,
  Pencil,
  Trash2,
  Layers,
} from "lucide-react";
import { parseISO, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CountUp } from "@/components/finance/CountUp";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import { remaining } from "./finance-math";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import { cn } from "@/lib/utils";

export interface ContasPagarTabProps {
  finance: FinanceSnapshot;
  onRefresh?: () => Promise<unknown> | void;
  refreshing?: boolean;
  onOpenNew: (type?: "receita" | "despesa") => void;
  onEdit: (entry: FinancialTitle) => void;
  onPay: (entry: FinancialTitle) => void;
  onDelete: (id: string) => void;
}

export const ContasPagarTab = React.memo(function ContasPagarTab({
  finance,
  onRefresh,
  refreshing = false,
  onOpenNew,
  onEdit,
  onPay,
  onDelete,
}: ContasPagarTabProps) {
  const [subTab, setSubTab] = useState<"a-pagar" | "historico" | "todas">("a-pagar");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "pendente" | "vencido">("todos");

  // Filtra todas as despesas ativas do sistema
  const despesas = useMemo(() => {
    return (finance?.titles || []).filter((t) => {
      if (t.status === "cancelado") return false;
      return t.type === "despesa";
    });
  }, [finance?.titles]);

  // Cálculos de KPI e Faixas de Vencimento
  const metrics = useMemo(() => {
    const today = startOfDay(new Date());
    const todayTime = today.getTime();

    let aVencerTotal = 0;
    let aVencerCount = 0;
    let vencidoTotal = 0;
    let vencidoCount = 0;
    let pagoTotal = 0;
    let pagoCount = 0;

    let av_0_15_count = 0,
      av_0_15_val = 0;
    let av_15_30_count = 0,
      av_15_30_val = 0;
    let av_30_plus_count = 0,
      av_30_plus_val = 0;

    let ven_1_15_count = 0,
      ven_1_15_val = 0;
    let ven_15_30_count = 0,
      ven_15_30_val = 0;
    let ven_30_plus_count = 0,
      ven_30_plus_val = 0;

    despesas.forEach((e) => {
      const paid = Number(e.paid_amount ?? (e.status === "pago" ? e.amount : 0));
      const rem = remaining(e);
      const isPaid = e.status === "pago" || rem <= 0;

      if (paid > 0) {
        pagoTotal += paid;
        pagoCount += 1;
      }

      if (isPaid) {
        return;
      }

      const amt = rem;

      if (!e.due_date) {
        aVencerTotal += amt;
        aVencerCount++;
        av_0_15_count++;
        av_0_15_val += amt;
        return;
      }

      const dueTime = parseISO(e.due_date).getTime();
      const diff = Math.floor((dueTime - todayTime) / 86400000);

      if (diff < 0) {
        // Vencido
        vencidoTotal += amt;
        vencidoCount++;
        const absDiff = Math.abs(diff);
        if (absDiff <= 15) {
          ven_1_15_count++;
          ven_1_15_val += amt;
        } else if (absDiff <= 30) {
          ven_15_30_count++;
          ven_15_30_val += amt;
        } else {
          ven_30_plus_count++;
          ven_30_plus_val += amt;
        }
      } else {
        // A Vencer
        aVencerTotal += amt;
        aVencerCount++;
        if (diff <= 15) {
          av_0_15_count++;
          av_0_15_val += amt;
        } else if (diff <= 30) {
          av_15_30_count++;
          av_15_30_val += amt;
        } else {
          av_30_plus_count++;
          av_30_plus_val += amt;
        }
      }
    });

    return {
      aVencerTotal,
      aVencerCount,
      vencidoTotal,
      vencidoCount,
      pagoTotal,
      pagoCount,
      totalAcumulado: aVencerTotal + vencidoTotal + pagoTotal,
      faixas: {
        aVencer: [
          { label: "0-15 dias", count: av_0_15_count, val: av_0_15_val },
          { label: "15-30 dias", count: av_15_30_count, val: av_15_30_val },
          { label: "30+ dias", count: av_30_plus_count, val: av_30_plus_val },
        ],
        vencido: [
          { label: "1-15 dias", count: ven_1_15_count, val: ven_1_15_val },
          { label: "15-30 dias", count: ven_15_30_count, val: ven_15_30_val },
          { label: "30+ dias", count: ven_30_plus_count, val: ven_30_plus_val },
        ],
      },
    };
  }, [despesas]);

  // Itens filtrados para exibição na lista
  const filteredList = useMemo(() => {
    const today = startOfDay(new Date());

    return despesas.filter((e) => {
      const rem = remaining(e);
      const isPaid = e.status === "pago" || rem <= 0;
      const isVencido = !isPaid && !!e.due_date && startOfDay(parseISO(e.due_date)) < today;

      // 1. Filtro de Sub-abas
      if (subTab === "a-pagar" && isPaid) return false;
      if (subTab === "historico" && !isPaid) return false;

      // 2. Filtro de Status
      if (statusFilter === "pendente") {
        if (isPaid || isVencido) return false;
      }
      if (statusFilter === "vencido") {
        if (isPaid || !isVencido) return false;
      }

      // 3. Busca por texto
      if (search.trim()) {
        const q = search.toLowerCase();
        const desc = (e.description || "").toLowerCase();
        const cat = (e.category || "").toLowerCase();
        const patient = (e.patient_name || "").toLowerCase();
        const payer = (e.payer_name || "").toLowerCase();
        return (
          desc.includes(q) ||
          cat.includes(q) ||
          patient.includes(q) ||
          payer.includes(q)
        );
      }

      return true;
    });
  }, [despesas, subTab, statusFilter, search]);

  return (
    <div className="space-y-6 pb-12">
      {/* ========================================================================= */}
      {/* 1. CABEÇALHO COM ÍCONE VERMELHO, TÍTULO, BADGE E BOTÕES DE AÇÃO           */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-xs shrink-0">
            <ArrowDownLeft className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Contas a Pagar
              <span className="text-[11px] font-semibold text-rose-600 border border-rose-200 bg-rose-50/60 px-2.5 py-0.5 rounded-full">
                {despesas.length} despesas
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Custas processuais, despesas do escritório, fornecedores, repasses e faturas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            onClick={() => onOpenNew("despesa")}
            className="h-9 px-4 text-xs font-semibold gap-1.5 bg-[#5046e5] hover:bg-[#4338ca] text-white shadow-xs rounded-xl cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nova Despesa
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-xs cursor-pointer rounded-xl"
            onClick={() => void onRefresh?.()}
            disabled={refreshing || !onRefresh}
            title="Atualizar"
            aria-label="Atualizar"
          >
            <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. SUB-ABAS / PILLS (A Pagar, Histórico, Todas)                            */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setSubTab("a-pagar")}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "a-pagar"
              ? "bg-rose-600 text-white shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          A Pagar ({metrics.aVencerCount + metrics.vencidoCount})
        </button>

        <button
          type="button"
          onClick={() => setSubTab("historico")}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "historico"
              ? "bg-rose-600 text-white shadow-xs font-semibold"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          <Receipt className="h-3.5 w-3.5" />
          Histórico ({metrics.pagoCount} pagas)
        </button>

        <button
          type="button"
          onClick={() => setSubTab("todas")}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "todas"
              ? "bg-rose-600 text-white shadow-xs font-semibold"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          Todas ({despesas.length})
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. BARRA DE FILTROS (POSICIONADA ACIMA DOS CARDS DE KPIS CONFORME IMAGEM) */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="relative w-full sm:w-[320px] md:w-[360px]">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar por descrição, categoria, cliente ou conta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-xs bg-white border-slate-200 rounded-lg placeholder:text-slate-400 shadow-2xs"
          />
        </div>

        <div className="inline-flex items-center bg-slate-50 p-0.5 rounded-lg border border-slate-200 shadow-2xs">
          <button
            type="button"
            onClick={() => setStatusFilter("todos")}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
              statusFilter === "todos"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("pendente")}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
              statusFilter === "pendente"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            A Vencer ({metrics.aVencerCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("vencido")}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
              statusFilter === "vencido"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            Vencidas ({metrics.vencidoCount})
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. CARDS DE MÉTRICAS (A VENCER, VENCIDO, PAGO / LIQUIDADO)                 */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* A VENCER */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              A VENCER
            </span>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              <CountUp value={metrics.aVencerTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              {metrics.aVencerCount} lançamentos pendentes
            </p>
          </div>
          <div className="h-9 w-9 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4" />
          </div>
        </div>

        {/* VENCIDO */}
        <div
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between cursor-pointer hover:border-rose-300 transition-colors"
          onClick={() => setStatusFilter("vencido")}
        >
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-rose-500 uppercase tracking-wider">
              VENCIDO
            </span>
            <p className="text-2xl font-bold text-rose-600 tracking-tight">
              <CountUp value={metrics.vencidoTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">{metrics.vencidoCount} em atraso</p>
          </div>
          <div className="h-9 w-9 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>

        {/* PAGO / LIQUIDADO */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              PAGO / LIQUIDADO
            </span>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              <CountUp value={metrics.pagoTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              {metrics.pagoCount} lançamentos liquidados
            </p>
          </div>
          <div className="h-9 w-9 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 5. SEÇÃO 2 COLUNAS: ANÁLISE DE VENCIMENTO & CONTROLE DE SAÍDAS             */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* COLUNA ESQUERDA: ANÁLISE DE VENCIMENTO */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            ANÁLISE DE VENCIMENTO
          </h2>

          <div className="space-y-2">
            <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block">
              A VENCER
            </span>
            <div className="divide-y divide-slate-100">
              {metrics.faixas.aVencer.map((f) => (
                <div key={f.label} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{f.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-400">{f.count} itens</span>
                    <strong className="font-bold text-slate-800 tabular-nums min-w-[85px] text-right">
                      {currency(f.val)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wider block">
              VENCIDO
            </span>
            <div className="divide-y divide-slate-100">
              {metrics.faixas.vencido.map((f) => (
                <div key={f.label} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{f.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-400">{f.count} itens</span>
                    <strong className="font-bold text-rose-600 tabular-nums min-w-[85px] text-right">
                      {currency(f.val)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA: CONTROLE DE SAÍDAS */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
              <TrendingDown className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Controle de Saídas</h2>
              <p className="text-xs text-slate-400">
                Total acumulado de despesas cadastradas
              </p>
            </div>
          </div>

          <div className="py-10 text-center space-y-1">
            <p className="text-3xl font-bold text-rose-600 tracking-tight">
              {currency(metrics.totalAcumulado)}
            </p>
            <p className="text-xs text-slate-400">
              {despesas.length} despesas registradas no total
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3 text-center">
            <p className="text-[11px] text-slate-400">
              Atualizado em tempo real com todos os lançamentos
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 6. LISTA PRINCIPAL: LANÇAMENTOS DE DESPESAS                               */}
      {/* ========================================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">
            Lançamentos de Despesas ({filteredList.length})
          </h2>

          <Button
            size="sm"
            variant="outline"
            className="h-8 border-rose-200 bg-white text-rose-600 hover:bg-rose-50 text-xs font-semibold px-3 rounded-lg flex items-center gap-1.5 shadow-2xs cursor-pointer"
            onClick={() => onOpenNew("despesa")}
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar Despesa
          </Button>
        </div>

        {filteredList.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="h-10 w-10 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
              <ArrowDownLeft className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">
                Nenhuma despesa encontrada nesta visualização.
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Cadastre uma nova despesa ou ajuste os filtros de pesquisa.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => onOpenNew("despesa")}
              className="h-9 px-4 text-xs font-semibold gap-1.5 bg-[#5046e5] hover:bg-[#4338ca] text-white shadow-xs rounded-xl cursor-pointer mx-auto"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Cadastrar Despesa Agora
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredList.map((item) => {
              const rem = remaining(item);
              const isPaid = item.status === "pago" || rem <= 0;
              const today = startOfDay(new Date());
              const isOverdue = !isPaid && !!item.due_date && startOfDay(parseISO(item.due_date)) < today;
              const displayName = item.payer_name || item.patient_name || null;

              return (
                <div
                  key={item.id}
                  className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/50 rounded-lg px-2 transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900 truncate">
                        {item.description || "Despesa sem descrição"}
                      </span>
                      {item.category && (
                        <span className="inline-flex items-center text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          {item.category}
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex items-center text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full",
                          isPaid
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : isOverdue
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                        )}
                      >
                        {isPaid ? "Pago" : isOverdue ? "Vencido" : "Pendente"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate">
                      Vencimento: {item.due_date ? formatClinicalDate(item.due_date) : "Sem vencimento fixo"}
                      {displayName && ` · Favorecido: ${displayName}`}
                      {item.paid_amount > 0 && !isPaid && ` · Pago parcial: ${currency(item.paid_amount)}`}
                      {!isPaid && rem !== item.amount && ` · Restante: ${currency(rem)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                    <strong className="font-bold text-sm text-rose-600 tabular-nums">
                      {currency(item.amount)}
                    </strong>
                    {!isPaid && (
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-4 rounded-lg shadow-2xs cursor-pointer"
                        onClick={() => onPay(item)}
                      >
                        Liquidar
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                      onClick={() => onEdit(item)}
                      title="Editar título"
                      aria-label="Editar título"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {item.can_cancel && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                        onClick={() => onDelete(item.id)}
                        title="Excluir / Cancelar"
                        aria-label="Excluir / Cancelar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export default ContasPagarTab;

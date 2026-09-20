import React, { useState, useMemo } from "react";
import {
  ArrowDownLeft as ArrowDownLeftIcon,
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  AlertTriangle as AlertTriangleIcon,
  CheckCircle2 as CheckCircle2Icon,
  Search as SearchIcon,
  RotateCw as RotateCwIcon,
  Plus as PlusIcon,
  TrendingDown as TrendingDownIcon,
  Receipt as ReceiptIcon,
  Pencil as PencilIcon,
  Trash2 as Trash2Icon,
  Layers as LayersIcon,
} from "lucide-react";
import { parseISO, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CountUp } from "@/components/finance/CountUp";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import { remaining } from "./finance-math";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";

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
      const isPaid = e.status === "pago" || remaining(e) <= 0;
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
    <div className="space-y-6">
      {/* Header com Ícone e Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="h-12 w-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-xs shrink-0 mt-0.5">
            <ArrowDownLeftIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              Contas a Pagar
              <Badge
                variant="outline"
                className="text-xs font-semibold text-rose-600 border-rose-200 bg-rose-50/50"
              >
                {despesas.length} despesas
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Custas processuais, despesas do consultório, fornecedores, repasses e faturas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            onClick={() => onOpenNew("despesa")}
            className="h-9 text-sm font-semibold gap-1.5 bg-rose-600 hover:bg-rose-700 text-white shadow-xs"
          >
            <PlusIcon className="h-3.5 w-3.5" /> Nova Despesa
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={() => void onRefresh?.()}
            disabled={refreshing || !onRefresh}
            title="Atualizar"
            aria-label="Atualizar"
          >
            <RotateCwIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Sub-abas Pills */}
      <div className="flex items-center gap-1.5 border-b pb-3">
        <button
          onClick={() => setSubTab("a-pagar")}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
            subTab === "a-pagar"
              ? "bg-rose-600 text-white shadow-xs"
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          }`}
        >
          <ClockIcon className="h-3.5 w-3.5" /> A Pagar (
          {metrics.aVencerCount + metrics.vencidoCount})
        </button>
        <button
          onClick={() => setSubTab("historico")}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
            subTab === "historico"
              ? "bg-rose-600 text-white shadow-xs"
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          }`}
        >
          <ReceiptIcon className="h-3.5 w-3.5" /> Histórico ({metrics.pagoCount} pagas)
        </button>
        <button
          onClick={() => setSubTab("todas")}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
            subTab === "todas"
              ? "bg-rose-600 text-white shadow-xs"
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          }`}
        >
          <LayersIcon className="h-3.5 w-3.5" /> Todas ({despesas.length})
        </button>
      </div>

      {/* Barra de Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição, categoria, fornecedor ou pagador..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Pills de Status */}
          <div className="inline-flex items-center bg-muted/60 p-0.5 rounded-lg text-xs font-medium border">
            <button
              onClick={() => setStatusFilter("todos")}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                statusFilter === "todos"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setStatusFilter("pendente")}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                statusFilter === "pendente"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              A Vencer ({metrics.aVencerCount})
            </button>
            <button
              onClick={() => setStatusFilter("vencido")}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                statusFilter === "vencido"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Vencidas ({metrics.vencidoCount})
            </button>
          </div>
        </div>
      </div>

      {/* Cards de Métricas (KPIs) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* A VENCER */}
        <div className="rounded-xl border bg-card p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              A Vencer
            </span>
            <p className="text-2xl font-bold text-foreground mt-0.5">
              <CountUp value={metrics.aVencerTotal} format={currency} />
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {metrics.aVencerCount} lançamentos pendentes
            </p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
            <ClockIcon className="h-5 w-5" />
          </div>
        </div>

        {/* VENCIDO */}
        <div className="rounded-xl border bg-card p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold tracking-wider text-rose-600 uppercase">
              Vencido
            </span>
            <p className="text-2xl font-bold text-rose-600 mt-0.5">
              <CountUp value={metrics.vencidoTotal} format={currency} />
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{metrics.vencidoCount} em atraso</p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangleIcon className="h-5 w-5" />
          </div>
        </div>

        {/* PAGO (LIQUIDADO) */}
        <div className="rounded-xl border bg-card p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Pago / Liquidado
            </span>
            <p className="text-2xl font-bold text-foreground mt-0.5">
              <CountUp value={metrics.pagoTotal} format={currency} />
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {metrics.pagoCount} lançamentos liquidados
            </p>
          </div>
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
            <CheckCircle2Icon className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Seção 2 Colunas: Análise de Vencimento e Previsão */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Coluna Esquerda: Análise de Vencimento */}
        <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
          <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            Análise de Vencimento
          </h2>

          <div className="space-y-4">
            {/* Bloco A Vencer */}
            <div className="space-y-2">
              <span className="text-xs font-bold tracking-wider text-amber-600 uppercase">
                A Vencer
              </span>
              <div className="divide-y text-xs">
                {metrics.faixas.aVencer.map((f) => (
                  <div key={f.label} className="py-2 flex items-center justify-between">
                    <span className="text-muted-foreground">{f.label}</span>
                    <div className="space-x-3">
                      <span className="text-muted-foreground">{f.count} itens</span>
                      <span className="font-semibold text-foreground">{currency(f.val)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bloco Vencido */}
            <div className="space-y-2 pt-2 border-t">
              <span className="text-xs font-bold tracking-wider text-rose-600 uppercase">
                Vencido
              </span>
              <div className="divide-y text-xs">
                {metrics.faixas.vencido.map((f) => (
                  <div key={f.label} className="py-2 flex items-center justify-between">
                    <span className="text-muted-foreground">{f.label}</span>
                    <div className="space-x-3">
                      <span className="text-muted-foreground">{f.count} itens</span>
                      <span className="font-semibold text-rose-600">{currency(f.val)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Coluna Direita: Previsão & Controle */}
        <div className="rounded-xl border bg-card p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
              <TrendingDownIcon className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Controle de Saídas</h2>
              <p className="text-xs text-muted-foreground">
                Total acumulado de despesas cadastradas
              </p>
            </div>
          </div>

          <div className="py-8 text-center space-y-2">
            <p className="text-3xl font-black text-rose-600">
              {currency(metrics.aVencerTotal + metrics.vencidoTotal + metrics.pagoTotal)}
            </p>
            <p className="text-xs text-muted-foreground">
              {despesas.length} despesas registradas no total
            </p>
          </div>

          <div className="text-right text-xs text-muted-foreground border-t pt-2.5">
            Atualizado em tempo real com todos os lançamentos
          </div>
        </div>
      </div>

      {/* Lista de Contas a Pagar */}
      <div className="rounded-xl border bg-card p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            Lançamentos de Despesas ({filteredList.length})
          </h2>

          <Button
            size="sm"
            variant="outline"
            className="h-9 text-sm font-semibold gap-1 text-rose-600 border-rose-200 hover:bg-rose-50 cursor-pointer"
            onClick={() => onOpenNew("despesa")}
          >
            <PlusIcon className="h-3.5 w-3.5" /> Adicionar Despesa
          </Button>
        </div>

        {filteredList.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-muted/60 text-muted-foreground mx-auto flex items-center justify-center">
              <ArrowDownLeftIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Nenhuma despesa encontrada nesta visualização.
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {subTab === "a-pagar" && metrics.pagoCount > 0
                  ? `Existem ${metrics.pagoCount} despesa(s) já liquidadas na aba "Histórico" ou "Todas".`
                  : "Cadastre uma nova despesa ou ajuste os filtros de pesquisa."}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => onOpenNew("despesa")}
              className="h-9 text-sm font-semibold gap-1.5 bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
            >
              <PlusIcon className="h-3.5 w-3.5" /> Cadastrar Despesa Agora
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {filteredList.map((item) => {
              const rem = remaining(item);
              const isPaid = item.status === "pago" || rem <= 0;
              const today = startOfDay(new Date());
              const isOverdue = !isPaid && !!item.due_date && startOfDay(parseISO(item.due_date)) < today;
              const displayName = item.payer_name || item.patient_name || null;

              return (
                <div
                  key={item.id}
                  className="py-3 flex items-center justify-between gap-3 flex-wrap hover:bg-muted/30 px-2 rounded-xl transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {item.description || "Despesa sem descrição"}
                      </span>
                      {item.category && (
                        <Badge variant="secondary" className="text-xs py-0 h-4">
                          {item.category}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-xs py-0 h-4 font-semibold ${
                          isPaid
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : isOverdue
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {isPaid ? "Pago" : isOverdue ? "Vencido" : "Pendente"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Vencimento:{" "}
                      {item.due_date ? formatClinicalDate(item.due_date) : "Sem vencimento fixo"}
                      {displayName && ` · Beneficiário / Fornecedor: ${displayName}`}
                      {item.paid_amount > 0 && !isPaid && ` · Pago parcial: ${currency(item.paid_amount)}`}
                      {!isPaid && rem !== item.amount && ` · Restante: ${currency(rem)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-bold text-sm text-rose-600">{currency(item.amount)}</span>
                    {!isPaid && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 text-sm text-emerald-600 border-emerald-200 hover:bg-emerald-50 cursor-pointer font-medium"
                        onClick={() => onPay(item)}
                      >
                        Liquidar
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => onEdit(item)}
                      title="Editar / Ver detalhes"
                      aria-label="Editar / Ver detalhes"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </Button>
                    {item.can_cancel && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-rose-600 hover:bg-rose-50 cursor-pointer"
                        onClick={() => onDelete(item.id)}
                        title="Excluir / Cancelar"
                        aria-label="Excluir / Cancelar"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
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

import React, { useState, useMemo } from "react";
import {
  Calendar as CalIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Receipt,
  ArrowDownLeft,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import { remaining } from "./finance-math";
import { StatusBadge } from "@/components/ui-app/StatusBadge";
import { parseISO, startOfDay, format, addMonths, subMonths, isSameMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CalendarioVencimentosProps {
  finance: FinanceSnapshot;
  onPay: (entry: FinancialTitle) => void;
  onEdit: (entry: FinancialTitle) => void;
}

export function CalendarioVencimentos({ finance, onPay, onEdit }: CalendarioVencimentosProps) {
  const [currentMonthDate, setCurrentMonthDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Filtra despesas com data de vencimento
  const despesasComVencimento = useMemo(() => {
    return (finance?.titles || []).filter((t) => {
      if (t.status === "cancelado") return false;
      return t.type === "despesa" && !!t.due_date;
    });
  }, [finance?.titles]);

  // Agrupa despesas pelo mês atual selecionado
  const despesasDoMes = useMemo(() => {
    const curYear = currentMonthDate.getFullYear();
    const curMonth = currentMonthDate.getMonth();

    return despesasComVencimento.filter((t) => {
      const d = parseISO(t.due_date);
      return d.getFullYear() === curYear && d.getMonth() === curMonth;
    });
  }, [despesasComVencimento, currentMonthDate]);

  // Agrupamento por dia do mês
  const despesasPorDia = useMemo(() => {
    const map: Record<string, FinancialTitle[]> = {};
    for (const t of despesasDoMes) {
      const dayKey = t.due_date.slice(0, 10);
      if (!map[dayKey]) map[dayKey] = [];
      map[dayKey].push(t);
    }
    return map;
  }, [despesasDoMes]);

  // Lista de dias ordenados
  const diasOrdenados = useMemo(() => {
    return Object.keys(despesasPorDia).sort();
  }, [despesasPorDia]);

  // Totais do mês
  const metricasMes = useMemo(() => {
    let totalPendente = 0;
    let totalPago = 0;
    let totalVencido = 0;
    const today = startOfDay(new Date());

    despesasDoMes.forEach((t) => {
      const rem = remaining(t);
      const isPaid = t.status === "pago" || rem <= 0;
      const isOverdue = !isPaid && startOfDay(parseISO(t.due_date)) < today;

      if (isPaid) {
        totalPago += Number(t.paid_amount || t.amount);
      } else if (isOverdue) {
        totalVencido += rem;
      } else {
        totalPendente += rem;
      }
    });

    return { totalPendente, totalPago, totalVencido, totalGeral: totalPendente + totalPago + totalVencido };
  }, [despesasDoMes]);

  const activeDayList = selectedDay
    ? despesasPorDia[selectedDay] || []
    : despesasDoMes;

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. SELETOR DE MÊS & RESUMO                                                */}
      {/* ========================================================================= */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-primary-soft text-primary flex items-center justify-center">
              <CalIcon className="h-4 w-4" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Calendário de Vencimentos
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Visualize os vencimentos organizados por dia do mês e antecipe os pagamentos da clínica.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 rounded-lg border-border bg-card"
            onClick={() => {
              setCurrentMonthDate(subMonths(currentMonthDate, 1));
              setSelectedDay(null);
            }}
          >
            <ChevronLeft size={16} />
          </Button>

          <span className="text-sm font-bold text-foreground capitalize min-w-[130px] text-center">
            {format(currentMonthDate, "MMMM yyyy", { locale: ptBR })}
          </span>

          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 rounded-lg border-border bg-card"
            onClick={() => {
              setCurrentMonthDate(addMonths(currentMonthDate, 1));
              setSelectedDay(null);
            }}
          >
            <ChevronRight size={16} />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-primary font-semibold"
            onClick={() => {
              setCurrentMonthDate(new Date());
              setSelectedDay(null);
            }}
          >
            Mês Atual
          </Button>
        </div>
      </div>

      {/* Métricas do mês selecionado */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
        <div className="bg-card rounded-xl border border-border p-4 shadow-2xs">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
            Total do Mês
          </span>
          <div className="text-lg font-bold text-foreground mt-1 tabular-nums">
            {currency(metricasMes.totalGeral)}
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">{despesasDoMes.length} conta(s)</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-2xs">
          <span className="text-xs font-semibold text-warning uppercase tracking-wider block">
            A Vencer no Mês
          </span>
          <div className="text-lg font-bold text-warning mt-1 tabular-nums">
            {currency(metricasMes.totalPendente)}
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">Aguardando vencimento</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-2xs">
          <span className="text-xs font-semibold text-destructive uppercase tracking-wider block">
            Vencidas no Mês
          </span>
          <div className="text-lg font-bold text-destructive mt-1 tabular-nums">
            {currency(metricasMes.totalVencido)}
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">Exigem liquidação</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-2xs">
          <span className="text-xs font-semibold text-success uppercase tracking-wider block">
            Pagas no Mês
          </span>
          <div className="text-lg font-bold text-success mt-1 tabular-nums">
            {currency(metricasMes.totalPago)}
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">Liquidadas com sucesso</p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. DIAS COM VENCIMENTO NO MÊS                                             */}
      {/* ========================================================================= */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Dias com Vencimento em {format(currentMonthDate, "MMMM", { locale: ptBR })}
          </h3>

          {selectedDay && (
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver todas as datas do mês
            </button>
          )}
        </div>

        {diasOrdenados.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground bg-muted/40 rounded-xl">
            Nenhum vencimento de despesa programado para este mês.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {diasOrdenados.map((dayKey) => {
              const dayNum = parseInt(dayKey.slice(8, 10), 10);
              const items = despesasPorDia[dayKey] || [];
              const daySum = items.reduce((acc, x) => acc + remaining(x), 0);
              const isSelected = selectedDay === dayKey;
              const hasOverdue = items.some(
                (x) =>
                  x.status !== "pago" &&
                  remaining(x) > 0 &&
                  startOfDay(parseISO(x.due_date)) < startOfDay(new Date()),
              );

              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : dayKey)}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs transition cursor-pointer min-w-[72px] ${
                    isSelected
                      ? "bg-primary text-white border-primary shadow-xs"
                      : hasOverdue
                        ? "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/15"
                        : "bg-muted/50 border-border text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="text-base font-bold">Dia {dayNum}</span>
                  <span className="text-[10px] mt-0.5 font-medium tabular-nums opacity-85">
                    {items.length} conta(s)
                  </span>
                  <span className="text-[10px] font-bold tabular-nums mt-0.5">
                    {currency(daySum)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Lista de lançamentos do dia ou mês selecionado */}
        <div className="pt-3 border-t border-border-soft space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            <span>
              {selectedDay
                ? `Contas vencendo em ${formatClinicalDate(selectedDay)} (${activeDayList.length})`
                : `Todas as contas do mês (${activeDayList.length})`}
            </span>
          </div>

          <div className="divide-y divide-border-soft">
            {activeDayList.map((item) => {
              const rem = remaining(item);
              const isPaid = item.status === "pago" || rem <= 0;
              const today = startOfDay(new Date());
              const isOverdue =
                !isPaid && !!item.due_date && startOfDay(parseISO(item.due_date)) < today;

              return (
                <div
                  key={item.id}
                  className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2.5 hover:bg-muted/30 px-2 rounded-lg"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">
                        {item.description || "Despesa"}
                      </span>
                      {item.category && (
                        <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                          {item.category}
                        </span>
                      )}
                      <StatusBadge
                        tone={isPaid ? "success" : isOverdue ? "danger" : "warning"}
                        icon={isPaid ? CheckCircle2 : isOverdue ? AlertCircle : Clock}
                      >
                        {isPaid ? "Pago" : isOverdue ? "Vencido" : "Pendente"}
                      </StatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Vencimento: {formatClinicalDate(item.due_date)}
                      {item.payer_name ? ` · Favorecido: ${item.payer_name}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                    <strong className="text-sm font-semibold text-destructive tabular-nums">
                      {currency(item.amount)}
                    </strong>
                    {!isPaid && (
                      <Button
                        size="sm"
                        className="h-8 bg-success hover:bg-success/90 text-white text-xs font-semibold px-3 cursor-pointer shadow-2xs"
                        onClick={() => onPay(item)}
                      >
                        Liquidar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

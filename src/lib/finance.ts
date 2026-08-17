/**
 * Serviço financeiro — usado pelo Dashboard e pela página Financeiro.
 * Sempre calcula valores dinamicamente a partir de transactions.
 */

export type TxType = "receita" | "despesa" | "income" | "expense";
export type TxStatus = "pendente" | "pago" | "concluido" | "vencido" | "cancelado";

export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  date: string;
  status: TxStatus;
  due_date?: string | null;
  [k: string]: unknown;
}

export interface CashFlowDay {
  date: string;
  label: string;
  entradas: number;
  entradasPrev: number;
  saidas: number;
  saidasPrev: number;
  saldo: number;
  saldoPrev: number;
}

export interface KPIs {
  receitaPaga: number;
  receitaPrevista: number;
  despesaPaga: number;
  despesaPrevista: number;
  saldoAtual: number;
  saldoPrevisto: number;
}

export function calcKPIs(rows: Transaction[]): KPIs {
  const active = rows.filter((r) => r.status !== "cancelado");
  const isPaid = (r: Transaction) => r.status === "pago" || r.status === "concluido";
  const isPending = (r: Transaction) => r.status === "pendente" || r.status === "vencido";
  const isIncome = (r: Transaction) => r.type === "receita" || r.type === "income";
  const isExpense = (r: Transaction) => r.type === "despesa" || r.type === "expense";

  const sum = (arr: Transaction[], pred: (r: Transaction) => boolean) =>
    arr.filter(pred).reduce((s, r) => s + Number(r.amount || 0), 0);

  const receitaPaga = sum(active, (r) => isPaid(r) && isIncome(r));
  const receitaPrevista = sum(active, (r) => isPending(r) && isIncome(r));
  const despesaPaga = sum(active, (r) => isPaid(r) && isExpense(r));
  const despesaPrevista = sum(active, (r) => isPending(r) && isExpense(r));

  return {
    receitaPaga,
    receitaPrevista,
    despesaPaga,
    despesaPrevista,
    saldoAtual: receitaPaga - despesaPaga,
    saldoPrevisto: (receitaPaga + receitaPrevista) - (despesaPaga + despesaPrevista),
  };
}

const fmtLabel = (
  key: string,
  period: "day" | "week" | "month" | "year",
  customRange?: [Date, Date]
) => {
  if (customRange && period !== "day") {
    const fmt = (x: Date) => {
      const day = String(x.getDate()).padStart(2, "0");
      const month = String(x.getMonth() + 1).padStart(2, "0");
      const year = x.getFullYear();
      return `${day}/${month}/${year}`;
    };
    if (period === "week") {
      return `${fmt(customRange[0])} - ${fmt(customRange[1])}`;
    } else if (period === "month") {
      return customRange[0].toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
    } else {
      return String(customRange[0].getFullYear());
    }
  }

  if (period === "day") {
    const d = new Date(key + "T00:00:00");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  } else if (period === "week") {
    const d = new Date(key + "T00:00:00");
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (x: Date) => x.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return `${fmt(start)} - ${fmt(end)}`;
  } else if (period === "month") {
    const parts = key.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    if (y && m) {
      const d = new Date(y, m - 1, 1);
      return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
    }
  }
  return key;
};

export function calcCashFlow(
  rows: Transaction[],
  period: "day" | "week" | "month" | "year",
  limit?: number,
  customRange?: [Date, Date]
): CashFlowDay[] {
  const paid = (r: Transaction) => r.status === "pago" || r.status === "concluido";
  const pending = (r: Transaction) => r.status === "pendente" || r.status === "vencido";

  const localYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const bucketKey = (raw: string): string => {
    const day = raw.slice(0, 10);
    if (period === "day") return day;
    if (period === "week") {
      const dt = new Date(day + "T12:00:00");
      dt.setDate(dt.getDate() - dt.getDay());
      return localYMD(dt);
    }
    if (period === "month") return day.slice(0, 7);
    return day.slice(0, 4);
  };

  const generateRecentKeys = (): string[] => {
    const keys: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = limit! - 1; i >= 0; i--) {
      const d = new Date(today);
      if (period === "day") {
        d.setDate(today.getDate() - i);
        keys.push(localYMD(d));
      } else if (period === "week") {
        d.setDate(today.getDate() - i * 7);
        d.setDate(d.getDate() - d.getDay());
        keys.push(localYMD(d));
      } else if (period === "month") {
        d.setMonth(today.getMonth() - i);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      } else {
        keys.push(String(today.getFullYear() - i));
      }
    }
    return keys;
  };

  const generateRangeKeys = (start: Date, end: Date): string[] => {
    const keys: string[] = [];
    if (period === "day") {
      const current = new Date(start);
      current.setHours(0, 0, 0, 0);
      const limitDate = new Date(end);
      limitDate.setHours(23, 59, 59, 999);
      while (current <= limitDate) {
        keys.push(localYMD(current));
        current.setDate(current.getDate() + 1);
      }
    } else if (period === "week") {
      const current = new Date(end);
      current.setDate(current.getDate() - current.getDay());
      keys.push(localYMD(current));
    } else if (period === "month") {
      keys.push(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}`);
    } else {
      keys.push(String(end.getFullYear()));
    }
    return keys;
  };

  const baseKeys = customRange
    ? generateRangeKeys(customRange[0], customRange[1])
    : limit
    ? generateRecentKeys()
    : [];

  const isSingleSummary = customRange && period !== "day" && baseKeys.length > 0;
  const singleKey = isSingleSummary ? baseKeys[0] : null;
  const startStr = customRange ? localYMD(customRange[0]) : "";
  const endStr = customRange ? localYMD(customRange[1]) : "";

  const activeData: Record<string, { entradas: number; saidas: number }> = {};
  const pendingRData: Record<string, number> = {};
  const pendingDData: Record<string, number> = {};

  rows
    .filter((r) => r.status !== "cancelado")
    .forEach((r) => {
      let key = bucketKey(r.date);
      if (isSingleSummary) {
        const rDate = r.date.slice(0, 10);
        if (rDate >= startStr && rDate <= endStr) {
          key = singleKey!;
        } else {
          return; // Skip transactions outside selection
        }
      }

      const isIncome = r.type === "receita" || r.type === "income";
      if (paid(r)) {
        if (!activeData[key]) activeData[key] = { entradas: 0, saidas: 0 };
        if (isIncome) activeData[key].entradas += Number(r.amount || 0);
        else activeData[key].saidas += Number(r.amount || 0);
      }
      if (pending(r)) {
        if (isIncome) pendingRData[key] = (pendingRData[key] || 0) + Number(r.amount || 0);
        else pendingDData[key] = (pendingDData[key] || 0) + Number(r.amount || 0);
      }
    });

  const finalKeys = baseKeys.length > 0 ? baseKeys : Array.from(
    new Set([
      ...Object.keys(activeData),
      ...Object.keys(pendingRData),
      ...Object.keys(pendingDData),
    ])
  ).sort();

  return finalKeys.map((key) => {
    const a = activeData[key] ?? { entradas: 0, saidas: 0 };
    const pr = pendingRData[key] || 0;
    const pd = pendingDData[key] || 0;
    const saldo = a.entradas - a.saidas;
    return {
      date: key,
      label: fmtLabel(key, period, customRange),
      entradas: a.entradas,
      entradasPrev: pr,
      saidas: a.saidas,
      saidasPrev: pd,
      saldo,
      saldoPrev: saldo + pr - pd,
    };
  });
}

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Tela aberta ao clicar numa barra do "Fluxo de caixa": lista os lançamentos do financeiro
 * (pagamentos e títulos em aberto) que compõem aquela barra.
 */

export interface CashFlowDetailRow {
  id: string;
  type: string;
  amount: number;
  date: string;
  status: string;
  due_date?: string | null;
  description?: string | null;
  category?: string | null;
  person?: string | null;
  method?: string | null;
}

type SortKey = "due" | "paid" | "description" | "category" | "method" | "amount";

const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Crédito",
  cartao_debito: "Débito",
  credito: "Crédito",
  debito: "Débito",
  boleto: "Boleto",
  transferencia: "Transferência",
  cheque: "Cheque",
};

const fmtDay = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CashFlowDetailsDialog({
  open,
  onOpenChange,
  title,
  rows,
  hideValues,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  rows: CashFlowDetailRow[];
  hideValues?: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "due", dir: 1 });
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const today = todayISO();

  const items = useMemo(() => {
    const mapped = rows.map((r) => {
      const paid = r.status === "pago" || r.status === "concluido";
      const income = r.type === "receita" || r.type === "income";
      const due = (r.due_date || r.date || "").slice(0, 10);
      const situation = paid
        ? income
          ? "Recebido"
          : "Pago"
        : due && due < today
          ? "Em atraso"
          : "Em aberto";
      const desc = [r.description, r.person].filter(Boolean).join(" — ") || "—";
      return {
        id: r.id,
        due,
        paid: paid ? (r.date || "").slice(0, 10) : "",
        description: desc,
        category: r.category || "—",
        method: r.method ? METHOD_LABEL[r.method] || r.method : "",
        situation,
        amount: Number(r.amount || 0),
      };
    });
    const { key, dir } = sort;
    return mapped.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR") * dir;
    });
  }, [rows, sort, today]);

  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = items.slice(current * pageSize, current * pageSize + pageSize);
  const total = items.reduce((s, r) => s + r.amount, 0);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const Th = ({ k, label, right }: { k?: SortKey; label: string; right?: boolean }) => (
    <th className={`px-3 py-3 font-semibold text-foreground ${right ? "text-right" : "text-left"}`}>
      {k ? (
        <button
          type="button"
          onClick={() => toggle(k)}
          className="inline-flex cursor-pointer items-center gap-1"
        >
          {label}
          <ChevronsUpDown size={12} className="text-muted-foreground" />
        </button>
      ) : (
        label
      )}
    </th>
  );

  const badge = (s: string) =>
    s === "Recebido" || s === "Pago"
      ? "bg-success/10 text-success"
      : s === "Em atraso"
        ? "bg-destructive/10 text-destructive"
        : "bg-warning/10 text-warning";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setPage(0);
      }}
    >
      <DialogContent className="max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto px-6">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th k="due" label="Venc." />
                <Th k="paid" label="Execução" />
                <Th k="description" label="Descrição" />
                <Th k="category" label="Categoria" />
                <Th k="method" label="Método" />
                <Th label="Situação" />
                <Th k="amount" label="Valor (R$)" right />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">
                    Nenhum lançamento neste período.
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{fmtDay(r.due)}</td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{fmtDay(r.paid)}</td>
                    <td className="max-w-[240px] truncate px-3 py-3 text-foreground" title={r.description}>
                      {r.description}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-3 text-muted-foreground" title={r.category}>
                      {r.category}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{r.method}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded px-2.5 py-1 text-xs font-medium ${badge(r.situation)}`}>
                        {r.situation}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-foreground tabular-nums">
                      {hideValues ? "••••" : fmtMoney(r.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-3 py-3 font-semibold text-foreground">
                    Total ({items.length})
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-foreground tabular-nums">
                    {hideValues ? "••••" : fmtMoney(total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 px-6 py-4">
          <label className="relative inline-flex items-center">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="cursor-pointer appearance-none rounded-lg border border-border bg-card py-2 pr-9 pl-3 text-sm text-foreground"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 text-muted-foreground" />
          </label>
          <div className="flex items-center gap-2">
            {(
              [
                [ChevronsLeft, 0, "Primeira página"],
                [ChevronLeft, current - 1, "Página anterior"],
              ] as const
            ).map(([Icon, to, label]) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                disabled={current === 0}
                onClick={() => setPage(to)}
                className="grid size-9 cursor-pointer place-items-center rounded-lg bg-muted text-muted-foreground disabled:cursor-default disabled:opacity-50"
              >
                <Icon size={16} />
              </button>
            ))}
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              {current + 1}
            </span>
            {(
              [
                [ChevronRight, current + 1, "Próxima página"],
                [ChevronsRight, pages - 1, "Última página"],
              ] as const
            ).map(([Icon, to, label]) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                disabled={current >= pages - 1}
                onClick={() => setPage(to)}
                className="grid size-9 cursor-pointer place-items-center rounded-lg bg-muted text-muted-foreground disabled:cursor-default disabled:opacity-50"
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { Fragment, useState } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import { currency, formatClinicalDate, localDate } from "@/features/acompanhamentos/followup-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import { cents, isFreeBalance, remaining, titleStatus } from "./finance-math";
import { fieldClass } from "./OperationForm";

export default function TitleList({
  finance,
  type,
  onNew,
  onSelect,
  onCancel,
}: {
  finance: FinanceSnapshot;
  type: FinancialTitle["type"];
  onNew: () => void;
  onSelect: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("open");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const receiving = type === "receita";
  const today = localDate();
  const rangeValid = !start || !end || start <= end;
  const base = finance.titles.filter(
    (t) =>
      t.type === type &&
      (scope === "all" || (t.company_id ?? "legacy") === scope) &&
      [t.patient_name, t.payer_name, t.description, t.category].some((value) =>
        (value ?? "").toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      ),
  );
  const open = base.filter((t) => remaining(t) > 0);
  const sum = (titles: FinancialTitle[]) =>
    titles.reduce((total, t) => total + cents(remaining(t)), 0) / 100;
  const free = open.filter(isFreeBalance);
  const stats: [string, number][] = [
    ["Em aberto total", sum(open)],
    ["Vencido", sum(open.filter((t) => !isFreeBalance(t) && t.due_date < today))],
    ["Hoje e a vencer", sum(open.filter((t) => !isFreeBalance(t) && t.due_date >= today))],
    ["Sem vencimento", sum(free)],
  ];
  const filtered = base
    .filter((t) => {
      const balance = remaining(t);
      const undated = isFreeBalance(t);
      if (status === "open" && balance <= 0) return false;
      if (status === "overdue" && (balance <= 0 || undated || t.due_date >= today)) return false;
      if (status === "upcoming" && (balance <= 0 || undated || t.due_date < today)) return false;
      if (status === "free" && (balance <= 0 || !undated)) return false;
      if (status === "paid" && (balance !== 0 || t.status === "cancelado")) return false;
      if (status === "cancelled" && t.status !== "cancelado") return false;
      if (undated) return status === "free" || (!start && !end);
      return (!start || t.due_date >= start) && (!end || t.due_date <= end);
    })
    .sort(
      (a, b) =>
        Number(isFreeBalance(a)) - Number(isFreeBalance(b)) ||
        a.due_date.localeCompare(b.due_date) ||
        a.id.localeCompare(b.id),
    );
  const groups = new Map<string, FinancialTitle[]>();
  for (const title of filtered) {
    const key = title.treatment_id ?? title.id;
    groups.set(key, [...(groups.get(key) ?? []), title]);
  }
  const canCreate = finance.scopes.some(
    (s) =>
      s.can_create && (receiving || s.can_pay) && (scope === "all" || (s.id ?? "legacy") === scope),
  );
  const renderTitle = (t: FinancialTitle) => {
    const balance = remaining(t);
    const overdue = balance > 0 && !isFreeBalance(t) && t.due_date < today;
    const lastPayment = finance.payments
      .filter((p) => p.transaction_id === t.id && !p.reversed_at)
      .sort((a, b) => b.paid_on.localeCompare(a.paid_on))[0];
    return (
      <tr key={t.id} className="border-t hover:bg-slate-50/60">
        <td className="p-3">
          <button
            onClick={() => onSelect(t.id)}
            className="text-left font-medium hover:text-primary hover:underline"
          >
            {receiving
              ? t.patient_name || t.payer_name || "Avulso"
              : t.payer_name || "Favorecido não informado"}
          </button>
          <p className="text-xs text-slate-500">{t.description}</p>
          <p className="text-xs text-slate-400">
            {t.treatment_id ? "Plano de acompanhamento" : t.category}
          </p>
        </td>
        <td className="p-3 whitespace-nowrap">
          {isFreeBalance(t) ? (
            <>
              <span>Sem vencimento</span>
              <p className="text-xs text-slate-500">
                {lastPayment
                  ? `Último pagamento: ${formatClinicalDate(lastPayment.paid_on)}`
                  : "Nenhum pagamento"}
              </p>
            </>
          ) : (
            formatClinicalDate(t.due_date)
          )}
        </td>
        <td className="p-3 text-right tabular-nums">{currency(t.amount)}</td>
        <td className="p-3 text-right tabular-nums">{currency(t.paid_amount)}</td>
        <td className="p-3 text-right font-semibold tabular-nums">{currency(balance)}</td>
        <td className="p-3">
          <span
            className={`rounded-md px-2 py-1 text-xs ${overdue ? "bg-red-50 text-red-700" : balance === 0 && t.status !== "cancelado" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
          >
            {titleStatus(t, today)}
          </span>
        </td>
        <td className="p-3">
          <div className="flex items-center justify-end gap-2">
            {balance > 0 && t.can_settle ? (
              <Button size="sm" variant="outline" onClick={() => onSelect(t.id)}>
                {receiving ? "Receber" : "Registrar pagamento"}
              </Button>
            ) : (
              <button className="text-sm text-primary" onClick={() => onSelect(t.id)}>
                Histórico
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Mais ações: ${t.description}`}>
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onSelect(t.id)}>
                  Detalhes e histórico
                </DropdownMenuItem>
                {t.can_cancel &&
                  !t.treatment_id &&
                  t.status !== "cancelado" &&
                  !finance.payments.some((p) => p.transaction_id === t.id) && (
                    <DropdownMenuItem className="text-red-700" onSelect={() => onCancel(t.id)}>
                      Cancelar conta
                    </DropdownMenuItem>
                  )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>
    );
  };
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {receiving ? "Contas a Receber" : "Contas a Pagar"}
          </h1>
          <p className="text-sm text-slate-500">
            {receiving
              ? "Pacientes, cobranças e saldos pendentes."
              : "Fornecedores, despesas e pagamentos."}
          </p>
        </div>
        <Button disabled={!canCreate} onClick={onNew}>
          <Plus size={16} />
          {receiving ? "Nova conta a receber" : "Nova conta a pagar"}
        </Button>
      </header>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
        <label className="min-w-48 flex-1 text-sm">
          Busca
          <input
            className={fieldClass}
            placeholder={receiving ? "Paciente, pagador ou descrição" : "Fornecedor ou descrição"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Situação
          <select className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Em aberto</option>
            <option value="overdue">Vencidas</option>
            <option value="upcoming">Hoje e a vencer</option>
            <option value="free">Sem vencimento</option>
            <option value="paid">Quitadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <label className="text-sm">
          Vencimento de
          <input
            className={fieldClass}
            type="date"
            disabled={status === "free"}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Até
          <input
            className={fieldClass}
            type="date"
            disabled={status === "free"}
            min={start}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        {finance.scopes.length > 1 && (
          <label className="text-sm">
            Clínica
            <select className={fieldClass} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">Todas autorizadas</option>
              {finance.scopes.map((s) => (
                <option key={s.id ?? "legacy"} value={s.id ?? "legacy"}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-white px-4 py-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{currency(value)}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Resumo de todos os saldos da busca e clínica, independente da situação e do período de
        vencimento. As três faixas compõem o total em aberto.
      </p>
      {(start || end) && status !== "free" && free.length > 0 && (
        <p className="text-sm text-amber-800">
          {free.length} saldo(s) sem vencimento fora do período.{" "}
          <button className="underline" onClick={() => setStatus("free")}>
            Ver saldos sem vencimento
          </button>
        </p>
      )}
      {!rangeValid && status !== "free" ? (
        <p role="alert" className="text-red-700">
          A data inicial deve ser anterior ou igual à final.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                {[
                  receiving ? "Paciente / origem" : "Fornecedor / descrição",
                  "Vencimento",
                  "Valor",
                  receiving ? "Recebido" : "Pago",
                  "Saldo",
                  "Situação",
                  "Ação",
                ].map((label, i) => (
                  <th
                    key={label}
                    className={`p-3 font-medium text-slate-500 ${i >= 2 && i <= 4 ? "text-right" : ""}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(groups, ([key, titles]) =>
                titles.length === 1 || !titles[0].treatment_id ? (
                  titles.map(renderTitle)
                ) : (
                  <Fragment key={key}>
                    <tr className="border-t bg-slate-50/70">
                      <td colSpan={7} className="p-3">
                        <button
                          className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                          aria-expanded={expanded.has(key)}
                          onClick={() =>
                            setExpanded((previous) => {
                              const next = new Set(previous);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        >
                          <span className="font-medium">
                            {expanded.has(key) ? "−" : "+"}{" "}
                            {titles[0].patient_name || titles[0].payer_name} · Plano ·{" "}
                            {titles.length} cobranças no filtro
                          </span>
                          <span>
                            Saldo no filtro: <strong>{currency(sum(titles))}</strong>
                          </span>
                        </button>
                      </td>
                    </tr>
                    {expanded.has(key) && titles.map(renderTitle)}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">
              Nenhuma conta para os filtros selecionados.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

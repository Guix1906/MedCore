import { useContext, useState } from "react";
import { Download, Plus, SlidersHorizontal } from "lucide-react";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
} from "@/features/acompanhamentos/followup-utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import type { OperationsSnapshot } from "./operations-schema";
import type { CashFlowSnapshot } from "./cash-flow-schema";
import { availableCashFlow } from "./available-cash-flow";
import { exportFinanceCsv } from "./export-csv";
import OperationForm, {
  Field,
  Reason,
  OperationLock,
  fieldClass,
  formMoney,
  formText,
} from "./OperationForm";
import CardDeposits from "./CardDeposits";

export default function CashFlow({
  finance,
  ops,
  cash,
  onSelectTitle,
  onOpenTitles,
}: {
  finance: FinanceSnapshot;
  ops: OperationsSnapshot;
  cash: CashFlowSnapshot;
  onSelectTitle: (id: string) => void;
  onOpenTitles: (type: FinancialTitle["type"]) => void;
}) {
  const { active } = useContext(OperationLock);
  const [start, setStart] = useState(localDate().slice(0, 7) + "-01");
  const [end, setEnd] = useState(localDate());
  const [account, setAccount] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [matched, setMatched] = useState("all");
  const [filters, setFilters] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [reversing, setReversing] = useState("");
  let flow: ReturnType<typeof availableCashFlow> | undefined;
  let failure = "";
  try {
    flow = availableCashFlow(cash, ops, start, end, account);
  } catch (error) {
    failure = errorMessage(error);
  }
  const matches = ops.matches.filter((m) => !m.reversed_at);
  const isMatched = (entry: OperationsSnapshot["entries"][number]) =>
    matches.some((m) => m.source_kind === entry.source_kind && m.source_id === entry.source_id);
  const paymentFor = (entry: OperationsSnapshot["entries"][number]) =>
    finance.payments.find(
      (p) =>
        p.id ===
        (entry.source_kind === "card"
          ? ops.cards.find((c) => c.id === entry.source_id)?.payment_id
          : entry.source_kind === "payment"
            ? entry.source_id
            : null),
    );
  const titleFor = (entry: OperationsSnapshot["entries"][number]) =>
    finance.titles.find((t) => t.id === paymentFor(entry)?.transaction_id);
  const rows =
    flow?.rows.filter((entry) => {
      const title = titleFor(entry);
      return (
        [entry.description, title?.patient_name, title?.payer_name].some((s) =>
          (s ?? "").toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        ) &&
        (kind === "all" ||
          (kind === "transfer"
            ? entry.source_kind.startsWith("transfer_")
            : !entry.source_kind.startsWith("transfer_") &&
              (kind === "income" ? entry.amount > 0 : entry.amount < 0))) &&
        (matched === "all" || isMatched(entry) === (matched === "yes"))
      );
    }) ?? [];
  const name = (id: string) => cash.accounts.find((a) => a.id === id)?.name ?? "Conta indisponível";
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Fluxo de Caixa</h1>
          <p className="text-sm text-slate-500">Movimentações efetivas de caixa e bancos.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!flow}
            onClick={() =>
              exportFinanceCsv(`fluxo-${start}-${end}.csv`, [
                ["Período", start, end],
                ["Conta", account ? name(account) : "Caixa e bancos"],
                ["Saldo inicial", flow?.opening == null ? null : flow.opening / 100],
                ["Entradas", (flow?.income ?? 0) / 100],
                ["Saídas", (flow?.expense ?? 0) / 100],
                ["Saldo final", flow?.closing == null ? null : flow.closing / 100],
                ["Saldos são da conta/período, não da busca"],
                [
                  "Data",
                  "Descrição",
                  "Pessoa",
                  "Conta",
                  "Entrada",
                  "Saída",
                  "Saldo cronológico",
                  "Conciliação",
                ],
                ...rows.map((e) => [
                  e.date,
                  e.description ?? "",
                  titleFor(e)?.patient_name || titleFor(e)?.payer_name || "",
                  name(e.account_id),
                  e.amount > 0 ? e.amount : 0,
                  e.amount < 0 ? -e.amount : 0,
                  e.balance === null ? null : e.balance / 100,
                  isMatched(e) ? "Conciliado" : "Pendente",
                ]),
              ])
            }
          >
            <Download size={16} />
            Exportar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={!!active}>
                <Plus size={16} />
                Registrar movimentação
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpenTitles("receita")}>
                Localizar conta e receber
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenTitles("despesa")}>
                Localizar conta e registrar pagamento
              </DropdownMenuItem>
              {ops.can_manage && (
                <DropdownMenuItem onSelect={() => setTransfer(true)}>
                  Registrar transferência realizada
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
        <label className="text-sm">
          De
          <input
            type="date"
            className={fieldClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Até
          <input
            type="date"
            className={fieldClass}
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Conta
          <select
            className={fieldClass}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Caixa e bancos</option>
            {cash.accounts
              .filter((a) => a.kind === "available")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {!a.active ? " (inativa)" : ""}
                </option>
              ))}
          </select>
        </label>
        <label className="min-w-40 flex-1 text-sm">
          Busca
          <input
            className={fieldClass}
            placeholder="Descrição ou pessoa"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button variant="outline" aria-expanded={filters} onClick={() => setFilters(!filters)}>
          <SlidersHorizontal size={16} />
          Filtros{kind !== "all" || matched !== "all" ? " (ativos)" : ""}
        </Button>
      </div>
      {filters && (
        <div className="flex gap-3 rounded-lg border bg-white p-3">
          <label className="text-sm">
            Movimento
            <select className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">Todos</option>
              <option value="income">Entradas</option>
              <option value="expense">Saídas</option>
              <option value="transfer">Transferências</option>
            </select>
          </label>
          <label className="text-sm">
            Conciliação
            <select
              className={fieldClass}
              value={matched}
              onChange={(e) => setMatched(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="yes">Conciliados</option>
              <option value="no">Pendentes</option>
            </select>
          </label>
        </div>
      )}
      {failure && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
          {failure}
        </p>
      )}
      {flow && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Saldo inicial", flow.opening],
              ["Entradas", flow.income],
              ["Saídas", flow.expense],
              ["Saldo final", flow.closing],
            ].map(([label, amount]) => (
              <div key={String(label)} className="rounded-xl border bg-white px-4 py-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-semibold tabular-nums">
                  {amount === null ? "Pendente" : currency(Number(amount) / 100)}
                </p>
              </div>
            ))}
          </div>
          {!flow.complete && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Saldo incompleto: confira contas sem classificação, abertura anterior ao período e{" "}
              {flow.unassigned} pagamento(s) sem conta. Cadastros e abertura ficam em Configurações
              → Contas financeiras.
            </p>
          )}
          {flow.legacy > 0 && (
            <p role="alert" className="text-xs text-amber-800">
              Há {flow.legacy} pagamento(s) legado(s) no período. Confira datas e contas.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Saldos e resumo consideram a conta e o período completos, não a busca nem os filtros
            adicionais. Transferências internas se anulam no consolidado. Cartões só entram após o
            depósito.
          </p>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    "Data efetiva",
                    "Descrição / pessoa",
                    "Conta",
                    "Entrada",
                    "Saída",
                    "Saldo",
                    "Conciliação",
                  ].map((label) => (
                    <th className="p-3 font-medium text-slate-500" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const title = titleFor(entry);
                  return (
                    <tr
                      className="border-t hover:bg-slate-50"
                      key={`${entry.source_kind}:${entry.source_id}`}
                    >
                      <td className="whitespace-nowrap p-3">{formatClinicalDate(entry.date)}</td>
                      <td className="p-3">
                        {title ? (
                          <button
                            className="text-left hover:text-primary hover:underline"
                            onClick={() => onSelectTitle(title.id)}
                          >
                            {entry.description || title.description}
                          </button>
                        ) : (
                          entry.description || "Transferência"
                        )}
                        <p className="text-xs text-slate-500">
                          {title?.patient_name || title?.payer_name}
                          {entry.internal ? " · Transferência interna" : ""}
                        </p>
                        {ops.can_manage &&
                          entry.source_kind.startsWith("transfer_") &&
                          !isMatched(entry) && (
                            <button
                              className="text-xs text-slate-500 underline"
                              onClick={() => setReversing(entry.source_id)}
                            >
                              Detalhes / corrigir registro
                            </button>
                          )}
                      </td>
                      <td className="p-3">{name(entry.account_id)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-700">
                        {entry.amount > 0 ? currency(entry.amount) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {entry.amount < 0 ? currency(-entry.amount) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {entry.balance === null ? "Pendente" : currency(entry.balance / 100)}
                      </td>
                      <td className="p-3 text-xs">
                        {isMatched(entry) ? "Conciliado" : "Pendente"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="p-8 text-center text-sm text-slate-500">
                Nenhuma movimentação para os filtros selecionados.
              </p>
            )}
          </div>
        </>
      )}
      <CardDeposits finance={finance} ops={ops} />
      <Dialog
        open={transfer || !!reversing}
        onOpenChange={(open) => {
          if (!open && !active) {
            setTransfer(false);
            setReversing("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reversing
                ? "Corrigir transferência registrada"
                : "Registrar transferência realizada"}
            </DialogTitle>
            <DialogDescription>
              Registro administrativo. O sistema não executa transferências no banco.
            </DialogDescription>
          </DialogHeader>
          {reversing ? (
            <OperationForm
              key={reversing}
              title="Desfazer registro incorreto"
              onSuccess={() => setReversing("")}
              execute={(f) =>
                supabase.rpc("reverse_account_transfer", {
                  p_id: reversing,
                  p_reason: formText(f, "reason"),
                })
              }
            >
              <p className="text-sm sm:col-span-2">
                Transferência: {cash.transfers.find((t) => t.id === reversing)?.description}.
                Corrigir não representa devolver dinheiro.
              </p>
              <Reason />
            </OperationForm>
          ) : (
            transfer && (
              <OperationForm
                title="Dados da transferência"
                onSuccess={() => setTransfer(false)}
                execute={(f, id) =>
                  supabase.rpc("record_account_transfer", {
                    p_id: id,
                    p_from: formText(f, "from"),
                    p_to: formText(f, "to"),
                    p_amount: formMoney(f, "amount"),
                    p_date: formText(f, "date"),
                    p_description: formText(f, "description"),
                  })
                }
              >
                <Field
                  name="from"
                  label="Conta de origem"
                  options={finance.accounts.filter(
                    (a) => a.active && a.balance_kind === "available",
                  )}
                />
                <Field
                  name="to"
                  label="Conta de destino"
                  options={finance.accounts.filter(
                    (a) => a.active && a.balance_kind === "available",
                  )}
                />
                <Field name="amount" label="Valor (R$)" />
                <Field
                  name="date"
                  label="Data efetiva"
                  type="date"
                  value={ops.business_date}
                  max={ops.business_date}
                />
                <Field name="description" label="Descrição / referência" minLength={5} />
              </OperationForm>
            )
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
  moneyCents,
} from "@/features/acompanhamentos/followup-utils";
import { refreshFinance } from "./finance-api";
import { cashFlow } from "./cash-flow-math";
import type { CashAccount, CashFlowSnapshot } from "./cash-flow-schema";
import type { FinanceSnapshot } from "./finance-schema";

const input = "w-full rounded-lg border border-slate-200 p-2 text-sm";
const button = "rounded-lg bg-purple-600 px-3 py-2 text-white disabled:opacity-50";
const balance = (value: number | null) =>
  value === null ? "Pendente de conferência" : currency(value);

export default function CashFlow({ finance }: { finance: FinanceSnapshot }) {
  const [scope, setScope] = useState(finance.scopes[0]?.id || "legacy");
  const [start, setStart] = useState(() => `${localDate().slice(0, 7)}-01`);
  const [end, setEnd] = useState(localDate());
  const [account, setAccount] = useState("");
  const selectedScope = finance.scopes.find((s) => (s.id || "legacy") === scope);
  const query = useQuery({
    queryKey: ["cash-flow-snapshot", scope],
    enabled: !!selectedScope,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cash_flow_snapshot", {
        p_company_id: scope === "legacy" ? null : scope,
      });
      if (error) throw error;
      if (!data) throw new Error("Fluxo de caixa indisponível. Verifique a migração financeira.");
      return data;
    },
  });
  let result: ReturnType<typeof cashFlow> | undefined;
  let calculationError = "";
  if (query.data) {
    try {
      result = cashFlow(query.data, start, end, account);
    } catch (error) {
      calculationError = errorMessage(error);
    }
  }
  return (
    <section className="space-y-4">
      <h2 className="font-bold">Fluxo de caixa por conta</h2>
      <p className="text-sm text-slate-600">
        Saldo de abertura confirmado mais movimentações acumuladas. Transferências não são receitas
        nem despesas. Este controle não consulta o banco nem executa transferências.
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label>
          Clínica
          <select
            className={input}
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setAccount("");
            }}
          >
            {finance.scopes.map((s) => (
              <option key={s.id || "legacy"} value={s.id || "legacy"}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          De
          <input
            className={input}
            type="date"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            className={input}
            type="date"
            required
            min={start}
            max={localDate()}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label>
          Conta
          <select className={input} value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Todas, inclusive inativas</option>
            {query.data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {!a.active ? " (inativa)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!selectedScope && <p role="alert">Sem permissão financeira para esta clínica.</p>}
      {selectedScope && query.isPending && <p>Carregando fluxo de caixa...</p>}
      {query.error && (
        <div role="alert" className="rounded bg-red-50 p-3 text-red-800">
          {errorMessage(query.error)}
          <p>Confira a aplicação da migração de fluxo de caixa e suas permissões.</p>
          <button className="underline" onClick={() => query.refetch()}>
            Tentar novamente
          </button>
        </div>
      )}
      {!query.error && calculationError && (
        <p role="alert" className="text-red-700">
          {calculationError}
        </p>
      )}
      {!query.error && query.data && result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <p>Saldo calculado de caixa/bancos</p>
              <strong>{balance(result.available)}</strong>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p>Recebíveis de cartão (não disponíveis)</p>
              <strong>{balance(result.receivable)}</strong>
            </div>
          </div>
          <p className="text-xs text-slate-600">
            Valores baseados nos registros do sistema, não em conciliação bancária automática.
            Recebíveis não representam liquidação na conta, taxas ou chargebacks. Resultado do
            período não é lucro. Estornos corrigem o registro original e recalculam os períodos
            anteriores.
          </p>
          {(result.unassigned > 0 || result.legacy > 0) && (
            <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-900">
              Na clínica/período: {result.unassigned} baixa(s) sem conta, excluída(s) dos saldos por
              conta; {result.legacy} baixa(s) legada(s) requerem conferência. Não considere estes
              saldos como posição bancária conciliada.
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Conta / abertura",
                    "Saldo anterior",
                    "Recebimentos",
                    "Pagamentos",
                    "Resultado do período",
                    "Transferências líquidas",
                    "Saldo final",
                  ].map((h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.account.id} className="border-t">
                    <td className="p-3">
                      <strong>{r.account.name}</strong>
                      <p>
                        {r.account.kind === "available"
                          ? "Caixa/banco"
                          : r.account.kind === "receivable"
                            ? "Recebíveis"
                            : "Não classificada"}
                        {!r.account.active ? " / inativa" : ""}
                      </p>
                      <p className="text-xs">
                        {r.account.opening_date
                          ? `${formatClinicalDate(r.account.opening_date)}: ${currency(r.account.opening_amount!)}`
                          : "Abertura não confirmada"}
                      </p>
                      {r.account.opening_date && r.account.opening_date > start && (
                        <p className="text-amber-800">Selecione um início a partir da abertura.</p>
                      )}
                    </td>
                    {[r.opening, r.income, r.expense, r.result, r.transfers, r.closing].map(
                      (v, i) => (
                        <td key={i} className="p-3">
                          {balance(v)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length === 0 && (
              <p className="p-3">Nenhuma conta cadastrada nesta clínica.</p>
            )}
          </div>
          <details className="rounded-xl border bg-white p-4">
            <summary className="cursor-pointer font-semibold">
              Movimentações do período ({result.entries.length})
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {["Data", "Conta", "Tipo", "Valor", "Situação"].map((h) => (
                      <th key={h} className="p-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="p-2">{formatClinicalDate(e.date)}</td>
                      <td className="p-2">
                        {query.data.accounts.find((a) => a.id === e.accountId)?.name}
                      </td>
                      <td className="p-2">{e.kind}</td>
                      <td className="p-2">{currency(e.amount)}</td>
                      <td className="p-2">
                        {e.reversed ? "Estornado / fora dos totais" : "Ativo"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.entries.length === 0 && <p>Nenhuma movimentação neste período.</p>}
            </div>
          </details>
          <TransferHistory
            key={`${scope}:${account}:${start}:${end}`}
            data={query.data}
            start={start}
            end={end}
            accountId={account}
            canManage={!!selectedScope?.can_accounts}
          />
        </>
      )}
      {!query.error && query.data && selectedScope?.can_accounts && (
        <div key={scope} className="grid gap-4 lg:grid-cols-2">
          <OpeningForm accounts={query.data.accounts} />
          <TransferForm accounts={query.data.accounts} />
        </div>
      )}
    </section>
  );
}

function OpeningForm({ accounts }: { accounts: CashAccount[] }) {
  const qc = useQueryClient();
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDate());
  const [kind, setKind] = useState("available");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const negative = amount.trim().startsWith("-");
      const value =
        (moneyCents(negative ? amount.trim().slice(1) : amount) / 100) * (negative ? -1 : 1);
      setSubmitted(true);
      const { error } = await supabase.rpc("confirm_financial_opening", {
        p_account_id: account,
        p_amount: value,
        p_date: date,
        p_kind: kind,
        p_reference: reference,
      });
      if (error) {
        if (error.code === "P0001") setSubmitted(false);
        throw error;
      }
      setAccount("");
      setAmount("");
      setReference("");
      setSubmitted(false);
      await refreshFinance(qc);
      toast.success("Abertura confirmada com autoria e referência.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="font-semibold">Confirmar saldo de abertura</h3>
      <p className="text-xs text-slate-600">
        Informe o saldo conferido no início da data escolhida, antes dos movimentos daquele dia.
        Movimentos anteriores ficam incorporados à abertura, sem nova soma. A confirmação é
        imutável; não use valores estimados.
      </p>
      <fieldset disabled={busy || submitted} className="space-y-3">
        <label className="block">
          Conta
          <select
            required
            className={input}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Selecione</option>
            {accounts
              .filter((a) => !a.opening_date)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          Saldo conferido (R$, pode ser negativo)
          <input
            required
            inputMode="decimal"
            className={input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block">
          Data de início
          <input
            required
            type="date"
            max={localDate()}
            className={input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block">
          Natureza
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="available">Caixa / banco (disponibilidade)</option>
            <option value="receivable">Controle de recebíveis de cartão</option>
          </select>
        </label>
        <label className="block">
          Referência da conferência
          <input
            required
            minLength={5}
            className={input}
            placeholder="Extrato ou conferência de caixa, sem dados clínicos"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="flex gap-2 text-sm">
          <input type="checkbox" required />
          Conferi a data, o saldo e a natureza desta conta.
        </label>
      </fieldset>
      {submitted && (
        <p role="alert">
          Confirmação enviada. Em caso de falha de comunicação, repita os mesmos dados.
        </p>
      )}
      <button disabled={busy || (!submitted && !account)} className={button}>
        {busy ? "Salvando..." : submitted ? "Repetir confirmação" : "Confirmar abertura"}
      </button>
    </form>
  );
}

function TransferForm({ accounts }: { accounts: CashAccount[] }) {
  const qc = useQueryClient();
  const eligible = accounts.filter((a) => a.active && a.kind === "available" && a.opening_date);
  const [id, setId] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDate());
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const value = moneyCents(amount) / 100;
      if (value <= 0 || from === to) throw new Error("Informe valor positivo e contas diferentes.");
      setSubmitted(true);
      const { error } = await supabase.rpc("record_account_transfer", {
        p_id: id,
        p_from: from,
        p_to: to,
        p_amount: value,
        p_date: date,
        p_description: description,
      });
      if (error) {
        if (error.code === "P0001") setSubmitted(false);
        throw error;
      }
      setId(crypto.randomUUID());
      setAmount("");
      setDescription("");
      setSubmitted(false);
      await refreshFinance(qc);
      toast.success("Transferência registrada. Nenhuma operação bancária foi executada.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="font-semibold">Registrar transferência interna já realizada</h3>
      <p className="text-xs text-slate-600">
        Somente entre contas de caixa/banco da mesma clínica. Não use para liquidar cartões. O
        sistema registra o movimento informado; não confirma disponibilidade nem transfere dinheiro.
      </p>
      <fieldset disabled={busy || submitted} className="space-y-3">
        <label className="block">
          Origem
          <select
            required
            className={input}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setTo("");
            }}
          >
            <option value="">Selecione</option>
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Destino
          <select required className={input} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Selecione</option>
            {eligible
              .filter((a) => a.id !== from)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          Valor (R$)
          <input
            required
            inputMode="decimal"
            className={input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block">
          Data
          <input
            required
            type="date"
            max={localDate()}
            className={input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block">
          Referência administrativa
          <input
            required
            minLength={5}
            className={input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </fieldset>
      {eligible.length < 2 && (
        <p role="alert">Confirme a abertura de pelo menos duas contas de caixa/banco.</p>
      )}
      {submitted && (
        <p role="alert">
          Solicitação enviada. Repetir usa a mesma identificação, sem duplicar o movimento.
        </p>
      )}
      <button disabled={busy || eligible.length < 2} className={button}>
        {busy ? "Salvando..." : submitted ? "Repetir solicitação" : "Registrar transferência"}
      </button>
    </form>
  );
}

function TransferHistory({
  data,
  start,
  end,
  accountId,
  canManage,
}: {
  data: CashFlowSnapshot;
  start: string;
  end: string;
  accountId: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const transfers = data.transfers.filter(
    (t) =>
      t.date >= start &&
      t.date <= end &&
      (!accountId || t.from_account_id === accountId || t.to_account_id === accountId),
  );
  const reverse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSubmitted(true);
    try {
      const { error } = await supabase.rpc("reverse_account_transfer", {
        p_id: selected,
        p_reason: reason,
      });
      if (error) {
        if (error.code === "P0001") setSubmitted(false);
        throw error;
      }
      setSelected("");
      setReason("");
      setSubmitted(false);
      await refreshFinance(qc);
      toast.success("Registro estornado com histórico preservado. Nenhum dinheiro foi devolvido.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="font-semibold">Histórico de transferências ({transfers.length})</h3>
      {transfers.map((t) => (
        <div key={t.id} className="border-t pt-2 text-sm">
          <p>
            {formatClinicalDate(t.date)}:{" "}
            {data.accounts.find((a) => a.id === t.from_account_id)?.name} →{" "}
            {data.accounts.find((a) => a.id === t.to_account_id)?.name}: {currency(t.amount)}
          </p>
          <p>{t.description}</p>
          {t.reversed_at ? (
            <p>Estornado: {t.reversal_reason}</p>
          ) : (
            canManage && (
              <button
                disabled={busy || submitted}
                className="text-red-700 underline"
                onClick={() => {
                  setSelected(t.id);
                  setReason("");
                }}
              >
                Corrigir registro incorreto
              </button>
            )
          )}
        </div>
      ))}
      {selected && (
        <form onSubmit={reverse} className="space-y-3 border-t pt-3">
          <p className="text-sm">
            Esta correção exclui o registro dos cálculos sem apagá-lo. Uma transferência real de
            volta deve ser registrada como novo movimento.
          </p>
          <label>
            Justificativa
            <textarea
              required
              minLength={5}
              disabled={busy || submitted}
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={busy} className={button}>
            {submitted ? "Repetir correção" : "Confirmar correção"}
          </button>
          <button
            type="button"
            disabled={busy || submitted}
            className="ml-3"
            onClick={() => setSelected("")}
          >
            Cancelar
          </button>
        </form>
      )}
    </section>
  );
}

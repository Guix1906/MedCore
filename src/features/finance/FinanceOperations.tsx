import { useEffect, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currency, errorMessage } from "@/features/acompanhamentos/followup-utils";
import type { FinanceSnapshot } from "./finance-schema";
import { remaining, titleStatus } from "./finance-math";
import OperationForm, {
  Field,
  Reason,
  OperationLock,
  fieldClass,
  formMoney,
  formText,
} from "./OperationForm";
import ManagementReports from "./ManagementReports";
import BankReconciliation from "./BankReconciliation";

export const operationTabs = [
  "Caixa por turno",
  "Cartoes",
  "Repasses",
  "Conciliacao",
  "DRE / DFC",
] as const;
export type OperationTab = (typeof operationTabs)[number];

export default function FinanceOperations({
  finance,
  onLockChange,
  subTab,
  onSubTabChange,
  hideSubNav = false,
}: {
  finance: FinanceSnapshot;
  onLockChange: (locked: boolean) => void;
  subTab?: OperationTab;
  onSubTabChange?: (tab: OperationTab) => void;
  hideSubNav?: boolean;
}) {
  const [scope, setScope] = useState(finance.scopes[0]?.id ?? "legacy");
  const [internalTab, setInternalTab] = useState<OperationTab>("Caixa por turno");
  const [active, setActive] = useState<string | null>(null);
  const tab = subTab ?? internalTab;
  const setTab = (t: OperationTab) => {
    setInternalTab(t);
    onSubTabChange?.(t);
  };
  const company = scope === "legacy" ? null : scope;
  const allowed = finance.scopes.some((s) => s.id === company);
  const query = useQuery({
    queryKey: ["financial-operations", company],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_financial_operations", {
        p_company: company,
      });
      if (error) throw error;
      if (!data) throw new Error("Operacoes indisponiveis. Confira as migracoes financeiras.");
      return data;
    },
  });
  const cashQuery = useQuery({
    queryKey: ["cash-flow-snapshot", company],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cash_flow_snapshot", {
        p_company_id: company,
      });
      if (error) throw error;
      if (!data) throw new Error("Fluxo de caixa indisponivel.");
      return data;
    },
  });
  useEffect(() => {
    onLockChange(active !== null);
  }, [active, onLockChange]);
  useBlocker({ shouldBlockFn: () => active !== null, enableBeforeUnload: active !== null });
  const ops = query.data;
  const titles = finance.titles.filter((t) => t.company_id === company);
  const ids = new Set(titles.map((t) => t.id));
  const scoped: FinanceSnapshot = {
    ...finance,
    titles,
    payments: finance.payments.filter((p) => ids.has(p.transaction_id)),
    accounts: finance.accounts.filter((a) => a.company_id === company),
  };
  const accountName = (id: string) => scoped.accounts.find((a) => a.id === id)?.name ?? id;
  const receiptOptions = scoped.payments
    .filter(
      (p) =>
        !p.reversed_at && titles.some((t) => t.id === p.transaction_id && t.type === "receita"),
    )
    .map((p) => ({
      id: p.id,
      name: `${p.paid_on} ${currency(p.amount)} - ${titles.find((t) => t.id === p.transaction_id)?.description} [${p.id.slice(0, 8)}]`,
    }));
  return (
    <OperationLock.Provider value={{ active, setActive }}>
      <section className="space-y-4">
        <label className="block max-w-md">
          Clinica
          <select
            disabled={!!active}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className={fieldClass}
          >
            {finance.scopes.map((s) => (
              <option key={s.id ?? "legacy"} value={s.id ?? "legacy"}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {!hideSubNav && (
          <nav aria-label="Operacoes financeiras" className="flex flex-wrap gap-2">
            {operationTabs.map((t) => (
              <button
                key={t}
                disabled={!!active}
                aria-current={t === tab ? "page" : undefined}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-2 text-sm ${t === tab ? "bg-purple-100 text-purple-800" : "bg-white border"}`}
              >
                {t}
              </button>
            ))}
          </nav>
        )}
        {!allowed && <p role="alert">Sem clinica autorizada.</p>}
        {allowed && query.isPending && <p>Carregando operacoes...</p>}
        {(query.error || cashQuery.error) && (
          <div role="alert" className="rounded bg-red-50 p-3 text-red-800">
            {errorMessage(query.error ?? cashQuery.error)}
            <p>
              Dados anteriores, quando exibidos, podem estar desatualizados. Confira a conexao, as
              permissoes e todas as migracoes financeiras. Nenhum outro banco sera usado.
            </p>
            <button
              className="underline"
              onClick={() => {
                void query.refetch();
                void cashQuery.refetch();
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {ops && allowed && (
          <div key={scope} className="space-y-4">
            {tab === "Caixa por turno" && (
              <>
                <p className="text-sm text-slate-600">
                  A primeira abertura, feita por administrador, ativa o controle obrigatorio desta
                  conta caixa. Depois, somente dinheiro e baixas do operador/data do turno entram
                  nela; Pix e cartoes usam outras contas. A contagem nao altera o saldo bancario.
                  Sangrias e suprimentos sao transferencias na aba Fluxo de caixa, sem duplicar
                  despesas ou receitas. Data operacional do banco: {ops.business_date}.
                </p>
                {ops.can_receive && (
                  <OperationForm
                    title="Abrir turno e conferir fundo de caixa"
                    execute={(f, id) =>
                      supabase.rpc("open_financial_shift", {
                        p_id: id,
                        p_account: formText(f, "account"),
                        p_amount: formMoney(f, "amount"),
                        p_reason: formText(f, "reason"),
                      })
                    }
                  >
                    <Field
                      name="account"
                      label="Conta caixa com abertura confirmada"
                      options={scoped.accounts.filter(
                        (a) => a.type === "caixa" && a.active && a.balance_kind === "available",
                      )}
                    />
                    <Field name="amount" label="Dinheiro contado na abertura (R$)" />
                    <Reason />
                  </OperationForm>
                )}
                {ops.can_receive && (
                  <OperationForm
                    title="Fechar turno com contagem fisica"
                    execute={(f) =>
                      supabase.rpc("close_financial_shift", {
                        p_id: formText(f, "session"),
                        p_amount: formMoney(f, "amount"),
                        p_reason: formText(f, "reason"),
                      })
                    }
                  >
                    <Field
                      name="session"
                      label="Turno aberto autorizado"
                      options={ops.sessions
                        .filter(
                          (s) =>
                            s.managed &&
                            !s.closed_at &&
                            (s.opened_by === ops.user_id || ops.can_manage),
                        )
                        .map((s) => ({
                          id: s.id,
                          name: `${accountName(s.account_id)} - ${s.business_date}`,
                        }))}
                    />
                    <Field name="amount" label="Dinheiro contado no fechamento (R$)" />
                    <Reason />
                  </OperationForm>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>Conta / turno</th>
                        <th>Operador</th>
                        <th>Abertura</th>
                        <th>Esperado</th>
                        <th>Contado / diferenca</th>
                        <th>Situacao</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ops.sessions.map((s) => {
                        const expected = s.closed_at ? s.expected_amount : s.current_expected;
                        return (
                          <tr key={s.id} className="border-t">
                            <td className="p-2">
                              {accountName(s.account_id)}
                              <p>{s.business_date ?? s.opened_at}</p>
                              <p>{s.opening_reference}</p>
                            </td>
                            <td className="break-all">{s.opened_by}</td>
                            <td>{currency(s.opening_amount)}</td>
                            <td>
                              {s.managed && expected !== null ? currency(expected) : "Conferir"}
                            </td>
                            <td>
                              {s.physical_amount === null ? "-" : currency(s.physical_amount)} /{" "}
                              {s.difference === null ? "-" : currency(s.difference)}
                            </td>
                            <td>
                              {s.closed_at ? "Fechado" : "Aberto"}
                              <p>{s.notes}</p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs">
                  Turnos fechados sao imutaveis. Diferencas ficam registradas, sem ajuste automatico
                  de saldo; devem ser apuradas. Turnos legados nao sao convertidos por suposicao.
                </p>
              </>
            )}
            {tab === "Cartoes" && (
              <>
                <p className="text-sm text-slate-600">
                  Registre a liquidacao integral de cada baixa de cartao apos conferir o extrato da
                  adquirente. O bruto sai dos recebiveis; o banco recebe o liquido e a taxa vira
                  despesa paga. Isso nao gera outra receita nem altera a quitacao do paciente.
                  Antecipacoes, lotes parciais e chargebacks nao sao simulados.
                </p>
                {ops.can_manage && (
                  <>
                    <OperationForm
                      title="Liquidar recebimento de cartao"
                      execute={(f, id) =>
                        supabase.rpc("settle_financial_card", {
                          p_id: id,
                          p_payment: formText(f, "payment"),
                          p_bank: formText(f, "bank"),
                          p_fee: formMoney(f, "fee"),
                          p_date: formText(f, "date"),
                          p_reference: formText(f, "reason"),
                        })
                      }
                    >
                      <Field
                        name="payment"
                        label="Baixa ainda nao liquidada"
                        options={receiptOptions.filter(
                          (r) =>
                            scoped.payments.some(
                              (p) =>
                                p.id === r.id &&
                                ["cartao_credito", "cartao_debito"].includes(
                                  p.payment_method ?? "",
                                ),
                            ) && !ops.cards.some((c) => c.payment_id === r.id && !c.reversed_at),
                        )}
                      />
                      <Field
                        name="bank"
                        label="Banco de destino"
                        options={scoped.accounts.filter(
                          (a) => a.active && a.balance_kind === "available" && a.type !== "caixa",
                        )}
                      />
                      <Field name="fee" label="Taxa total conferida (R$)" value="0.00" />
                      <Field
                        name="date"
                        label="Data do credito"
                        type="date"
                        max={ops.business_date}
                      />
                      <Reason />
                    </OperationForm>
                    <OperationForm
                      title="Corrigir liquidacao incorreta"
                      execute={(f) =>
                        supabase.rpc("reverse_financial_card", {
                          p_id: formText(f, "card"),
                          p_reason: formText(f, "reason"),
                        })
                      }
                    >
                      <Field
                        name="card"
                        label="Liquidacao ativa"
                        options={ops.cards
                          .filter((c) => !c.reversed_at)
                          .map((c) => ({ id: c.id, name: c.reference }))}
                      />
                      <Reason />
                    </OperationForm>
                  </>
                )}
                {ops.cards.map((c) => {
                  const p = scoped.payments.find((p) => p.id === c.payment_id);
                  return (
                    <article key={c.id} className="rounded border p-3 text-sm">
                      <strong>{c.reference}</strong>
                      <p>
                        Bruto: {p ? currency(p.amount) : "Indisponivel"} / Taxa: {currency(c.fee)} /
                        Liquido: {p ? currency(p.amount - c.fee) : "Indisponivel"}
                      </p>
                      <p>
                        {c.reversed_at ? `Corrigida: ${c.reversal_reason}` : "Ativa"} - Autor:{" "}
                        {c.created_by}
                      </p>
                    </article>
                  );
                })}
              </>
            )}
            {tab === "Repasses" && (
              <>
                <p className="text-sm text-slate-600">
                  Aprovacao manual por recebimento bruto efetivo, nao por agendamento ou simples
                  cadastro de percentual. Confira o contrato e informe competencia e vencimento. A
                  soma dos repasses nao pode exceder o recebimento. O titulo gerado em A pagar
                  aceita baixas parciais; aprovar nao significa pagar.
                </p>
                {ops.can_manage && (
                  <OperationForm
                    title="Aprovar repasse sobre recebimento"
                    execute={(f, id) =>
                      supabase.rpc("approve_financial_commission", {
                        p_id: id,
                        p_payment: formText(f, "payment"),
                        p_doctor: formText(f, "doctor"),
                        p_percent: formMoney(f, "percent"),
                        p_due: formText(f, "due"),
                        p_competence: formText(f, "competence"),
                        p_reason: formText(f, "reason"),
                      })
                    }
                  >
                    <Field name="payment" label="Recebimento base" options={receiptOptions} />
                    <Field name="doctor" label="Profissional" options={ops.doctors} />
                    <Field name="percent" label="Percentual aprovado sobre o bruto (%)" />
                    <Field name="due" label="Vencimento" type="date" />
                    <Field
                      name="competence"
                      label="Competencia do direito ao repasse"
                      type="date"
                    />
                    <Reason />
                  </OperationForm>
                )}
                {ops.commissions.map((c) => {
                  const t = titles.find((t) => t.id === c.title_id);
                  return (
                    <article key={c.id} className="rounded border p-3 text-sm">
                      <strong>
                        {ops.doctors.find((d) => d.id === c.doctor_id)?.name ?? c.doctor_id}
                      </strong>
                      <p>
                        {c.percent}% - {currency(c.amount)} -{" "}
                        {t ? titleStatus(t, ops.business_date) : "Titulo indisponivel"} - Saldo:{" "}
                        {t ? currency(remaining(t)) : "Conferir"}
                      </p>
                      <p>
                        {c.reason} - Aprovado por: {c.created_by}
                      </p>
                      <p>Titulo em A pagar: {c.title_id}</p>
                    </article>
                  );
                })}
                <p className="text-xs">
                  Cancelamento antes de qualquer baixa e feito no titulo em A pagar e permite nova
                  aprovacao corrigida. Recebimentos com repasses ativos nao podem ser estornados sem
                  resolver a obrigacao dependente.
                </p>
              </>
            )}
            {tab === "Conciliacao" && <BankReconciliation finance={scoped} ops={ops} />}
            {tab === "DRE / DFC" &&
              (cashQuery.isPending ? (
                <p>Carregando saldos...</p>
              ) : (
                cashQuery.data &&
                !cashQuery.error && (
                  <ManagementReports finance={scoped} ops={ops} cash={cashQuery.data} />
                )
              ))}
          </div>
        )}
      </section>
    </OperationLock.Provider>
  );
}

import { currency, formatClinicalDate, localDate } from "@/features/acompanhamentos/followup-utils";
import { supabase } from "@/integrations/supabase/client";
import type { FinanceSnapshot } from "./finance-schema";
import type { CashFlowSnapshot } from "./cash-flow-schema";
import type { OperationsSnapshot } from "./operations-schema";
import OperationForm, { Field, Reason, formMoney, formText } from "./OperationForm";

export default function FinancialAccounts({
  finance,
  cash,
  ops,
}: {
  finance: FinanceSnapshot;
  cash: CashFlowSnapshot;
  ops: OperationsSnapshot;
}) {
  const company = finance.scopes[0]?.id ?? null;
  const pending = cash.accounts.filter((a) => !a.opening_date);
  const legacyAccounts = finance.accounts.filter((a) =>
    ops.sessions.some((s) => s.account_id === a.id && s.managed),
  );
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Contas financeiras</h2>
        <p className="text-sm text-slate-500">
          Caixa físico, bancos e recebíveis de cartão. Saldos iniciais exigem conferência; não são
          presumidos como zero.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {["Conta", "Natureza", "Saldo inicial", "Data de abertura", "Situação"].map(
                (label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {cash.accounts.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-3">{a.name}</td>
                <td className="p-3">
                  {a.kind === "available"
                    ? "Caixa / banco"
                    : a.kind === "receivable"
                      ? "Recebíveis de cartão"
                      : "Não classificada"}
                </td>
                <td className="p-3">
                  {a.opening_amount === null ? "Não confirmado" : currency(a.opening_amount)}
                </td>
                <td className="p-3">
                  {a.opening_date ? formatClinicalDate(a.opening_date) : "Não confirmada"}
                </td>
                <td className="p-3">{a.active ? "Ativa" : "Inativa"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cash.accounts.length === 0 && (
          <p className="p-4 text-sm">Nenhuma conta cadastrada nesta clínica.</p>
        )}
      </div>
      {ops.can_manage && (
        <>
          <details className="rounded-xl border bg-white p-4">
            <summary className="cursor-pointer font-medium">Cadastrar conta</summary>
            <div className="mt-3">
              <OperationForm
                title="Nova conta financeira"
                execute={(f, id) =>
                  supabase.rpc("create_financial_account", {
                    p_id: id,
                    p_name: formText(f, "name"),
                    p_type: formText(f, "type"),
                    p_company_id: company,
                  })
                }
              >
                <Field name="name" label="Nome da conta" />
                <Field
                  name="type"
                  label="Tipo"
                  options={[
                    { id: "corrente", name: "Banco / controle de recebíveis" },
                    { id: "caixa", name: "Caixa físico" },
                  ]}
                />
                <p className="text-xs text-slate-500 sm:col-span-2">
                  Após cadastrar, confirme a natureza e o saldo inicial abaixo antes de usar o saldo
                  nos demonstrativos.
                </p>
              </OperationForm>
            </div>
          </details>
          {pending.length > 0 && (
            <OperationForm
              title="Confirmar natureza e saldo inicial"
              execute={(f) => {
                const raw = formText(f, "amount");
                const negative = raw.startsWith("-");
                const amountForm = new FormData();
                amountForm.set("amount", negative ? raw.slice(1) : raw);
                return supabase.rpc("confirm_financial_opening", {
                  p_account_id: formText(f, "account"),
                  p_amount: formMoney(amountForm, "amount") * (negative ? -1 : 1),
                  p_date: formText(f, "date"),
                  p_kind: formText(f, "kind"),
                  p_reference: formText(f, "reason"),
                });
              }}
            >
              <Field name="account" label="Conta sem abertura" options={pending} />
              <Field
                name="kind"
                label="Natureza"
                options={[
                  { id: "available", name: "Disponível em caixa / banco" },
                  { id: "receivable", name: "Recebíveis de cartão (não disponível)" },
                ]}
              />
              <Field name="amount" label="Saldo no início do dia (R$)" />
              <Field name="date" label="Data da abertura conferida" type="date" max={localDate()} />
              <Reason />
              <p className="text-xs text-slate-500 sm:col-span-2">
                Movimentos do dia entram depois da abertura. Uma abertura confirmada não pode ser
                sobrescrita.
              </p>
            </OperationForm>
          )}
          {legacyAccounts.length > 0 && (
            <details className="rounded-xl border bg-white p-4">
              <summary className="cursor-pointer text-sm">
                Desativar controle legado por turno
              </summary>
              <p className="my-3 text-sm text-slate-500">
                Somente para contas que já utilizavam turnos. A desativação encerra o turno aberto
                com a contagem informada, preserva o histórico e permite a rotina sem abertura
                diária.
              </p>
              <OperationForm
                title="Encerrar controle por turno desta conta"
                execute={(f) =>
                  supabase.rpc("retire_financial_shift_control", {
                    p_account: formText(f, "account"),
                    p_amount: formMoney(f, "amount"),
                    p_reason: formText(f, "reason"),
                  })
                }
              >
                <Field name="account" label="Conta de caixa" options={legacyAccounts} />
                <Field
                  name="amount"
                  label="Contagem física atual (R$); zero se não houver turno aberto"
                />
                <Reason />
              </OperationForm>
            </details>
          )}
        </>
      )}
    </section>
  );
}

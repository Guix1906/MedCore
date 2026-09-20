import { currency } from "@/features/acompanhamentos/followup-utils";
import { supabase } from "@/integrations/supabase/client";
import type { FinanceSnapshot } from "./finance-schema";
import type { OperationsSnapshot } from "./operations-schema";
import OperationForm, { Field, Reason, formMoney, formText } from "./OperationForm";

export default function CardDeposits({
  finance,
  ops,
}: {
  finance: FinanceSnapshot;
  ops: OperationsSnapshot;
}) {
  const pending = finance.payments.filter(
    (p) =>
      !p.reversed_at &&
      ["cartao_credito", "cartao_debito"].includes(p.payment_method ?? "") &&
      !ops.cards.some((c) => c.payment_id === p.id && !c.reversed_at),
  );
  return (
    <details className="rounded-xl border bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Depósitos de cartão · {pending.length} recebimento(s) aguardando depósito
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-500">
          O pagamento já abateu a dívida do paciente. Registre aqui o depósito confirmado da
          operadora, sem criar outra receita. Cada registro liquida integralmente um recebimento.
        </p>
        {ops.can_manage && pending.length > 0 && (
          <OperationForm
            title="Registrar depósito da operadora"
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
              label="Recebimento no cartão"
              options={pending.map((p) => ({
                id: p.id,
                name: `${p.paid_on} · ${currency(p.amount)} · ${finance.titles.find((t) => t.id === p.transaction_id)?.patient_name || p.payer_name || p.id}`,
              }))}
            />
            <Field
              name="bank"
              label="Banco de destino"
              options={finance.accounts.filter(
                (a) => a.active && a.balance_kind === "available" && a.type !== "caixa",
              )}
            />
            <Field name="fee" label="Taxa total (R$)" value="0.00" />
            <Field name="date" label="Data do depósito" type="date" max={ops.business_date} />
            <Reason />
          </OperationForm>
        )}
        <details>
          <summary className="cursor-pointer text-sm">
            Histórico de depósitos ({ops.cards.length})
          </summary>
          <div className="mt-3 space-y-2">
            {ops.cards.map((c) => {
              const payment = finance.payments.find((p) => p.id === c.payment_id);
              return (
                <div key={c.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {c.reference} · {c.reversed_at ? "Registro desfeito" : "Confirmado"}
                  </p>
                  <p>
                    Bruto: {payment ? currency(payment.amount) : "Indisponível"} · Taxa:{" "}
                    {currency(c.fee)} · Líquido:{" "}
                    {payment ? currency(payment.amount - c.fee) : "Indisponível"}
                  </p>
                  {c.reversed_at && <p>{c.reversal_reason}</p>}
                  {ops.can_manage && !c.reversed_at && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-red-700">
                        Desfazer registro incorreto
                      </summary>
                      <OperationForm
                        title="Correção do registro, não devolução"
                        execute={(f) =>
                          supabase.rpc("reverse_financial_card", {
                            p_id: c.id,
                            p_reason: formText(f, "reason"),
                          })
                        }
                      >
                        <Reason />
                      </OperationForm>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </details>
  );
}

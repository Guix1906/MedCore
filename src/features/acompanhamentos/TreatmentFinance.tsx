import PaymentHistory from "@/features/finance/PaymentHistory";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { remaining, titleStatus } from "@/features/finance/finance-math";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { FinancialPlan } from "@/features/finance/finance-schema";
import { confirmDialog } from "@/components/app/confirm-dialog";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
  PAYMENT_METHODS,
  paymentPreview,
} from "./followup-utils";

const input = "w-full rounded-lg border border-slate-200 p-2 text-sm";
function Methods({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select required className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecione</option>
      {Object.entries(PAYMENT_METHODS)
        .filter(([key]) => key !== "convenio")
        .map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
    </select>
  );
}
const methodLabel = (value: string | null) =>
  Object.entries(PAYMENT_METHODS).find(([key]) => key === value)?.[1] || value || "Não informada";

function PlanPayments({ plan }: { plan: FinancialPlan }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState("");
  const ledger = useQuery({ queryKey: ["financial-snapshot"], queryFn: getFinancialSnapshot });
  const [form, setForm] = useState({
    total: String(plan.total_value),
    discount: String(plan.discount),
    down: String(plan.down_payment),
    type: plan.payment_type,
    downMethod: plan.down_payment_method || "",
    method: plan.payment_method || "",
    count: String(plan.installments_count || 1),
    downDue: plan.down_payment_due_date || localDate(),
    firstDue: plan.first_due_date || localDate(),
  });
  const planTitles = ledger.data?.titles.filter((t) => t.treatment_id === plan.id) || [];
  const paid = ledger.data?.payments.some((p) => planTitles.some((t) => t.id === p.transaction_id));
  const selected = planTitles.find((t) => t.id === selectedTitle);
  let preview: ReturnType<typeof paymentPreview> | undefined;
  let previewError = "";
  try {
    preview = paymentPreview(form.total, form.discount, form.down, Number(form.count));
  } catch (error) {
    previewError = errorMessage(error);
  }
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["treatment-installments", plan.id] }),
      qc.invalidateQueries({ queryKey: ["treatment-finance-plans"] }),
      qc.invalidateQueries({ queryKey: ["treatment-alerts"] }),
      qc.invalidateQueries({ queryKey: ["transactions"] }),
      qc.invalidateQueries({ queryKey: ["treatment-ledger"] }),
      refreshFinance(qc),
    ]);
  const configure = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) {
      toast.error(previewError);
      return;
    }
    if (
      !(await confirmDialog({
        title: "Salvar condições do plano",
        description:
          "As parcelas ainda não pagas serão substituídas. A entrada será criada como pendente; confirme o recebimento separadamente.",
        confirmText: "Salvar condições",
      }))
    )
      return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("configure_treatment_payment", {
        p_treatment_id: plan.id,
        p_total: preview.total,
        p_discount: preview.discount,
        p_down: preview.down,
        p_type: form.type,
        p_down_method: form.downMethod || null,
        p_method: form.method || null,
        p_count: form.type === "a_vista" ? 1 : Number(form.count),
        p_down_due: form.downDue || null,
        p_first_due: form.firstDue || null,
      });
      if (error) throw error;
      await refresh();
      toast.success("Entrada e parcelas salvas no Financeiro.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {paid && (
        <p className="text-sm text-amber-800">
          Este plano já possui recebimentos. As condições não podem ser regeneradas para preservar o
          histórico.
        </p>
      )}
      <form onSubmit={configure}>
        <fieldset
          disabled={busy || paid || !plan.can_configure || !ledger.data || !!ledger.error}
          className="grid sm:grid-cols-3 gap-3 disabled:opacity-70"
        >
          <label className="text-sm">
            Valor total (R$)
            <input
              required
              inputMode="decimal"
              className={input}
              value={form.total}
              onChange={(e) => setForm({ ...form, total: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Desconto (R$)
            <input
              required
              inputMode="decimal"
              className={input}
              value={form.discount}
              onChange={(e) => setForm({ ...form, discount: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Tipo de pagamento
            <select
              className={input}
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value,
                  count: e.target.value === "a_vista" ? "1" : form.count,
                })
              }
            >
              <option value="a_vista">À vista</option>
              <option value="parcelado">Parcelado</option>
              <option value="financiado">Financiado</option>
            </select>
          </label>
          <label className="text-sm">
            Entrada (R$)
            <input
              required
              inputMode="decimal"
              className={input}
              value={form.down}
              onChange={(e) => setForm({ ...form, down: e.target.value })}
            />
          </label>
          {Number(form.down.replace(",", ".")) > 0 && (
            <>
              <label className="text-sm">
                Forma da entrada
                <Methods
                  value={form.downMethod}
                  onChange={(downMethod) => setForm({ ...form, downMethod })}
                />
              </label>
              <label className="text-sm">
                Vencimento da entrada
                <input
                  required
                  type="date"
                  className={input}
                  value={form.downDue}
                  onChange={(e) => setForm({ ...form, downDue: e.target.value })}
                />
              </label>
            </>
          )}
          {(!preview || preview.balance > 0) && (
            <>
              <label className="text-sm">
                Forma de pagamento do saldo
                <Methods value={form.method} onChange={(method) => setForm({ ...form, method })} />
              </label>
              <label className="text-sm">
                Parcelas do saldo
                <input
                  required
                  disabled={form.type === "a_vista"}
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  className={input}
                  value={form.count}
                  onChange={(e) => setForm({ ...form, count: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Primeiro vencimento do saldo
                <input
                  required
                  type="date"
                  className={input}
                  value={form.firstDue}
                  onChange={(e) => setForm({ ...form, firstDue: e.target.value })}
                />
              </label>
            </>
          )}
          <button
            disabled={!preview}
            className="rounded-xl bg-purple-600 text-white p-2 disabled:opacity-50"
          >
            {busy ? "Salvando..." : "Salvar condições e gerar parcelas"}
          </button>
        </fieldset>
      </form>
      {preview ? (
        <p className="text-sm">
          Entrada: {currency(preview.down)}. Saldo: {currency(preview.balance)}
          {preview.parts.length > 0 &&
            ` em ${preview.parts.length} parcela(s): ${preview.parts.map(currency).join(" + ")}`}
          . Total líquido: {currency(preview.total - preview.discount)}.
        </p>
      ) : (
        <p role="alert" className="text-sm text-amber-800">
          {previewError}
        </p>
      )}
      <p className="text-xs text-slate-500">
        Financiamento registra o valor contratado, sem calcular juros. Vencimentos mensais usam o
        dia escolhido, limitado ao último dia de cada mês.
      </p>
      {ledger.isPending && <p>Carregando baixas...</p>}
      {ledger.data && !ledger.error && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr>
                <th>Cobrança</th>
                <th>Valor / liquidado / saldo</th>
                <th>Vencimento</th>
                <th>Forma prevista</th>
                <th>Situação</th>
                <th>Baixas</th>
              </tr>
            </thead>
            <tbody>
              {plan.installments.map((i) => {
                const title = planTitles.find((t) => t.installment_id === i.id);
                return (
                  <tr key={i.id} className="border-t">
                    <td className="py-3">{i.number === 0 ? "Entrada" : `Parcela ${i.number}`}</td>
                    <td>
                      {currency(i.amount)} /{" "}
                      {title ? currency(title.paid_amount) : "Não sincronizado"} /{" "}
                      {title ? currency(remaining(title)) : "Não sincronizado"}
                    </td>
                    <td>{formatClinicalDate(i.due_date)}</td>
                    <td>{methodLabel(i.payment_method)}</td>
                    <td>{title ? titleStatus(title, localDate()) : "Cobrança não sincronizada"}</td>
                    <td>
                      {title && (
                        <button
                          type="button"
                          className="text-purple-700 underline"
                          onClick={() => setSelectedTitle(title.id)}
                        >
                          Baixas / histórico
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {plan.installments.length === 0 && <p>Nenhuma cobrança gerada.</p>}
        </div>
      )}
      {ledger.error && (
        <p role="alert" className="text-red-700">
          {errorMessage(ledger.error)}
        </p>
      )}
      {selected && ledger.data && (
        <PaymentHistory
          key={selected.id}
          title={selected}
          data={ledger.data}
          onClose={() => setSelectedTitle("")}
        />
      )}
    </div>
  );
}

export default function TreatmentFinance() {
  const [selected, setSelected] = useState("");
  const query = useQuery({
    queryKey: ["treatment-finance-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_financial_plans");
      if (error) throw error;
      return data;
    },
  });
  const plan = query.data?.find((p) => p.id === selected);
  return (
    <section className="rounded-2xl border bg-white p-5 space-y-4" id="planos-acompanhamento">
      <h2 className="text-lg font-bold">Financeiro dos planos de acompanhamento</h2>
      <p className="text-sm text-slate-500">
        Entrada, saldo e recebimentos parciais vinculados ao paciente, com conta, data e histórico
        de cada baixa.
      </p>
      {query.error && (
        <p role="alert" className="text-red-700">
          {errorMessage(query.error)}
        </p>
      )}
      {query.isPending && <p>Carregando planos...</p>}
      <label className="block text-sm">
        Paciente / plano
        <select className={input} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Selecione um acompanhamento</option>
          {query.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.patient_name} - {p.title}
            </option>
          ))}
        </select>
      </label>
      {plan && <PlanPayments key={plan.id} plan={plan} />}
    </section>
  );
}

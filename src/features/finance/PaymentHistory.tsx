import { useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
  moneyCents,
  PAYMENT_METHODS,
} from "@/features/acompanhamentos/followup-utils";
import { refreshFinance } from "./finance-api";
import { remaining } from "./finance-math";
import type { FinanceSnapshot, FinancialTitle, FinancialPayment } from "./finance-schema";

const input = "w-full rounded-lg border p-2 text-sm";
export default function PaymentHistory({
  title,
  data,
  onClose,
}: {
  title: FinancialTitle;
  data: FinanceSnapshot;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const [amount, setAmount] = useState(remaining(title).toFixed(2));
  const [date, setDate] = useState(localDate());
  const [method, setMethod] = useState("pix");
  const [account, setAccount] = useState("");
  const [payer, setPayer] = useState(title.payer_name || title.patient_name || "");
  const [reversing, setReversing] = useState("");
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<FinancialPayment | null>(null);
  useBlocker({ shouldBlockFn: () => busy || submitted, enableBeforeUnload: busy || submitted });
  const payments = data.payments.filter((p) => p.transaction_id === title.id);
  const cardPayment = method === "cartao_credito" || method === "cartao_debito";
  const accounts = data.accounts.filter(
    (a) =>
      a.active &&
      (!title.company_id || !a.company_id || a.company_id === title.company_id) &&
      (!a.balance_kind || a.balance_kind === (cardPayment ? "receivable" : "available")),
  );
  const fallbackAccounts = data.accounts.filter((a) => a.active);
  const selectableAccounts = accounts.length > 0 ? accounts : fallbackAccounts;
  const receive = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const value = moneyCents(amount) / 100;
      if (value <= 0 || (!submitted && value > remaining(title)))
        throw new Error("Informe um valor positivo até o saldo em aberto.");
      setSubmitted(true);
      const { error } = await supabase.rpc("record_financial_payment", {
        p_id: requestId,
        p_transaction_id: title.id,
        p_amount: value,
        p_paid_on: date,
        p_method: method,
        p_account_id: account,
        p_payer_name: payer || null,
      });
      if (error) {
        if (error.code === "P0001") setSubmitted(false);
        throw error;
      }
      setRequestId(crypto.randomUUID());
      setSubmitted(false);
      setAmount("");
      await refreshFinance(qc);
      toast.success("Pagamento registrado. Nenhuma transferência bancária foi executada.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const reverse = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.rpc("reverse_financial_payment", {
        p_id: reversing,
        p_reason: reason,
      });
      if (error) throw error;
      setReversing("");
      setReason("");
      setReceipt(null);
      await refreshFinance(qc);
      toast.success("Baixa incorreta estornada; histórico preservado.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy && !submitted) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl print:static print:w-full print:max-w-none print:overflow-visible">
        <section className="space-y-4">
          <SheetHeader className="print:hidden">
            <SheetTitle>Pagamentos e histórico</SheetTitle>
            <SheetDescription>
              Registre valores efetivamente pagos. Pagamentos parciais preservam o saldo restante.
            </SheetDescription>
          </SheetHeader>
          <div className="print:hidden">
            <p>
              {title.patient_name || "Sem paciente"} · {title.description}
            </p>
            <p>
              Original: {currency(title.amount)} · Liquidado: {currency(title.paid_amount)} · Saldo:{" "}
              {currency(remaining(title))}
            </p>
          </div>
          {title.can_settle &&
            (remaining(title) > 0 || submitted) &&
            title.status !== "cancelado" && (
              <form onSubmit={receive} className="rounded-xl border p-4 space-y-3 print:hidden">
                <h3 className="font-semibold">
                  {title.type === "receita" ? "Registrar recebimento" : "Registrar pagamento"}
                </h3>
                <fieldset disabled={busy || submitted} className="grid gap-3 sm:grid-cols-2">
                  <label>
                    Valor (R$)
                    <input
                      required
                      inputMode="decimal"
                      className={input}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    Data efetiva
                    <input
                      required
                      type="date"
                      max={localDate()}
                      className={input}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Forma
                    <select
                      className={input}
                      value={method}
                      onChange={(e) => {
                        setMethod(e.target.value);
                        setAccount("");
                      }}
                    >
                      {Object.entries(PAYMENT_METHODS)
                        .filter(([key]) => key !== "convenio")
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Conta de destino/origem
                    <select
                      required
                      className={input}
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {selectableAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {!a.balance_kind ? " (classificar em Configurações)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Pagador / favorecido
                    <input
                      required
                      className={input}
                      value={payer}
                      onChange={(e) => setPayer(e.target.value)}
                    />
                  </label>
                </fieldset>
                <p className="text-xs text-slate-600">
                  Baixa manual não confirma transação bancária. Cartão deve usar uma conta de
                  recebíveis; esta tela não confirma depósito da adquirente.
                </p>
                {submitted && (
                  <p role="alert" className="text-sm text-amber-800">
                    A solicitação foi enviada. Repetir usa a mesma identificação e não duplica a
                    baixa. Consulte o histórico antes de iniciar outra operação.
                  </p>
                )}
                <button
                  disabled={busy || accounts.length === 0}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-white disabled:opacity-50"
                >
                  {busy
                    ? "Registrando..."
                    : submitted
                      ? "Repetir mesma solicitação"
                      : "Confirmar pagamento"}
                </button>
                {accounts.length === 0 && (
                  <p role="alert">
                    Cadastre uma conta ativa desta clínica em Configurações → Contas financeiras.
                  </p>
                )}
              </form>
            )}
          <div className="space-y-3 print:hidden">
            {payments.length === 0 && <p>Nenhum pagamento registrado.</p>}
            {payments.map((p) => (
              <article key={p.id} className="rounded-lg border p-3 text-sm space-y-1">
                <p className="font-semibold">
                  {currency(p.amount)} · {formatClinicalDate(p.paid_on)} ·{" "}
                  {p.reversed_at ? "Estornado" : "Ativo"}
                </p>
                <p>
                  {p.payment_method || "Forma não informada"} ·{" "}
                  {data.accounts.find((a) => a.id === p.account_id)?.name || "Conta não informada"}{" "}
                  · {p.payer_name || "Pagador não informado"}
                </p>
                <p className="break-all text-xs text-slate-500">
                  Baixa: {p.id} · Autor: {p.created_by || "Não disponível no legado"} · Registro:{" "}
                  {new Date(p.created_at).toLocaleString("pt-BR")}
                </p>
                {p.legacy && (
                  <p className="text-amber-800">
                    Importado do título legado. Data original de caixa, conta e autoria precisam de
                    conferência.
                  </p>
                )}
                {p.reversed_at && (
                  <p>
                    Motivo: {p.reversal_reason} · Autor: {p.reversed_by} ·{" "}
                    {new Date(p.reversed_at).toLocaleString("pt-BR")}
                  </p>
                )}
                {!p.reversed_at && (
                  <div className="flex gap-4">
                    <button className="text-purple-700 underline" onClick={() => setReceipt(p)}>
                      Comprovante
                    </button>
                    {title.can_reverse && (
                      <button
                        disabled={busy || submitted}
                        className="text-red-700 underline"
                        onClick={() => {
                          setReversing(p.id);
                          setReason("");
                        }}
                      >
                        Corrigir por estorno
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {reversing && (
            <form onSubmit={reverse} className="space-y-2 border p-3 print:hidden">
              <p>Estorno corrige um registro incorreto. Não use para devolução real de dinheiro.</p>
              <label>
                Justificativa
                <textarea
                  required
                  minLength={5}
                  className={input}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button disabled={busy} className="rounded bg-red-700 p-2 text-white">
                Confirmar estorno
              </button>
              <button
                type="button"
                disabled={busy}
                className="ml-3"
                onClick={() => setReversing("")}
              >
                Cancelar
              </button>
            </form>
          )}
          {receipt && (
            <section id="financial-receipt" className="rounded-lg border p-5 space-y-2">
              <h3 className="font-bold">Comprovante de baixa manual</h3>
              <p>
                Clínica:{" "}
                {data.scopes.find((s) => s.id === title.company_id)?.name ||
                  "Cadastro legado - confirmar razão social"}
              </p>
              <p>Paciente: {title.patient_name || "Não vinculado"}</p>
              <p>
                Pagador / favorecido: {receipt.payer_name || title.payer_name || "Não informado"}
              </p>
              <p>
                {title.type === "receita" ? "Recebido" : "Pago"}: {currency(receipt.amount)} em{" "}
                {formatClinicalDate(receipt.paid_on)}
              </p>
              <p>
                Forma: {receipt.payment_method || "Não informada"} · Conta:{" "}
                {data.accounts.find((a) => a.id === receipt.account_id)?.name || "Não informada"}
              </p>
              <p className="break-all">Identificador: {receipt.id}</p>
              <p>Registro administrativo. Não é nota fiscal nem comprovante bancário.</p>
              <button
                className="text-purple-700 underline print:hidden"
                onClick={() => window.print()}
              >
                Imprimir / salvar PDF
              </button>
              <style>{`@media print { body * { visibility: hidden; } #financial-receipt, #financial-receipt * { visibility: visible; } #financial-receipt { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
            </section>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}

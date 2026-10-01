import { useEffect, useState } from "react";
import { Link, useBlocker } from "@tanstack/react-router";
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
  tryMoneyCents,
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
  // Já traz selecionada a conta cadastrada em Configurações → Contas financeiras
  useEffect(() => {
    if (!selectableAccounts.some((a) => a.id === account) && selectableAccounts[0]) {
      setAccount(selectableAccounts[0].id);
    }
  }, [selectableAccounts, account]);
  const receive = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const value = moneyCents(amount) / 100;
      if (value <= 0 || (!submitted && value > remaining(title)))
        throw new Error("Informe um valor positivo até o saldo em aberto.");
      setSubmitted(true);

      const accountId =
        (account && selectableAccounts.some((a) => a.id === account) ? account : "") ||
        selectableAccounts[0]?.id;
      if (!accountId) throw new Error("Selecione a conta financeira que recebeu o valor.");

      const { error } = await supabase.rpc("record_financial_payment", {
        p_id: requestId,
        p_transaction_id: title.id,
        p_amount: value,
        p_paid_on: date,
        p_method: method,
        p_account_id: accountId,
        p_payer_name: payer || null,
      });
      if (error) throw error;

      setRequestId(crypto.randomUUID());
      setSubmitted(false);
      setAmount("");
      await refreshFinance(qc);
      toast.success("Pagamento registrado com sucesso.");
    } catch (error) {
      setSubmitted(false);
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const reverse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
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
      toast.success("Baixa estornada com sucesso; histórico preservado.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  // Descrição sem o nome do paciente repetido ("FULANO - Agendamento" -> "Agendamento")
  const personName = (title.patient_name || title.payer_name || "").trim();
  const cleanDescription = (() => {
    const d = (title.description || "").trim();
    if (!personName) return d;
    const stripped = d.replace(new RegExp(`^${personName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–·:]\\s*`, "i"), "");
    return stripped.toLowerCase() === personName.toLowerCase() ? "" : stripped;
  })();
  const isIncome = title.type === "receita";
  const total = Number(title.amount) || 0;
  const paid = Number(title.paid_amount) || 0;
  const open = remaining(title);
  const progress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const methodLabel = (m?: string | null) =>
    (m && (PAYMENT_METHODS as Record<string, string>)[m]) || m || "Forma não informada";
  const accountName = (id?: string | null) =>
    data.accounts.find((a) => a.id === id)?.name || "Conta não informada";
  const field =
    "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-60";
  const fieldLabel = "space-y-1.5 text-sm font-medium text-foreground";
  const canRegister = title.can_settle && (open > 0 || submitted) && title.status !== "cancelado";

  return (
    <Sheet
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy && !submitted) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl print:static print:w-full print:max-w-none print:overflow-visible">
        <section className="space-y-5 p-5 sm:p-6">
          <SheetHeader className="space-y-1 text-left print:hidden">
            <SheetTitle className="text-lg">Pagamentos e histórico</SheetTitle>
            <SheetDescription>
              Registre o que foi efetivamente {isIncome ? "recebido" : "pago"}. Pagamento parcial
              mantém o restante em aberto.
            </SheetDescription>
          </SheetHeader>

          {/* Resumo do título */}
          <div className="space-y-4 rounded-2xl border border-border bg-surface/60 p-4 print:hidden">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">
                  {personName || cleanDescription || "Lançamento"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[personName ? cleanDescription : "", title.category, `Vencimento ${formatClinicalDate(title.due_date)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                  title.status === "cancelado"
                    ? "bg-muted text-muted-foreground"
                    : open <= 0
                      ? "bg-success/12 text-success"
                      : paid > 0
                        ? "bg-warning/12 text-warning"
                        : "bg-info/12 text-info"
                }`}
              >
                {title.status === "cancelado"
                  ? "Cancelado"
                  : open <= 0
                    ? isIncome ? "Recebido" : "Pago"
                    : paid > 0
                      ? "Parcial"
                      : isIncome ? "A receber" : "A pagar"}
              </span>
            </div>

            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Valor total", currency(total), "text-foreground"],
                [isIncome ? "Recebido" : "Pago", currency(paid), "text-success"],
                ["Em aberto", currency(open), open > 0 ? "text-warning" : "text-muted-foreground"],
              ].map(([label, value, cls]) => (
                <div key={label} className="rounded-xl bg-card px-2 py-2.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className={`text-sm font-semibold tabular-nums sm:text-base ${cls}`}>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Registrar pagamento */}
          {canRegister && (
            <form onSubmit={receive} className="space-y-4 rounded-2xl border border-border p-4 print:hidden">
              <h3 className="text-sm font-semibold text-foreground">
                {isIncome ? "Registrar recebimento" : "Registrar pagamento"}
              </h3>

              {selectableAccounts.length === 0 && (
                <div role="alert" className="rounded-xl border border-warning/30 bg-warning/8 p-3 text-sm text-foreground">
                  Nenhuma conta financeira ativa. Cadastre a conta que recebe os valores em{" "}
                  <Link to="/configuracoes" className="font-semibold text-primary underline">
                    Configurações → Contas financeiras
                  </Link>
                  .
                </div>
              )}

              <fieldset disabled={busy || submitted} className="grid gap-3 sm:grid-cols-2">
                <label className={fieldLabel}>
                  <span>Valor (R$)</span>
                  <input required inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className={fieldLabel}>
                  <span>Data do {isIncome ? "recebimento" : "pagamento"}</span>
                  <input required type="date" max={localDate()} className={field} value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className={fieldLabel}>
                  <span>Forma</span>
                  <select
                    className={field}
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
                <label className={fieldLabel}>
                  <span>Conta {isIncome ? "de destino" : "de origem"}</span>
                  <select
                    required
                    className={field}
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    disabled={selectableAccounts.length === 0}
                  >
                    {selectableAccounts.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
                    {selectableAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {!a.balance_kind ? " (classificar em Configurações)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${fieldLabel} sm:col-span-2`}>
                  <span>{isIncome ? "Pagador" : "Favorecido"}</span>
                  <input required className={field} value={payer} onChange={(e) => setPayer(e.target.value)} />
                </label>
              </fieldset>

              {submitted && (
                <p role="alert" className="text-sm text-warning">
                  Solicitação enviada. Repetir usa a mesma identificação e não duplica o pagamento.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {cardPayment
                    ? "Cartão deve usar uma conta de recebíveis."
                    : "Registro manual; não confirma a transação no banco."}
                </p>
                <button
                  disabled={busy || selectableAccounts.length === 0}
                  className="h-10 cursor-pointer rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? "Registrando..."
                    : submitted
                      ? "Repetir mesma solicitação"
                      : tryMoneyCents(amount) !== null
                        ? `Confirmar ${currency((tryMoneyCents(amount) as number) / 100)}`
                        : "Confirmar pagamento"}
                </button>
              </div>
            </form>
          )}

          {/* Histórico */}
          <div className="space-y-2.5 print:hidden">
            <h3 className="text-sm font-semibold text-foreground">Histórico</h3>
            {payments.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Nenhum pagamento registrado.
              </p>
            )}
            {payments.map((p) => (
              <article
                key={p.id}
                className={`space-y-2 rounded-xl border p-3.5 text-sm ${p.reversed_at ? "border-border bg-muted/40" : "border-border bg-card"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`font-semibold tabular-nums ${p.reversed_at ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {currency(p.amount)}
                    <span className="ml-2 font-normal text-muted-foreground no-underline">
                      {formatClinicalDate(p.paid_on)}
                    </span>
                  </p>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      p.reversed_at ? "bg-muted text-muted-foreground" : "bg-success/12 text-success"
                    }`}
                  >
                    {p.reversed_at ? "Estornado" : isIncome ? "Recebido" : "Pago"}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {[methodLabel(p.payment_method), accountName(p.account_id), p.payer_name].filter(Boolean).join(" · ")}
                </p>
                {p.legacy && (
                  <p className="text-xs text-warning">
                    Importado do sistema antigo: confira data, conta e autoria.
                  </p>
                )}
                {p.reversed_at && (
                  <p className="text-xs text-muted-foreground">
                    Estornado em {new Date(p.reversed_at).toLocaleString("pt-BR")} — {p.reversal_reason}
                  </p>
                )}
                {!p.reversed_at && (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <button
                      type="button"
                      className="h-8 cursor-pointer rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted"
                      onClick={() => setReceipt(p)}
                    >
                      Comprovante
                    </button>
                    {title.can_reverse && (
                      <button
                        type="button"
                        disabled={busy || submitted}
                        className="h-8 cursor-pointer rounded-md px-3 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        onClick={() => {
                          setReversing(p.id);
                          setReason("");
                        }}
                      >
                        Estornar
                      </button>
                    )}
                  </div>
                )}
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Detalhes do registro</summary>
                  <p className="mt-1 break-all">
                    Registro {new Date(p.created_at).toLocaleString("pt-BR")} · ID {p.id}
                  </p>
                </details>
              </article>
            ))}
          </div>

          {reversing && (
            <form onSubmit={reverse} className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 print:hidden">
              <p className="text-sm text-foreground">
                O estorno corrige um registro feito por engano. Não use para devolução de dinheiro ao paciente.
              </p>
              <label className={fieldLabel}>
                <span>Motivo</span>
                <textarea
                  required
                  minLength={5}
                  rows={2}
                  className="w-full rounded-lg border border-input bg-card p-3 text-sm outline-none focus:border-primary"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <button disabled={busy} className="h-9 cursor-pointer rounded-md bg-destructive px-4 text-sm font-semibold text-white disabled:opacity-50">
                  Confirmar estorno
                </button>
                <button type="button" disabled={busy} className="h-9 cursor-pointer rounded-md px-3 text-sm text-muted-foreground hover:bg-muted" onClick={() => setReversing("")}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {receipt && (
            <section id="financial-receipt" className="space-y-2 rounded-2xl border border-border p-5 text-sm">
              <h3 className="text-base font-semibold">Comprovante de {isIncome ? "recebimento" : "pagamento"}</h3>
              <p>
                Clínica:{" "}
                {data.scopes.find((s) => s.id === title.company_id)?.name || "Cadastro legado - confirmar razão social"}
              </p>
              <p>Paciente: {title.patient_name || "Não vinculado"}</p>
              {cleanDescription && <p>Referente a: {cleanDescription}</p>}
              <p>{isIncome ? "Pagador" : "Favorecido"}: {receipt.payer_name || title.payer_name || "Não informado"}</p>
              <p>
                {isIncome ? "Recebido" : "Pago"}: <strong>{currency(receipt.amount)}</strong> em {formatClinicalDate(receipt.paid_on)}
              </p>
              <p>
                Forma: {methodLabel(receipt.payment_method)} · Conta: {accountName(receipt.account_id)}
              </p>
              <p className="break-all text-xs text-muted-foreground">Identificador: {receipt.id}</p>
              <p className="text-xs text-muted-foreground">Registro administrativo. Não é nota fiscal nem comprovante bancário.</p>
              <button
                className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm font-semibold text-primary hover:bg-muted print:hidden"
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

import PaymentHistory from "@/features/finance/PaymentHistory";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { isFreeBalance, remaining, titleStatus } from "@/features/finance/finance-math";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { FinancialPlan } from "@/features/finance/finance-schema";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { Clock, RefreshCw, ArrowRight, Wallet, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
  PAYMENT_METHODS,
  paymentPreview,
} from "./followup-utils";

const input = "w-full rounded-lg border border-border p-2 text-sm";
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

export function PlanPayments({ plan }: { plan: FinancialPlan }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState("");
  const ledger = useQuery({ queryKey: ["financial-snapshot"], queryFn: getFinancialSnapshot });
  const planTitles = ledger.data?.titles.filter((t) => t.treatment_id === plan.id) || [];
  const paid = ledger.data?.payments.some((p) => planTitles.some((t) => t.id === p.transaction_id));
  const selected = planTitles.find((t) => t.id === selectedTitle);

  const freeBalanceTitle = planTitles.find((t) => isFreeBalance(t) && remaining(t) > 0);
  // Saldo em aberto do plano (todas as parcelas não quitadas): base da repactuação
  const openBalance = planTitles
    .filter((t) => t.status !== "cancelado")
    .reduce((sum, t) => sum + remaining(t), 0);
  const paidTotal = planTitles
    .filter((t) => t.status !== "cancelado")
    .reduce((sum, t) => sum + (Number(t.paid_amount) || 0), 0);

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

  const isInitiallyLivre =
    planTitles.some(isFreeBalance) || (plan as any).notes?.includes("saldo_livre");
  const [modality, setModality] = useState<"parcelado" | "livre">(
    isInitiallyLivre ? "livre" : "parcelado",
  );

  // Repactuation modal state
  const [repactOpen, setRepactOpen] = useState(false);
  const [repactCount, setRepactCount] = useState("3");
  const [repactFirstDue, setRepactFirstDue] = useState(localDate());
  const [repactMethod, setRepactMethod] = useState("pix");
  const [downReceivedNow, setDownReceivedNow] = useState(true);
  const [downAccountId, setDownAccountId] = useState("");

  let preview: ReturnType<typeof paymentPreview> | undefined;
  let previewError = "";
  try {
    preview = paymentPreview(
      form.total,
      form.discount,
      form.down,
      modality === "livre" ? 1 : Number(form.count),
    );
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
      qc.invalidateQueries({ queryKey: ["financial-snapshot"] }),
      qc.invalidateQueries({ queryKey: ["cash-flow-snapshot"] }),
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
          preview.down > 0 && downReceivedNow
            ? "As parcelas serão salvas e a entrada à vista será lançada imediatamente no Fluxo de Caixa."
            : "As parcelas não pagas serão recalculadas no Contas a Receber.",
        confirmText: "Salvar condições",
      }))
    )
      return;

    setBusy(true);
    try {
      const isLivre = modality === "livre";
      const { error } = await supabase.rpc("configure_treatment_payment", {
        p_treatment_id: plan.id,
        p_total: preview.total,
        p_discount: preview.discount,
        p_down: preview.down,
        p_type: isLivre ? "parcelado" : form.type,
        p_down_method: form.downMethod || null,
        p_method: form.method || null,
        p_count: isLivre || form.type === "a_vista" ? 1 : Number(form.count),
        p_down_due: form.downDue || null,
        p_first_due: form.firstDue || null,
      });
      if (error) throw error;

      // Se for modalidade de Saldo Livre, atualizar o título do saldo gerado
      if (isLivre && preview.balance > 0) {
        const { error: labelErr } = await (supabase.rpc as any)("label_free_balance_title", {
          p_treatment_id: plan.id,
          p_title: plan.title,
        });
        if (labelErr) console.warn("Rótulo Saldo Livre não aplicado:", labelErr);
      }

      // Se entrada foi marcada para baixa à vista agora
      if (preview.down > 0 && downReceivedNow) {
        const { data: createdTxs } = await supabase
          .from("transactions")
          .select("id, description, installment_id, installments:installment_id(number)")
          .eq("treatment_id", plan.id);

        const downTx = createdTxs?.find(
          (tx: any) => tx.installments?.number === 0 || tx.description?.toLowerCase().includes("entrada")
        );
        if (downTx) {
          const accountId = downAccountId || ledger.data?.accounts?.[0]?.id;
          if (!accountId) throw new Error("Selecione a conta financeira que recebeu a entrada.");
          const patName = (plan as any).patient_name || (plan as any).patients?.name || plan.title || "Paciente";

          const { error: payError } = await supabase.rpc("record_financial_payment", {
            p_id: crypto.randomUUID(),
            p_transaction_id: downTx.id,
            p_amount: preview.down,
            p_paid_on: form.downDue || localDate(),
            p_method: (form.downMethod || "pix").toLowerCase(),
            p_account_id: accountId,
            p_payer_name: patName,
          });
          if (payError) throw payError;
        }
      }

      await refresh();
      toast.success(
        preview.down > 0 && downReceivedNow
          ? `Condições salvas e entrada de ${currency(preview.down)} lançada no Fluxo de Caixa!`
          : "Condições do plano salvas no Financeiro.",
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleRepactuate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (openBalance <= 0) {
      toast.error("Este plano não tem saldo em aberto.");
      return;
    }
    const count = Number(repactCount) || 1;
    if (count < 1) {
      toast.error("Informe um número válido de parcelas.");
      return;
    }

    setBusy(true);
    try {
      // Função do banco: atômica, preserva pagamentos e recria as cobranças das novas parcelas
      const { error } = await (supabase.rpc as any)("repactuate_treatment_balance", {
        p_treatment_id: plan.id,
        p_count: count,
        p_first_due: repactFirstDue,
        p_method: repactMethod,
      });
      if (error) throw error;
      toast.success(
        `Saldo de ${currency(openBalance)} repactuado em ${count}x. Pagamentos já feitos foram preservados.`,
      );
      setRepactOpen(false);
      await refresh();
    } catch (err: any) {
      toast.error(errorMessage(err) || "Erro ao repactuar saldo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {paid && (
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Condições contratadas</h4>
              <p className="text-xs text-muted-foreground">
                O plano já tem recebimentos, por isso as condições não são recalculadas. Para mudar o
                parcelamento do que falta, repactue o saldo em aberto.
              </p>
            </div>
            {openBalance > 0 && plan.can_configure && (
              <button
                type="button"
                onClick={() => {
                  setRepactCount(String(Math.max(1, plan.installments_count || 1)));
                  setRepactFirstDue(localDate());
                  setRepactMethod(plan.payment_method || "pix");
                  setRepactOpen(true);
                }}
                className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 px-3 text-sm font-semibold text-primary hover:bg-primary/10"
              >
                <RefreshCw size={14} /> Repactuar saldo em aberto
              </button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Valor total", currency(Number(plan.total_value) - Number(plan.discount || 0))],
              ["Entrada", currency(Number(plan.down_payment) || 0)],
              ["Recebido", currency(paidTotal)],
              ["Em aberto", currency(openBalance)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Banner de Saldo Livre e Ação Rápida de Repactuação */}
      {freeBalanceTitle && remaining(freeBalanceTitle) > 0 && (
        <div className="p-4 rounded-2xl bg-primary-soft/80 border border-primary/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-primary uppercase tracking-wider block">
              Modalidade Contratual Ativa
            </span>
            <h4 className="text-sm font-semibold text-primary-hover flex items-center gap-1.5 mt-0.5">
              <Clock size={16} className="text-primary" />
              Pagamentos Livres: Saldo em aberto de {currency(remaining(freeBalanceTitle))}
            </h4>
            <p className="text-xs text-primary mt-0.5">
              Este valor não vence por data e recebe baixas parciais conforme a rotina do paciente.
              Se preferir agendar vencimentos fixos, repactue apenas o saldo restante.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedTitle(freeBalanceTitle.id)}
              className="px-3.5 py-2 bg-primary hover:bg-primary-hover text-white text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer"
            >
              Receber Saldo
            </button>
            <button
              type="button"
              onClick={() => {
                setRepactCount("3");
                setRepactFirstDue(localDate());
                setRepactOpen(true);
              }}
              className="px-3.5 py-2 bg-card hover:bg-muted/60 text-primary border border-primary/35 text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer"
            >
              Repactuar em Parcelas
            </button>
          </div>
        </div>
      )}

      {!paid && (<>
      <form onSubmit={configure}>
        <fieldset
          disabled={busy || paid || !plan.can_configure || !ledger.data || !!ledger.error}
          className="space-y-3 disabled:opacity-70"
        >
          <div className="grid sm:grid-cols-3 gap-3">
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
              Modalidade do saldo
              <select
                className={input}
                value={modality}
                onChange={(e) => setModality(e.target.value as "parcelado" | "livre")}
              >
                <option value="livre">Pagamentos livres (Sem vencimento definido)</option>
                <option value="parcelado">Parcelado com vencimentos</option>
              </select>
            </label>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
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
                  Vencimento / Recebimento da entrada
                  <input
                    required
                    type="date"
                    className={input}
                    value={form.downDue}
                    onChange={(e) => setForm({ ...form, downDue: e.target.value })}
                  />
                </label>
                <div className="sm:col-span-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                    <input
                      type="checkbox"
                      checked={downReceivedNow}
                      onChange={(e) => setDownReceivedNow(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                    />
                    <span>Entrada recebida à vista hoje (lançar no Fluxo de Caixa)</span>
                  </label>
                  {downReceivedNow && (
                    <div className="grid sm:grid-cols-2 gap-2 pt-1">
                      <label className="text-xs">
                        Conta de Entrada
                        <select
                          className={input}
                          value={downAccountId || ledger.data?.accounts?.[0]?.id || ""}
                          onChange={(e) => setDownAccountId(e.target.value)}
                        >
                          {(ledger.data?.accounts || []).map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 self-end pb-2">
                        <CheckCircle2 size={13} className="shrink-0" />
                        A entrada entrará imediatamente no Fluxo de Caixa Realizado como receita.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {(!preview || preview.balance > 0) && (
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-sm">
                Forma de pagamento do saldo
                <Methods value={form.method} onChange={(method) => setForm({ ...form, method })} />
              </label>

              {modality === "parcelado" && (
                <>
                  <label className="text-sm">
                    Parcelas do saldo
                    <input
                      required
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

              {modality === "livre" && (
                <div className="sm:col-span-2 flex items-center text-xs text-primary bg-primary-soft p-2 rounded-lg border border-primary/25">
                  <span>✓ Saldo aberto único sem cobranças vencidas nem parcelas artificiais.</span>
                </div>
              )}
            </div>
          )}

          <button
            disabled={!preview}
            className="rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold p-2.5 text-sm disabled:opacity-50 transition cursor-pointer"
          >
            {busy ? "Salvando..." : "Salvar condições do plano"}
          </button>
        </fieldset>
      </form>

      {preview ? (
        <p className="text-sm">
          Entrada: {currency(preview.down)}. Saldo: {currency(preview.balance)}
          {modality === "parcelado" &&
            preview.parts.length > 0 &&
            (new Set(preview.parts).size === 1
              ? ` em ${preview.parts.length}x de ${currency(preview.parts[0])}`
              : ` em ${preview.parts.length}x (de ${currency(Math.min(...preview.parts))} a ${currency(Math.max(...preview.parts))})`)}
          {modality === "livre" && preview.balance > 0 && " (saldo sem vencimento fixo)"}. Total
          líquido: {currency(preview.total - preview.discount)}.
        </p>
      ) : (
        <p role="alert" className="text-sm text-warning">
          {previewError}
        </p>
      )}
      </>)}

      {ledger.isPending && <p>Carregando baixas...</p>}
      {ledger.data && !ledger.error && (
        <div className="overflow-x-auto">
          {(() => {
            // Parcelas substituídas numa repactuação ficam fora da lista principal
            const active = plan.installments.filter(
              (i) => i.status !== "cancelado" && i.status !== "renegociado",
            );
            const replaced = plan.installments.length - active.length;
            const totalParts = active.filter((i) => i.number > 0).length;
            const partIndex = new Map(
              active
                .filter((i) => i.number > 0)
                .sort((a, b) => a.number - b.number)
                .map((i, idx) => [i.id, idx + 1]),
            );
            return (
              <>
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Parcela</th>
                      <th className="py-2 pr-3 font-medium">Vencimento</th>
                      <th className="py-2 pr-3 font-medium">Forma</th>
                      <th className="py-2 pr-3 text-right font-medium">Valor</th>
                      <th className="py-2 pr-3 text-right font-medium">Pago</th>
                      <th className="py-2 pr-3 text-right font-medium">Em aberto</th>
                      <th className="py-2 pr-3 font-medium">Situação</th>
                      <th className="py-2 text-right font-medium">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {active.map((i) => {
                      const title = planTitles.find(
                        (t) =>
                          t.installment_id === i.id ||
                          (i.number === 0 && t.description?.toLowerCase().includes("entrada")),
                      );
                      const isFree = title && isFreeBalance(title);
                      const relatedPayments = (ledger.data?.payments || []).filter(
                        (p) => !p.reversed_at && title && p.transaction_id === title.id,
                      );
                      const sumPaid = relatedPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
                      const titlePaid = Math.max(Number(title?.paid_amount) || 0, sumPaid);
                      const amount = Number(i.amount) || Number(title?.amount) || 0;
                      const isPaid =
                        i.status === "pago" || title?.status === "pago" || (amount > 0 && amount - titlePaid <= 0.01);
                      const paidValue = isPaid ? amount : titlePaid;
                      const openValue = isPaid ? 0 : Math.max(0, amount - titlePaid);
                      const overdue = !isPaid && !isFree && !!i.due_date && i.due_date < localDate();
                      const status = isPaid
                        ? { label: "Quitada", dot: "bg-success", text: "text-success" }
                        : overdue
                          ? { label: "Vencida", dot: "bg-destructive", text: "text-destructive" }
                          : paidValue > 0
                            ? { label: "Parcial", dot: "bg-warning", text: "text-warning" }
                            : { label: "A receber", dot: "bg-info", text: "text-info" };

                      return (
                        <tr key={i.id} className="align-middle hover:bg-muted/40">
                          <td className="whitespace-nowrap py-3 pr-3 font-medium text-foreground">
                            {isFree
                              ? "Saldo livre"
                              : i.number === 0
                                ? "Entrada"
                                : `${partIndex.get(i.id) ?? i.number} de ${totalParts}`}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-3 tabular-nums">
                            {isFree ? <span className="text-muted-foreground">Sem vencimento</span> : formatClinicalDate(i.due_date)}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-3 text-muted-foreground">{methodLabel(i.payment_method)}</td>
                          <td className="whitespace-nowrap py-3 pr-3 text-right tabular-nums text-foreground">{currency(amount)}</td>
                          <td className="whitespace-nowrap py-3 pr-3 text-right tabular-nums text-muted-foreground">
                            {paidValue > 0 ? currency(paidValue) : "—"}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-3 text-right font-semibold tabular-nums text-foreground">
                            {openValue > 0 ? currency(openValue) : "—"}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status.text}`}>
                              <span className={`size-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                              {status.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-3 text-right">
                            {title ? (
                              isPaid ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedTitle(title.id)}
                                  className="h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                  title="Ver pagamentos e comprovante"
                                >
                                  Ver
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setSelectedTitle(title.id)}
                                  className="h-8 cursor-pointer rounded-md bg-success px-3 text-xs font-semibold text-white hover:bg-success/90"
                                >
                                  Receber
                                </button>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">Sem cobrança</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {active.length === 0 && (
                  <p className="py-4 text-muted-foreground">Nenhuma cobrança gerada.</p>
                )}
                {replaced > 0 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    {replaced} parcela(s) substituída(s) em repactuação não aparecem na lista.
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Modal de Repactuação do Saldo Restante */}
      <Dialog
        open={repactOpen && openBalance > 0}
        onOpenChange={(open) => {
          if (!open && !busy) setRepactOpen(false);
        }}
      >
        <DialogContent onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b border-border-soft pb-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <RefreshCw size={16} />
            </div>
            <div>
              <DialogTitle className="text-base">Repactuar Saldo Restante</DialogTitle>
              <DialogDescription className="text-xs">
                Dividir o que falta receber em novas parcelas com vencimento
              </DialogDescription>
            </div>
          </DialogHeader>
          {openBalance > 0 && (
            <>
              <div className="p-3.5 bg-primary-soft rounded-2xl border border-primary/15 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-primary">Saldo em aberto a parcelar:</span>
                  <strong className="text-primary-hover font-semibold">
                    {currency(openBalance)}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-primary">Pagamentos já realizados (preservados):</span>
                  <strong className="text-success">{currency(paidTotal)}</strong>
                </div>
                <p className="text-xs text-primary/80 pt-1 border-t border-primary/15">
                  Nenhum pagamento é apagado. As parcelas em aberto (ou o saldo livre) serão substituídas
                  pelas novas parcelas programadas.
                </p>
              </div>

              <form onSubmit={handleRepactuate} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground/80">
                      Quantidade de Parcelas
                    </label>
                    <select
                      value={repactCount}
                      onChange={(e) => setRepactCount(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-border text-sm bg-muted/60 focus:bg-card outline-none focus:border-primary"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 24].map((n) => (
                        <option key={n} value={n}>
                          {n}x de {currency(openBalance / n)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground/80">
                      1º Vencimento
                    </label>
                    <input
                      type="date"
                      required
                      value={repactFirstDue}
                      onChange={(e) => setRepactFirstDue(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-border text-sm bg-muted/60 focus:bg-card outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground/80">
                    Forma de Pagamento
                  </label>
                  <select
                    value={repactMethod}
                    onChange={(e) => setRepactMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-border text-sm bg-muted/60 focus:bg-card outline-none focus:border-primary"
                  >
                    <option value="pix">Pix</option>
                    <option value="cartao_credito">Cartão de Crédito</option>
                    <option value="cartao_debito">Cartão de Débito</option>
                    <option value="boleto">Boleto Bancário</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="transferencia">Transferência</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border-soft">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRepactOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition"
                  >
                    {busy ? "Repactuando..." : "Confirmar Repactuação"}
                  </button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {ledger.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(ledger.error)}
        </p>
      )}
      {selected && ledger.data && (
        <PaymentHistory
          key={selected.id}
          title={ledger.data.titles.find((t) => t.id === selected.id) || selected}
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
    <section className="rounded-2xl border bg-card p-5 space-y-4" id="planos-acompanhamento">
      <h2 className="text-lg font-semibold">Financeiro dos planos de acompanhamento</h2>
      <p className="text-sm text-muted-foreground">
        Entrada, saldo e recebimentos parciais vinculados ao paciente, com conta, data e histórico
        de cada baixa.
      </p>
      {query.error && (
        <p role="alert" className="text-destructive">
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

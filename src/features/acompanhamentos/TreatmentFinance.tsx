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
        const { data: createdTxs } = await supabase
          .from("transactions")
          .select("id, description, installment_id, installments:installment_id(number)")
          .eq("treatment_id", plan.id);

        const balanceTx = createdTxs?.find(
          (tx: any) => tx.installments?.number !== 0 && !tx.description?.includes("Entrada"),
        );
        if (balanceTx) {
          await supabase
            .from("transactions")
            .update({
              description: `Acompanhamento: ${plan.title} - Saldo Livre (Sem vencimento definido)`,
              category: "Saldo Livre",
            })
            .eq("id", balanceTx.id);
        }
      }

      await refresh();
      toast.success("Condições do plano salvas no Financeiro.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleRepactuate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!freeBalanceTitle) return;
    const rem = remaining(freeBalanceTitle);
    if (rem <= 0) {
      toast.error("Este saldo já está totalmente quitado.");
      return;
    }
    const count = Number(repactCount) || 1;
    if (count < 1) {
      toast.error("Informe um número válido de parcelas.");
      return;
    }

    setBusy(true);
    try {
      const freeBalanceInstallment = plan.installments.find(
        (i) => i.id === freeBalanceTitle.installment_id,
      );

      // 1. Quitar/encerrar o título de saldo livre anterior
      if (freeBalanceTitle.paid_amount > 0) {
        await supabase
          .from("transactions")
          .update({
            amount: freeBalanceTitle.paid_amount,
            status: "pago",
            description: `${freeBalanceTitle.description} (Saldo anterior quitado - Repactuado)`,
          })
          .eq("id", freeBalanceTitle.id);

        if (freeBalanceInstallment) {
          await supabase
            .from("treatment_installments")
            .update({
              amount: freeBalanceTitle.paid_amount,
              status: "pago",
            })
            .eq("id", freeBalanceInstallment.id);
        }
      } else {
        await supabase
          .from("transactions")
          .update({
            status: "cancelado",
            description: `${freeBalanceTitle.description} (Repactuado em parcelas)`,
          })
          .eq("id", freeBalanceTitle.id);

        if (freeBalanceInstallment) {
          await supabase
            .from("treatment_installments")
            .update({
              status: "cancelado",
            })
            .eq("id", freeBalanceInstallment.id);
        }
      }

      // 2. Buscar maior número de parcela já existente no plano
      const { data: existingInsts } = await supabase
        .from("treatment_installments")
        .select("number")
        .eq("treatment_id", plan.id);
      const maxNum = (existingInsts || []).reduce((max, cur) => Math.max(max, cur.number), 0);

      // 3. Criar as novas parcelas no treatment_installments
      const eachCents = Math.floor((rem * 100) / count);
      const remainderCents = Math.round(rem * 100) - eachCents * count;
      const [y, m, d] = repactFirstDue.split("-").map(Number);

      for (let k = 1; k <= count; k++) {
        const partAmount = (eachCents + (k <= remainderCents ? 1 : 0)) / 100;
        const targetDate = new Date(y, m - 1 + (k - 1), d);
        const targetDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;

        const { error: insErr } = await supabase.from("treatment_installments").insert({
          treatment_id: plan.id,
          number: maxNum + k,
          amount: partAmount,
          due_date: targetDateStr,
          payment_method: repactMethod,
          status: "pendente",
        });
        if (insErr) throw insErr;
      }

      // 4. Atualizar metadados do plano
      await supabase
        .from("treatments")
        .update({
          installments_count: maxNum + count,
          payment_type: "parcelado",
        })
        .eq("id", plan.id);

      toast.success(
        `Saldo de ${currency(rem)} repactuado em ${count}x parcelas com sucesso! Histórico de pagamentos preservado.`,
      );
      setRepactOpen(false);
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao repactuar saldo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {paid && (
        <p className="text-sm text-warning">
          Este plano já possui recebimentos. As condições não podem ser regeneradas para preservar o
          histórico. Caso necessário, utilize a repactuação do saldo restante abaixo.
        </p>
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
            ` em ${preview.parts.length} parcela(s): ${preview.parts.map(currency).join(" + ")}`}
          {modality === "livre" && preview.balance > 0 && " (saldo sem vencimento fixo)"}. Total
          líquido: {currency(preview.total - preview.discount)}.
        </p>
      ) : (
        <p role="alert" className="text-sm text-warning">
          {previewError}
        </p>
      )}

      {ledger.isPending && <p>Carregando baixas...</p>}
      {ledger.data && !ledger.error && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b text-muted-foreground text-xs uppercase">
                <th className="py-2.5">Cobrança</th>
                <th>Valor / liquidado / saldo</th>
                <th>Vencimento</th>
                <th>Forma prevista</th>
                <th>Situação</th>
                <th>Baixas / Ações</th>
              </tr>
            </thead>
            <tbody>
              {plan.installments.map((i) => {
                const title = planTitles.find((t) => t.installment_id === i.id);
                const isFree = title && isFreeBalance(title);
                return (
                  <tr key={i.id} className="border-t hover:bg-muted/30">
                    <td className="py-3">
                      {isFree ? (
                        <div>
                          <span className="font-semibold text-primary">Saldo Livre</span>
                          <span className="block text-xs text-muted-foreground font-normal">
                            Sem vencimento fixo
                          </span>
                        </div>
                      ) : i.number === 0 ? (
                        <span className="font-semibold text-foreground">Entrada</span>
                      ) : (
                        <span className="font-medium text-foreground">Parcela {i.number}</span>
                      )}
                    </td>
                    <td>
                      {currency(i.amount)} /{" "}
                      {title ? currency(title.paid_amount) : "Não sincronizado"} /{" "}
                      {title ? currency(remaining(title)) : "Não sincronizado"}
                    </td>
                    <td>
                      {isFree ? (
                        <span className="text-muted-foreground italic text-xs">Sem vencimento</span>
                      ) : (
                        formatClinicalDate(i.due_date)
                      )}
                    </td>
                    <td>{methodLabel(i.payment_method)}</td>
                    <td>
                      {title ? (
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-md text-xs font-semibold",
                            titleStatus(title, localDate()).includes("Quitado")
                              ? "bg-success/10 text-success"
                              : titleStatus(title, localDate()).includes("sem vencimento")
                                ? "bg-primary-soft text-primary"
                                : titleStatus(title, localDate()).includes("Vencido")
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-muted text-foreground/80",
                          )}
                        >
                          {titleStatus(title, localDate())}
                        </span>
                      ) : (
                        "Cobrança não sincronizada"
                      )}
                    </td>
                    <td>
                      {title && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="px-2.5 py-1 bg-primary-soft hover:bg-primary-soft text-primary rounded-lg text-xs font-semibold transition cursor-pointer"
                            onClick={() => setSelectedTitle(title.id)}
                          >
                            {remaining(title) > 0 ? "Receber / Baixas" : "Ver Baixas"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {plan.installments.length === 0 && (
            <p className="py-4 text-muted-foreground">Nenhuma cobrança gerada.</p>
          )}
        </div>
      )}

      {/* Modal de Repactuação do Saldo Restante */}
      <Dialog
        open={repactOpen && !!freeBalanceTitle}
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
                Transformar saldo livre em parcelas com data
              </DialogDescription>
            </div>
          </DialogHeader>
          {freeBalanceTitle && (
            <>
              <div className="p-3.5 bg-primary-soft rounded-2xl border border-primary/15 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-primary">Saldo em aberto a parcelar:</span>
                  <strong className="text-primary-hover font-semibold">
                    {currency(remaining(freeBalanceTitle))}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-primary">Pagamentos já realizados (preservados):</span>
                  <strong className="text-success">{currency(freeBalanceTitle.paid_amount)}</strong>
                </div>
                <p className="text-xs text-primary/80 pt-1 border-t border-primary/15">
                  Nenhum histórico será apagado. O saldo livre anterior será encerrado e substituído
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
                      {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                        <option key={n} value={n}>
                          {n}x de {currency(remaining(freeBalanceTitle) / n)}
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

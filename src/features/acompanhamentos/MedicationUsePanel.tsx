import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, formatClinicalDate, localDate } from "./followup-utils";
import { useTreatmentMedicationUses } from "./use-treatment-medication-uses";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { setTitleServiceType } from "@/features/finance/service-types";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Pill, Syringe } from "lucide-react";

const input = "w-full rounded-lg border border-border p-2 text-sm";
const nowInput = () => `${localDate()}T${new Date().toTimeString().slice(0, 5)}`;

export type MedicationPreset = {
  id: string;
  name: string;
  dose?: string | null;
  unit?: string | null;
  route?: string | null;
  start_date?: string | null;
};

const emptyForm = (medication?: MedicationPreset) => ({
  medication: medication?.id ?? "",
  dose: medication ? `${medication.dose || ""} ${medication.unit || ""}`.trim() : "",
  route: medication?.route || "",
  usedAt: nowInput(),
  notes: "",
  item: "",
  quantity: "1",
});

/** Cria a cobrança da aplicação (receita do paciente do plano, tipo Medicações). */
async function chargeApplication(
  treatmentId: string,
  c: { name: string; dose: string; amount: number; date: string; companyId: string | null },
) {
  const { data: plan, error: planErr } = await supabase
    .from("treatments")
    .select("patient_id, patients(name)")
    .eq("id", treatmentId)
    .maybeSingle();
  if (planErr) throw planErr;
  const id = crypto.randomUUID();
  const label = c.name.replace(/\s+\(Sem\.\s*\d+\)$/, "");
  const { error } = await supabase.rpc("create_financial_title", {
    p_id: id,
    p_type: "receita",
    p_amount: Math.round(c.amount * 100) / 100,
    p_due_date: c.date,
    p_description: `Aplicação de ${label}${c.dose ? ` ${c.dose}` : ""}`,
    p_category: "Medicações",
    p_patient_id: (plan as any)?.patient_id ?? null,
    p_payer_name: (plan as any)?.patients?.name ?? null,
    p_competence_date: `-01`,
    p_company_id: c.companyId,
  });
  if (error) throw error;
  await setTitleServiceType(id, "medicacoes").catch(() => undefined);
}

const QUICK_REASONS = [
  "Esquecimento do paciente",
  "Náuseas / desconforto gástrico",
  "Efeito colateral / intolerância",
  "Orientação médica de pausa",
  "Falta da medicação na farmácia",
  "Paciente em viagem",
];

export default function MedicationUsePanel({
  treatmentId,
  medication,
  variant = "panel",
  onSaved,
}: {
  treatmentId: string;
  /** Medicação já escolhida (botão "Registrar aplicação" de uma semana do cronograma). */
  medication?: MedicationPreset;
  /** "dialog" mostra só o formulário, sem moldura, seletor de medicação nem histórico. */
  variant?: "panel" | "dialog";
  onSaved?: () => void;
}) {
  const isDialog = variant === "dialog";
  const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [statusType, setStatusType] = useState<"tomou" | "nao_tomou" | "suspensa" | "adiada">(
    "tomou",
  );
  const [form, setForm] = useState(() => emptyForm(medication));
  // Medicação da clínica pode gerar cobrança (receita do tipo Medicações)
  const [charge, setCharge] = useState({ on: false, amount: "" });
  const query = useQuery({
    queryKey: ["treatment-medication-uses", treatmentId, "options"],
    queryFn: async () => {
      const [meds, items] = await Promise.all([
        supabase
          .from("treatment_medications")
          .select("id,name,dose,unit,route")
          .eq("treatment_id", treatmentId)
          .eq("status", "ativo"),
        supabase
          .from("inventory_items")
          .select("id,name,unit,quantity")
          .eq("active", true)
          .order("name"),
      ]);
      if (meds.error) throw meds.error;
      if (items.error) throw items.error;
      // Ordem natural: "(Sem. 2)" antes de "(Sem. 10)".
      const sortedMeds = [...meds.data].sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR", { numeric: true }),
      );
      return { meds: sortedMeds, items: items.data };
    },
  });
  const usesQuery = useTreatmentMedicationUses(treatmentId);
  const uses = usesQuery.data ?? [];
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.medication || !form.dose.trim() || !form.usedAt) {
      toast.error("Informe a medicação, a dose e a data/hora.");
      return;
    }

    const isNonAdmin = statusType !== "tomou";
    if (isNonAdmin && !form.notes.trim()) {
      toast.error("Por favor, descreva o motivo nas observações (ex: esquecimento, enjoo, etc.)");
      return;
    }

    const quantity = Number(form.quantity);
    if (!isNonAdmin && form.item && (!Number.isInteger(quantity) || quantity <= 0)) {
      toast.error("Informe a quantidade inteira consumida na unidade do estoque.");
      return;
    }

    const chargeAmount = Number(String(charge.amount).replace(/\./g, "").replace(",", "."));
    const willCharge = !isNonAdmin && !!form.item && charge.on;
    if (willCharge && !(chargeAmount > 0)) {
      toast.error("Informe o valor a cobrar pela aplicação.");
      return;
    }

    let finalDose = form.dose.trim();
    if (statusType === "nao_tomou") {
      finalDose = `[NÃO TOMOU] ${finalDose}`;
    } else if (statusType === "suspensa") {
      finalDose = `[SUSPENSA] ${finalDose}`;
    } else if (statusType === "adiada") {
      finalDose = `[ADIADA] ${finalDose}`;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("record_treatment_medication_use", {
        p_id: requestId.current,
        p_medication_id: form.medication,
        p_dose: finalDose,
        p_used_at: new Date(form.usedAt).toISOString(),
        p_route: form.route.trim() || null,
        p_notes: form.notes.trim() || null,
        p_inventory_item_id: !isNonAdmin && form.item ? form.item : null,
        p_quantity: !isNonAdmin && form.item ? quantity : null,
      });
      if (error) throw error;
      if (willCharge) {
        try {
          await chargeApplication(treatmentId, {
            name: query.data?.meds.find((m) => m.id === form.medication)?.name || medication?.name || "Medicação",
            dose: form.dose.trim(),
            amount: chargeAmount,
            date: form.usedAt.slice(0, 10),
            // Mesma clínica que os outros lançamentos (primeiro escopo com permissão de lançar)
            companyId:
              (
                await qc.fetchQuery({
                  queryKey: ["financial-snapshot"],
                  queryFn: getFinancialSnapshot,
                  staleTime: 60_000,
                })
              ).scopes.find((s) => s.can_create)?.id ?? null,
          });
          void refreshFinance(qc);
        } catch (err) {
          toast.warning("Aplicação registrada, mas a cobrança não foi gerada", {
            description: `. Lance pelo Financeiro (Nova receita › Medicações).`,
          });
        }
        setCharge({ on: false, amount: "" });
      }
      requestId.current = crypto.randomUUID();
      setForm(emptyForm(medication));
      setStatusType("tomou");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["treatment-medication-uses", treatmentId] }),
        qc.invalidateQueries({ queryKey: ["inventory-items-list"] }),
        qc.invalidateQueries({ queryKey: ["inventory-clinical-stock"] }),
      ]);

      if (statusType === "nao_tomou") {
        toast.success(
          "Ocorrência registrada: paciente não tomou a medicação (sem baixa de estoque).",
        );
      } else if (statusType === "suspensa") {
        toast.success(
          "Ocorrência registrada: medicação suspensa pelo médico (sem baixa de estoque).",
        );
      } else if (statusType === "adiada") {
        toast.success("Ocorrência registrada: dose adiada / esquecida (sem baixa de estoque).");
      } else {
        toast.success(
          form.item
            ? "Uso registrado. O item foi baixado do estoque da clínica."
            : "Uso externo / do paciente registrado com sucesso.",
        );
      }
      onSaved?.();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={isDialog ? "space-y-4" : "rounded-2xl border bg-card p-5 space-y-4 mt-5 shadow-xs"}
    >
      {!isDialog && (
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Pill className="h-5 w-5 text-primary" />
              Registro de Medicação & Adesão do Paciente
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Registre administrações reais ou anote ocorrências de não adesão ("não tomou",
              suspensões ou pausas), preservando o histórico da ficha física.
            </p>
          </div>
        </div>
      )}

      {(query.error || usesQuery.error) && (
        <p
          role="alert"
          className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/25"
        >
          {errorMessage(query.error || usesQuery.error)}
        </p>
      )}
      {query.isPending && (
        <p className="text-sm text-muted-foreground">Carregando medicações e estoque...</p>
      )}

      {/* Tipo de Ocorrência */}
      <div className="space-y-1.5 pt-1">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tipo de Ocorrência
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setStatusType("tomou")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "tomou"
                ? "bg-success/10 border-success text-success shadow-2xs"
                : "bg-muted/60 border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
            Tomada / Aplicada
          </button>
          <button
            type="button"
            onClick={() => setStatusType("nao_tomou")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "nao_tomou"
                ? "bg-destructive/10 border-destructive text-destructive shadow-2xs"
                : "bg-muted/60 border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
            Não Tomou / Ausente
          </button>
          <button
            type="button"
            onClick={() => setStatusType("suspensa")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "suspensa"
                ? "bg-primary-soft border-primary text-primary-hover shadow-2xs"
                : "bg-muted/60 border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0" />
            Suspensa p/ Médico
          </button>
          <button
            type="button"
            onClick={() => setStatusType("adiada")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "adiada"
                ? "bg-warning/10 border-warning text-warning shadow-2xs"
                : "bg-muted/60 border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <Clock className="h-3.5 w-3.5 text-warning shrink-0" />
            Adiada / Esquecida
          </button>
        </div>
      </div>

      <form onSubmit={save} className="grid sm:grid-cols-2 gap-3 pt-1">
        {!isDialog && (
          <label className="text-sm font-medium text-foreground/80">
            Medicação
            <select
              required
              className={input}
              value={form.medication}
              onChange={(e) => {
                const med = query.data?.meds.find((m) => m.id === e.target.value);
                setForm({
                  ...form,
                  medication: e.target.value,
                  dose: med ? `${med.dose || ""} ${med.unit || ""}`.trim() : "",
                  route: med?.route || "",
                });
              }}
            >
              <option value="">Selecione</option>
              {query.data?.meds.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm font-medium text-foreground/80">
          {statusType === "tomou" ? "Dose tomada / aplicada" : "Dose prevista (não administrada)"}
          <input
            required
            className={input}
            value={form.dose}
            onChange={(e) => setForm({ ...form, dose: e.target.value })}
            placeholder="Ex: 50mg, 1 ampola"
          />
        </label>
        <label className="text-sm font-medium text-foreground/80">
          Via de Administração
          <input
            className={input}
            value={form.route}
            onChange={(e) => setForm({ ...form, route: e.target.value })}
            placeholder="Ex: Oral, Subcutânea, Intramuscular"
          />
        </label>
        <label className="text-sm font-medium text-foreground/80">
          Data e hora do registro
          <input
            required
            type="datetime-local"
            max={nowInput()}
            className={input}
            value={form.usedAt}
            onChange={(e) => setForm({ ...form, usedAt: e.target.value })}
          />
        </label>

        {statusType === "tomou" ? (
          <>
            <label className="text-sm font-medium text-foreground/80">
              Origem / item consumido
              <select
                className={input}
                value={form.item}
                onChange={(e) => setForm({ ...form, item: e.target.value })}
              >
                <option value="">Uso externo / trazido pelo paciente (sem baixa)</option>
                {query.data?.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.quantity} {i.unit} em estoque)
                  </option>
                ))}
              </select>
            </label>
            {form.item ? (
              <label className="text-sm font-medium text-foreground/80">
                Quantidade consumida da clínica
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  className={input}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </label>
            ) : null}
            {form.item ? (
              <div className="sm:col-span-2 space-y-2 rounded-lg border border-border-soft bg-muted/40 p-2.5">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={charge.on}
                    onChange={(e) => setCharge({ ...charge, on: e.target.checked })}
                  />
                  Cobrar esta aplicação do paciente
                </label>
                {charge.on && (
                  <label className="block text-sm font-medium text-foreground/80">
                    Valor (R$)
                    <input
                      inputMode="decimal"
                      className={input}
                      placeholder="Ex.: 450,00"
                      value={charge.amount}
                      onChange={(e) => setCharge({ ...charge, amount: e.target.value })}
                    />
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      Gera uma receita em Contas a Receber, no tipo de serviço "Medicações".
                    </span>
                  </label>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground self-center bg-muted/60 p-2.5 rounded-lg border border-border-soft">
                Sem consumo de estoque da clínica (administração domiciliar ou frasco do paciente).
              </div>
            )}
          </>
        ) : (
          <div className="sm:col-span-2 p-3 rounded-xl bg-warning/10 border border-warning/25 text-xs text-warning space-y-2">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span>Ocorrência de não administração — Estoque preservado</span>
            </div>
            <p className="text-warning">
              Como a medicação não foi aplicada na clínica, nenhum item será descontado do estoque.
              Selecione abaixo o motivo rápido ou digite nas observações.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => {
                    const current = form.notes.trim();
                    setForm({
                      ...form,
                      notes: current ? `${current}; ${reason}` : reason,
                    });
                  }}
                  className="px-2 py-1 rounded-md text-xs font-medium bg-card border border-warning/35 text-warning hover:bg-warning/8 transition cursor-pointer"
                >
                  + {reason}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="text-sm font-medium text-foreground/80 sm:col-span-2">
          {statusType === "tomou"
            ? "Observações clínicas"
            : "Motivo / Justificativa clínica (obrigatório)"}
          <textarea
            required={statusType !== "tomou"}
            placeholder={
              statusType === "tomou"
                ? "Anotações sobre a aplicação, tolerância, etc."
                : "Descreva a justificativa clínica (ex: paciente relatou náuseas no 3º dia e suspendeu por conta própria)"
            }
            className={`${input} min-h-[70px] resize-none`}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <div className="sm:col-span-2 flex justify-end">
          <button
            disabled={busy || !query.data}
            className={`rounded-xl px-5 py-2.5 font-semibold text-sm text-white transition cursor-pointer disabled:opacity-50 ${
              statusType === "nao_tomou"
                ? "bg-destructive hover:bg-destructive/90"
                : statusType === "suspensa"
                  ? "bg-primary hover:bg-primary-hover"
                  : statusType === "adiada"
                    ? "bg-warning hover:bg-warning/90"
                    : "bg-primary hover:opacity-90"
            }`}
          >
            {busy
              ? "Registrando..."
              : statusType === "nao_tomou"
                ? "Gravar registro: Não Tomou"
                : statusType === "suspensa"
                  ? "Gravar suspensão médica"
                  : statusType === "adiada"
                    ? "Gravar adiamento"
                    : "Registrar aplicação"}
          </button>
        </div>
      </form>

      {/* Histórico com Adesão Visual */}
      {!isDialog && (
        <div className="border-t pt-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Histórico de Aplicações & Interrupções
          </h4>

          {usesQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground py-3 text-center bg-muted/60 rounded-xl">
              Nenhum registro de medicação ou ocorrência anotado.
            </p>
          )}

          <div className="space-y-2.5">
            {uses.map((u) => {
              const rawDose = u.dose || "";
              const isNaoTomou = rawDose.includes("[NÃO TOMOU]");
              const isSuspensa = rawDose.includes("[SUSPENSA]");
              const isAdiada = rawDose.includes("[ADIADA]");
              const cleanDose = rawDose
                .replace("[NÃO TOMOU]", "")
                .replace("[SUSPENSA]", "")
                .replace("[ADIADA]", "")
                .trim();

              return (
                <article
                  key={u.id}
                  className={`p-3 rounded-xl border text-sm transition ${
                    isNaoTomou
                      ? "bg-destructive/5 border-destructive/25"
                      : isSuspensa
                        ? "bg-primary-soft/50 border-primary/25"
                        : isAdiada
                          ? "bg-warning/5 border-warning/25"
                          : "bg-muted/42 border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isNaoTomou ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-destructive/15 text-destructive">
                          <XCircle className="h-3 w-3" /> Não Tomou
                        </span>
                      ) : isSuspensa ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-primary-soft text-primary-hover">
                          <AlertTriangle className="h-3 w-3" /> Suspensa
                        </span>
                      ) : isAdiada ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-warning/15 text-warning">
                          <Clock className="h-3 w-3" /> Adiada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-success/15 text-success">
                          <CheckCircle2 className="h-3 w-3" /> Aplicada
                        </span>
                      )}
                      <span className="font-semibold text-foreground">{u.medication_name}</span>
                      {cleanDose && (
                        <span className="text-muted-foreground font-medium">({cleanDose})</span>
                      )}
                      {u.route && (
                        <span className="text-muted-foreground text-xs">• {u.route}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">
                      {new Date(u.used_at).toLocaleString("pt-BR")}
                    </span>
                  </div>

                  <div className="mt-1.5 text-xs text-muted-foreground flex items-center gap-2">
                    <span>
                      {u.inventory_item_id
                        ? `Consumo da clínica: ${u.quantity} unidade(s) de estoque`
                        : isNaoTomou || isSuspensa || isAdiada
                          ? "Sem saída de estoque (ocorrência clínica de interrupção/ausência)"
                          : "Uso externo / trazido pelo paciente (sem saída de estoque)"}
                    </span>
                  </div>

                  {u.notes && (
                    <p className="mt-2 text-xs bg-card/80 p-2 rounded-lg border border-border/60 text-foreground/80 whitespace-pre-wrap font-sans">
                      <strong className="text-foreground">Observação:</strong> {u.notes}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/** Diálogo do botão "Registrar aplicação" de cada item do cronograma. */
export function RegisterApplicationDialog({
  treatmentId,
  medication,
  onClose,
}: {
  treatmentId: string;
  medication: MedicationPreset;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Syringe className="h-4 w-4 text-primary" />
            Registrar aplicação
          </DialogTitle>
          <DialogDescription>
            {medication.name}
            {medication.start_date
              ? ` — prevista para ${formatClinicalDate(medication.start_date)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <MedicationUsePanel
          treatmentId={treatmentId}
          medication={medication}
          variant="dialog"
          onSaved={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

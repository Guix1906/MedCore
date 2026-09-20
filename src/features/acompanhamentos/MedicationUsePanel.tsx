import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, localDate } from "./followup-utils";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Pill } from "lucide-react";

const input = "w-full rounded-lg border border-slate-200 p-2 text-sm";
const nowInput = () => `${localDate()}T${new Date().toTimeString().slice(0, 5)}`;

const QUICK_REASONS = [
  "Esquecimento do paciente",
  "Náuseas / desconforto gástrico",
  "Efeito colateral / intolerância",
  "Orientação médica de pausa",
  "Falta da medicação na farmácia",
  "Paciente em viagem",
];

export default function MedicationUsePanel({ treatmentId }: { treatmentId: string }) {
  const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [statusType, setStatusType] = useState<"tomou" | "nao_tomou" | "suspensa" | "adiada">("tomou");
  const [form, setForm] = useState({
    medication: "",
    dose: "",
    route: "",
    usedAt: nowInput(),
    notes: "",
    item: "",
    quantity: "1",
  });
  const query = useQuery({
    queryKey: ["treatment-medication-uses", treatmentId],
    queryFn: async () => {
      const [meds, items, uses] = await Promise.all([
        supabase
          .from("treatment_medications")
          .select("id,name,dose,unit,route")
          .eq("treatment_id", treatmentId)
          .eq("status", "ativo")
          .order("name"),
        supabase
          .from("inventory_items")
          .select("id,name,unit,quantity")
          .eq("active", true)
          .order("name"),
        supabase
          .from("treatment_medication_uses")
          .select("*")
          .eq("treatment_id", treatmentId)
          .order("used_at", { ascending: false }),
      ]);
      if (meds.error) throw meds.error;
      if (items.error) throw items.error;
      if (uses.error) throw uses.error;
      return { meds: meds.data, items: items.data, uses: uses.data };
    },
  });
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
      requestId.current = crypto.randomUUID();
      setForm({
        medication: "",
        dose: "",
        route: "",
        usedAt: nowInput(),
        notes: "",
        item: "",
        quantity: "1",
      });
      setStatusType("tomou");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["treatment-medication-uses", treatmentId] }),
        qc.invalidateQueries({ queryKey: ["inventory-items-list"] }),
        qc.invalidateQueries({ queryKey: ["inventory-clinical-stock"] }),
      ]);

      if (statusType === "nao_tomou") {
        toast.success("Ocorrência registrada: paciente não tomou a medicação (sem baixa de estoque).");
      } else if (statusType === "suspensa") {
        toast.success("Ocorrência registrada: medicação suspensa pelo médico (sem baixa de estoque).");
      } else if (statusType === "adiada") {
        toast.success("Ocorrência registrada: dose adiada / esquecida (sem baixa de estoque).");
      } else {
        toast.success(
          form.item
            ? "Uso registrado. O item foi baixado do estoque da clínica."
            : "Uso externo / do paciente registrado com sucesso.",
        );
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-white p-5 space-y-4 mt-5 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <Pill className="h-5 w-5 text-primary" />
            Registro de Medicação & Adesão do Paciente
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Registre administrações reais ou anote ocorrências de não adesão ("não tomou", suspensões ou pausas), preservando o histórico da ficha física.
          </p>
        </div>
      </div>

      {query.error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 p-3 rounded-lg border border-red-200">
          {errorMessage(query.error)}
        </p>
      )}
      {query.isPending && <p className="text-sm text-slate-500">Carregando medicações e estoque...</p>}

      {/* Tipo de Ocorrência */}
      <div className="space-y-1.5 pt-1">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
          Tipo de Ocorrência
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setStatusType("tomou")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "tomou"
                ? "bg-emerald-50 border-emerald-500 text-emerald-800 shadow-2xs"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            Tomada / Aplicada
          </button>
          <button
            type="button"
            onClick={() => setStatusType("nao_tomou")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "nao_tomou"
                ? "bg-rose-50 border-rose-500 text-rose-800 shadow-2xs"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
            Não Tomou / Ausente
          </button>
          <button
            type="button"
            onClick={() => setStatusType("suspensa")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "suspensa"
                ? "bg-purple-50 border-purple-500 text-purple-800 shadow-2xs"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-purple-600 shrink-0" />
            Suspensa p/ Médico
          </button>
          <button
            type="button"
            onClick={() => setStatusType("adiada")}
            className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              statusType === "adiada"
                ? "bg-amber-50 border-amber-500 text-amber-800 shadow-2xs"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            Adiada / Esquecida
          </button>
        </div>
      </div>

      <form onSubmit={save} className="grid sm:grid-cols-2 gap-3 pt-1">
        <label className="text-sm font-medium text-slate-700">
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
        <label className="text-sm font-medium text-slate-700">
          {statusType === "tomou" ? "Dose tomada / aplicada" : "Dose prevista (não administrada)"}
          <input
            required
            className={input}
            value={form.dose}
            onChange={(e) => setForm({ ...form, dose: e.target.value })}
            placeholder="Ex: 50mg, 1 ampola"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Via de Administração
          <input
            className={input}
            value={form.route}
            onChange={(e) => setForm({ ...form, route: e.target.value })}
            placeholder="Ex: Oral, Subcutânea, Intramuscular"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
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
            <label className="text-sm font-medium text-slate-700">
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
              <label className="text-sm font-medium text-slate-700">
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
            ) : (
              <div className="text-xs text-slate-500 self-center bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                Sem consumo de estoque da clínica (administração domiciliar ou frasco do paciente).
              </div>
            )}
          </>
        ) : (
          <div className="sm:col-span-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span>Ocorrência de não administração — Estoque preservado</span>
            </div>
            <p className="text-amber-800">
              Como a medicação não foi aplicada na clínica, nenhum item será descontado do estoque. Selecione abaixo o motivo rápido ou digite nas observações.
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
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-white border border-amber-300 text-amber-800 hover:bg-amber-100/50 transition cursor-pointer"
                >
                  + {reason}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
          {statusType === "tomou" ? "Observações clínicas" : "Motivo / Justificativa clínica (obrigatório)"}
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
                ? "bg-rose-600 hover:bg-rose-700"
                : statusType === "suspensa"
                  ? "bg-purple-600 hover:bg-purple-700"
                  : statusType === "adiada"
                    ? "bg-amber-600 hover:bg-amber-700"
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
      <div className="border-t pt-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
          Histórico de Aplicações & Interrupções
        </h4>

        {query.data?.uses.length === 0 && (
          <p className="text-sm text-slate-500 py-3 text-center bg-slate-50 rounded-xl">
            Nenhum registro de medicação ou ocorrência anotado.
          </p>
        )}

        <div className="space-y-2.5">
          {query.data?.uses.map((u) => {
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
                    ? "bg-rose-50/50 border-rose-200"
                    : isSuspensa
                      ? "bg-purple-50/50 border-purple-200"
                      : isAdiada
                        ? "bg-amber-50/50 border-amber-200"
                        : "bg-slate-50/70 border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isNaoTomou ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                        <XCircle className="h-3 w-3" /> Não Tomou
                      </span>
                    ) : isSuspensa ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
                        <AlertTriangle className="h-3 w-3" /> Suspensa
                      </span>
                    ) : isAdiada ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                        <Clock className="h-3 w-3" /> Adiada
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> Aplicada
                      </span>
                    )}
                    <span className="font-semibold text-slate-900">
                      {u.medication_name}
                    </span>
                    {cleanDose && (
                      <span className="text-slate-600 font-medium">({cleanDose})</span>
                    )}
                    {u.route && <span className="text-slate-500 text-xs">• {u.route}</span>}
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    {new Date(u.used_at).toLocaleString("pt-BR")}
                  </span>
                </div>

                <div className="mt-1.5 text-xs text-slate-600 flex items-center gap-2">
                  <span>
                    {u.inventory_item_id
                      ? `Consumo da clínica: ${u.quantity} unidade(s) de estoque`
                      : isNaoTomou || isSuspensa || isAdiada
                        ? "Sem saída de estoque (ocorrência clínica de interrupção/ausência)"
                        : "Uso externo / trazido pelo paciente (sem saída de estoque)"}
                  </span>
                </div>

                {u.notes && (
                  <p className="mt-2 text-xs bg-white/80 p-2 rounded-lg border border-slate-200/60 text-slate-700 whitespace-pre-wrap font-sans">
                    <strong className="text-slate-800">Observação:</strong> {u.notes}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

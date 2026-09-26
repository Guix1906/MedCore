import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ClinicalPhotos from "./ClinicalPhotos";
import TreatmentAlerts from "./TreatmentAlerts";
import { errorMessage, formatClinicalDate, localDate, protocolDeadline } from "./followup-utils";

const input = "w-full rounded-lg border border-border p-2 text-sm";
const statusLabel: Record<string, string> = {
  em_andamento: "Em andamento",
  pausado: "Pausado",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

export async function changeTreatmentStatus(id: string, status: string): Promise<boolean> {
  const reason = window.prompt("Informe a justificativa da alteração de status:");
  if (reason === null) return false;
  if (!reason.trim()) {
    toast.error("A justificativa é obrigatória.");
    return false;
  }
  const { error } = await supabase
    .from("treatments")
    .update({ status, status_reason: reason.trim() })
    .eq("id", id);
  if (error) {
    toast.error(error.message);
    return false;
  }
  toast.success("Status e justificativa registrados.");
  return true;
}

export default function ClinicalFollowup({
  treatmentId,
  objective,
  startDate,
  status,
  endDate,
  nextReturn,
  returnDays,
  onSaved,
}: {
  treatmentId: string;
  objective: string | null;
  startDate: string;
  status: string;
  endDate: string | null;
  nextReturn: string | null;
  returnDays: number | null;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    date: localDate(),
    notes: "",
    weight: "",
    parameters: "",
    next: "",
    returned: false,
  });
  const history = useQuery({
    queryKey: ["treatment-evolutions", treatmentId],
    queryFn: async () => {
      const [e, s] = await Promise.all([
        supabase
          .from("treatment_evolutions")
          .select("*")
          .eq("treatment_id", treatmentId)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("treatment_status_history")
          .select("*")
          .eq("treatment_id", treatmentId)
          .order("created_at", { ascending: false }),
      ]);
      if (e.error) throw e.error;
      if (s.error) throw s.error;
      return { evolutions: e.data, statuses: s.data };
    },
  });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const weight = form.weight === "" ? null : Number(form.weight.replace(",", "."));
    if (
      !form.notes.trim() ||
      (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 700))
    ) {
      toast.error("Informe a evolução e um peso válido (maior que zero e até 700 kg).");
      return;
    }
    if (!form.date || form.date < startDate || form.date > localDate()) {
      toast.error("Confira a data da evolução.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("record_treatment_evolution", {
        p_id: requestId.current,
        p_treatment_id: treatmentId,
        p_occurred_on: form.date,
        p_notes: form.notes.trim(),
        p_weight_kg: weight,
        p_parameters: form.parameters.trim() || null,
        p_next_step: form.next.trim() || null,
        p_is_return: form.returned,
      });
      if (error) throw error;
      requestId.current = crypto.randomUUID();
      setForm({
        date: localDate(),
        notes: "",
        weight: "",
        parameters: "",
        next: "",
        returned: false,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["treatment-evolutions", treatmentId] }),
        qc.invalidateQueries({ queryKey: ["treatment-alerts"] }),
        qc.invalidateQueries({ queryKey: ["treatments-list"] }),
      ]);
      onSaved();
      toast.success("Evolução salva. O retorno realizado renova a próxima data do paciente.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card p-4 text-sm space-y-1">
        <p className="font-semibold">{protocolDeadline(status, endDate)}</p>
        <p>Prazo do protocolo: {formatClinicalDate(endDate)}</p>
        <p>
          Próximo retorno necessário: {formatClinicalDate(nextReturn)} (a cada {returnDays || 30}{" "}
          dias).
        </p>
        <p className="text-muted-foreground">
          A previsão de retorno não substitui um agendamento. Marque abaixo somente quando o retorno
          tiver sido realizado.
        </p>
      </div>
      <TreatmentAlerts scope="clinical" treatmentId={treatmentId} />
      <section className="rounded-2xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">Evolução clínica e peso</h3>
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            Data
            <input
              required
              type="date"
              className={input}
              min={startDate}
              max={localDate()}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Peso (kg)
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="700"
              className={input}
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Evolução / observação / justificativa
            <textarea
              required
              rows={3}
              className={input}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Outros parâmetros clínicos
            <input
              className={input}
              value={form.parameters}
              onChange={(e) => setForm({ ...form, parameters: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Próxima conduta
            <input
              className={input}
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
            />
          </label>
          <label className="flex gap-2 items-center text-sm">
            <input
              type="checkbox"
              disabled={status !== "em_andamento"}
              checked={form.returned}
              onChange={(e) => setForm({ ...form, returned: e.target.checked })}
            />
            Retorno realizado nesta data
          </label>
          <button
            disabled={busy}
            className="rounded-xl bg-primary text-white p-2 disabled:opacity-50"
          >
            {busy ? "Salvando..." : "Salvar evolução"}
          </button>
        </form>
        {history.isPending && <p>Carregando histórico...</p>}
        {history.error && (
          <p role="alert" className="text-destructive">
            {errorMessage(history.error)}
          </p>
        )}
        {history.data?.evolutions.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma evolução registrada.</p>
        )}
        {history.data?.evolutions.map((e) => (
          <article key={e.id} className="border-t pt-3 text-sm space-y-1">
            <p className="font-semibold">
              {formatClinicalDate(e.occurred_on)}
              {e.is_return && " - Retorno realizado"}
              {e.weight_kg !== null && ` - ${e.weight_kg} kg`}
            </p>
            <p className="whitespace-pre-wrap">{e.notes}</p>
            {e.parameters && <p>Parâmetros: {e.parameters}</p>}
            {e.next_step && <p>Próxima conduta: {e.next_step}</p>}
            <p className="text-xs text-muted-foreground">
              Registrado em {new Date(e.created_at).toLocaleString("pt-BR")}
            </p>
          </article>
        ))}
        {!!history.data?.statuses.length && (
          <h4 className="font-semibold">Histórico de status e justificativas</h4>
        )}
        {history.data?.statuses.map((s) => (
          <p key={s.id} className="text-sm border-t pt-2">
            {new Date(s.created_at).toLocaleString("pt-BR")}: {statusLabel[s.previous_status]} →{" "}
            {statusLabel[s.status]} — {s.justification}
          </p>
        ))}
      </section>
      <ClinicalPhotos treatmentId={treatmentId} objective={objective} />
    </div>
  );
}

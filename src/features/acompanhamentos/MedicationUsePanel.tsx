import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, localDate } from "./followup-utils";

const input = "w-full rounded-lg border border-slate-200 p-2 text-sm";
const nowInput = () => `${localDate()}T${new Date().toTimeString().slice(0, 5)}`;

export default function MedicationUsePanel({ treatmentId }: { treatmentId: string }) {
  const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
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
      toast.error("Informe medicação, dose e data do uso.");
      return;
    }
    const quantity = Number(form.quantity);
    if (form.item && (!Number.isInteger(quantity) || quantity <= 0)) {
      toast.error("Informe a quantidade inteira consumida na unidade do estoque.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("record_treatment_medication_use", {
        p_id: requestId.current,
        p_medication_id: form.medication,
        p_dose: form.dose.trim(),
        p_used_at: new Date(form.usedAt).toISOString(),
        p_route: form.route.trim() || null,
        p_notes: form.notes.trim() || null,
        p_inventory_item_id: form.item || null,
        p_quantity: form.item ? quantity : null,
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
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["treatment-medication-uses", treatmentId] }),
        qc.invalidateQueries({ queryKey: ["inventory-items-list"] }),
        qc.invalidateQueries({ queryKey: ["inventory-clinical-stock"] }),
      ]);
      toast.success("Uso registrado. O consumo de item da clínica foi baixado do estoque.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border bg-white p-5 space-y-4 mt-5">
      <h3 className="font-bold">Medicação efetivamente tomada / aplicada</h3>
      <p className="text-sm text-slate-500">
        Prescrever não baixa estoque. Selecione um item somente quando houver consumo da clínica;
        dose clínica e quantidade de estoque são campos distintos.
      </p>
      {query.error && (
        <p role="alert" className="text-red-700">
          {errorMessage(query.error)}
        </p>
      )}
      {query.isPending && <p>Carregando medicações e estoque...</p>}
      <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
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
        <label className="text-sm">
          Dose tomada / aplicada
          <input
            required
            className={input}
            value={form.dose}
            onChange={(e) => setForm({ ...form, dose: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Via
          <input
            className={input}
            value={form.route}
            onChange={(e) => setForm({ ...form, route: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Data e hora do uso
          <input
            required
            type="datetime-local"
            max={nowInput()}
            className={input}
            value={form.usedAt}
            onChange={(e) => setForm({ ...form, usedAt: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Origem / item consumido
          <select
            className={input}
            value={form.item}
            onChange={(e) => setForm({ ...form, item: e.target.value })}
          >
            <option value="">Uso externo / do paciente (sem baixa)</option>
            {query.data?.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.quantity} {i.unit})
              </option>
            ))}
          </select>
        </label>
        {form.item && (
          <label className="text-sm">
            Quantidade consumida (unidade do estoque)
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
        )}
        <label className="text-sm sm:col-span-2">
          Descrição / observações
          <textarea
            className={input}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <button
          disabled={busy || !query.data}
          className="rounded-xl bg-purple-600 text-white p-2 disabled:opacity-50"
        >
          {busy ? "Registrando..." : "Registrar uso"}
        </button>
      </form>
      {query.data?.uses.length === 0 && (
        <p className="text-sm text-slate-500">Nenhum uso registrado.</p>
      )}
      {query.data?.uses.map((u) => (
        <article key={u.id} className="border-t pt-3 text-sm">
          <p className="font-semibold">
            {new Date(u.used_at).toLocaleString("pt-BR")} - {u.medication_name}: {u.dose} {u.route}
          </p>
          <p>
            {u.inventory_item_id
              ? `Consumo da clínica: ${u.quantity} unidade(s) de estoque`
              : "Uso externo / do paciente - sem baixa de estoque"}
          </p>
          <p className="whitespace-pre-wrap">{u.notes}</p>
        </article>
      ))}
    </section>
  );
}

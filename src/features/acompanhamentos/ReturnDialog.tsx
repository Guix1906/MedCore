import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatDateOnly } from "@/lib/date-utils";
import { errorMessage, localDate } from "./followup-utils";

/**
 * Retorno do plano: registra que o paciente compareceu (entra no histórico como evolução de
 * retorno) e marca a data do próximo retorno. Atalhos de 15/30/45/60/90 dias.
 */

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: any }>;
const callRpc = supabase.rpc.bind(supabase) as unknown as Rpc;

export function ReturnDialog({
  treatment,
  onClose,
  onSaved,
}: {
  treatment: {
    id: string;
    title: string;
    start_date: string;
    return_days: number | null;
    next_return_date: string | null;
    patients?: { name: string } | null;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = localDate();
  const interval = treatment.return_days || 30;
  const late = !!treatment.next_return_date && treatment.next_return_date <= today;
  const [attended, setAttended] = useState(late);
  const [returnedOn, setReturnedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState(() => addDays(today, interval));
  const [busy, setBusy] = useState(false);
  const base = attended ? returnedOn : today;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!next || next < today) return toast.error("Escolha uma data de próximo retorno a partir de hoje.");
    if (attended && next <= returnedOn) return toast.error("O próximo retorno deve ser depois do retorno realizado.");
    setBusy(true);
    try {
      const { error } = await callRpc("schedule_treatment_return", {
        p_treatment_id: treatment.id,
        p_next_date: next,
        p_returned_on: attended ? returnedOn : null,
        p_notes: attended ? notes.trim() || null : null,
      });
      if (error) {
        if (/schedule_treatment_return|function .* does not exist|PGRST202/i.test(error.message ?? ""))
          throw new Error(
            "Aplique a migração 20261009150000_treatment_return_scheduling.sql no Supabase para usar os retornos.",
          );
        throw error;
      }
      toast.success(
        attended
          ? `Retorno registrado. Próximo em ${formatDateOnly(next)}.`
          : `Próximo retorno marcado para ${formatDateOnly(next)}.`,
      );
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const input =
    "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={save} className="space-y-4">
          <div>
            <DialogTitle>Retorno · {treatment.patients?.name ?? "Paciente"}</DialogTitle>
            <DialogDescription className="mt-1">
              {treatment.title}
              {treatment.next_return_date && (
                <>
                  {" · "}previsto para{" "}
                  <b className={late ? "text-destructive" : "text-foreground"}>
                    {formatDateOnly(treatment.next_return_date)}
                    {late ? " (vencido)" : ""}
                  </b>
                </>
              )}
            </DialogDescription>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={attended}
              onChange={(e) => {
                setAttended(e.target.checked);
                setNext(addDays(e.target.checked ? returnedOn : today, interval));
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <b>O paciente compareceu ao retorno</b>
              <span className="block text-xs text-muted-foreground">
                Fica registrado no histórico do plano. Desmarque para só remarcar a data.
              </span>
            </span>
          </label>

          {attended && (
            <div className="grid grid-cols-1 gap-3">
              <label className="space-y-1 text-sm font-medium">
                Data do retorno realizado
                <input
                  type="date"
                  value={returnedOn}
                  min={treatment.start_date?.slice(0, 10)}
                  max={today}
                  onChange={(e) => {
                    setReturnedOn(e.target.value);
                    setNext(addDays(e.target.value || today, interval));
                  }}
                  className={input}
                  required
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Observação (opcional)
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: paciente bem, manteve a dose"
                  className={input}
                />
              </label>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="space-y-1 text-sm font-medium">
              Próximo retorno
              <input
                type="date"
                value={next}
                min={today}
                onChange={(e) => setNext(e.target.value)}
                className={input}
                required
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[15, 30, 45, 60, 90].map((d) => {
                const value = addDays(base, d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setNext(value)}
                    className={`h-7 rounded-lg px-2.5 text-xs font-semibold transition cursor-pointer ${
                      next === value ? "bg-primary text-white" : "bg-muted text-foreground/80 hover:bg-surface-2"
                    }`}
                  >
                    {d} dias
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted cursor-pointer"
            >
              Voltar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {attended ? "Registrar retorno" : "Salvar data"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

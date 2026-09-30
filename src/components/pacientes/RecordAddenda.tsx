import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/**
 * Adendos de um prontuário: complementos que não alteram o texto original. São a única forma
 * de acrescentar informação a um prontuário assinado, e não podem ser editados nem apagados.
 */
export function RecordAddenda({ recordId, patientId }: { recordId: string; patientId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: addenda = [] } = useQuery({
    queryKey: ["record-addenda", recordId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medical_record_addenda")
        .select("id, content, created_at")
        .eq("record_id", recordId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    const content = text.trim();
    if (content.length < 3) {
      toast.error("Escreva o adendo antes de salvar.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("medical_record_addenda")
      .insert({ record_id: recordId, patient_id: patientId, content });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar o adendo", { description: error.message });
      return;
    }
    toast.success("Adendo registrado.");
    setText("");
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["record-addenda", recordId] });
  };

  return (
    <div className="space-y-2">
      {addenda.map((a) => (
        <div key={a.id} className="rounded-lg border border-border-soft bg-muted/30 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Adendo em {new Date(a.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </p>
          <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">{a.content}</p>
        </div>
      ))}
      {open ? (
        <div className="space-y-2">
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Complemento ao atendimento (o texto original não é alterado)"
            aria-label="Texto do adendo"
            className="w-full resize-y rounded-xl border border-input bg-card p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={saving}>
              {saving ? "Salvando…" : "Registrar adendo"}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <FilePlus2 className="size-3.5" aria-hidden="true" /> Adicionar adendo
        </button>
      )}
    </div>
  );
}

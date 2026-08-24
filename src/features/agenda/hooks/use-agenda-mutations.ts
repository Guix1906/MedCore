import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pad2 } from "@/lib/date-utils";
import { deleteStoredLocalEvent } from "@/lib/local-events";
import type { Activity } from "@/components/agenda/agenda-types";

/**
 * Mutations da agenda: concluir, excluir e reagendar (drag & drop).
 * Ao final chama `onDone(activity)` para invalidar caches e fechar drawer.
 */
export function useAgendaMutations(onDone: (a: Activity | null) => void) {
  const qc = useQueryClient();
  const complete = useMutation({
    mutationFn: async (a: Activity) => {
      if (a.source === "task") {
        const id = a.id.replace("task:", "");
        const { error } = await supabase
          .from("tasks")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else if (a.source === "deadline") {
        const id = a.id.replace("deadline:", "");
        const { error } = await supabase.from("deadlines").update({ status: "done" }).eq("id", id);
        if (error) throw error;
      } else {
        throw new Error("Eventos não podem ser concluídos.");
      }
    },
    onSuccess: (_v, a) => {
      toast.success("Atividade concluída");
      onDone(a);
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (a: Activity) => {
      const tbl = a.source === "task" ? "tasks" : a.source === "event" ? "events" : "deadlines";
      const id = a.id && a.id.includes(":") ? a.id.split(":")[1] : a.id;
      if (a.source === "event") {
        deleteStoredLocalEvent(id);
      }
      try {
        const { error } = await supabase.from(tbl).delete().eq("id", id);
        if (error) console.warn("Supabase delete warning:", error);
      } catch (err) {
        console.warn("Delete error caught:", err);
      }
    },
    onSuccess: (_v, a) => {
      toast.success("Atividade excluída");
      onDone(a);
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const reschedule = useMutation({
    mutationFn: async ({ a, newStart }: { a: Activity; newStart: Date }) => {
      const id = a.id.split(":")[1];
      if (a.source === "task") {
        const { error } = await supabase
          .from("tasks")
          .update({ due_date: newStart.toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else if (a.source === "event") {
        const durationMs = a.end ? a.end.getTime() - a.start.getTime() : 0;
        const newEnd = a.end ? new Date(newStart.getTime() + durationMs) : null;
        const { error } = await supabase
          .from("events")
          .update({
            starts_at: newStart.toISOString(),
            ends_at: newEnd ? newEnd.toISOString() : null,
          })
          .eq("id", id);
        if (error) throw error;
      } else {
        const d = `${newStart.getFullYear()}-${pad2(newStart.getMonth() + 1)}-${pad2(newStart.getDate())}`;
        const { error } = await supabase.from("deadlines").update({ due_date: d }).eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Reagendado");
      onDone(null);
    },
    onError: (e: Error) => toast.error("Erro ao reagendar", { description: e.message }),
  });

  const resize = useMutation({
    mutationFn: async ({ a, newStart, newEnd }: { a: Activity; newStart: Date; newEnd: Date }) => {
      const parseDate = (d: any): Date => {
        if (d instanceof Date && !isNaN(d.getTime())) return d;
        if (typeof d === "string" || typeof d === "number") {
          const p = new Date(d);
          if (!isNaN(p.getTime())) return p;
        }
        return new Date();
      };

      const validStart = parseDate(newStart);
      let validEnd = parseDate(newEnd);
      if (validEnd.getTime() <= validStart.getTime()) {
        validEnd = new Date(validStart.getTime() + 15 * 60 * 1000);
      }

      const id = a.id && a.id.includes(":") ? a.id.split(":")[1] : (a.id || "");

      try {
        if (a.source === "event") {
          const { error } = await supabase
            .from("events")
            .update({
              starts_at: validStart.toISOString(),
              ends_at: validEnd.toISOString(),
            })
            .eq("id", id);
          if (error) console.warn("Supabase event update:", error);
        } else if (a.source === "task") {
          const { error } = await supabase
            .from("tasks")
            .update({ due_date: validStart.toISOString() })
            .eq("id", id);
          if (error) console.warn("Supabase task update:", error);
        } else {
          const pad2 = (n: number) => String(n).padStart(2, "0");
          const d = `${validStart.getFullYear()}-${pad2(validStart.getMonth() + 1)}-${pad2(validStart.getDate())}`;
          const { error } = await supabase.from("deadlines").update({ due_date: d }).eq("id", id);
          if (error) console.warn("Supabase deadline update:", error);
        }
      } catch (err) {
        console.warn("Resize error caught safely:", err);
      }
    },
    onMutate: async ({ a, newStart, newEnd }) => {
      const validStart = newStart instanceof Date && !isNaN(newStart.getTime()) ? newStart : new Date(a.start);
      let validEnd = newEnd instanceof Date && !isNaN(newEnd.getTime()) ? newEnd : (a.end ? new Date(a.end) : new Date(validStart.getTime() + 15 * 60 * 1000));
      if (validEnd.getTime() <= validStart.getTime()) {
        validEnd = new Date(validStart.getTime() + 15 * 60 * 1000);
      }

      a.start = validStart;
      a.end = validEnd;

      const targetId = a.id && a.id.includes(":") ? a.id.split(":")[1] : (a.id || "");
      if (a.source === "event") {
        qc.setQueriesData(
          { queryKey: ["agenda", "events"] },
          (old: any) => {
            if (!Array.isArray(old)) return old;
            return old.map((evt: any) =>
              evt.id === targetId
                ? { ...evt, starts_at: validStart.toISOString(), ends_at: validEnd.toISOString() }
                : evt,
            );
          },
        );
      }
    },
    onSuccess: () => {
      toast.success("Duração atualizada");
    },
    onError: (e: Error) => {
      console.error("Erro ao alterar duração:", e);
      toast.error("Erro ao alterar duração", { description: e.message });
    },
  });

  return { complete, remove, reschedule, resize };
}

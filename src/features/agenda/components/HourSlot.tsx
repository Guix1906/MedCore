import { memo, type MutableRefObject } from "react";
import { pad2 } from "@/lib/date-utils";
import type { Activity } from "@/components/agenda/agenda-types";

/**
 * Slot horário individual do grid diário — extraído para permitir
 * memoização e evitar recriar 24 handlers a cada render do pai.
 */
export const HourSlot = memo(
  function HourSlot({
    hour,
    hourHeight,
    date,
    onSlotClick,
    onReschedule,
    draggedRef,
  }: {
    hour: number;
    hourHeight: number;
    date: Date;
    onSlotClick: (d: Date) => void;
    onReschedule: (a: Activity, newStart: Date) => void;
    draggedRef: MutableRefObject<Activity | null>;
  }) {
    return (
      <div
        className="flex absolute left-0 right-0 border-b border-foreground/25"
        style={{ top: hour * hourHeight, height: hourHeight }}
      >
        <div className="w-16 shrink-0 pr-1 pt-1 text-[11px] font-normal tabular-nums text-slate-600 text-right border-r border-foreground/25">
          {pad2(hour)}:00
        </div>
        <button
          onClick={() => {
            const d = new Date(date);
            d.setHours(hour, 0, 0, 0);
            onSlotClick(d);
          }}
          onDragOver={(e) => {
            if (draggedRef.current) {
              e.preventDefault();
              e.currentTarget.classList.add("bg-primary/15");
            }
          }}
          onDragLeave={(e) => e.currentTarget.classList.remove("bg-primary/15")}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("bg-primary/15");
            const a = draggedRef.current;
            if (!a) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;
            const minutes = Math.round(((offsetY / hourHeight) * 60) / 15) * 15;
            const n = new Date(date);
            n.setHours(hour, Math.min(59, Math.max(0, minutes)), 0, 0);
            onReschedule(a, n);
            draggedRef.current = null;
          }}
          className="flex-1 hover:bg-accent/40 transition-colors text-left cursor-crosshair"
          aria-label={`Criar tarefa às ${pad2(hour)}:00`}
        />
      </div>
    );
  },
  (prev, next) =>
    prev.hour === next.hour &&
    prev.hourHeight === next.hourHeight &&
    prev.date.getTime() === next.date.getTime() &&
    prev.onSlotClick === next.onSlotClick &&
    prev.onReschedule === next.onReschedule &&
    prev.draggedRef === next.draggedRef,
);

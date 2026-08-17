import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { isSameDay, type Activity } from "@/components/agenda/agenda-types";
import { SkeletonRows } from "@/components/ui-app";
import { ActivityCard, ActivityChip } from "./ActivityCard";
import { HourSlot } from "./HourSlot";
import { cn } from "@/utils/cn";

const HOUR_H = 72;

export function DailyGrid({
  date,
  activities,
  loading,
  onActivityClick,
  onActivityEdit,
  onSlotClick,
  onReschedule,
  onResize,
  draggedRef,
}: {
  date: Date;
  activities: Activity[];
  loading: boolean;
  onActivityClick: (a: Activity) => void;
  onActivityEdit?: (a: Activity) => void;
  onSlotClick: (d: Date) => void;
  onReschedule: (a: Activity, newStart: Date) => void;
  onResize?: (a: Activity, newStart: Date, newEnd: Date) => void;
  draggedRef: MutableRefObject<Activity | null>;
}) {
  const allDay = activities.filter((a) => a.allDay);
  const timed = activities.filter((a) => !a.allDay);
  const isToday = isSameDay(date, new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  // linha do "agora"
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [isToday]);
  const nowLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const nowOffset = isToday ? (now.getHours() + now.getMinutes() / 60) * HOUR_H : -1;

  // Scroll para o horário comercial/atual ao montar ou mudar de data
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const target = isToday
      ? Math.max(
          0,
          (new Date().getHours() + new Date().getMinutes() / 60) * HOUR_H - c.clientHeight / 2,
        )
      : 8 * HOUR_H;
    if (!hasScrolledRef.current) {
      c.scrollTop = target;
      hasScrolledRef.current = true;
    }
  }, [date, isToday]);

  const dow = date.getDay();
  let workStart = 0;
  let workEnd = 0;
  if (dow >= 1 && dow <= 5) {
    workStart = 8;
    workEnd = 18;
  } else if (dow === 6) {
    workStart = 8;
    workEnd = 12;
  }

  const hatchSegs: Array<{ top: number; height: number }> = [];
  if (workStart === workEnd) {
    hatchSegs.push({ top: 0, height: HOUR_H * 24 });
  } else {
    if (workStart > 0) hatchSegs.push({ top: 0, height: workStart * HOUR_H });
    if (workEnd < 24) hatchSegs.push({ top: workEnd * HOUR_H, height: (24 - workEnd) * HOUR_H });
  }

  const hatchBg =
    "repeating-linear-gradient(-45deg, transparent 0 12px, rgba(148,163,184,0.28) 12px 13px)";
  const hatchStyle: React.CSSProperties = {
    backgroundImage: hatchBg,
    backgroundAttachment: "fixed",
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* All-day strip */}
      <div className="flex border-b border-border bg-muted/30 shrink-0">
        <div className="w-16 shrink-0 px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-r border-border">
          Dia todo
        </div>
        <div className="flex-1 p-2 flex flex-wrap gap-1.5 min-h-[40px]">
          {allDay.length === 0 ? (
            <span className="text-[11px] text-muted-foreground/70 self-center pl-1">—</span>
          ) : (
            allDay.map((a) => (
              <ActivityChip key={a.id} a={a} onClick={() => onActivityClick(a)} compact />
            ))
          )}
        </div>
      </div>

      {/* Hour grid */}
      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-y-auto bg-white">
        <div
          className="relative"
          style={{ height: HOUR_H * 24 }}
          onDragOver={(e) => {
            if (draggedRef.current) e.preventDefault();
          }}
          onDrop={(e) => {
            const a = draggedRef.current;
            if (!a) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const totalMinutes = Math.max(
              0,
              Math.min(24 * 60 - 15, Math.round((y / HOUR_H) * 4) * 15),
            );
            const nd = new Date(date);
            nd.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
            onReschedule(a, nd);
            draggedRef.current = null;
          }}
        >
          {/* Hachuras fora do expediente */}
          <div className="absolute left-16 right-0 top-0 bottom-0 pointer-events-none z-[1]">
            {hatchSegs.map((seg, idx) => (
              <div
                key={`hatch-${idx}`}
                className="absolute left-0 right-0"
                style={{ top: seg.top, height: seg.height, ...hatchStyle }}
              />
            ))}
          </div>

          {Array.from({ length: 24 }, (_, h) => (
            <HourSlot
              key={h}
              hour={h}
              hourHeight={HOUR_H}
              date={date}
              onSlotClick={onSlotClick}
              onReschedule={onReschedule}
              draggedRef={draggedRef}
            />
          ))}

          {isToday && nowOffset >= 0 && (
            <div
              className="absolute left-0 right-0 z-30 pointer-events-none"
              style={{ top: nowOffset }}
            >
              {/* Linha vermelha esticada de ponta a ponta na tela */}
              <div
                className="absolute left-0 right-0 bg-[#FF2D55] shadow-[0_0_8px_rgba(255,45,85,0.6)]"
                style={{ height: 2, top: -1 }}
              />
              {/* Ponta da linha: Triângulo vermelho apontando para a direita no canto esquerdo */}
              <div
                className="absolute left-0 w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-[#FF2D55] z-40 drop-shadow-sm"
                style={{ top: -5 }}
              />
            </div>
          )}

          <div className="absolute left-16 right-0.5 top-0 bottom-0 pointer-events-none">
            {timed.map((a) => {
              const startH = a.start.getHours() + a.start.getMinutes() / 60;
              const endH = a.end
                ? Math.max(startH + 0.5, a.end.getHours() + a.end.getMinutes() / 60)
                : startH + 0.75;
              const top = startH * HOUR_H;
              const height = Math.max(28, (endH - startH) * HOUR_H - 2);
              return (
                <ActivityCard
                  key={a.id}
                  a={a}
                  siblings={timed}
                  style={{ top, height }}
                  onClick={() => onActivityClick(a)}
                  onEdit={() => onActivityEdit ? onActivityEdit(a) : onActivityClick(a)}
                  onDragStart={() => {
                    draggedRef.current = a;
                  }}
                  onDragEnd={() => {
                    draggedRef.current = null;
                  }}
                  onResize={onResize}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

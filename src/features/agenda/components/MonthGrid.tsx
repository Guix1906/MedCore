import { useMemo, type MutableRefObject } from "react";
import { KIND_COLOR, isSameDay, type Activity } from "@/components/agenda/agenda-types";
import { SkeletonRows } from "@/components/ui-app";
import { cn } from "@/utils/cn";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function startOfMonthGrid(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

export function MonthGrid({
  date,
  activities,
  loading,
  onActivityClick,
  onSelectDate,
  onReschedule,
  draggedRef,
}: {
  date: Date;
  activities: Activity[];
  loading: boolean;
  onActivityClick: (a: Activity) => void;
  onSelectDate: (d: Date) => void;
  onReschedule: (a: Activity, newStart: Date) => void;
  draggedRef: MutableRefObject<Activity | null>;
}) {
  const days = useMemo(() => {
    const start = startOfMonthGrid(date);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [date]);

  const today = new Date();
  const currentMonth = date.getMonth();

  if (loading) return <SkeletonRows count={6} />;

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground text-center border-r border-border last:border-r-0"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6" style={{ minHeight: "70vh" }}>
        {days.map((d) => {
          const inMonth = d.getMonth() === currentMonth;
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, date);
          const dayActs = activities
            .filter((a) => isSameDay(a.start, d))
            .sort((a, b) => a.start.getTime() - b.start.getTime());
          const visible = dayActs.slice(0, 3);
          const overflow = dayActs.length - visible.length;

          return (
            <div
              key={d.toISOString()}
              onClick={() => onSelectDate(d)}
              onDragOver={(e) => {
                if (draggedRef.current) {
                  e.preventDefault();
                  e.currentTarget.classList.add("bg-primary/10");
                }
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove("bg-primary/10")}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("bg-primary/10");
                const a = draggedRef.current;
                if (!a) return;
                const n = new Date(a.start);
                n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                onReschedule(a, n);
                draggedRef.current = null;
              }}
              className={cn(
                "border-r border-b border-border p-1.5 min-h-[110px] cursor-crosshair hover:bg-accent/30 transition-colors flex flex-col gap-1",
                !inMonth && "bg-muted/20 text-muted-foreground/60",
                isSelected && "bg-primary/10 ring-1 ring-inset ring-primary/30",
              )}
            >
              <div className="flex items-center justify-end">
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums h-6 w-6 grid place-items-center rounded-full",
                    isToday ? "bg-red-500 text-white" : isSelected && "bg-primary/20 text-primary",
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {visible.map((a) => {
                  const c = KIND_COLOR[a.kind];
                  const time = a.allDay
                    ? ""
                    : a.start.toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                  return (
                    <button
                      key={a.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.effectAllowed = "move";
                        try {
                          e.dataTransfer.setData("text/plain", a.id);
                        } catch {
                          /* noop */
                        }
                        draggedRef.current = a;
                      }}
                      onDragEnd={() => {
                        draggedRef.current = null;
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onActivityClick(a);
                      }}
                      className={cn(
                        "text-left text-[11px] truncate rounded px-1.5 py-0.5 border transition-colors hover:brightness-110",
                        c.soft,
                        c.text,
                      )}
                      title={a.title}
                    >
                      {time && <span className="tabular-nums mr-1 opacity-80">{time}</span>}
                      {a.title}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <span className="text-[10px] text-muted-foreground pl-1">+{overflow} mais</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { isSameDay, type Activity } from "@/components/agenda/agenda-types";
import { SkeletonRows } from "@/components/ui-app";
import { pad2 } from "@/lib/date-utils";
import { cn } from "@/utils/cn";
import { ActivityCard, ActivityChip } from "./ActivityCard";

const HOUR_H = 72;
const TIME_COL = 64;

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function startOfWeek(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  n.setDate(n.getDate() - n.getDay()); // domingo
  return n;
}

export function WeeklyGrid({
  date,
  activities,
  loading,
  onActivityClick,
  onActivityEdit,
  onSlotClick,
  onReschedule,
  onResize,
  draggedRef,
  onSelectDate,
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
  onSelectDate?: (d: Date) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [gridContentWidth, setGridContentWidth] = useState<number | null>(null);
  const week = useMemo(() => {
    const s = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(s);
      d.setDate(s.getDate() + i);
      return d;
    });
  }, [date]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const nowLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const todayIdx = week.findIndex((d) => isSameDay(d, now));
  const nowOffset = (now.getHours() + now.getMinutes() / 60) * HOUR_H;

  useEffect(() => {
    const measureScrollbar = () => {
      const el = containerRef.current;
      if (!el) return;
      setScrollbarWidth(Math.max(0, el.offsetWidth - el.clientWidth));
      setGridContentWidth(el.clientWidth);
    };

    measureScrollbar();
    const resizeObserver = new ResizeObserver(measureScrollbar);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", measureScrollbar);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureScrollbar);
    };
  }, []);

  // Scroll para o horário comercial/atual ao montar ou mudar de data
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const n = new Date();
    const weekStart = startOfWeek(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const weekHasToday = n >= weekStart && n < weekEnd;
    const currentOffset = (n.getHours() + n.getMinutes() / 60) * HOUR_H;
    const target = weekHasToday ? Math.max(0, currentOffset - c.clientHeight / 2) : 8 * HOUR_H;

    if (!hasScrolledRef.current) {
      c.scrollTop = target;
      hasScrolledRef.current = true;
    }
  }, [date]);

  const allDay = activities.filter((a) => a.allDay);
  const timed = activities.filter((a) => !a.allDay);

  // Garante largura mínima legível por dia; abaixo disso ativa scroll horizontal
  const MIN_DAY_W = 96;
  const dayWidth = gridContentWidth ? Math.max(MIN_DAY_W, (gridContentWidth - TIME_COL) / 7) : null;
  const gridTemplate = dayWidth
    ? `${TIME_COL}px repeat(7, ${dayWidth}px)`
    : `${TIME_COL}px repeat(7, minmax(0, 1fr))`;
  const totalWidth = dayWidth ? TIME_COL + dayWidth * 7 : null;
  const gridWidth = totalWidth ? `${totalWidth}px` : "100%";
  const columnGuides = (
    <div className="pointer-events-none absolute inset-0 z-[20]" aria-hidden="true">
      {dayWidth ? (
        Array.from({ length: 8 }, (_, i) => (
          <span
            key={`v-${i}`}
            className="absolute top-0 bottom-0 w-px bg-border"
            style={{ left: TIME_COL + dayWidth * i }}
          />
        ))
      ) : (
        <>
          <span className="absolute top-0 bottom-0 w-px bg-border" style={{ left: TIME_COL }} />
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={`vf-${i}`}
              className="absolute top-0 bottom-0 w-px bg-border"
              style={{
                left: `calc(${TIME_COL}px + ${((i + 1) * 100) / 7}% - ${(TIME_COL * (i + 1)) / 7}px)`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-x-auto bg-white">
      {/* Header dias */}
      <div
        className="sticky top-0 z-30 border-b border-slate-200 bg-white shrink-0 shadow-2xs"
        style={{ paddingRight: scrollbarWidth, minWidth: totalWidth ?? undefined }}
        data-agenda-header-shell
      >
        {/* Linha 1: Datas e Dias da Semana */}
        <div
          className="relative grid border-b border-slate-200/90 h-[52px]"
          style={{ gridTemplateColumns: gridTemplate, width: gridWidth }}
          data-agenda-header-grid
        >
          {columnGuides}
          <div
            className="relative z-[1] border-r border-slate-200/90"
            style={{
              backgroundImage:
                "repeating-linear-gradient(-45deg, transparent 0 6px, rgba(203,213,225,0.4) 6px 7px)",
            }}
          />
          {week.map((d) => {
            const isToday = isSameDay(d, now);
            const isSelected = isSameDay(d, date);
            return (
              <div
                key={d.toISOString()}
                className={cn("relative z-[1] px-2 flex items-center justify-center border-r border-slate-200/90")}
                data-agenda-day-header
                data-selected={isSelected || undefined}
              >
                <div
                  className="flex items-center gap-1.5 justify-center cursor-pointer select-none"
                  onClick={() => onSelectDate?.(d)}
                >
                  {isToday || isSelected ? (
                    <span className="bg-[#7C3AED] text-white font-bold text-[15px] rounded-xl px-2.5 py-1 h-[32px] min-w-[32px] flex items-center justify-center shadow-2xs">
                      {d.getDate()}
                    </span>
                  ) : (
                    <span className="text-[#101828] font-bold text-[16px]">{d.getDate()}</span>
                  )}
                  <span
                    className={cn(
                      "text-[14px] lowercase",
                      isToday || isSelected ? "text-[#475467] font-semibold" : "text-[#64748B] font-normal",
                    )}
                  >
                    {WEEKDAY_SHORT[d.getDay()]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Linha 2: Seção de Feriados / Eventos do Dia Todo */}
        <div
          className="relative grid bg-white min-h-[30px]"
          style={{ gridTemplateColumns: gridTemplate, width: gridWidth }}
          data-agenda-allday-grid
        >
          {columnGuides}
          <div className="relative z-[1] border-r border-slate-200/90" />
          {week.map((d) => {
            const dayAllDay = allDay.filter((a) => isSameDay(a.start, d));
            return (
              <div
                key={`allday-${d.toISOString()}`}
                className="relative z-[1] px-0.5 py-0.5 flex flex-col gap-1 items-stretch justify-center border-r border-slate-200/90 min-h-[28px] w-full"
              >
                {dayAllDay.map((a) => (
                  <ActivityChip key={a.id} a={a} onClick={() => onActivityClick(a)} compact />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid horas */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-y-auto bg-white"
        style={{ scrollbarGutter: "stable", minWidth: totalWidth ?? undefined }}
        data-agenda-scroll-body
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: gridTemplate,
            width: gridWidth,
            height: HOUR_H * 24,
          }}
        >
          {columnGuides}
          {/* Coluna de horários estilo imagem de referência (media_1786217017772.png) */}
          <div className="relative z-[1] bg-white border-r border-slate-200/90">
            {Array.from({ length: 48 }, (_, i) => {
              const h = Math.floor(i / 2);
              const m = (i % 2) * 30;
              const timeStr = `${pad2(h)}:${pad2(m)}`;
              const isHalfHour = i % 2 === 0;

              return (
                <div
                  key={i}
                  className={cn(
                    "absolute left-0 right-0 flex items-center justify-center px-1 text-[13px] font-normal tabular-nums text-slate-600 border-b",
                    isHalfHour
                      ? "border-dashed border-slate-200/90"
                      : "border-solid border-slate-200/90",
                  )}
                  style={{
                    top: i * (HOUR_H / 2),
                    height: HOUR_H / 2,
                  }}
                >
                  {timeStr}
                </div>
              );
            })}
          </div>

          {/* Colunas dos dias */}
          {week.map((d) => {
            const isToday = isSameDay(d, now);
            const isSelected = isSameDay(d, date);
            const dayTimed = timed.filter((a) => isSameDay(a.start, d));
            const dow = d.getDay(); // 0=dom, 6=sáb
            // Horário comercial: seg-sex 8-18, sáb 8-12, dom fechado
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
              if (workEnd < 24)
                hatchSegs.push({ top: workEnd * HOUR_H, height: (24 - workEnd) * HOUR_H });
            }

            const hatchBg =
              "repeating-linear-gradient(-45deg, transparent 0 12px, rgba(148,163,184,0.28) 12px 13px)";
            const hatchStyle: React.CSSProperties = {
              backgroundImage: hatchBg,
              backgroundAttachment: "fixed",
            };
            return (
              <div
                key={d.toISOString()}
                data-agenda-day-column
                className={cn(
                  "relative z-[1]",
                  isToday && "bg-primary/[0.04]",
                  isSelected && "bg-primary/[0.09] ring-1 ring-inset ring-primary/25",
                )}
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
                  const nd = new Date(d);
                  nd.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
                  onReschedule(a, nd);
                  draggedRef.current = null;
                }}
              >
                {hatchSegs.map((seg, idx) => (
                  <div
                    key={`hatch-${idx}`}
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{ top: seg.top, height: seg.height, ...hatchStyle }}
                  />
                ))}
                {/* Slots de 30 min */}
                {Array.from({ length: 48 }, (_, i) => {
                  const isHalfHour = i % 2 === 0;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const nd = new Date(d);
                        nd.setHours(Math.floor(i / 2), (i % 2) * 30, 0, 0);
                        onSlotClick(nd);
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
                        const nd = new Date(d);
                        nd.setHours(Math.floor(i / 2), (i % 2) * 30, 0, 0);
                        onReschedule(a, nd);
                        draggedRef.current = null;
                      }}
                      className={cn(
                        "absolute left-0 right-0 w-full text-left transition-colors hover:bg-primary/[0.06] cursor-crosshair border-b",
                        isHalfHour
                          ? "border-dashed border-slate-200/90"
                          : "border-solid border-slate-200/90",
                      )}
                      style={{
                        top: (i * HOUR_H) / 2,
                        height: HOUR_H / 2,
                      }}
                    />
                  );
                })}

                {/* Cards */}
                <div className="absolute inset-0 pointer-events-none">
                  {dayTimed.map((a) => {
                    const startH = a.start.getHours() + a.start.getMinutes() / 60;
                    const endH = a.end
                      ? Math.max(startH + 0.5, a.end.getHours() + a.end.getMinutes() / 60)
                      : startH + 0.75;
                    const top = startH * HOUR_H + 3;
                    const height = Math.max(24, (endH - startH) * HOUR_H - 6);

                    return (
                      <ActivityCard
                        key={a.id}
                        a={a}
                        siblings={dayTimed}
                        style={{ top, height }}
                        colWidth={gridContentWidth ? (gridContentWidth - TIME_COL) / 7 : undefined}
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
            );
          })}

          {/* Now indicator (linha vermelha esticada de ponta a ponta atravessando toda a grade com triângulo no canto esquerdo) */}
          {todayIdx >= 0 && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-30"
              style={{ top: nowOffset }}
            >
              {/* Linha vermelha esticada de ponta a ponta */}
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
        </div>
      </div>
    </div>
  );
}

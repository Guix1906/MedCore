"use client";
import React, { useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { CalendarAppointment } from "./types";
import AppointmentBlock from "./AppointmentBlock";
import { timeToMinutes, todayStr } from "./utils";

const SLOT_HEIGHT = 48; // px per 30-min slot
const START_HOUR = 7; // calendar starts at 07:00
const END_HOUR = 21; // calendar ends at 21:00
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 2; // 30-min slots

interface Props {
  date: string;
  appointments: CalendarAppointment[];
  columnWidth: number;
  dimmed?: boolean;
  onResize: (id: string, newEndTime: string) => void;
  onSlotClick: (date: string, time: string) => void;
  onClick?: (appt: CalendarAppointment) => void;
}

export default function DayColumn({
  date,
  appointments,
  columnWidth,
  dimmed,
  onResize,
  onSlotClick,
  onClick,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const isToday = date === todayStr();

  /* ── Current-time indicator ── */
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, [isToday]);

  const timeToTop = (t: string) => ((timeToMinutes(t) - START_HOUR * 60) / 30) * SLOT_HEIGHT;

  const durationToPx = (start: string, end: string) => {
    const dur = Math.max(15, timeToMinutes(end) - timeToMinutes(start));
    return (dur / 30) * SLOT_HEIGHT;
  };

  const nowTop =
    isToday && nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60
      ? ((nowMin - START_HOUR * 60) / 30) * SLOT_HEIGHT
      : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "relative",
        width: columnWidth,
        height: TOTAL_SLOTS * SLOT_HEIGHT,
        background: isOver ? "#EFF6FF" : "transparent",
        backgroundImage:
          !isOver && dimmed
            ? "repeating-linear-gradient(-45deg, transparent 0 6px, #F1F2F5 6px 7px)"
            : undefined,
        transition: "background .15s",
        borderRight: "1px solid #F3F4F6",
      }}
    >
      {/* 30-min slot lines + click zones */}
      {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
        const mins = START_HOUR * 60 + i * 30;
        const hh = String(Math.floor(mins / 60)).padStart(2, "0");
        const mm = String(mins % 60).padStart(2, "0");
        const isHour = mm === "00";
        return (
          <div
            key={i}
            onClick={() => onSlotClick(date, `${hh}:${mm}`)}
            style={{
              position: "absolute",
              top: i * SLOT_HEIGHT,
              left: 0,
              right: 0,
              height: SLOT_HEIGHT,
              borderTop: `1px ${isHour ? "solid #E5E7EB" : "dashed #F3F4F6"}`,
              cursor: "cell",
            }}
          />
        );
      })}

      {/* Appointment blocks */}
      {appointments.map((appt) => {
        const top = timeToTop(appt.start_time);
        const height = durationToPx(appt.start_time, appt.end_time);
        // Skip if outside visible range
        if (top + height < 0 || top > TOTAL_SLOTS * SLOT_HEIGHT) return null;
        return (
          <AppointmentBlock
            key={appt.id}
            appt={appt}
            topPx={Math.max(0, top)}
            heightPx={height}
            columnWidth={columnWidth}
            onResize={onResize}
            onClick={onClick}
          />
        );
      })}

      {/* Current-time red line (today only) */}
      {nowTop !== null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: nowTop,
            height: 0,
            borderTop: "2px solid #EF4444",
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: -5,
              top: -5,
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#EF4444",
              boxShadow: "0 0 0 3px rgba(239,68,68,.2)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export { START_HOUR, END_HOUR, TOTAL_SLOTS, SLOT_HEIGHT };

"use client";
import React, { useRef, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarAppointment } from "./types";
import { timeToMinutes, minutesToTime, TYPE_META, STATUS_META } from "./utils";

const SLOT_HEIGHT = 48;
const MIN_DURATION = 15;

type StatusEntry = (typeof STATUS_META)[string];

interface Props {
  appt: CalendarAppointment;
  topPx: number;
  heightPx: number;
  columnWidth: number;
  onResize: (id: string, newEndTime: string) => void;
  onClick?: (appt: CalendarAppointment) => void;
}

/* ─── Portal tooltip ─── */
function TooltipPortal({ cfg, rect }: { cfg: StatusEntry; rect: DOMRect }) {
  // Posiciona à direita do bloco; se não couber, vai para a esquerda
  const left = rect.right + 8;
  const top = Math.max(4, rect.top + rect.height / 2 - 34);

  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 99999,
        pointerEvents: "none",
        background: cfg.bg,
        border: `1.5px solid ${cfg.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 4px 20px rgba(0,0,0,.14)",
        minWidth: 170,
        maxWidth: 240,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: cfg.dot,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 13, color: cfg.textColor }}>{cfg.label}</span>
      </div>
      <div style={{ fontSize: 12, color: cfg.textColor, opacity: 0.8, lineHeight: 1.4 }}>
        {cfg.desc}
      </div>
    </div>,
    document.body,
  );
}

export default function AppointmentBlock({
  appt,
  topPx,
  heightPx,
  columnWidth,
  onResize,
  onClick,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appt.id,
    data: { appt },
  });

  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);

  const resizing = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartEnd = useRef(timeToMinutes(appt.end_time));
  const [resizeEnd, setResizeEnd] = useState(appt.end_time);

  const meta = TYPE_META[appt.type] ?? { label: appt.type, color: "#374151", bg: "#F3F4F6" };
  const status = STATUS_META[appt.status] ?? {
    label: appt.status ?? "Status",
    dot: "#9CA3AF",
    desc: "—",
    bg: "#F9FAFB",
    border: "#D1D5DB",
    textColor: "#374151",
  };
  const dotColor = status.dot;

  /* ── Hover handlers ── */
  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setTooltipRect(e.currentTarget.getBoundingClientRect());
  }, []);
  const handleMouseLeave = useCallback(() => setTooltipRect(null), []);

  /* ── Resize ── */
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizing.current = true;
    resizeStartY.current = e.clientY;
    resizeStartEnd.current = timeToMinutes(appt.end_time);

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const deltaMin = Math.round((ev.clientY - resizeStartY.current) / (SLOT_HEIGHT / 30)) * 15;
      setResizeEnd(
        minutesToTime(
          Math.min(
            Math.max(resizeStartEnd.current + MIN_DURATION, resizeStartEnd.current + deltaMin),
            23 * 60 + 45,
          ),
        ),
      );
    };
    const onUp = (ev: MouseEvent) => {
      resizing.current = false;
      const deltaMin = Math.round((ev.clientY - resizeStartY.current) / (SLOT_HEIGHT / 30)) * 15;
      onResize(
        appt.id,
        minutesToTime(
          Math.min(
            Math.max(resizeStartEnd.current + MIN_DURATION, resizeStartEnd.current + deltaMin),
            23 * 60 + 45,
          ),
        ),
      );
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const displayEnd = resizing.current ? resizeEnd : appt.end_time;
  const dur = timeToMinutes(displayEnd) - timeToMinutes(appt.start_time);
  const compact = heightPx < 40;

  const showTooltip = !!tooltipRect && !isDragging;

  return (
    <>
      <div
        ref={setNodeRef}
        style={{
          position: "absolute",
          top: topPx,
          left: 2,
          width: columnWidth - 4,
          height: heightPx,
          background: meta.bg,
          border: `1.5px solid ${meta.color}33`,
          borderLeft: `3px solid ${dotColor}`,
          borderRadius: 6,
          padding: "3px 6px",
          cursor: isDragging ? "grabbing" : "grab",
          opacity: isDragging ? 0.45 : 1,
          boxShadow: isDragging
            ? `0 8px 24px ${meta.color}44`
            : showTooltip
              ? "0 4px 14px rgba(0,0,0,.15)"
              : "0 1px 3px rgba(0,0,0,.08)",
          overflow: "hidden",
          zIndex: isDragging ? 999 : 10,
          transform: CSS.Translate.toString(transform),
          userSelect: "none",
          transition: "box-shadow .15s",
        }}
        {...listeners}
        {...attributes}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => !isDragging && onClick?.(appt)}
      >
        {/* Dot + nome */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              flexShrink: 0,
              background: dotColor,
            }}
          />
          <span
            style={{
              fontSize: compact ? 10 : 11,
              fontWeight: 700,
              color: meta.color,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              flex: 1,
            }}
          >
            {appt.patient_name}
          </span>
        </div>

        {/* Horário + tipo */}
        {!compact && (
          <>
            <div
              style={{
                fontSize: 10,
                color: meta.color + "CC",
                marginTop: 1,
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {appt.start_time}–{displayEnd}
              {dur >= 60
                ? ` · ${Math.floor(dur / 60)}h${dur % 60 ? (dur % 60) + "min" : ""}`
                : ` · ${dur}min`}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#6B7280",
                marginTop: 1,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {meta.label}
              {appt.insurance ? ` · ${appt.insurance}` : ""}
            </div>
          </>
        )}

        {/* Handle de resize */}
        <div
          onMouseDown={onResizeMouseDown}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 8,
            cursor: "ns-resize",
            background: `${meta.color}22`,
            borderRadius: "0 0 5px 5px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ width: 20, height: 2, borderRadius: 1, background: meta.color + "66" }} />
        </div>
      </div>

      {/* Tooltip portal — direto no document.body, imune a overflow */}
      {showTooltip && <TooltipPortal cfg={status} rect={tooltipRect!} />}
    </>
  );
}

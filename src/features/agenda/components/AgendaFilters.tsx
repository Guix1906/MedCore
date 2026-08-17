import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, CalendarDays, CalendarRange, ChevronDown, List, UserRound } from "lucide-react";
import type { AssignFilter, TypeFilter } from "../hooks/use-agenda-filters";

export type ViewMode = "dia" | "semana" | "mes" | "ano" | "lista";

const OPTIONS: {
  value: ViewMode;
  label: string;
  icon: typeof Calendar;
}[] = [
  { value: "dia", label: "Dia", icon: CalendarDays },
  { value: "semana", label: "Semana", icon: CalendarRange },
  { value: "mes", label: "Mês", icon: Calendar },
];

// Ciclo entre Dia → Semana → Mês
const CYCLE: ViewMode[] = ["dia", "semana", "mes"];

export function AgendaFilters({
  view,
  onViewChange,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  assignFilter?: AssignFilter;
  onAssignChange?: (v: AssignFilter) => void;
  typeFilter?: TypeFilter;
  onTypeChange?: (v: TypeFilter) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
  searchOpen?: boolean;
  onSearchOpenChange?: (v: boolean) => void;
  resultCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState<number>(() =>
    Math.max(
      0,
      OPTIONS.findIndex((o) => o.value === view),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const current = OPTIONS.find((o) => o.value === view) ?? OPTIONS[1];
  const CurrentIcon = current.icon;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menuWidth = 200;
    const menuHeight = OPTIONS.length * 36 + (OPTIONS.length - 1) * 3 + 16;
    let top = r.top;
    const maxTop = window.innerHeight - 8 - menuHeight;
    if (top > maxTop) top = Math.max(8, maxTop);
    setPos({
      top,
      left: r.left - 8 - menuWidth,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % OPTIONS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + OPTIONS.length) % OPTIONS.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const o = OPTIONS[focusIdx];
        if (o) {
          onViewChange(o.value);
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, focusIdx, onViewChange]);

  return (
    <div className="flex items-center justify-end">
      <div className="relative" ref={rootRef}>
        <button
          ref={btnRef}
          type="button"
          onClick={() => {
            setFocusIdx(
              Math.max(
                0,
                OPTIONS.findIndex((o) => o.value === view),
              ),
            );
            setOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          className="h-9 inline-flex items-center gap-1.5 rounded-md bg-transparent border-0 outline-none ring-0 shadow-none px-2.5 hover:bg-[#F3EEFF] text-[#2E3448] hover:text-[#7C3AED] transition-colors cursor-pointer select-none group/viewbtn focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:border-0 focus:border-0 active:outline-none active:ring-0 active:border-0"
          style={{ fontFamily: "Inter, ui-sans-serif, system-ui", border: "none", outline: "none", boxShadow: "none" }}
        >
          <CurrentIcon className="h-4 w-4 text-[#5D667C] group-hover/viewbtn:text-[#7C3AED] transition-colors" />
          <span className="leading-none text-[13.5px] font-semibold text-[#2E3448] group-hover/viewbtn:text-[#7C3AED] transition-colors">
            {current.label}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-[#5D667C] group-hover/viewbtn:text-[#7C3AED] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open &&
          pos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[100] origin-top-right"
              style={{
                top: pos.top,
                left: pos.left,
                width: 200,
                background: "#FFFFFF",
                borderRadius: 14,
                boxShadow: "0 24px 60px rgba(24,20,50,.22), 0 6px 16px rgba(24,20,50,.10)",
                padding: "8px 10px",
                fontFamily: "Inter, ui-sans-serif, system-ui",
                animation: "agendaMenuIn 180ms cubic-bezier(.2,.8,.2,1)",
              }}
            >
              <style>{`@keyframes agendaMenuIn{from{opacity:0;transform:translateX(8px) scale(.97)}to{opacity:1;transform:translateX(0) scale(1)}}`}</style>
              {OPTIONS.map((o, i) => {
                const Icon = o.icon;
                const active = o.value === view;
                const focused = i === focusIdx;
                return (
                  <button
                    key={o.value}
                    role="menuitem"
                    onMouseEnter={() => setFocusIdx(i)}
                    onClick={() => {
                      onViewChange(o.value);
                      setOpen(false);
                    }}
                    className="relative w-full h-9 flex items-center gap-[10px] px-3 rounded-[8px] transition-colors duration-150 text-left"
                    style={{
                      marginTop: i === 0 ? 0 : 3,
                      background: active ? "#F3EEFF" : focused ? "#F5F7FB" : "transparent",
                    }}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full"
                        style={{ background: "#6D5EF8" }}
                      />
                    )}
                    <Icon
                      className="h-4 w-4 shrink-0"
                      style={{ color: active ? "#6D5EF8" : "#7A8397" }}
                    />
                    <span
                      style={{
                        fontWeight: 500,
                        fontSize: 12.5,
                        color: active ? "#4B3FCF" : "#4B5568",
                      }}
                    >
                      {o.label}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}

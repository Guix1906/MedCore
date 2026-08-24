import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Search, MapPin, Filter, UserCheck, ChevronDown, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateLong, isSameDay, type Activity } from "@/components/agenda/agenda-types";
import { pad2 } from "@/lib/date-utils";
import type { AssignFilter, TypeFilter } from "../hooks/use-agenda-filters";

export function CityFilterDropdown({
  cityFilter,
  onCityChange,
  cities,
}: {
  cityFilter: string;
  onCityChange: (v: string) => void;
  cities: string[];
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const options = ["todas", ...cities];
  const currentLabel = cityFilter === "todas" ? "Todas as Cidades" : cityFilter;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menuWidth = 210;
    const menuHeight = options.length * 36 + (options.length - 1) * 3 + 16;
    let top = r.bottom + 6;
    const maxTop = window.innerHeight - 8 - menuHeight;
    if (top > maxTop) top = Math.max(8, r.top - menuHeight - 6);
    setPos({
      top,
      left: Math.max(8, r.right - menuWidth),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-9 inline-flex items-center gap-1.5 rounded-md bg-transparent border-0 outline-none ring-0 shadow-none px-2.5 hover:bg-[#F3EEFF] text-[#2E3448] hover:text-[#7C3AED] transition-colors cursor-pointer select-none group/citybtn focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:border-0 focus:border-0 active:outline-none active:ring-0 active:border-0"
        style={{ fontFamily: "Inter, ui-sans-serif, system-ui", border: "none", outline: "none", boxShadow: "none" }}
      >
        <MapPin className="h-4 w-4 shrink-0 text-[#7C3AED] transition-colors" />
        <span
          className="leading-none truncate max-w-[150px] text-[13.5px] font-semibold text-[#2E3448] group-hover/citybtn:text-[#7C3AED] transition-colors"
        >
          {currentLabel}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[#5D667C] group-hover/citybtn:text-[#7C3AED] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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
              width: 210,
              background: "#FFFFFF",
              borderRadius: 14,
              boxShadow: "0 24px 60px rgba(24,20,50,.22), 0 6px 16px rgba(24,20,50,.10)",
              padding: "8px 10px",
              fontFamily: "Inter, ui-sans-serif, system-ui",
              animation: "agendaMenuIn 180ms cubic-bezier(.2,.8,.2,1)",
            }}
          >
            <style>{`@keyframes agendaMenuIn{from{opacity:0;transform:translateX(8px) scale(.97)}to{opacity:1;transform:translateX(0) scale(1)}}`}</style>
            {options.map((opt, i) => {
              const active = opt === cityFilter;
              const label = opt === "todas" ? "Todas as Cidades" : opt;
              return (
                <button
                  key={opt}
                  role="menuitem"
                  onClick={() => {
                    onCityChange(opt);
                    setOpen(false);
                  }}
                  className="relative w-full h-9 flex items-center gap-[10px] px-3 rounded-[8px] transition-colors duration-150 text-left hover:bg-[#F5F7FB]"
                  style={{
                    marginTop: i === 0 ? 0 : 3,
                    background: active ? "#F3EEFF" : undefined,
                  }}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full"
                      style={{ background: "#6D5EF8" }}
                    />
                  )}
                  <MapPin className="h-4 w-4 shrink-0" style={{ color: active ? "#6D5EF8" : "#8B95A7" }} />
                  <span
                    className="text-[13px] leading-none truncate"
                    style={{
                      fontWeight: active ? 600 : 400,
                      color: active ? "#6D5EF8" : "#2E3448",
                    }}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

import { AgendaFilters } from "./AgendaFilters";

export function AgendaToolbar({
  date,
  onSetDate,
  onShiftDay,
  onToday,
  draggedRef,
  onReschedule,
  label,
  stepDays = 1,
  search = "",
  onSearchChange,
  cityFilter,
  onCityChange,
  cities,
  view,
  onViewChange,
  onNewAppointment,
}: {
  date: Date;
  onSetDate: (d: Date) => void;
  onShiftDay: (delta: number) => void;
  onToday: () => void;
  draggedRef: MutableRefObject<Activity | null>;
  onReschedule: (a: Activity, newStart: Date) => void;
  label?: string;
  stepDays?: number;
  search?: string;
  onSearchChange?: (v: string) => void;
  cityFilter?: string;
  onCityChange?: (v: string) => void;
  cities?: string[];
  view?: string;
  onViewChange?: (view: any) => void;
  onNewAppointment?: () => void;
}) {
  const handleDropShift = (deltaDays: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove("bg-primary/20");
    const a = draggedRef.current;
    if (!a) return;
    const n = new Date(a.start);
    n.setDate(n.getDate() + deltaDays);
    onReschedule(a, n);
    draggedRef.current = null;
  };

  const displayLabel = label ?? (isSameDay(date, new Date()) ? "Hoje" : formatDateLong(date));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border bg-white text-xs min-h-[52px]">
      {/* Botões da Esquerda: Hoje e Navegação de Data */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToday}
          className="h-8 px-2 font-extrabold text-[#2E3448] hover:text-[#7C3AED] transition-colors shrink-0 cursor-pointer select-none border-0 bg-transparent shadow-none"
          style={{ fontFamily: "Inter, ui-sans-serif, system-ui", fontSize: 14 }}
        >
          Hoje
        </button>

        <div className="flex items-center gap-0 shrink-0">
          <button
            type="button"
            onClick={() => onShiftDay(-stepDays)}
            onDragOver={(e) => {
              if (draggedRef.current) {
                e.preventDefault();
                e.currentTarget.classList.add("bg-primary/20");
              }
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove("bg-primary/20")}
            onDrop={handleDropShift(-stepDays)}
            className="h-8 w-8 grid place-items-center rounded-lg bg-transparent border-0 text-[#5D667C] hover:bg-[#F3EEFF] hover:text-[#7C3AED] transition-colors cursor-pointer select-none"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-8 px-2 rounded-lg bg-transparent border-0 text-[13.5px] font-semibold text-[#2E3448] hover:bg-[#F3EEFF] hover:text-[#7C3AED] inline-flex items-center gap-1 transition-colors cursor-pointer select-none"
                style={{ fontFamily: "Inter, ui-sans-serif, system-ui" }}
              >
                {displayLabel}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-popover border-border text-foreground">
              <DropdownMenuItem onClick={onToday} className="focus:bg-accent">
                Hoje
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const n = new Date();
                  n.setDate(n.getDate() + 1);
                  n.setSeconds(0, 0);
                  onSetDate(n);
                }}
                className="focus:bg-accent"
              >
                Amanhã
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <div className="px-2 py-1.5">
                <Input
                  type="date"
                  value={`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [y, m, d] = e.target.value.split("-").map(Number);
                    const n = new Date(date);
                    n.setFullYear(y, m - 1, d);
                    onSetDate(n);
                  }}
                  className="bg-background border-border text-foreground h-8 text-xs"
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={() => onShiftDay(stepDays)}
            onDragOver={(e) => {
              if (draggedRef.current) {
                e.preventDefault();
                e.currentTarget.classList.add("bg-primary/20");
              }
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove("bg-primary/20")}
            onDrop={handleDropShift(stepDays)}
            className="h-8 w-8 grid place-items-center rounded-lg bg-transparent border-0 text-[#5D667C] hover:bg-[#F3EEFF] hover:text-[#7C3AED] transition-colors cursor-pointer select-none"
            aria-label="Próximo"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Controle da Direita: Buscar Paciente, Cidades e Visão */}
      <div className="flex items-center gap-2 flex-1 max-w-[650px] justify-end">
        {onSearchChange && (
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar paciente, médico ou título..."
              className="w-full h-9 pl-9 pr-3 rounded-md border border-slate-200 bg-white text-[13.5px] font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED]/20 transition shadow-2xs"
            />
          </div>
        )}

        {cityFilter !== undefined && onCityChange && cities && (
          <CityFilterDropdown
            cityFilter={cityFilter}
            onCityChange={onCityChange}
            cities={cities}
          />
        )}

        {view !== undefined && onViewChange && (
          <AgendaFilters view={view as any} onViewChange={onViewChange} />
        )}

        {onNewAppointment && (
          <button
            type="button"
            onClick={onNewAppointment}
            className="h-9 px-3.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[13px] font-bold inline-flex items-center gap-1.5 shadow-sm hover:shadow-md transition-all shrink-0 cursor-pointer"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>+ Novo Agendamento</span>
          </button>
        )}
      </div>
    </div>
  );
}

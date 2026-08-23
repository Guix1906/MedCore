import { useState, useRef, useEffect, useMemo } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function BeautifulDatePicker({
  value,
  onChange,
  placeholder = "Selecione a data de nascimento...",
  minYear = 1920,
  maxYear = new Date().getFullYear(),
  className,
}: {
  value?: string | null; // Format: YYYY-MM-DD
  onChange: (val: string) => void;
  placeholder?: string;
  minYear?: number;
  maxYear?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse current value
  const parsedDate = useMemo(() => {
    if (!value) return null;
    const parts = value.split("-");
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d);
  }, [value]);

  // Viewing month/year state
  const [viewYear, setViewYear] = useState<number>(() => {
    return parsedDate ? parsedDate.getFullYear() : 1995;
  });
  const [viewMonth, setViewMonth] = useState<number>(() => {
    return parsedDate ? parsedDate.getMonth() : 0;
  });

  // Keep view in sync when value changes
  useEffect(() => {
    if (parsedDate) {
      setViewYear(parsedDate.getFullYear());
      setViewMonth(parsedDate.getMonth());
    }
  }, [value]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Year options for fast jump
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = maxYear; y >= minYear; y--) {
      years.push(y);
    }
    return years;
  }, [minYear, maxYear]);

  // Days in current viewing month
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: { day: number; isCurrentMonth: boolean; dateStr: string }[] = [];

    // Previous month padding days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dateStr = `${prevY}-${String(prevM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, isCurrentMonth: false, dateStr });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, isCurrentMonth: true, dateStr });
    }

    // Next month padding days to complete 35 or 42 cells
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
      const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dateStr = `${nextY}-${String(nextM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, isCurrentMonth: false, dateStr });
    }

    return days;
  }, [viewYear, viewMonth]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (dateStr: string) => {
    onChange(dateStr);
    setOpen(false);
  };

  // Formatted display text & age calculation
  const formattedDisplay = useMemo(() => {
    if (!parsedDate) return null;
    const day = String(parsedDate.getDate()).padStart(2, "0");
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const year = parsedDate.getFullYear();

    // Calculate age
    const today = new Date();
    let age = today.getFullYear() - year;
    const monthDiff = today.getMonth() - parsedDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsedDate.getDate())) {
      age--;
    }

    return {
      dateFormatted: `${day}/${month}/${year}`,
      ageStr: age >= 0 ? `${age} ${age === 1 ? "ano" : "anos"}` : "",
    };
  }, [parsedDate]);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Clickable Trigger Button (opens when clicking ANYWHERE on the field) */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "w-full h-10 px-3 rounded-lg border text-[13px] flex items-center justify-between text-left transition-all duration-150 cursor-pointer select-none",
          open
            ? "border-[#8B47FF] ring-2 ring-[#8B47FF]/10 bg-white"
            : "border-[#E5E7EB] bg-white hover:border-[#8B47FF]/60",
          !formattedDisplay ? "text-[#9CA3AF]" : "text-[#111827]"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <CalendarIcon
            size={16}
            className={cn(
              "shrink-0 transition-colors",
              formattedDisplay ? "text-[#8B47FF]" : "text-[#9CA3AF]"
            )}
          />
          {formattedDisplay ? (
            <div className="flex items-center gap-2 truncate">
              <span className="font-semibold text-[#111827]">
                {formattedDisplay.dateFormatted}
              </span>
              {formattedDisplay.ageStr && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F5F3FF] text-[#8B47FF] border border-[#DDD6FE]">
                  {formattedDisplay.ageStr}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[13px] text-[#9CA3AF] truncate">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          {formattedDisplay && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="h-5 w-5 rounded-full hover:bg-slate-100 hover:text-rose-600 grid place-items-center text-[#9CA3AF] transition cursor-pointer"
              title="Limpar data"
            >
              <X size={13} />
            </span>
          )}
          <span className="text-[10px] text-[#9CA3AF]">▼</span>
        </div>
      </button>

      {/* Modern & Polished Calendar Popover */}
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-[10000] w-[310px] rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150">
          {/* Header with Month & Year Selectors */}
          <div className="flex items-center justify-between gap-1 pb-3 border-b border-[#F3F4F6]">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F5F3FF] hover:text-[#8B47FF] transition cursor-pointer"
              title="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="flex items-center gap-1.5">
              {/* Month Dropdown */}
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                className="h-8 px-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] text-[12.5px] font-bold text-[#111827] focus:outline-none focus:border-[#8B47FF] cursor-pointer"
              >
                {MONTHS_PT.map((m, idx) => (
                  <option key={m} value={idx}>
                    {m}
                  </option>
                ))}
              </select>

              {/* Year Dropdown */}
              <select
                value={viewYear}
                onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                className="h-8 px-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] text-[12.5px] font-bold text-[#111827] focus:outline-none focus:border-[#8B47FF] cursor-pointer max-h-48"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F5F3FF] hover:text-[#8B47FF] transition cursor-pointer"
              title="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 text-center mt-2.5 mb-1.5">
            {WEEKDAYS_PT.map((wd) => (
              <span key={wd} className="text-[11px] font-bold text-[#9CA3AF] uppercase">
                {wd}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {calendarDays.map((dObj, idx) => {
              const isSelected = value === dObj.dateStr;
              const isToday =
                new Date().toISOString().slice(0, 10) === dObj.dateStr;

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectDay(dObj.dateStr)}
                  className={cn(
                    "h-8 w-8 rounded-xl text-[12px] font-medium flex items-center justify-center transition-all cursor-pointer",
                    isSelected
                      ? "bg-[#8B47FF] text-white font-bold shadow-md shadow-[#8B47FF]/30 scale-105"
                      : dObj.isCurrentMonth
                        ? "text-[#111827] hover:bg-[#F5F3FF] hover:text-[#8B47FF]"
                        : "text-[#D1D5DB] hover:bg-slate-50",
                    isToday && !isSelected && "border border-[#8B47FF] font-bold text-[#8B47FF]"
                  )}
                >
                  {dObj.day}
                </button>
              );
            })}
          </div>

          {/* Quick Actions Footer */}
          <div className="flex items-center justify-between pt-3 mt-2.5 border-t border-[#F3F4F6] text-[11.5px]">
            <button
              type="button"
              onClick={() => {
                const todayStr = new Date().toISOString().slice(0, 10);
                handleSelectDay(todayStr);
              }}
              className="text-[#8B47FF] font-bold hover:underline cursor-pointer"
            >
              Hoje
            </button>

            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="text-[#6B7280] hover:text-rose-600 font-semibold cursor-pointer"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

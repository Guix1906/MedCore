import { useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Banknote, CreditCard, QrCode, Receipt } from "lucide-react";
import { cn } from "@/utils/cn";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const WEEKDAYS_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const pad = (n: number) => String(n).padStart(2, "0");
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIsoDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const fromMinutes = (n: number) => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;

export function formatLongDate(iso: string) {
  const d = fromIsoDate(iso);
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

export const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

export function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Pill({
  children,
  active,
  onClick,
  className,
  ...rest
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm tabular-nums transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Faixa com 7 dias a partir de hoje (ou da data escolhida) e acesso ao calendário completo. */
export function WeekStrip({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = fromIsoDate(value);
    const inWindow = selected >= today && selected.getTime() < today.getTime() + 7 * 86_400_000;
    const base = inWindow ? today : selected;
    return Array.from({ length: 7 }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
  }, [value]);

  return (
    <div className="flex gap-1.5">
      <div className="grid flex-1 grid-cols-7 gap-1 sm:gap-1.5">
        {days.map((d) => {
          const iso = toIsoDate(d);
          const active = iso === value;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onChange(iso)}
              aria-pressed={active}
              className={cn(
                "min-w-0 rounded-xl border py-2 text-center transition-colors",
                active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:border-primary/40",
              )}
            >
              <span className="block text-[11px] text-muted-foreground">{WEEKDAYS[d.getDay()]}</span>
              <span className="block text-base font-medium tabular-nums">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      <label className="relative grid w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-border bg-card hover:border-primary/40">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Escolher outra data</span>
        <input
          ref={pickerRef}
          type="date"
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          onClick={() => pickerRef.current?.showPicker?.()}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

/**
 * Horários livres do profissional no dia (intervalos de 30 min, 07h–20h), considerando a
 * duração do atendimento. "Outro horário" permite encaixe em qualquer hora.
 */
export function TimeSlots({
  day,
  value,
  duration,
  busy,
  onChange,
}: {
  day: string;
  value: string;
  duration: number;
  busy: { start: number; end: number }[];
  onChange: (time: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const slots = useMemo(() => {
    const now = new Date();
    const isToday = day === toIsoDate(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const list: string[] = [];
    for (let t = 7 * 60; t + duration <= 20 * 60; t += 30) {
      if (isToday && t < nowMin) continue;
      if (busy.some((b) => t < b.end && t + duration > b.start)) continue;
      list.push(fromMinutes(t));
    }
    return list;
  }, [day, duration, busy]);

  const valueIsSlot = slots.includes(value);

  return (
    <div className="space-y-2">
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem horários livres neste dia.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.map((t) => (
            <Pill key={t} active={t === value && !custom} onClick={() => { setCustom(false); onChange(t); }}>
              {t}
            </Pill>
          ))}
        </div>
      )}
      {custom || (!valueIsSlot && value) ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Encaixe às</span>
          <input
            type="time"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2 tabular-nums"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setCustom(true)} className="text-xs font-medium text-primary hover:underline">
          Outro horário (encaixe)
        </button>
      )}
    </div>
  );
}

const METHODS = [
  { id: "pix", label: "Pix", icon: QrCode },
  { id: "cartao_credito", label: "Crédito", icon: CreditCard },
  { id: "cartao_debito", label: "Débito", icon: CreditCard },
  { id: "dinheiro", label: "Dinheiro", icon: Banknote },
  { id: "boleto", label: "Boleto", icon: Receipt },
];

export const methodLabel = (id: string) => METHODS.find((m) => m.id === id)?.label ?? id;

export function PaymentMethods({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {METHODS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg border py-2 text-xs transition-colors",
            value === id
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:border-primary/40",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function SummaryRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-sm", strong && "font-medium")}>
      <span className={strong ? "text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums text-right">{value}</span>
    </div>
  );
}

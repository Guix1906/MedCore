import { CalendarRange, X } from "lucide-react";

/**
 * Filtro de período por vencimento usado em Contas a receber e Contas a pagar.
 * Período vazio (from/to "") = todos os lançamentos.
 */

export type Period = { from: string; to: string; preset: PresetKey };
type PresetKey =
  | "todos"
  | "hoje"
  | "semana"
  | "mes"
  | "proximos30"
  | "mesAnterior"
  | "dia"
  | "mesEscolhido"
  | "ano"
  | "custom";

export const ALL_PERIOD: Period = { from: "", to: "", preset: "todos" };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presetRange(key: PresetKey): Period {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  switch (key) {
    case "hoje":
      return { from: iso(t), to: iso(t), preset: key };
    case "semana": {
      const s = new Date(t);
      s.setDate(t.getDate() - t.getDay());
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return { from: iso(s), to: iso(e), preset: key };
    }
    case "mes":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)), preset: key };
    case "proximos30": {
      const e = new Date(t);
      e.setDate(t.getDate() + 30);
      return { from: iso(t), to: iso(e), preset: key };
    }
    case "mesAnterior":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)), preset: key };
    // Escolha livre: começam no dia/mês/ano atual e o usuário troca no campo ao lado
    case "dia":
      return { from: iso(t), to: iso(t), preset: key };
    case "mesEscolhido":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)), preset: key };
    case "ano":
      return { from: `${y}-01-01`, to: `${y}-12-31`, preset: key };
    default:
      return ALL_PERIOD;
  }
}

/**
 * Texto pesquisável das datas de um lançamento: permite buscar por "01/10", "01/10/2026"
 * ou "2026-10-01" no campo de busca.
 */
export function dateSearchText(...dates: (string | null | undefined)[]): string {
  return dates
    .map((raw) => String(raw || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .map((d) => {
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y} ${day}/${m} ${d}`;
    })
    .join(" ");
}

/** Data (yyyy-mm-dd) dentro do período. Sem período: tudo passa. Sem data: só passa sem período. */
export function inPeriod(date: string | null | undefined, period: Period): boolean {
  if (!period.from && !period.to) return true;
  const d = String(date || "").slice(0, 10);
  if (!d) return false;
  if (period.from && d < period.from) return false;
  if (period.to && d > period.to) return false;
  return true;
}

const PRESETS: [PresetKey, string][] = [
  ["todos", "Todos"],
  ["hoje", "Hoje"],
  ["semana", "Esta semana"],
  ["mes", "Este mês"],
  ["proximos30", "Próximos 30 dias"],
  ["mesAnterior", "Mês anterior"],
  ["dia", "Escolher dia"],
  ["mesEscolhido", "Escolher mês"],
  ["ano", "Escolher ano"],
  ["custom", "Personalizado"],
];

const thisYear = new Date().getFullYear();

export function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const dateInput =
    "h-9 rounded-lg border border-border bg-card px-2 text-xs text-foreground shadow-2xs outline-none focus:border-primary";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5" /> Vencimento:
      </span>
      <select
        aria-label="Período por vencimento"
        value={value.preset}
        onChange={(e) => {
          const key = e.target.value as PresetKey;
          onChange(key === "custom" ? { ...value, preset: "custom" } : presetRange(key));
        }}
        className="h-9 cursor-pointer rounded-lg border border-border bg-card px-2 text-xs font-medium text-foreground shadow-2xs outline-none focus:border-primary"
      >
        {PRESETS.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {value.preset === "dia" && (
        <input
          type="date"
          aria-label="Dia"
          value={value.from}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to: e.target.value, preset: "dia" })}
          className={dateInput}
        />
      )}
      {value.preset === "mesEscolhido" && (
        <input
          type="month"
          aria-label="Mês"
          value={value.from.slice(0, 7)}
          onChange={(e) => {
            if (!e.target.value) return;
            const [y, m] = e.target.value.split("-").map(Number);
            onChange({ from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)), preset: "mesEscolhido" });
          }}
          className={dateInput}
        />
      )}
      {value.preset === "ano" && (
        <select
          aria-label="Ano"
          value={value.from.slice(0, 4)}
          onChange={(e) =>
            onChange({ from: `${e.target.value}-01-01`, to: `${e.target.value}-12-31`, preset: "ano" })
          }
          className={`${dateInput} cursor-pointer`}
        >
          {Array.from({ length: 8 }, (_, i) => thisYear + 2 - i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
      {value.preset === "custom" && (
        <>
          <input
            type="date"
            aria-label="De"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className={dateInput}
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            aria-label="Até"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className={dateInput}
          />
        </>
      )}
      {value.preset !== "todos" && (
        <button
          type="button"
          onClick={() => onChange(ALL_PERIOD)}
          className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Limpar período"
        >
          <X className="h-3.5 w-3.5" /> Limpar
        </button>
      )}
    </div>
  );
}

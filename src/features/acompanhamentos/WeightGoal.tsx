import { useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { DbRow } from "@/lib/types";
import { errorMessage, formatClinicalDate } from "./followup-utils";
import { Chart, CHART_COLORS } from "@/components/ds/Chart";

/**
 * Peso do plano: evolução (pesos das evoluções), meta, quanto falta e IMC.
 * A meta é guardada como variação (perder/ganhar X kg); o peso-alvo em kg sai do
 * peso inicial + variação, informado no cadastro do plano.
 */

export type WeightGoalForm = {
  initial: string;
  direction: "perder" | "ganhar";
  change: string;
  height: string;
};

const kg = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").trim());
  return s.trim() === "" ? null : Number.isFinite(n) ? n : NaN;
};

/** Meta do plano: variação (kg, negativa = perder) e peso-alvo quando há peso inicial. */
export function weightGoalOf(t?: DbRow | null) {
  const initial = t?.initial_weight_kg != null ? Number(t.initial_weight_kg) : null;
  const change = t?.weight_goal_change_kg != null ? Number(t.weight_goal_change_kg) : null;
  const target =
    initial !== null && change !== null
      ? initial + change
      : t?.target_weight_kg != null
        ? Number(t.target_weight_kg)
        : null;
  return { initial, change, target };
}

/** Valida e grava peso inicial, meta e altura. Se o banco ainda não tem as colunas, explica o que falta. */
export async function saveWeightGoal(treatmentId: string, form: WeightGoalForm) {
  const initial = num(form.initial);
  const amount = num(form.change);
  const height = num(form.height);
  for (const [label, v, min, max] of [
    ["Peso inicial", initial, 1, 700],
    ["Meta (kg)", amount, 0.1, 300],
    ["Altura", height, 50, 250],
  ] as const) {
    if (v !== null && (Number.isNaN(v) || v < min || v > max)) throw new Error(`${label} inválido.`);
  }
  const change = amount === null ? null : form.direction === "ganhar" ? amount : -amount;
  const values = {
    initial_weight_kg: initial,
    weight_goal_change_kg: change,
    target_weight_kg: initial !== null && change !== null ? Math.round((initial + change) * 100) / 100 : null,
    height_cm: height,
  };
  const { error } = await supabase.from("treatments").update(values).eq("id", treatmentId);
  if (error) {
    if (/column|schema cache/i.test(error.message))
      throw new Error(
        "O banco ainda não tem o campo de meta de peso. Aplique a migração 20261007140000_treatment_weight_goal_change.sql no Supabase.",
      );
    throw error;
  }
}

export function bmiLabel(bmi: number) {
  if (bmi < 18.5) return "abaixo do peso";
  if (bmi < 25) return "peso normal";
  if (bmi < 30) return "sobrepeso";
  if (bmi < 35) return "obesidade grau I";
  if (bmi < 40) return "obesidade grau II";
  return "obesidade grau III";
}

/** Campos peso inicial / meta (perder ou ganhar X kg) / altura: cadastro, edição e resumo. */
export function WeightGoalFields({
  value,
  onChange,
  inputClass,
}: {
  value: WeightGoalForm;
  onChange: (v: WeightGoalForm) => void;
  inputClass: string;
}) {
  const initial = num(value.initial);
  const amount = num(value.change);
  const preview =
    initial && amount && !Number.isNaN(initial) && !Number.isNaN(amount)
      ? initial + (value.direction === "ganhar" ? amount : -amount)
      : null;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_1fr]">
        <label className="block text-xs font-medium text-muted-foreground">
          Peso inicial (kg)
          <input
            inputMode="decimal"
            className={`${inputClass} mt-1`}
            placeholder="Ex.: 92,5"
            value={value.initial}
            onChange={(e) => onChange({ ...value, initial: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Meta de peso
          <div className="mt-1 flex gap-1.5">
            <select
              aria-label="Perder ou ganhar"
              className={`${inputClass} w-[96px] shrink-0`}
              value={value.direction}
              onChange={(e) => onChange({ ...value, direction: e.target.value as WeightGoalForm["direction"] })}
            >
              <option value="perder">Perder</option>
              <option value="ganhar">Ganhar</option>
            </select>
            <input
              inputMode="decimal"
              aria-label="Quilos da meta"
              className={inputClass}
              placeholder="kg (ex.: 15)"
              value={value.change}
              onChange={(e) => onChange({ ...value, change: e.target.value })}
            />
          </div>
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Altura (cm)
          <input
            inputMode="decimal"
            className={`${inputClass} mt-1`}
            placeholder="Ex.: 168"
            value={value.height}
            onChange={(e) => onChange({ ...value, height: e.target.value })}
          />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {preview !== null
          ? `Peso-alvo: ${kg(preview)}`
          : amount
            ? "Informe o peso inicial para calcular o peso-alvo."
            : "Ex.: perder 15 kg. O peso-alvo é calculado a partir do peso inicial."}
      </p>
    </div>
  );
}

export const weightGoalForm = (t?: DbRow | null): WeightGoalForm => {
  const g = weightGoalOf(t);
  const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
  return {
    initial: g.initial !== null ? fmt(g.initial) : "",
    direction: g.change !== null && g.change > 0 ? "ganhar" : "perder",
    change: g.change !== null ? fmt(Math.abs(g.change)) : "",
    height: t?.height_cm != null ? fmt(Number(t.height_cm)) : "",
  };
};

export function hasWeightGoal(f: WeightGoalForm) {
  return !!(f.initial.trim() || f.change.trim() || f.height.trim());
}

/** Evolução do peso (ApexCharts): área com gradiente, pontos de cada medida e linha da meta. */
function WeightChart({
  points,
  target,
}: {
  points: { date: string; kg: number }[];
  target: number | null;
}) {
  if (points.length === 0) return null;
  const ts = (d: string) => new Date(`${d}T12:00:00`).getTime();
  const values = [...points.map((p) => p.kg), ...(target !== null ? [target] : [])];
  const min = Math.floor(Math.min(...values) - 2);
  const max = Math.ceil(Math.max(...values) + 2);
  return (
    <Chart
      type="area"
      height={170}
      summary={`Evolução do peso: ${points.map((p) => `${formatClinicalDate(p.date)} ${kg(p.kg)}`).join(", ")}${target !== null ? `; meta ${kg(target)}` : ""}`}
      series={[{ name: "Peso", data: points.map((p) => ({ x: ts(p.date), y: p.kg })) }]}
      options={{
        colors: [CHART_COLORS.primary],
        chart: { animations: { enabled: true, speed: 500 }, sparkline: { enabled: false } },
        stroke: { curve: "smooth", width: 3 },
        fill: {
          type: "gradient",
          gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 90, 100] },
        },
        markers: { size: 4, strokeWidth: 2, strokeColors: "#fff", hover: { size: 6 } },
        grid: { padding: { top: 0, right: 12, bottom: 0, left: 4 } },
        xaxis: {
          type: "datetime",
          labels: { datetimeUTC: false, format: "dd/MM", style: { fontSize: "11px" } },
          tooltip: { enabled: false },
        },
        yaxis: {
          min,
          max,
          tickAmount: 4,
          labels: { formatter: (v: number) => `${Math.round(v)} kg`, style: { fontSize: "11px" } },
        },
        tooltip: {
          x: { format: "dd/MM/yyyy" },
          y: { formatter: (v: number) => kg(v) },
        },
        annotations:
          target !== null
            ? {
                yaxis: [
                  {
                    y: target,
                    borderColor: CHART_COLORS.success,
                    strokeDashArray: 5,
                    label: {
                      text: `Meta ${kg(target)}`,
                      position: "left",
                      textAnchor: "start",
                      borderColor: "transparent",
                      style: { background: "transparent", color: CHART_COLORS.success, fontSize: "11px", fontWeight: 600 },
                    },
                  },
                ],
              }
            : undefined,
      }}
    />
  );
}
export function WeightPanel({
  treatment,
  weights,
  onChanged,
}: {
  treatment: DbRow;
  /** Pesos das evoluções, do mais antigo ao mais recente. */
  weights: { date: string; kg: number }[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => weightGoalForm(treatment));
  const [busy, setBusy] = useState(false);

  const { initial, change: goalChange, target } = weightGoalOf(treatment);
  const height = treatment.height_cm != null ? Number(treatment.height_cm) : null;

  // Série: peso inicial na data de início + pesos registrados nas evoluções
  const points = [
    ...(initial !== null ? [{ date: String(treatment.start_date).slice(0, 10), kg: initial }] : []),
    ...weights,
  ].sort((a, b) => a.date.localeCompare(b.date));
  const baseline = points[0]?.kg ?? null;
  const current = points.length ? points[points.length - 1].kg : null;
  const lost = baseline !== null && current !== null ? baseline - current : null;
  // Quanto falta, no sentido da meta (perder: atual - alvo; ganhar: alvo - atual)
  const gaining = target !== null && baseline !== null && target > baseline;
  const toGo =
    target !== null && current !== null ? (gaining ? target - current : current - target) : null;
  const goalTotal = baseline !== null && target !== null ? baseline - target : null;
  const goalPct =
    goalTotal && lost !== null && goalTotal !== 0 ? Math.max(0, Math.min(100, Math.round((lost / goalTotal) * 100))) : null;
  const bmi = height && current ? current / (height / 100) ** 2 : null;

  const save = async () => {
    setBusy(true);
    try {
      await saveWeightGoal(treatment.id, form);
      toast.success("Meta de peso salva.");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-xl border border-border-soft bg-muted/40 p-3.5">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <Scale size={14} /> Peso e meta
        </h4>
        <button
          type="button"
          onClick={() => {
            setForm(weightGoalForm(treatment));
            setEditing((v) => !v);
          }}
          className="text-xs font-semibold text-primary hover:underline cursor-pointer"
        >
          {editing
            ? "Cancelar"
            : target !== null || initial !== null || goalChange !== null
              ? "Editar meta"
              : "Definir meta"}
        </button>
      </div>

      {editing ? (
        <div className="space-y-2">
          <WeightGoalFields
            value={form}
            onChange={setForm}
            inputClass="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Salvando..." : "Salvar meta"}
            </button>
          </div>
        </div>
      ) : current === null ? (
        <div className="space-y-1 text-sm">
          {goalChange !== null && (
            <p className="text-foreground">
              Meta: <b>{goalChange < 0 ? "perder" : "ganhar"} {kg(Math.abs(goalChange))}</b>
            </p>
          )}
          <p className="text-muted-foreground">
            {goalChange !== null
              ? "Informe o peso inicial em \"Editar meta\" para calcular o peso-alvo e acompanhar no gráfico."
              : "Sem peso registrado. Defina o peso inicial e a meta, e informe o peso ao salvar cada evolução."}
          </p>
        </div>
      ) : (
        // Números à esquerda e gráfico à direita: o bloco fica baixo e a página continua sem rolagem
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[230px_1fr] md:items-center">
          <div className="space-y-2">
            <div>
              <span className="text-2xl font-semibold tabular-nums text-foreground">{kg(current)}</span>
              {lost !== null && points.length > 1 && (
                <span
                  className={`ml-2 text-sm font-semibold tabular-nums ${lost > 0 ? "text-success" : lost < 0 ? "text-warning" : "text-muted-foreground"}`}
                >
                  {lost > 0 ? `-${kg(lost)}` : lost < 0 ? `+${kg(-lost)}` : "sem variação"}
                </span>
              )}
            </div>
            {target !== null && toGo !== null && (
              <p className="text-sm text-muted-foreground">
                {toGo > 0 ? (
                  <>
                    faltam <b className="text-foreground">{kg(toGo)}</b> para a meta de {kg(target)}
                  </>
                ) : (
                  <b className="text-success">Meta de {kg(target)} atingida</b>
                )}
              </p>
            )}
            {goalPct !== null && (
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-success" style={{ width: `${goalPct}%` }} />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{goalPct}% da meta</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {baseline !== null && points.length > 1 && `Início ${kg(baseline)} · `}
              {points.length} medida(s) · última {formatClinicalDate(points[points.length - 1].date)}
            </p>
            {bmi !== null && (
              <p className="text-xs text-muted-foreground">
                IMC <b className="text-foreground">{bmi.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</b>{" "}
                ({bmiLabel(bmi)})
              </p>
            )}
          </div>
          <div className="min-w-0">
            {points.length > 1 || target !== null ? (
              <WeightChart points={points} target={target} />
            ) : (
              <p className="text-xs text-muted-foreground">
                O gráfico aparece a partir da segunda medida (ou ao definir a meta).
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

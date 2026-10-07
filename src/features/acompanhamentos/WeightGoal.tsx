import { useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { DbRow } from "@/lib/types";
import { errorMessage, formatClinicalDate } from "./followup-utils";

/**
 * Peso do plano: evolução (pesos das evoluções), meta, quanto falta e IMC.
 * Peso inicial, meta e altura ficam no próprio plano (treatments).
 */

export type WeightGoalValues = {
  initial_weight_kg: number | null;
  target_weight_kg: number | null;
  height_cm: number | null;
};

const kg = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").trim());
  return s.trim() === "" ? null : Number.isFinite(n) ? n : NaN;
};

/** Valida e grava os campos de meta. Se o banco ainda não tem as colunas, explica o que falta. */
export async function saveWeightGoal(treatmentId: string, form: { initial: string; target: string; height: string }) {
  const values: WeightGoalValues = {
    initial_weight_kg: num(form.initial),
    target_weight_kg: num(form.target),
    height_cm: num(form.height),
  };
  for (const [label, v, min, max] of [
    ["Peso inicial", values.initial_weight_kg, 1, 700],
    ["Meta de peso", values.target_weight_kg, 1, 700],
    ["Altura", values.height_cm, 50, 250],
  ] as const) {
    if (v !== null && (Number.isNaN(v) || v < min || v > max)) throw new Error(`${label} inválido.`);
  }
  const { error } = await supabase.from("treatments").update(values).eq("id", treatmentId);
  if (error) {
    if (/column|schema cache/i.test(error.message))
      throw new Error(
        "O banco ainda não tem os campos de meta de peso. Aplique a migração 20261007120000_treatment_weight_goal.sql no Supabase.",
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

/** Campos peso inicial / meta / altura (usados no cadastro, na edição e no resumo). */
export function WeightGoalFields({
  value,
  onChange,
  inputClass,
}: {
  value: { initial: string; target: string; height: string };
  onChange: (v: { initial: string; target: string; height: string }) => void;
  inputClass: string;
}) {
  const field = (key: "initial" | "target" | "height", label: string, ph: string) => (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      <input
        inputMode="decimal"
        className={`${inputClass} mt-1`}
        placeholder={ph}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {field("initial", "Peso inicial (kg)", "Ex.: 92,5")}
      {field("target", "Meta (kg)", "Ex.: 78")}
      {field("height", "Altura (cm)", "Ex.: 168")}
    </div>
  );
}

export const weightGoalForm = (t?: DbRow | null) => ({
  initial: t?.initial_weight_kg != null ? String(t.initial_weight_kg).replace(".", ",") : "",
  target: t?.target_weight_kg != null ? String(t.target_weight_kg).replace(".", ",") : "",
  height: t?.height_cm != null ? String(t.height_cm).replace(".", ",") : "",
});

export function hasWeightGoal(f: { initial: string; target: string; height: string }) {
  return !!(f.initial.trim() || f.target.trim() || f.height.trim());
}

/** Gráfico simples de evolução do peso com a linha da meta. */
function WeightChart({
  points,
  target,
}: {
  points: { date: string; kg: number }[];
  target: number | null;
}) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 70;
  const values = [...points.map((p) => p.kg), ...(target ? [target] : [])];
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const t0 = new Date(`${points[0].date}T12:00:00`).getTime();
  const t1 = new Date(`${points[points.length - 1].date}T12:00:00`).getTime();
  const x = (d: string) =>
    t1 === t0 ? W / 2 : ((new Date(`${d}T12:00:00`).getTime() - t0) / (t1 - t0)) * (W - 8) + 4;
  const y = (v: number) => H - 4 - ((v - min) / (max - min || 1)) * (H - 8);
  const path = points.map((p) => `${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[70px] w-full" role="img" aria-label="Evolução do peso">
      {target !== null && (
        <>
          <line
            x1={0}
            x2={W}
            y1={y(target)}
            y2={y(target)}
            stroke="var(--success)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <text x={W - 2} y={y(target) - 3} textAnchor="end" fontSize="9" fill="var(--success)">
            meta {kg(target)}
          </text>
        </>
      )}
      <polyline points={path} fill="none" stroke="var(--primary)" strokeWidth={2} />
      {points.map((p) => (
        <circle key={p.date + p.kg} cx={x(p.date)} cy={y(p.kg)} r={2.5} fill="var(--primary)">
          <title>
            {formatClinicalDate(p.date)}: {kg(p.kg)}
          </title>
        </circle>
      ))}
    </svg>
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

  const initial = treatment.initial_weight_kg != null ? Number(treatment.initial_weight_kg) : null;
  const target = treatment.target_weight_kg != null ? Number(treatment.target_weight_kg) : null;
  const height = treatment.height_cm != null ? Number(treatment.height_cm) : null;

  // Série: peso inicial na data de início + pesos registrados nas evoluções
  const points = [
    ...(initial !== null ? [{ date: String(treatment.start_date).slice(0, 10), kg: initial }] : []),
    ...weights,
  ].sort((a, b) => a.date.localeCompare(b.date));
  const baseline = points[0]?.kg ?? null;
  const current = points.length ? points[points.length - 1].kg : null;
  const lost = baseline !== null && current !== null ? baseline - current : null;
  const toGo = target !== null && current !== null ? current - target : null;
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
          {editing ? "Cancelar" : target !== null || initial !== null ? "Editar meta" : "Definir meta"}
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
        <p className="text-sm text-muted-foreground">
          Sem peso registrado. Defina o peso inicial e a meta, e informe o peso ao salvar cada evolução.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums text-foreground">{kg(current)}</span>
            {lost !== null && points.length > 1 && (
              <span
                className={`text-sm font-semibold tabular-nums ${lost > 0 ? "text-success" : lost < 0 ? "text-warning" : "text-muted-foreground"}`}
              >
                {lost > 0 ? `-${kg(lost)}` : lost < 0 ? `+${kg(-lost)}` : "sem variação"}
              </span>
            )}
            {target !== null && toGo !== null && (
              <span className="text-sm text-muted-foreground">
                {toGo > 0 ? (
                  <>
                    faltam <b className="text-foreground">{kg(toGo)}</b> para {kg(target)}
                  </>
                ) : (
                  <b className="text-success">meta de {kg(target)} atingida</b>
                )}
              </span>
            )}
          </div>
          {goalPct !== null && (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-success" style={{ width: `${goalPct}%` }} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{goalPct}% da meta</p>
            </div>
          )}
          <WeightChart points={points} target={target} />
          <p className="text-xs text-muted-foreground">
            {baseline !== null && points.length > 1 && `Início ${kg(baseline)} · `}
            última medida {formatClinicalDate(points[points.length - 1].date)}
            {bmi !== null && (
              <>
                {" "}· IMC <b className="text-foreground">{bmi.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</b>{" "}
                ({bmiLabel(bmi)})
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

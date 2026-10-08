import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Chart, CHART_COLORS } from "@/components/ds/Chart";
import { currency } from "@/features/acompanhamentos/followup-utils";
import { getTitleEventKey } from "./finance-api";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";

/**
 * Faturamento por tipo de serviço (consultas, planos, implantes, medicações...): quantidade,
 * valor faturado e recebido no período, com gráfico. Base: lançamentos de receita não
 * cancelados, na data do serviço (data do lançamento; sem ela, o vencimento).
 */

type ServiceType =
  | "consultas"
  | "planos"
  | "implantes"
  | "medicacoes"
  | "procedimentos"
  | "exames"
  | "outros";

const TYPES: { id: ServiceType; label: string; color: string }[] = [
  { id: "consultas", label: "Consultas", color: CHART_COLORS.primary },
  { id: "planos", label: "Planos de acompanhamento", color: CHART_COLORS.secondary },
  { id: "implantes", label: "Implantes", color: CHART_COLORS.success },
  { id: "medicacoes", label: "Medicações", color: CHART_COLORS.warning },
  { id: "procedimentos", label: "Procedimentos", color: CHART_COLORS.danger },
  { id: "exames", label: "Exames", color: CHART_COLORS.primarySoft },
  { id: "outros", label: "Outros", color: CHART_COLORS.neutral },
];

const norm = (s: string | null | undefined) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Classifica o lançamento pelo vínculo (plano / agendamento) e pelo texto da categoria e descrição. */
export function serviceTypeOf(t: FinancialTitle): ServiceType {
  const text = `${norm(t.category)} ${norm(t.description)}`;
  if (/implante/.test(text)) return "implantes";
  if (t.treatment_id) return "planos";
  if (/medica|injet|tirzepatida|semaglutida|mounjaro|ozempic|wegovy|saxenda|aplicac|soro|vitamina/.test(text))
    return "medicacoes";
  if (/exame|laudo/.test(text)) return "exames";
  if (/procedimento|cirurgi|botox|preenchimento/.test(text)) return "procedimentos";
  if (getTitleEventKey(t) || /consulta|retorno|avaliac|telemedicina|teleconsulta|atendimento/.test(text))
    return "consultas";
  return "outros";
}

type Mode = "dia" | "mes" | "ano";
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function ServiceRevenue({ finance }: { finance: FinanceSnapshot }) {
  const [mode, setMode] = useState<Mode>("mes");
  const [ref, setRef] = useState(() => new Date());

  const { start, end, label } = useMemo(() => {
    const y = ref.getFullYear();
    const m = ref.getMonth();
    if (mode === "dia") return { start: iso(ref), end: iso(ref), label: ref.toLocaleDateString("pt-BR") };
    if (mode === "ano") return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
    const l = new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)), label: l[0].toUpperCase() + l.slice(1) };
  }, [mode, ref]);

  const shift = (dir: 1 | -1) => {
    const d = new Date(ref);
    if (mode === "dia") d.setDate(d.getDate() + dir);
    else if (mode === "mes") d.setMonth(d.getMonth() + dir, 1);
    else d.setFullYear(d.getFullYear() + dir);
    setRef(d);
  };

  // Lançamentos de receita do período, já com o tipo de serviço
  const rows = useMemo(
    () =>
      finance.titles
        .filter((t) => t.type === "receita" && t.status !== "cancelado")
        .map((t) => ({ t, type: serviceTypeOf(t), day: (t.date || t.due_date || "").slice(0, 10) }))
        .filter((r) => r.day && r.day >= start && r.day <= end),
    [finance.titles, start, end],
  );

  const summary = useMemo(() => {
    const by = new Map<ServiceType, { qty: number; billed: number; received: number; plans: Set<string> }>();
    for (const r of rows) {
      const cur = by.get(r.type) ?? { qty: 0, billed: 0, received: 0, plans: new Set<string>() };
      // Plano conta uma vez (entrada e parcelas são do mesmo serviço)
      if (r.type === "planos" && r.t.treatment_id) cur.plans.add(r.t.treatment_id);
      else cur.qty += 1;
      cur.billed += Number(r.t.amount) || 0;
      cur.received += Number(r.t.paid_amount) || 0;
      by.set(r.type, cur);
    }
    return TYPES.map((tp) => {
      const v = by.get(tp.id);
      return {
        ...tp,
        qty: v ? v.qty + v.plans.size : 0,
        billed: v?.billed ?? 0,
        received: v?.received ?? 0,
      };
    });
  }, [rows]);

  const total = summary.reduce(
    (a, s) => ({ qty: a.qty + s.qty, billed: a.billed + s.billed, received: a.received + s.received }),
    { qty: 0, billed: 0, received: 0 },
  );
  const visible = summary.filter((s) => s.qty > 0 || s.billed > 0);

  // Gráfico: um dia = barras por tipo; mês = colunas por dia; ano = colunas por mês (empilhadas por tipo)
  const buckets = useMemo(() => {
    if (mode === "ano") return MONTHS.map((m, i) => ({ key: `${start.slice(0, 4)}-${pad(i + 1)}`, label: m }));
    if (mode === "mes") {
      const days = Number(end.slice(8, 10));
      return Array.from({ length: days }, (_, i) => ({ key: `${start.slice(0, 8)}${pad(i + 1)}`, label: String(i + 1) }));
    }
    return [];
  }, [mode, start, end]);

  const series = useMemo(() => {
    if (mode === "dia") return [{ name: "Faturado", data: visible.map((s) => Math.round(s.billed * 100) / 100) }];
    return visible.map((s) => ({
      name: s.label,
      data: buckets.map((b) =>
        Math.round(
          rows
            .filter((r) => r.type === s.id && r.day.startsWith(b.key))
            .reduce((sum, r) => sum + (Number(r.t.amount) || 0), 0) * 100,
        ) / 100,
      ),
    }));
  }, [mode, visible, buckets, rows]);

  const segBtn = (active: boolean) =>
    `px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
      active ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-4">
      {/* Período */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-border bg-muted/60 p-0.5">
          {(["dia", "mes", "ano"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={segBtn(mode === m)}>
              {m === "dia" ? "Dia" : m === "mes" ? "Mês" : "Ano"}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted cursor-pointer"
            aria-label="Período anterior"
          >
            <ChevronLeft size={16} />
          </button>
          {mode === "dia" ? (
            <input
              type="date"
              aria-label="Dia"
              value={start}
              onChange={(e) => e.target.value && setRef(new Date(`${e.target.value}T12:00:00`))}
              className="h-8 bg-transparent px-1 text-sm font-semibold outline-none"
            />
          ) : mode === "mes" ? (
            <input
              type="month"
              aria-label="Mês"
              value={start.slice(0, 7)}
              onChange={(e) => e.target.value && setRef(new Date(`${e.target.value}-01T12:00:00`))}
              className="h-8 bg-transparent px-1 text-sm font-semibold outline-none"
            />
          ) : (
            <span className="min-w-[60px] text-center text-sm font-semibold">{label}</span>
          )}
          <button
            type="button"
            onClick={() => shift(1)}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted cursor-pointer"
            aria-label="Próximo período"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="text-xs text-muted-foreground">Data do serviço (lançamento) · receitas não canceladas</span>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { l: "Serviços no período", v: String(total.qty), tone: "text-foreground" },
          { l: "Faturado", v: currency(total.billed), tone: "text-foreground" },
          { l: "Recebido", v: currency(total.received), tone: "text-success" },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-border bg-card px-4 py-3 shadow-2xs">
            <span className="text-xs font-medium text-muted-foreground">{k.l}</span>
            <p className={`text-xl font-semibold tabular-nums ${k.tone}`}>{k.v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Gráfico */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-xs lg:col-span-3">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Faturamento por tipo de serviço · {label}
          </h3>
          {visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Nenhum serviço faturado neste período.</p>
          ) : (
            <Chart
              type="bar"
              height={300}
              summary={`Faturamento por tipo de serviço em ${label}: ${visible.map((s) => `${s.label} ${currency(s.billed)}`).join(", ")}`}
              series={series}
              options={
                mode === "dia"
                  ? {
                      colors: visible.map((s) => s.color),
                      plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4, barHeight: "60%" } },
                      legend: { show: false },
                      xaxis: {
                        categories: visible.map((s) => s.label),
                        labels: { formatter: (v: string) => currency(Number(v)).replace(",00", "") },
                      },
                      tooltip: {
                        y: {
                          formatter: (v: number, o?: { dataPointIndex: number }) =>
                            `${currency(v)} · ${visible[o?.dataPointIndex ?? 0]?.qty ?? 0} serviço(s)`,
                        },
                      },
                    }
                  : {
                      colors: visible.map((s) => s.color),
                      chart: { stacked: true },
                      plotOptions: { bar: { borderRadius: 3, columnWidth: mode === "ano" ? "55%" : "70%" } },
                      xaxis: { categories: buckets.map((b) => b.label), tickAmount: mode === "mes" ? 10 : undefined },
                      yaxis: {
                        labels: {
                          formatter: (v: number) =>
                            v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : `R$ ${Math.round(v)}`,
                        },
                      },
                      tooltip: { shared: true, intersect: false, y: { formatter: (v: number) => currency(v) } },
                    }
              }
            />
          )}
        </section>

        {/* Tabela por tipo */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-xs lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Por tipo de serviço</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Serviço</th>
                <th className="py-2 text-right font-medium">Qtd.</th>
                <th className="py-2 text-right font-medium">Faturado</th>
                <th className="py-2 text-right font-medium">Recebido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {summary.map((s) => (
                <tr key={s.id} className={s.qty === 0 && s.billed === 0 ? "text-muted-foreground" : ""}>
                  <td className="py-2">
                    <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: s.color }} />
                    {s.label}
                    {s.billed > 0 && total.billed > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {Math.round((s.billed / total.billed) * 100)}%
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{s.qty}</td>
                  <td className="py-2 text-right tabular-nums">{currency(s.billed)}</td>
                  <td className="py-2 text-right tabular-nums text-success">{currency(s.received)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-right tabular-nums">{total.qty}</td>
                <td className="py-2 text-right tabular-nums">{currency(total.billed)}</td>
                <td className="py-2 text-right tabular-nums text-success">{currency(total.received)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Planos contam uma vez por plano (entrada e parcelas). O tipo vem do vínculo do lançamento
            (plano ou agendamento) e do nome da categoria/descrição.
          </p>
        </section>
      </div>
    </div>
  );
}

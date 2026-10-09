import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { DbRow } from "@/lib/types";
import { useActiveCompany } from "@/hooks/use-active-company";
import { isFreeBalance } from "@/features/finance/finance-math";
import type { FinancialTitle } from "@/features/finance/finance-schema";
import { localDate } from "./followup-utils";
import { useTreatmentMedicationUses } from "./use-treatment-medication-uses";
import { weightGoalOf } from "./WeightGoal";

/**
 * Resumo do plano em PDF: página A4 com a situação completa do plano (prazo, peso, aplicações,
 * medicações, financeiro e histórico) e gráficos. O PDF sai pelo "Salvar como PDF" do navegador:
 * texto e gráficos vetoriais ficam nítidos e não há biblioteca extra.
 */

type Financials = { total: number; paid: number; open: number; nextDueDate: string | null };

const STATUS: Record<string, string> = {
  em_andamento: "Em andamento",
  pausado: "Pausado",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};
const PERIOD: Record<string, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
  semanal: "Semanal",
};

const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const kg = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
const dt = (v?: string | null) =>
  v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const dtShort = (v: string) =>
  new Date(`${v.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const days = (a: string, b: string) =>
  Math.round((new Date(`${b.slice(0, 10)}T12:00:00`).getTime() - new Date(`${a.slice(0, 10)}T12:00:00`).getTime()) / 86400000);
const skipped = (u: DbRow) => /\[(NÃO TOMOU|SUSPENSA|ADIADA)\]/.test(u.dose || "");
const HEX = /^#[0-9a-f]{6}$/i;

export function TreatmentReportDialog({
  open,
  onClose,
  treatment,
  meds,
  planTitles,
  financials,
}: {
  open: boolean;
  onClose: () => void;
  treatment: DbRow;
  meds: DbRow[];
  planTitles: FinancialTitle[];
  financials: Financials;
}) {
  const [withFinance, setWithFinance] = useState(true);
  const [withPhotos, setWithPhotos] = useState(false);
  const id = treatment.id as string;
  const { companyId } = useActiveCompany();

  const history = useQuery({
    queryKey: ["treatment-evolutions", id],
    enabled: open,
    queryFn: async () => {
      const [e, s] = await Promise.all([
        supabase
          .from("treatment_evolutions")
          .select("*")
          .eq("treatment_id", id)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("treatment_status_history")
          .select("*")
          .eq("treatment_id", id)
          .order("created_at", { ascending: false }),
      ]);
      if (e.error) throw e.error;
      if (s.error) throw s.error;
      return { evolutions: e.data, statuses: s.data };
    },
  });
  const uses = useTreatmentMedicationUses(id);

  const clinic = useQuery({
    queryKey: ["report-clinic", companyId],
    enabled: open && !!companyId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("*").eq("id", companyId!).maybeSingle();
      const c = (data ?? {}) as Record<string, unknown>;
      return {
        name: typeof c.name === "string" ? c.name : "",
        logo: typeof c.brand_logo_url === "string" ? c.brand_logo_url : null,
        color: typeof c.brand_primary === "string" && HEX.test(c.brand_primary) ? c.brand_primary : null,
      };
    },
  });

  const patient = useQuery({
    queryKey: ["report-patient", treatment.patient_id],
    enabled: open && !!treatment.patient_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("patients")
        .select("city, state")
        .eq("id", treatment.patient_id)
        .maybeSingle();
      return (data ?? {}) as DbRow;
    },
  });

  // Fotos só quando marcadas (privacidade): baixa as imagens privadas como blobs locais
  const photos = useQuery({
    queryKey: ["report-photos", id],
    enabled: open && withPhotos,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_photos")
        .select("*")
        .eq("treatment_id", id)
        .order("taken_on", { ascending: true });
      if (error) throw error;
      const list = (data ?? []) as DbRow[];
      // Primeira e últimas fotos: mostram o antes e o agora sem lotar o relatório
      const pick = list.length > 4 ? [list[0], ...list.slice(-3)] : list;
      return Promise.all(
        pick.map(async (p) => {
          const { data: blob } = await supabase.storage.from("treatment-photos").download(p.storage_path);
          return { title: String(p.title), date: String(p.taken_on), url: blob ? URL.createObjectURL(blob) : "" };
        }),
      );
    },
  });
  useEffect(
    () => () => photos.data?.forEach((p) => p.url && URL.revokeObjectURL(p.url)),
    [photos.data],
  );

  const loading = history.isPending || uses.isPending || clinic.isPending || (withPhotos && photos.isPending);

  const data: ReportData = useMemo(
    () => ({
      treatment,
      meds,
      planTitles,
      financials,
      evolutions: (history.data?.evolutions ?? []) as DbRow[],
      statuses: (history.data?.statuses ?? []) as DbRow[],
      uses: (uses.data ?? []) as DbRow[],
      clinic: clinic.data ?? { name: "", logo: null, color: null },
      patient: patient.data ?? {},
      photos: withPhotos ? (photos.data ?? []) : [],
      withFinance,
    }),
    [treatment, meds, planTitles, financials, history.data, uses.data, clinic.data, patient.data, photos.data, withPhotos, withFinance],
  );

  const print = () => {
    const previous = document.title;
    // O navegador usa o título como nome do arquivo PDF
    document.title = `Resumo do plano - ${treatment.patients?.name ?? "Paciente"} - ${treatment.title}`;
    document.body.classList.add("printing-report");
    const done = () => {
      document.body.classList.remove("printing-report");
      document.title = previous;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[94vh] max-w-[880px] overflow-y-auto p-0">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
            <div>
              <DialogTitle className="text-base">Resumo do plano</DialogTitle>
              <DialogDescription className="text-xs">
                Confira abaixo e clique em “Baixar PDF” (escolha “Salvar como PDF” na janela que abrir).
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={withFinance}
                  onChange={(e) => setWithFinance(e.target.checked)}
                  className="size-4 accent-primary"
                />
                Incluir financeiro
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={withPhotos}
                  onChange={(e) => setWithPhotos(e.target.checked)}
                  className="size-4 accent-primary"
                />
                Incluir fotos
              </label>
              <button
                type="button"
                onClick={print}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 font-semibold text-white transition hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
                Baixar PDF
              </button>
            </div>
          </div>
          <div className="bg-muted/60 p-4 sm:p-6">
            <div className="mx-auto max-w-[794px] overflow-hidden rounded-md shadow-lg">
              {loading ? (
                <div className="grid h-96 place-items-center bg-white text-sm text-neutral-500">
                  Montando o resumo…
                </div>
              ) : (
                <ReportDocument data={data} />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {open &&
        !loading &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="print-report-root">
            <ReportDocument data={data} />
          </div>,
          document.body,
        )}
    </>
  );
}

export type ReportData = {
  treatment: DbRow;
  meds: DbRow[];
  planTitles: FinancialTitle[];
  financials: Financials;
  evolutions: DbRow[];
  statuses: DbRow[];
  uses: DbRow[];
  clinic: { name: string; logo: string | null; color: string | null };
  patient: DbRow;
  photos: { title: string; date: string; url: string }[];
  withFinance: boolean;
};

const INK = "#1f2937";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const GOOD = "#059669";
const BAD = "#dc2626";
const WARN = "#d97706";

/** Mistura a cor com branco (0 = cor, 1 = branco), para fundos suaves no tom da clínica. */
const tint = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)} ${mix((n >> 8) & 255)} ${mix(n & 255)})`;
};

export function ReportDocument({ data }: { data: ReportData }) {
  const { treatment: t, meds, planTitles, financials, evolutions, statuses, uses, clinic, patient, photos } = data;
  const color = clinic.color ?? "#2c7f86";
  const soft = tint(color, 0.9);
  const today = localDate();

  // Prazo
  const total = t.end_date ? days(t.start_date, t.end_date) : Number(t.return_days ?? 90);
  const passed = Math.max(0, days(t.start_date, today));
  const progress = total > 0 ? Math.min(100, Math.round((passed / total) * 100)) : 0;
  const remainingDays = Math.max(0, total - passed);
  const returnLate = t.status === "em_andamento" && !!t.next_return_date && t.next_return_date <= today;

  // Peso
  const weights = evolutions
    .filter((e) => e.weight_kg != null)
    .map((e) => ({ date: String(e.occurred_on).slice(0, 10), kg: Number(e.weight_kg) }))
    .reverse();
  const goal = weightGoalOf(t);
  if (goal.initial != null && (!weights.length || weights[0].date > String(t.start_date).slice(0, 10)))
    weights.unshift({ date: String(t.start_date).slice(0, 10), kg: goal.initial });
  const startKg = weights[0]?.kg ?? goal.initial ?? null;
  const currentKg = weights.length ? weights[weights.length - 1].kg : null;
  const delta = startKg != null && currentKg != null ? currentKg - startKg : null;
  const wantsLoss = goal.target != null && startKg != null ? goal.target < startKg : true;
  const deltaGood = delta == null ? null : wantsLoss ? delta <= 0 : delta >= 0;
  const goalPct =
    goal.target != null && startKg != null && currentKg != null && goal.target !== startKg
      ? Math.max(0, Math.min(100, Math.round(((startKg - currentKg) / (startKg - goal.target)) * 100)))
      : null;

  // Aplicações
  const applied = uses.filter((u) => !skipped(u));
  const missed = uses.filter(skipped);
  const adherence = uses.length ? Math.round((applied.length / uses.length) * 100) : null;
  const overdueScheduled = meds.filter(
    (m) =>
      m.status === "ativo" &&
      m.period === "semanal" &&
      m.start_date &&
      String(m.start_date) < today &&
      !uses.some((u) => u.medication_id === m.id),
  ).length;

  // Medicações ativas (protocolo semanal agrupado numa linha)
  const medRows = (() => {
    const groups = new Map<string, DbRow[]>();
    const rows: { name: string; dose: string; freq: string; period: string }[] = [];
    for (const m of meds.filter((x) => x.status === "ativo")) {
      const match = String(m.name || "").match(/^(.*)\s+\(Sem\.\s*(\d+)\)$/);
      if (match) groups.set(match[1], [...(groups.get(match[1]) ?? []), { ...m, _w: Number(match[2]) }]);
      else
        rows.push({
          name: m.name,
          dose: m.dose ? `${m.dose}${m.unit || ""}` : "—",
          freq: m.frequency || "—",
          period: PERIOD[m.period] ?? "Uso contínuo",
        });
    }
    for (const [name, list] of groups) {
      const sorted = list.sort((a, b) => a._w - b._w);
      const current = [...sorted].reverse().find((r) => r.start_date && String(r.start_date) <= today) ?? sorted[0];
      rows.unshift({
        name,
        dose: `${current.dose ?? ""}${current.unit || ""}`,
        freq: `Semanal · sem. ${current._w} de ${sorted[sorted.length - 1]._w}`,
        period: "Injetável",
      });
    }
    return rows;
  })();

  const titles = planTitles.filter((x) => x.status !== "cancelado" && !isFreeBalance(x));
  const paidCount = titles.filter((x) => Number(x.paid_amount || 0) >= Number(x.amount || 0)).length;
  const overdue = titles.filter(
    (x) => x.due_date && x.due_date < today && Number(x.paid_amount || 0) < Number(x.amount || 0),
  );
  const paidPct = financials.total > 0 ? Math.min(100, Math.round((financials.paid / financials.total) * 100)) : 0;

  const history = [
    ...evolutions.slice(0, 6).map((e) => ({
      date: String(e.occurred_on),
      tag: e.is_return ? "Retorno" : "Evolução",
      text: `${e.notes}${e.next_step ? ` · Próximo passo: ${e.next_step}` : ""}`,
      extra: e.weight_kg ? kg(Number(e.weight_kg)) : "",
    })),
    ...statuses.slice(0, 4).map((s) => ({
      date: String(s.created_at),
      tag: STATUS[s.status] ?? s.status,
      text: String(s.justification ?? ""),
      extra: "",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const showFinance = data.withFinance && financials.total > 0;
  let n = 0;
  const num = () => String(++n).padStart(2, "0");

  return (
    <article
      className="treatment-report bg-white text-[11.5px] leading-relaxed"
      style={{ color: INK, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* Faixa de cabeçalho na cor da clínica */}
      <header
        className="px-8 pb-6 pt-7 text-white"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${color} 78%, black) 0%, ${color} 55%, ${tint(color, 0.22)} 100%)`,
        }}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-[150px] place-items-center rounded-xl bg-white px-3 py-2 shadow-sm">
              <img
                src={clinic.logo ?? "/assets/dr-jonatas-bandeira-logo.png"}
                alt={clinic.name || "Clínica"}
                className="max-h-12 max-w-full object-contain"
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
                Resumo do acompanhamento
              </p>
              <h1 className="text-[22px] font-bold leading-tight">{t.patients?.name ?? "Paciente"}</h1>
              <p className="text-[12px] text-white/85">{t.title}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <span className="inline-block rounded-full bg-white px-3 py-1 text-[11px] font-bold" style={{ color }}>
              {STATUS[t.status] ?? t.status}
            </span>
            <p className="mt-2 text-[10px] text-white/80">Emitido em {dt(today)}</p>
            {clinic.name && <p className="text-[10px] text-white/80">{clinic.name}</p>}
          </div>
        </div>
      </header>

      <div className="px-8 pb-8">
        {/* Identificação */}
        <section className="-mt-px grid grid-cols-4 border-b" style={{ borderColor: LINE }}>
          <Field label="Cidade" value={[patient.city, patient.state].filter(Boolean).join(" / ") || "—"} />
          <Field label="Médico(a)" value={t.doctors?.name ? `Dr(a). ${t.doctors.name}` : "—"} />
          <Field label="Início" value={dt(t.start_date)} />
          <Field label="Término previsto" value={dt(t.end_date)} />
        </section>
        {t.objective && (
          <p className="mt-3 rounded-lg px-3 py-2 text-[11.5px]" style={{ background: soft }}>
            <b style={{ color }}>Objetivo: </b>
            {t.objective}
          </p>
        )}

        {/* Indicadores principais */}
        <section className="mt-5 grid grid-cols-4 gap-3 break-inside-avoid">
          <Kpi
            ring={progress}
            color={color}
            title="Prazo do plano"
            value={`${progress}%`}
            sub={t.status === "em_andamento" ? `${remainingDays} dias restantes` : `${passed} de ${total} dias`}
          />
          <Kpi
            ring={goalPct}
            color={deltaGood === false ? BAD : GOOD}
            title="Peso"
            value={delta != null ? `${delta > 0 ? "+" : ""}${kg(delta)}` : "—"}
            sub={goalPct != null ? `${goalPct}% da meta` : currentKg != null ? `Atual ${kg(currentKg)}` : "Sem pesagens"}
          />
          <Kpi
            ring={adherence}
            color={adherence != null && adherence < 80 ? WARN : color}
            title="Adesão"
            value={adherence != null ? `${adherence}%` : "—"}
            sub={uses.length ? `${applied.length} de ${uses.length} aplicações` : "Sem aplicações"}
          />
          {showFinance ? (
            <Kpi
              ring={paidPct}
              color={overdue.length ? BAD : GOOD}
              title="Financeiro"
              value={`${paidPct}% pago`}
              sub={overdue.length ? `${overdue.length} parcela(s) em atraso` : `Em aberto ${brl(financials.open)}`}
            />
          ) : (
            <Kpi
              ring={null}
              color={returnLate ? BAD : color}
              title="Próximo retorno"
              value={dt(t.next_return_date)}
              sub={returnLate ? "Retorno vencido" : t.return_days ? `A cada ${t.return_days} dias` : ""}
            />
          )}
        </section>

        {/* Peso */}
        {(weights.length > 0 || goal.target != null) && (
          <section className="mt-7 break-inside-avoid">
            <SectionTitle n={num()} title="Evolução de peso" color={color} />
            <div className="grid grid-cols-[1fr_168px] gap-4">
              <div className="rounded-xl border p-3" style={{ borderColor: LINE }}>
                {weights.length >= 2 ? (
                  <WeightChart points={weights} target={goal.target} color={color} />
                ) : (
                  <Empty text="Registre pelo menos duas pesagens nas evoluções para ver o gráfico." />
                )}
              </div>
              <div className="space-y-2">
                <Mini label="Peso inicial" value={startKg != null ? kg(startKg) : "—"} />
                <Mini label="Peso atual" value={currentKg != null ? kg(currentKg) : "—"} strong />
                <Mini label="Meta" value={goal.target != null ? kg(goal.target) : "—"} tone={GOOD} />
                <Mini
                  label={goal.target != null && currentKg != null ? "Falta para a meta" : "Variação"}
                  value={
                    goal.target != null && currentKg != null
                      ? kg(Math.abs(currentKg - goal.target))
                      : delta != null
                        ? kg(delta)
                        : "—"
                  }
                />
              </div>
            </div>
          </section>
        )}

        {/* Aplicações e medicações */}
        <section className="mt-7 break-inside-avoid">
          <SectionTitle n={num()} title="Medicações e aplicações" color={color} />
          <div className="grid grid-cols-[1fr_168px] gap-4">
            <div className="rounded-xl border p-3" style={{ borderColor: LINE }}>
              {uses.length > 0 ? (
                <UsesChart uses={uses} color={color} />
              ) : (
                <Empty text="Nenhuma aplicação registrada ainda." />
              )}
            </div>
            <div className="space-y-2">
              <Mini label="Aplicações feitas" value={String(applied.length)} strong />
              <Mini label="Não realizadas" value={String(missed.length)} tone={missed.length ? BAD : undefined} />
              <Mini label="Previstas sem registro" value={String(overdueScheduled)} tone={overdueScheduled ? WARN : undefined} />
              <Mini label="Medicações ativas" value={String(medRows.length)} />
            </div>
          </div>
          {medRows.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: LINE }}>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr style={{ background: soft }}>
                    {["Medicação", "Dose", "Frequência", "Tipo"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {medRows.map((m, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${LINE}`, background: i % 2 ? "#fafafa" : "#fff" }}>
                      <td className="px-3 py-1.5 font-semibold">{m.name}</td>
                      <td className="px-3 py-1.5">{m.dose}</td>
                      <td className="px-3 py-1.5">{m.freq}</td>
                      <td className="px-3 py-1.5" style={{ color: MUTED }}>
                        {m.period}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Financeiro */}
        {showFinance && (
          <section className="mt-7 break-inside-avoid">
            <SectionTitle n={num()} title="Financeiro do plano" color={color} />
            <div className="grid grid-cols-[180px_1fr] items-center gap-5 rounded-xl border p-4" style={{ borderColor: LINE }}>
              <Donut pct={paidPct} color={color} />
              <div>
                <div className="grid grid-cols-3 gap-2">
                  <Mini label="Contratado" value={brl(financials.total)} strong />
                  <Mini label="Pago" value={brl(financials.paid)} tone={GOOD} />
                  <Mini label="Em aberto" value={brl(financials.open)} tone={financials.open ? WARN : undefined} />
                  <Mini label="Desconto" value={brl(Number(t.discount || 0))} />
                  <Mini label="Parcelas pagas" value={`${paidCount} de ${titles.length}`} />
                  <Mini
                    label="Próximo vencimento"
                    value={financials.nextDueDate ? dt(financials.nextDueDate) : "—"}
                    tone={overdue.length ? BAD : undefined}
                  />
                </div>
                {overdue.length > 0 && (
                  <p className="mt-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold" style={{ background: "#fef2f2", color: BAD }}>
                    {overdue.length} parcela(s) em atraso.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Histórico */}
        {history.length > 0 && (
          <section className="mt-7 break-inside-avoid">
            <SectionTitle n={num()} title="Histórico do acompanhamento" color={color} />
            <ol className="relative ml-1.5 border-l-2 pl-5" style={{ borderColor: tint(color, 0.7) }}>
              {history.map((h, i) => (
                <li key={i} className="relative pb-3 last:pb-0 break-inside-avoid">
                  <span
                    className="absolute -left-[27px] top-1 size-3 rounded-full border-2 bg-white"
                    style={{ borderColor: color }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{dt(h.date)}</span>
                    <span className="rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase" style={{ background: soft, color }}>
                      {h.tag}
                    </span>
                    {h.extra && <span style={{ color: MUTED }}>{h.extra}</span>}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap" style={{ color: "#374151" }}>
                    {h.text}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Fotos */}
        {photos.length > 0 && (
          <section className="mt-7 break-inside-avoid">
            <SectionTitle n={num()} title="Fotos de evolução" color={color} />
            <div className="grid grid-cols-4 gap-3">
              {photos.map((p, i) => (
                <figure key={i} className="overflow-hidden rounded-xl border break-inside-avoid" style={{ borderColor: LINE }}>
                  {p.url && <img src={p.url} alt={p.title} className="h-40 w-full object-cover" />}
                  <figcaption className="px-2 py-1 text-[10px]" style={{ color: MUTED }}>
                    <b style={{ color: INK }}>{p.title}</b> · {dt(p.date)}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* Assinatura */}
        <footer className="mt-12 flex items-end justify-between break-inside-avoid">
          <div className="w-64 pt-1 text-center text-[11px]" style={{ borderTop: `1px solid #9ca3af`, color: "#4b5563" }}>
            {t.doctors?.name ? `Dr(a). ${t.doctors.name}` : "Responsável"}
          </div>
          <div className="text-right text-[9.5px]" style={{ color: "#9ca3af" }}>
            {clinic.name && <div>{clinic.name}</div>}
            Gerado pelo MedCore em {dt(today)}
          </div>
        </footer>
      </div>
    </article>
  );
}

function SectionTitle({ n, title, color }: { n: string; title: string; color: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className="grid size-6 place-items-center rounded-md text-[10px] font-bold text-white"
        style={{ background: color }}
      >
        {n}
      </span>
      <h2 className="text-[13.5px] font-bold" style={{ color: INK }}>
        {title}
      </h2>
      <span className="h-px flex-1" style={{ background: LINE }} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 pr-3">
      <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </div>
      <div className="truncate text-[12px] font-semibold">{value}</div>
    </div>
  );
}

function Mini({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border px-3 py-1.5" style={{ borderColor: LINE }}>
      <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </div>
      <div className={strong ? "text-[14px] font-bold" : "text-[13px] font-semibold"} style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="grid h-40 place-items-center px-6 text-center text-[11px]" style={{ color: MUTED }}>
      {text}
    </p>
  );
}

/** Indicador com anel de progresso (ring = null mostra só o número). */
function Kpi({
  ring,
  color,
  title,
  value,
  sub,
}: {
  ring: number | null;
  color: string;
  title: string;
  value: string;
  sub: string;
}) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: LINE }}>
      {ring != null && (
        <svg viewBox="0 0 44 44" className="size-11 shrink-0" aria-hidden="true">
          <circle cx="22" cy="22" r={r} fill="none" stroke={LINE} strokeWidth="5" />
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${(c * Math.max(0, Math.min(100, ring))) / 100} ${c}`}
            transform="rotate(-90 22 22)"
          />
        </svg>
      )}
      <div className="min-w-0">
        <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          {title}
        </div>
        <div className="text-[15px] font-bold leading-tight" style={{ color }}>
          {value}
        </div>
        <div className="truncate text-[10px]" style={{ color: MUTED }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

/** Curva suave (Catmull-Rom → Bézier) passando pelos pontos. */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Peso no tempo: curva com área em degradê, rótulo em cada pesagem e meta tracejada. */
function WeightChart({
  points,
  target,
  color,
}: {
  points: { date: string; kg: number }[];
  target: number | null;
  color: string;
}) {
  const W = 500;
  const H = 210;
  const pad = { l: 34, r: 16, t: 22, b: 28 };
  const vals = [...points.map((p) => p.kg), ...(target != null ? [target] : [])];
  const span = Math.max(4, Math.max(...vals) - Math.min(...vals));
  const min = Math.floor(Math.min(...vals) - span * 0.15);
  const max = Math.ceil(Math.max(...vals) + span * 0.15);
  const t0 = new Date(points[0].date).getTime();
  const t1 = Math.max(t0 + 1, new Date(points[points.length - 1].date).getTime());
  const x = (d: string) => pad.l + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((max - v) / (max - min || 1)) * (H - pad.t - pad.b);
  const step = Math.max(1, Math.round((max - min) / 4));
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  const pts = points.map((p) => [x(p.date), y(p.kg)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - pad.b} L${pts[0][0].toFixed(1)},${H - pad.b} Z`;
  const showAll = points.length <= 8;
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const gid = `wg-${color.slice(1)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico de evolução do peso">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <text x={pad.l - 4} y={10} textAnchor="end" fontSize="8.5" fill={MUTED}>
        kg
      </text>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={LINE} strokeDasharray="3 4" />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill={MUTED}>
            {v}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#d1d5db" />
      {target != null && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} stroke={GOOD} strokeDasharray="6 4" strokeWidth={1.5} />
          <rect x={W - pad.r - 78} y={y(target) - 17} width={78} height={14} rx={7} fill={GOOD} />
          <text x={W - pad.r - 39} y={y(target) - 7} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff">
            Meta {target.toLocaleString("pt-BR")} kg
          </text>
        </g>
      )}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => {
        const last = i === points.length - 1;
        const first = i === 0;
        return (
          <g key={i}>
            <circle cx={pts[i][0]} cy={pts[i][1]} r={last ? 5 : 3.5} fill={last ? color : "#fff"} stroke={color} strokeWidth={2} />
            {(showAll || first || last) && (
              <text
                x={pts[i][0]}
                y={pts[i][1] - 9}
                textAnchor={first ? "start" : last ? "end" : "middle"}
                fontSize="9"
                fontWeight={first || last ? 700 : 500}
                fill={INK}
              >
                {p.kg.toLocaleString("pt-BR")}
              </text>
            )}
            {(i % labelEvery === 0 || last) && (
              <text
                x={pts[i][0]}
                y={H - 10}
                textAnchor={first ? "start" : last ? "end" : "middle"}
                fontSize="9"
                fill={MUTED}
              >
                {dtShort(p.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Aplicações por semana (últimas 12): feitas e não realizadas, com o total sobre a barra. */
function UsesChart({ uses, color }: { uses: DbRow[]; color: string }) {
  const weekStart = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const map = new Map<string, { ok: number; miss: number }>();
  for (const u of uses) {
    const k = weekStart(String(u.used_at));
    const v = map.get(k) ?? { ok: 0, miss: 0 };
    if (skipped(u)) v.miss++;
    else v.ok++;
    map.set(k, v);
  }
  const weeks = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const W = 500;
  const H = 165;
  const pad = { l: 24, r: 8, t: 18, b: 28 };
  const max = Math.max(2, ...weeks.map(([, v]) => v.ok + v.miss));
  const slot = (W - pad.l - pad.r) / Math.max(weeks.length, 6);
  const bw = Math.min(30, slot * 0.58);
  const h = (v: number) => ((H - pad.t - pad.b) * v) / max;
  const base = H - pad.b;
  const ticks = [0, Math.round(max / 2), max];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico de aplicações por semana">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={base - h(v)} y2={base - h(v)} stroke={LINE} strokeDasharray={v ? "3 4" : undefined} />
            <text x={pad.l - 6} y={base - h(v) + 3} textAnchor="end" fontSize="9" fill={MUTED}>
              {v}
            </text>
          </g>
        ))}
        {weeks.map(([k, v], i) => {
          const cx = pad.l + slot * i + slot / 2;
          const x = cx - bw / 2;
          const okH = h(v.ok);
          const missH = h(v.miss);
          return (
            <g key={k}>
              {v.ok > 0 && <rect x={x} y={base - okH} width={bw} height={okH} rx={4} fill={color} />}
              {v.miss > 0 && (
                <rect x={x} y={base - okH - missH - (v.ok ? 1.5 : 0)} width={bw} height={missH} rx={4} fill="#f87171" />
              )}
              <text x={cx} y={base - okH - missH - 5} textAnchor="middle" fontSize="9" fontWeight="700" fill={INK}>
                {v.ok + v.miss}
              </text>
              <text x={cx} y={H - 10} textAnchor="middle" fontSize="8.5" fill={MUTED}>
                {dtShort(k)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center gap-4 pl-6 text-[10px]" style={{ color: MUTED }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full" style={{ background: color }} /> Feitas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-red-400" /> Não realizadas
        </span>
        <span>· por semana</span>
      </div>
    </div>
  );
}

/** Rosca do valor pago, com pontas arredondadas e legenda. */
function Donut({ pct, color }: { pct: number; color: string }) {
  const r = 58;
  const c = 2 * Math.PI * r;
  return (
    <div>
      <svg viewBox="0 0 160 160" className="mx-auto w-[150px]" role="img" aria-label={`${pct}% pago`}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="#fde7c3" strokeWidth="18" />
        {pct > 0 && (
          <circle
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={`${(c * pct) / 100} ${c}`}
            transform="rotate(-90 80 80)"
          />
        )}
        <text x="80" y="80" textAnchor="middle" fontSize="28" fontWeight="800" fill={INK}>
          {pct}%
        </text>
        <text x="80" y="98" textAnchor="middle" fontSize="10.5" fill={MUTED}>
          pago
        </text>
      </svg>
      <div className="mt-1 flex justify-center gap-3 text-[10px]" style={{ color: MUTED }}>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full" style={{ background: color }} /> Pago
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full" style={{ background: "#fde7c3" }} /> Em aberto
        </span>
      </div>
    </div>
  );
}

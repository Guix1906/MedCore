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

type ReportData = {
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

function ReportDocument({ data }: { data: ReportData }) {
  const { treatment: t, meds, planTitles, financials, evolutions, statuses, uses, clinic, patient, photos } = data;
  const color = clinic.color ?? "#2c7f86";
  const today = localDate();

  // Prazo
  const total = t.end_date ? days(t.start_date, t.end_date) : Number(t.return_days ?? 90);
  const passed = Math.max(0, days(t.start_date, today));
  const progress = total > 0 ? Math.min(100, Math.round((passed / total) * 100)) : 0;
  const remainingDays = Math.max(0, total - passed);

  // Peso
  const weights = evolutions
    .filter((e) => e.weight_kg != null)
    .map((e) => ({ date: String(e.occurred_on), kg: Number(e.weight_kg) }))
    .reverse();
  const goal = weightGoalOf(t);
  const startKg = goal.initial ?? weights[0]?.kg ?? null;
  if (goal.initial != null && (!weights.length || weights[0].date > String(t.start_date).slice(0, 10)))
    weights.unshift({ date: String(t.start_date).slice(0, 10), kg: goal.initial });
  const currentKg = weights.length ? weights[weights.length - 1].kg : null;
  const lost = startKg != null && currentKg != null ? currentKg - startKg : null;
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
        dose: `${current.dose ?? ""}${current.unit || ""} (sem. ${current._w} de ${sorted[sorted.length - 1]._w})`,
        freq: "Semanal",
        period: "Injetável",
      });
    }
    return rows;
  })();

  const titles = planTitles.filter((x) => x.status !== "cancelado" && !isFreeBalance(x));
  const overdue = titles.filter(
    (x) => x.due_date && x.due_date < today && Number(x.paid_amount || 0) < Number(x.amount || 0),
  );

  const section = "mt-6 break-inside-avoid";
  const h2 = "mb-2 border-b pb-1 text-[13px] font-bold uppercase tracking-wide";
  const card = "rounded-lg border border-neutral-200 p-3";
  const label = "text-[10px] font-semibold uppercase text-neutral-500";
  const value = "text-[15px] font-bold text-neutral-900";

  return (
    <article className="treatment-report bg-white p-8 text-[12px] leading-relaxed text-neutral-800">
      {/* Cabeçalho */}
      <header className="flex items-start justify-between gap-6 border-b-4 pb-4" style={{ borderColor: color }}>
        <div className="flex items-center gap-4">
          <img
            src={clinic.logo ?? "/assets/dr-jonatas-bandeira-logo.png"}
            alt={clinic.name || "Clínica"}
            className="h-14 max-w-[180px] object-contain"
          />
          <div>
            <h1 className="text-[20px] font-bold leading-tight" style={{ color }}>
              Resumo do plano
            </h1>
            <p className="text-neutral-500">{clinic.name}</p>
          </div>
        </div>
        <div className="text-right text-[11px] text-neutral-500">
          Emitido em {dt(today)}
          <div
            className="mt-1 inline-block rounded px-2 py-0.5 text-[11px] font-bold text-white"
            style={{ background: color }}
          >
            {STATUS[t.status] ?? t.status}
          </div>
        </div>
      </header>

      {/* Identificação */}
      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <Info k="Paciente" v={t.patients?.name ?? "—"} />
        <Info k="Plano" v={t.title} />
        <Info
          k="Cidade"
          v={[patient.city, patient.state].filter(Boolean).join(" / ") || "—"}
        />
        <Info k="Médico(a)" v={t.doctors?.name ? `Dr(a). ${t.doctors.name}` : "—"} />
        {t.objective && (
          <div className="col-span-2">
            <Info k="Objetivo" v={t.objective} />
          </div>
        )}
      </section>

      {/* Visão geral */}
      <section className={section}>
        <h2 className={h2} style={{ color, borderColor: color }}>
          Visão geral
        </h2>
        <div className="grid grid-cols-4 gap-2">
          <div className={card}>
            <div className={label}>Início</div>
            <div className={value}>{dt(t.start_date)}</div>
          </div>
          <div className={card}>
            <div className={label}>Término</div>
            <div className={value}>{dt(t.end_date)}</div>
          </div>
          <div className={card}>
            <div className={label}>Próximo retorno</div>
            <div className={value}>{dt(t.next_return_date)}</div>
          </div>
          <div className={card}>
            <div className={label}>Dias restantes</div>
            <div className={value}>{t.status === "em_andamento" ? remainingDays : "—"}</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] font-semibold text-neutral-600">
            <span>Prazo do plano concluído</span>
            <span>
              {progress}% · {passed} de {total} dias
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: color }} />
          </div>
        </div>
      </section>

      {/* Peso */}
      {(weights.length > 0 || goal.target != null) && (
        <section className={section}>
          <h2 className={h2} style={{ color, borderColor: color }}>
            Evolução de peso
          </h2>
          <div className="grid grid-cols-[1fr_190px] gap-3">
            <div className={card}>
              {weights.length >= 2 ? (
                <WeightChart points={weights} target={goal.target} color={color} />
              ) : (
                <p className="py-10 text-center text-neutral-500">
                  Registre pelo menos duas pesagens nas evoluções para ver o gráfico.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Stat label="Peso inicial" v={startKg != null ? kg(startKg) : "—"} />
              <Stat label="Peso atual" v={currentKg != null ? kg(currentKg) : "—"} />
              <Stat label="Meta" v={goal.target != null ? kg(goal.target) : "—"} />
              <Stat
                label="Variação"
                v={lost != null ? `${lost > 0 ? "+" : ""}${kg(lost)}` : "—"}
                tone={lost != null && lost < 0 ? "#059669" : lost ? "#dc2626" : undefined}
              />
              {goalPct != null && (
                <div className={card}>
                  <div className={label}>Meta atingida</div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200">
                    <div className="h-full rounded-full" style={{ width: `${goalPct}%`, background: color }} />
                  </div>
                  <div className="mt-0.5 text-[13px] font-bold">{goalPct}%</div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Aplicações e medicações */}
      <section className={section}>
        <h2 className={h2} style={{ color, borderColor: color }}>
          Medicações e aplicações
        </h2>
        <div className="grid grid-cols-[1fr_190px] gap-3">
          <div className={card}>
            {uses.length > 0 ? (
              <UsesChart uses={uses} color={color} />
            ) : (
              <p className="py-8 text-center text-neutral-500">Nenhuma aplicação registrada ainda.</p>
            )}
          </div>
          <div className="space-y-2">
            <Stat label="Aplicações feitas" v={String(applied.length)} />
            <Stat label="Não realizadas" v={String(missed.length)} tone={missed.length ? "#dc2626" : undefined} />
            <Stat label="Adesão" v={adherence != null ? `${adherence}%` : "—"} />
            {overdueScheduled > 0 && <Stat label="Previstas sem registro" v={String(overdueScheduled)} tone="#d97706" />}
          </div>
        </div>
        {medRows.length > 0 && (
          <table className="mt-3 w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="border-b py-1 pr-2">Medicação</th>
                <th className="border-b py-1 pr-2">Dose</th>
                <th className="border-b py-1 pr-2">Frequência</th>
                <th className="border-b py-1">Período</th>
              </tr>
            </thead>
            <tbody>
              {medRows.map((m, i) => (
                <tr key={i} className="odd:bg-neutral-50">
                  <td className="py-1 pr-2 font-semibold">{m.name}</td>
                  <td className="py-1 pr-2">{m.dose}</td>
                  <td className="py-1 pr-2">{m.freq}</td>
                  <td className="py-1">{m.period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Financeiro */}
      {data.withFinance && financials.total > 0 && (
        <section className={section}>
          <h2 className={h2} style={{ color, borderColor: color }}>
            Financeiro do plano
          </h2>
          <div className="grid grid-cols-[170px_1fr] items-center gap-4">
            <Donut paid={financials.paid} total={financials.total} color={color} />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Valor contratado" v={brl(financials.total)} />
              <Stat label="Desconto" v={brl(Number(t.discount || 0))} />
              <Stat label="Pago" v={brl(financials.paid)} tone="#059669" />
              <Stat label="Em aberto" v={brl(financials.open)} tone={financials.open ? "#d97706" : undefined} />
              <Stat
                label="Parcelas"
                v={`${titles.filter((x) => Number(x.paid_amount || 0) >= Number(x.amount || 0)).length} de ${titles.length} pagas`}
              />
              <Stat
                label="Próximo vencimento"
                v={financials.nextDueDate ? dt(financials.nextDueDate) : "—"}
                tone={overdue.length ? "#dc2626" : undefined}
              />
            </div>
          </div>
          {overdue.length > 0 && (
            <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
              {overdue.length} parcela(s) em atraso.
            </p>
          )}
        </section>
      )}

      {/* Histórico */}
      {(evolutions.length > 0 || statuses.length > 0) && (
        <section className={section}>
          <h2 className={h2} style={{ color, borderColor: color }}>
            Histórico do acompanhamento
          </h2>
          <ul className="space-y-1.5">
            {[
              ...evolutions.slice(0, 6).map((e) => ({
                date: String(e.occurred_on),
                text: `${e.is_return ? "Retorno: " : ""}${e.notes}${e.weight_kg ? ` (peso ${kg(Number(e.weight_kg))})` : ""}${e.next_step ? ` · Próximo passo: ${e.next_step}` : ""}`,
              })),
              ...statuses.slice(0, 4).map((s) => ({
                date: String(s.created_at),
                text: `Plano ${STATUS[s.status]?.toLowerCase() ?? s.status}: ${s.justification}`,
              })),
            ]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((h, i) => (
                <li key={i} className="flex gap-3 break-inside-avoid">
                  <span className="w-16 shrink-0 font-semibold text-neutral-500">{dt(h.date)}</span>
                  <span className="whitespace-pre-wrap">{h.text}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* Fotos */}
      {photos.length > 0 && (
        <section className={section}>
          <h2 className={h2} style={{ color, borderColor: color }}>
            Fotos de evolução
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((p, i) => (
              <figure key={i} className="break-inside-avoid">
                {p.url && <img src={p.url} alt={p.title} className="h-40 w-full rounded object-cover" />}
                <figcaption className="mt-0.5 text-[10px] text-neutral-500">
                  {p.title} · {dt(p.date)}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* Assinatura */}
      <footer className="mt-12 flex items-end justify-between break-inside-avoid">
        <div className="w-64 border-t border-neutral-400 pt-1 text-center text-[11px] text-neutral-600">
          {t.doctors?.name ? `Dr(a). ${t.doctors.name}` : "Responsável"}
        </div>
        <div className="text-[10px] text-neutral-400">Gerado pelo MedCore · {dt(today)}</div>
      </footer>
    </article>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <p>
      <span className="font-semibold text-neutral-500">{k}: </span>
      <span className="font-semibold text-neutral-900">{v}</span>
    </p>
  );
}

function Stat({ label, v, tone }: { label: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-1.5">
      <div className="text-[10px] font-semibold uppercase text-neutral-500">{label}</div>
      <div className="text-[14px] font-bold" style={tone ? { color: tone } : undefined}>
        {v}
      </div>
    </div>
  );
}

/** Linha do peso no tempo, com a meta tracejada. */
function WeightChart({
  points,
  target,
  color,
}: {
  points: { date: string; kg: number }[];
  target: number | null;
  color: string;
}) {
  const W = 480;
  const H = 190;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const vals = [...points.map((p) => p.kg), ...(target != null ? [target] : [])];
  const min = Math.floor(Math.min(...vals) - 1);
  const max = Math.ceil(Math.max(...vals) + 1);
  const t0 = new Date(points[0].date).getTime();
  const t1 = Math.max(t0 + 1, new Date(points[points.length - 1].date).getTime());
  const x = (d: string) => pad.l + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((max - v) / (max - min || 1)) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points[points.length - 1].date).toFixed(1)},${H - pad.b} L${pad.l},${H - pad.b} Z`;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico de evolução do peso">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e5e5e5" />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#737373">
            {v.toFixed(0)}
          </text>
        </g>
      ))}
      {target != null && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} stroke="#059669" strokeDasharray="5 4" strokeWidth={1.5} />
          <text x={W - pad.r} y={y(target) - 4} textAnchor="end" fontSize="9" fontWeight="bold" fill="#059669">
            Meta {target.toLocaleString("pt-BR")} kg
          </text>
        </g>
      )}
      <path d={area} fill={color} opacity={0.1} />
      <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.date)} cy={y(p.kg)} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
          {(i === 0 || i === points.length - 1) && (
            <text x={x(p.date)} y={y(p.kg) - 8} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#262626">
              {p.kg.toLocaleString("pt-BR")}
            </text>
          )}
          {(i % labelEvery === 0 || i === points.length - 1) && (
            <text x={x(p.date)} y={H - 8} textAnchor="middle" fontSize="9" fill="#737373">
              {dtShort(p.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Aplicações por semana (últimas 12): feitas e não realizadas, empilhadas. */
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
  const W = 480;
  const H = 170;
  const pad = { l: 26, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...weeks.map(([, v]) => v.ok + v.miss));
  const bw = (W - pad.l - pad.r) / weeks.length;
  const y = (v: number) => ((H - pad.t - pad.b) * v) / max;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico de aplicações por semana">
        {[0, Math.ceil(max / 2), max].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={H - pad.b - y(v)} y2={H - pad.b - y(v)} stroke="#e5e5e5" />
            <text x={pad.l - 5} y={H - pad.b - y(v) + 3} textAnchor="end" fontSize="9" fill="#737373">
              {v}
            </text>
          </g>
        ))}
        {weeks.map(([k, v], i) => {
          const x = pad.l + i * bw + bw * 0.2;
          const w = bw * 0.6;
          return (
            <g key={k}>
              <rect x={x} y={H - pad.b - y(v.ok)} width={w} height={y(v.ok)} rx={2} fill={color} />
              {v.miss > 0 && (
                <rect x={x} y={H - pad.b - y(v.ok + v.miss)} width={w} height={y(v.miss)} rx={2} fill="#f87171" />
              )}
              <text x={x + w / 2} y={H - 9} textAnchor="middle" fontSize="9" fill="#737373">
                {dtShort(k)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-[10px] text-neutral-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} /> Feitas
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-red-400" /> Não realizadas
        </span>
        <span className="text-neutral-400">por semana</span>
      </div>
    </div>
  );
}

/** Rosca: quanto do valor contratado já foi pago. */
function Donut({ paid, total, color }: { paid: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(1, paid / total) : 0;
  const r = 60;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 160 160" className="w-full" role="img" aria-label="Gráfico pago e em aberto">
      <circle cx="80" cy="80" r={r} fill="none" stroke="#fde68a" strokeWidth="20" />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="20"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 80 80)"
      />
      <text x="80" y="78" textAnchor="middle" fontSize="24" fontWeight="bold" fill="#171717">
        {Math.round(pct * 100)}%
      </text>
      <text x="80" y="96" textAnchor="middle" fontSize="10" fill="#737373">
        pago
      </text>
    </svg>
  );
}

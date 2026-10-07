import { useMutation, useQuery } from "@tanstack/react-query";
import { analyzeTreatmentPlan } from "@/services/ai.service";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Pill,
  Sparkles,
  Stethoscope,
  Syringe,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { DbRow } from "@/lib/types";
import { currency, errorMessage, formatClinicalDate, localDate } from "./followup-utils";
import { useTreatmentMedicationUses } from "./use-treatment-medication-uses";
import { WeightPanel } from "./WeightGoal";

/**
 * Resumo clínico do plano para o médico: peso, adesão às aplicações, última evolução,
 * medicações ativas e pontos de atenção. Tudo vem dos registros do próprio plano.
 */

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);

const skipped = (u: DbRow) => /\[(NÃO TOMOU|SUSPENSA|ADIADA)\]/.test(u.dose || "");
const cleanDose = (raw?: string | null) =>
  (raw || "").replace(/\[(NÃO TOMOU|SUSPENSA|ADIADA)\]/g, "").trim();
const kg = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;

export default function TreatmentSummary({
  treatment,
  meds,
  paymentOverdue,
  onChanged,
}: {
  treatment: DbRow;
  meds: DbRow[];
  paymentOverdue: number;
  /** Recarrega o plano depois de salvar a meta de peso. */
  onChanged: () => void;
}) {
  const id = treatment.id as string;
  // Mesma chave e formato da aba "Evolução & Fotos": o cache é compartilhado
  const history = useQuery({
    queryKey: ["treatment-evolutions", id],
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
  // Análise sob demanda (custa uma chamada à IA): só roda quando o médico clica
  const ai = useMutation({
    mutationFn: () => analyzeTreatmentPlan({ data: { treatmentId: id } }),
  });

  const today = localDate();
  const evolutions = (history.data?.evolutions ?? []) as DbRow[];
  const last = evolutions[0];

  // Peso: primeira e última medida registradas (evoluções vêm da mais recente para a mais antiga)
  const weights = evolutions
    .filter((e) => e.weight_kg !== null && e.weight_kg !== undefined)
    .map((e) => ({ date: String(e.occurred_on), kg: Number(e.weight_kg) }));
  // Base do alerta "peso subiu": peso inicial do plano, ou a primeira medida registrada
  const baseKg =
    treatment.initial_weight_kg != null ? Number(treatment.initial_weight_kg) : weights[weights.length - 1]?.kg;
  const lastKg = weights[0]?.kg;
  const deltaKg =
    baseKg !== undefined && lastKg !== undefined && (treatment.initial_weight_kg != null || weights.length > 1)
      ? lastKg - baseKg
      : null;

  // Aplicações / uso de medicação
  const useList = (uses.data ?? []) as DbRow[];
  const applied = useList.filter((u) => !skipped(u));
  const missed = useList.filter(skipped);
  const lastUse = applied[0];
  const medName = (u?: DbRow) =>
    u ? u.medication_name || meds.find((m) => m.id === u.medication_id)?.name || "Medicação" : "";
  const daysSinceUse = lastUse ? daysBetween(String(lastUse.used_at).slice(0, 10), today) : null;
  const adherence = useList.length ? Math.round((applied.length / useList.length) * 100) : null;

  const activeMeds = meds.filter((m) => m.status === "ativo");
  // Protocolo semanal é salvo como uma linha por semana ("Nome (Sem. 3)"): agrupa num item só,
  // com a faixa de dose e a semana atual
  const medItems = (() => {
    const groups = new Map<string, DbRow[]>();
    const singles: { key: string; name: string; detail: string }[] = [];
    for (const m of activeMeds) {
      const match = String(m.name || "").match(/^(.*)\s+\(Sem\.\s*(\d+)\)$/);
      if (match) groups.set(match[1], [...(groups.get(match[1]) ?? []), { ...m, _week: Number(match[2]) }]);
      else
        singles.push({
          key: m.id,
          name: m.name,
          detail: [m.dose ? `${m.dose}${m.unit || ""}` : "", m.frequency || ""].filter(Boolean).join(" · "),
        });
    }
    const protocols = [...groups.entries()].map(([name, rows]) => {
      const sorted = rows.sort((a, b) => a._week - b._week);
      const mgs = sorted.map((r) => Number(String(r.dose).replace(",", "."))).filter(Number.isFinite);
      const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      const range = mgs.length
        ? Math.min(...mgs) === Math.max(...mgs)
          ? `${fmt(mgs[0])} mg`
          : `${fmt(Math.min(...mgs))} → ${fmt(Math.max(...mgs))} mg`
        : "";
      const current = [...sorted].reverse().find((r) => r.start_date && String(r.start_date) <= today);
      const now = current
        ? `semana ${current._week} de ${sorted[sorted.length - 1]._week} (${fmt(Number(String(current.dose).replace(",", ".")))} mg)`
        : `${sorted.length} semanas, começa ${formatClinicalDate(sorted[0].start_date)}`;
      return { key: name, name, detail: ["Semanal", range, now].filter(Boolean).join(" · ") };
    });
    return [...protocols, ...singles];
  })();
  const returns = evolutions.filter((e) => e.is_return).length;
  const daysSinceEvolution = last ? daysBetween(String(last.occurred_on), today) : null;
  const daysToEnd = treatment.end_date ? daysBetween(today, String(treatment.end_date)) : null;

  // Pontos de atenção: só o que pede ação do médico
  const attention: { text: string; tone: "danger" | "warning" }[] = [];
  if (treatment.status === "em_andamento") {
    if (treatment.next_return_date && treatment.next_return_date < today)
      attention.push({
        text: `Retorno previsto para ${formatClinicalDate(treatment.next_return_date)} está atrasado (${daysBetween(treatment.next_return_date, today)} dias).`,
        tone: "danger",
      });
    if (daysSinceEvolution === null)
      attention.push({ text: "Nenhuma evolução clínica registrada neste plano.", tone: "warning" });
    else if (daysSinceEvolution > 30)
      attention.push({
        text: `Última evolução há ${daysSinceEvolution} dias.`,
        tone: "warning",
      });
    if (daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 14)
      attention.push({
        text: `Protocolo termina em ${daysToEnd} dia(s): avaliar renovação ou alta.`,
        tone: "warning",
      });
    if (daysToEnd !== null && daysToEnd < 0)
      attention.push({ text: `Prazo do protocolo encerrado há ${-daysToEnd} dia(s).`, tone: "danger" });
    const recentMissed = missed.filter(
      (u) => daysBetween(String(u.used_at).slice(0, 10), today) <= 30,
    ).length;
    if (recentMissed > 0)
      attention.push({
        text: `${recentMissed} aplicação(ões) não tomada(s), adiada(s) ou suspensa(s) nos últimos 30 dias.`,
        tone: "warning",
      });
    if (applied.length > 0 && daysSinceUse !== null && daysSinceUse > 10 && activeMeds.some((m) => m.period === "semanal"))
      attention.push({
        text: `Última aplicação registrada há ${daysSinceUse} dias (protocolo semanal).`,
        tone: "warning",
      });
  }
  if (deltaKg !== null && deltaKg > 0 && /emagre/i.test(`${treatment.title} ${treatment.objective ?? ""}`))
    attention.push({ text: `Peso subiu ${kg(deltaKg)} desde o início do plano.`, tone: "warning" });
  if (paymentOverdue > 0)
    attention.push({ text: `Parcela(s) em atraso: ${currency(paymentOverdue)}.`, tone: "warning" });

  const loading = history.isPending || uses.isPending;

  return (
    <div className="rounded-xl border border-border/90 bg-card p-5 shadow-xs md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">Resumo clínico do plano</h3>
            <p className="text-xs text-muted-foreground">
              Peso, aplicações, evoluções e o que precisa de atenção
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {evolutions.length} evolução(ões) · {returns} retorno(s)
          </span>
          <button
            type="button"
            disabled={ai.isPending}
            onClick={() => ai.mutate()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-primary transition hover:bg-primary/5 disabled:opacity-60 cursor-pointer"
          >
            <Sparkles size={13} />
            {ai.isPending ? "Analisando..." : ai.data ? "Atualizar análise" : "Analisar com IA"}
          </button>
        </div>
      </div>

      {/* Análise da IA: lê o plano inteiro (evoluções, peso, meta, aplicações) e resume para o médico */}
      {ai.error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          {errorMessage(ai.error)}
        </p>
      )}
      {ai.data && (
        <section className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-sm">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase text-primary">Análise do plano</h4>
            <span className="text-[11px] text-muted-foreground">
              Gerado por IA · revise antes de usar
            </span>
          </div>
          <p className="leading-relaxed text-foreground">{ai.data.panorama}</p>
          {ai.data.pontosAtencao.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground/80">Atenção</p>
              <ul className="ml-4 list-disc space-y-0.5 text-foreground/90">
                {ai.data.pontosAtencao.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {ai.data.proximoRetorno.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground/80">Para o próximo retorno</p>
              <ul className="ml-4 list-disc space-y-0.5 text-foreground/90">
                {ai.data.proximoRetorno.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Pontos de atenção */}
      {!loading && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            attention.length
              ? "border-warning/30 bg-warning/10"
              : "border-success/25 bg-success/10"
          }`}
        >
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 font-medium text-success">
              <CheckCircle2 size={16} /> Nada pendente: retorno, evoluções e aplicações em dia.
            </p>
          ) : (
            <ul className="space-y-1">
              {attention.map((a) => (
                <li
                  key={a.text}
                  className={`flex items-start gap-2 ${a.tone === "danger" ? "text-destructive" : "text-foreground"}`}
                >
                  <AlertTriangle
                    size={15}
                    className={`mt-0.5 shrink-0 ${a.tone === "danger" ? "text-destructive" : "text-warning"}`}
                  />
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <WeightPanel treatment={treatment} weights={[...weights].reverse()} onChanged={onChanged} />
        </div>

        {/* Aplicações */}
        <section className="rounded-xl border border-border-soft bg-muted/40 p-3.5 space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
            <Syringe size={14} /> Aplicações e adesão
          </h4>
          {useList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma aplicação registrada ainda.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-2xl font-semibold tabular-nums text-foreground">{applied.length}</span>
                <span className="text-sm text-muted-foreground">aplicada(s)</span>
                {missed.length > 0 && (
                  <span className="text-sm font-medium text-warning">{missed.length} não tomada(s)/adiada(s)</span>
                )}
                {adherence !== null && (
                  <span
                    className={`text-sm font-semibold ${adherence >= 90 ? "text-success" : adherence >= 70 ? "text-warning" : "text-destructive"}`}
                  >
                    adesão {adherence}%
                  </span>
                )}
              </div>
              {lastUse && (
                <p className="text-xs text-muted-foreground">
                  Última: <b className="text-foreground">{medName(lastUse)}</b>
                  {cleanDose(lastUse.dose) && ` ${cleanDose(lastUse.dose)}`} em{" "}
                  {new Date(lastUse.used_at).toLocaleDateString("pt-BR")}
                  {daysSinceUse !== null && ` (há ${daysSinceUse} dia${daysSinceUse === 1 ? "" : "s"})`}
                </p>
              )}
            </>
          )}
        </section>

        {/* Última evolução */}
        <section className="rounded-xl border border-border-soft bg-muted/40 p-3.5 space-y-1.5 md:col-span-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
            <ClipboardList size={14} /> Última evolução
            {last && (
              <span className="font-normal normal-case">
                · {formatClinicalDate(last.occurred_on)}
                {last.is_return ? " · retorno realizado" : ""}
              </span>
            )}
          </h4>
          {!last ? (
            <p className="text-sm text-muted-foreground">
              Registre a primeira evolução na aba "Evolução & Fotos".
            </p>
          ) : (
            <>
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-foreground">{last.notes}</p>
              {last.parameters && (
                <p className="text-xs text-muted-foreground">
                  <b className="text-foreground/80">Parâmetros:</b> {last.parameters}
                </p>
              )}
              {last.next_step && (
                <p className="text-xs text-muted-foreground">
                  <b className="text-foreground/80">Próxima conduta:</b> {last.next_step}
                </p>
              )}
            </>
          )}
        </section>

        {/* Medicações ativas */}
        <section className="rounded-xl border border-border-soft bg-muted/40 p-3.5 space-y-1.5 md:col-span-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
            <Pill size={14} /> Medicações ativas ({medItems.length})
          </h4>
          {medItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma medicação ativa no cronograma.</p>
          ) : (
            <ul className="space-y-1">
              {medItems.slice(0, 8).map((m) => (
                <li key={m.key} className="text-sm text-foreground">
                  <b>{m.name}</b>
                  {m.detail && <span className="text-muted-foreground"> · {m.detail}</span>}
                </li>
              ))}
              {medItems.length > 8 && (
                <li className="text-xs text-muted-foreground">+ {medItems.length - 8} na aba Injetáveis</li>
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

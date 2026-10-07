import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Pill,
  Scale,
  Stethoscope,
  Syringe,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { DbRow } from "@/lib/types";
import { currency, formatClinicalDate, localDate } from "./followup-utils";
import { useTreatmentMedicationUses } from "./use-treatment-medication-uses";

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
}: {
  treatment: DbRow;
  meds: DbRow[];
  paymentOverdue: number;
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

  const today = localDate();
  const evolutions = (history.data?.evolutions ?? []) as DbRow[];
  const last = evolutions[0];

  // Peso: primeira e última medida registradas (evoluções vêm da mais recente para a mais antiga)
  const weights = evolutions
    .filter((e) => e.weight_kg !== null && e.weight_kg !== undefined)
    .map((e) => ({ date: String(e.occurred_on), kg: Number(e.weight_kg) }));
  const firstW = weights[weights.length - 1];
  const lastW = weights[0];
  const deltaKg = firstW && lastW && weights.length > 1 ? lastW.kg - firstW.kg : null;
  const deltaPct = deltaKg !== null && firstW.kg > 0 ? (deltaKg / firstW.kg) * 100 : null;
  const trend = weights.slice(0, 6).reverse();

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
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Stethoscope size={18} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">Resumo clínico do plano</h3>
            <p className="text-xs text-muted-foreground">
              Peso, aplicações, evoluções e o que precisa de atenção
            </p>
          </div>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {evolutions.length} evolução(ões) · {returns} retorno(s) realizado(s)
        </span>
      </div>

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
        {/* Peso */}
        <section className="rounded-xl border border-border-soft bg-muted/40 p-3.5 space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
            <Scale size={14} /> Peso
          </h4>
          {weights.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum peso registrado. Informe o peso ao salvar uma evolução.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-2xl font-semibold tabular-nums text-foreground">{kg(lastW.kg)}</span>
                {deltaKg !== null && (
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      deltaKg < 0 ? "text-success" : deltaKg > 0 ? "text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {deltaKg > 0 ? "+" : ""}
                    {kg(deltaKg)}
                    {deltaPct !== null && ` (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%)`}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {firstW && weights.length > 1
                  ? `Início ${kg(firstW.kg)} em ${formatClinicalDate(firstW.date)} · última medida ${formatClinicalDate(lastW.date)}`
                  : `Medido em ${formatClinicalDate(lastW.date)}`}
              </p>
              {trend.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {trend.map((w) => (
                    <span
                      key={w.date + w.kg}
                      className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground"
                      title={formatClinicalDate(w.date)}
                    >
                      {w.date.slice(8, 10)}/{w.date.slice(5, 7)} · {kg(w.kg)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

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
            <Pill size={14} /> Medicações ativas ({activeMeds.length})
          </h4>
          {activeMeds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma medicação ativa no cronograma.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {activeMeds.slice(0, 8).map((m) => (
                <li key={m.id} className="truncate text-sm text-foreground">
                  <b>{m.name}</b>
                  <span className="text-muted-foreground">
                    {m.dose ? ` · ${m.dose}${m.unit || ""}` : ""}
                    {m.frequency ? ` · ${m.frequency}` : ""}
                  </span>
                </li>
              ))}
              {activeMeds.length > 8 && (
                <li className="text-xs text-muted-foreground">+ {activeMeds.length - 8} na aba Injetáveis</li>
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

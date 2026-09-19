import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { currency, errorMessage, localDate } from "@/features/acompanhamentos/followup-utils";
import type { FinanceSnapshot } from "./finance-schema";
import type { CashFlowSnapshot } from "./cash-flow-schema";
import type { OperationsSnapshot } from "./operations-schema";
import { DFC_LABELS, DRE_LABELS, managementReports } from "./operations-math";
import OperationForm, { Field, Reason, fieldClass, formText } from "./OperationForm";

export default function ManagementReports({
  finance,
  ops,
  cash,
}: {
  finance: FinanceSnapshot;
  ops: OperationsSnapshot;
  cash: CashFlowSnapshot;
}) {
  const [start, setStart] = useState(localDate().slice(0, 7) + "-01");
  const [end, setEnd] = useState(localDate());
  let report: ReturnType<typeof managementReports> | undefined;
  let failure = "";
  try {
    report = managementReports(finance, ops, cash, start, end);
  } catch (error) {
    failure = errorMessage(error);
  }
  const pending = new Set([
    ...(report?.missingCompetence ?? []),
    ...(report?.missingClassification ?? []),
  ]);
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">
        Demonstrativos gerenciais, nao substituem escrituracao contabil. DRE usa competencia do
        titulo, mesmo pendente; DFC usa disponibilidade efetiva. Recebiveis de cartao nao sao
        dinheiro em banco. Classificar nao gera movimentacao.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          De
          <input
            className={fieldClass}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Ate
          <input
            className={fieldClass}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {failure && (
        <p role="alert" className="text-red-700">
          {failure}
        </p>
      )}
      {report && (
        <>
          {(!report.completeDre || !report.completeDfc) && (
            <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">
              Demonstrativo incompleto: {report.missingCompetence.length} titulo(s) sem competencia
              (qualquer periodo), {report.missingClassification.length} sem classificacao no
              periodo, {report.missingCash.length} movimento(s) sem classificacao e{" "}
              {report.unassigned.length} baixa(s) sem conta classificada. Totais parciais nao
              representam resultado definitivo.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border bg-white p-4 space-y-2">
              <h3 className="font-bold">
                DRE por competencia {report.completeDre ? "" : "(parcial)"}
              </h3>
              {Object.entries(DRE_LABELS)
                .filter(([key]) => key !== "excluded")
                .map(([key, label]) => (
                  <p key={key} className="flex justify-between">
                    <span>{label}</span>
                    <span>{currency(report.dre[key as keyof typeof report.dre] / 100)}</span>
                  </p>
                ))}
              <p>Receita liquida: {currency(report.netRevenue / 100)}</p>
              <p>Resultado bruto: {currency(report.grossResult / 100)}</p>
              <p>Resultado operacional: {currency(report.operatingResult / 100)}</p>
              <p className="font-semibold">
                Resultado liquido:{" "}
                {report.completeDre
                  ? currency(report.netResult / 100)
                  : "Pendente de classificacao"}
              </p>
              <p className="text-xs">
                Patrimonial fora da DRE: {currency(report.dre.excluded / 100)}
              </p>
            </section>
            <section className="rounded-xl border bg-white p-4 space-y-2">
              <h3 className="font-bold">DFC direta {report.completeDfc ? "" : "(parcial)"}</h3>
              {Object.entries(DFC_LABELS).map(([key, label]) => (
                <p key={key} className="flex justify-between">
                  <span>{label}</span>
                  <span>{currency(report.dfc[key as keyof typeof report.dfc] / 100)}</span>
                </p>
              ))}
              <p>Nao classificado: {currency(report.unclassifiedCash / 100)}</p>
              <p>Transferencias internas liquidas: {currency(report.internalTransfers / 100)}</p>
              <p className="font-semibold">
                Variacao registrada da disponibilidade: {currency(report.cashChange / 100)}
              </p>
              <p className="text-xs">
                Saldos de abertura e fechamento estao no Fluxo de caixa. Transferencias entre contas
                disponiveis se anulam; liquidacao de cartao inclui recebimento bruto e taxa, sem
                repetir a receita na DRE.
              </p>
            </section>
          </div>
          {pending.size > 0 && (
            <details>
              <summary>Titulos que precisam de conferencia ({pending.size})</summary>
              <ul className="space-y-1 text-sm">
                {finance.titles
                  .filter((t) => pending.has(t.id))
                  .map((t) => (
                    <li key={t.id}>
                      {t.description} - {currency(t.amount)} -{" "}
                      {t.competence_date ?? "Sem competencia"} - {t.id}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}
      {ops.can_manage && (
        <OperationForm
          title="Classificar titulo / corrigir competencia"
          execute={(f) =>
            supabase.rpc("classify_financial_title", {
              p_id: formText(f, "title"),
              p_competence: formText(f, "date"),
              p_dre: formText(f, "dre"),
              p_dfc: formText(f, "dfc"),
              p_reason: formText(f, "reason"),
            })
          }
        >
          <Field
            name="title"
            label="Titulo"
            options={finance.titles
              .filter((t) => t.status !== "cancelado")
              .map((t) => ({
                id: t.id,
                name: `${t.type}: ${t.description} - ${currency(t.amount)} [${t.id.slice(0, 8)}]`,
              }))}
          />
          <Field name="date" label="Competencia confirmada" type="date" />
          <Field
            name="dre"
            label="Grupo DRE"
            options={Object.entries(DRE_LABELS).map(([id, name]) => ({ id, name }))}
          />
          <Field
            name="dfc"
            label="Atividade DFC"
            options={Object.entries(DFC_LABELS).map(([id, name]) => ({ id, name }))}
          />
          <Reason />
        </OperationForm>
      )}
    </section>
  );
}

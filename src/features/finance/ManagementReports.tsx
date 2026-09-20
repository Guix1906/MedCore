import { useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  currency,
  errorMessage,
  localDate,
  formatClinicalDate,
} from "@/features/acompanhamentos/followup-utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { FinanceSnapshot } from "./finance-schema";
import type { CashFlowSnapshot } from "./cash-flow-schema";
import type { OperationsSnapshot } from "./operations-schema";
import { DFC_LABELS, DRE_LABELS, managementReports } from "./operations-math";
import { availableCashFlow } from "./available-cash-flow";
import { exportFinanceCsv } from "./export-csv";
import OperationForm, { Field, Reason, fieldClass, formText } from "./OperationForm";

type ReportRow = { label: string; amount: number | null; groups?: string[]; subtotal?: boolean };
export default function ManagementReports({
  finance,
  ops,
  cash,
  mode,
  onSelectTitle,
}: {
  finance: FinanceSnapshot;
  ops: OperationsSnapshot;
  cash: CashFlowSnapshot;
  mode: "dre" | "dfc";
  onSelectTitle: (id: string) => void;
}) {
  const [start, setStart] = useState(localDate().slice(0, 7) + "-01");
  const [end, setEnd] = useState(localDate());
  const [detail, setDetail] = useState<ReportRow | null>(null);
  let report: ReturnType<typeof managementReports> | undefined;
  let flow: ReturnType<typeof availableCashFlow> | undefined;
  let failure = "";
  try {
    report = managementReports(finance, ops, cash, start, end);
    if (mode === "dfc") {
      flow = availableCashFlow(cash, ops, start, end);
      if (flow.income - flow.expense !== report.cashChange)
        throw new Error("DFC e Fluxo de Caixa divergentes. Atualize e confira os registros.");
    }
  } catch (error) {
    failure = errorMessage(error);
  }
  const pending = new Set([
    ...(report?.missingCompetence ?? []),
    ...(report?.missingClassification ?? []),
  ]);
  const complete = mode === "dre" ? report?.completeDre : report?.completeDfc && flow?.complete;
  const rows: ReportRow[] = !report
    ? []
    : mode === "dre"
      ? [
          { label: "Receita bruta", amount: report.dre.revenue, groups: ["revenue"] },
          {
            label: "(-) Deduções da receita",
            amount: report.dre.deductions,
            groups: ["deductions"],
          },
          {
            label: "(=) Receita líquida",
            amount: report.netRevenue,
            subtotal: true,
            groups: ["revenue", "deductions"],
          },
          { label: "(-) Custos dos serviços", amount: report.dre.costs, groups: ["costs"] },
          {
            label: "(=) Resultado bruto",
            amount: report.grossResult,
            subtotal: true,
            groups: ["revenue", "deductions", "costs"],
          },
          {
            label: "(-) Despesas operacionais",
            amount: report.dre.operating,
            groups: ["operating"],
          },
          {
            label: "(=) Resultado operacional",
            amount: report.operatingResult,
            subtotal: true,
            groups: ["revenue", "deductions", "costs", "operating"],
          },
          {
            label: "(+) Receitas financeiras",
            amount: report.dre.financial_income,
            groups: ["financial_income"],
          },
          {
            label: "(-) Despesas financeiras",
            amount: report.dre.financial_expense,
            groups: ["financial_expense"],
          },
          { label: "(-) Tributos sobre o resultado", amount: report.dre.taxes, groups: ["taxes"] },
          {
            label: "(=) Resultado líquido",
            amount: report.completeDre ? report.netResult : null,
            subtotal: true,
            groups: Object.keys(DRE_LABELS).filter((key) => key !== "excluded"),
          },
        ]
      : [
          {
            label: "Saldo inicial de caixa e bancos",
            amount: flow?.opening ?? null,
            subtotal: true,
          },
          { label: "Atividades operacionais", amount: report.dfc.operating, groups: ["operating"] },
          {
            label: "Atividades de investimento",
            amount: report.dfc.investing,
            groups: ["investing"],
          },
          {
            label: "Atividades de financiamento",
            amount: report.dfc.financing,
            groups: ["financing"],
          },
          {
            label: "Movimentos sem classificação",
            amount: report.unclassifiedCash,
            groups: ["unclassified"],
          },
          { label: "Transferências internas líquidas", amount: report.internalTransfers },
          {
            label: "Variação líquida do período",
            amount: report.cashChange,
            subtotal: true,
            groups: ["operating", "investing", "financing", "unclassified"],
          },
          { label: "Saldo final de caixa e bancos", amount: flow?.closing ?? null, subtotal: true },
        ];
  const titleDetails = report?.dreDetails.filter((d) => detail?.groups?.includes(d.group)) ?? [];
  const cashDetails = report?.dfcDetails.filter((d) => detail?.groups?.includes(d.group)) ?? [];
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{mode === "dre" ? "DRE" : "DFC"}</h1>
          <p className="text-sm text-slate-500">
            {mode === "dre"
              ? "Resultado por competência, independente do pagamento."
              : "Variação do dinheiro disponível por atividade."}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!report || !!failure}
          onClick={() =>
            exportFinanceCsv(`${mode}-${start}-${end}.csv`, [
              [mode.toUpperCase(), start, end],
              ["Clínica", finance.scopes[0]?.name ?? ""],
              ["Situação", complete ? "Completo" : "Parcial - há pendências"],
              ["Grupo", "Valor"],
              ...rows.map((r) => [r.label, r.amount === null ? null : r.amount / 100]),
            ])
          }
        >
          <Download size={16} />
          Exportar
        </Button>
      </header>
      <div className="flex gap-3 rounded-xl border bg-white p-3">
        <label className="text-sm">
          {mode === "dre" ? "Competência de" : "Período de"}
          <input
            className={fieldClass}
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setDetail(null);
            }}
          />
        </label>
        <label className="text-sm">
          Até
          <input
            className={fieldClass}
            type="date"
            min={start}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setDetail(null);
            }}
          />
        </label>
      </div>
      {failure && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
          {failure}
        </p>
      )}
      {report && !failure && (
        <>
          {!complete && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Demonstrativo parcial.{" "}
              {mode === "dre"
                ? `${report.missingCompetence.length} conta(s) sem competência e ${report.missingClassification.length} sem classificação no período.`
                : `${report.missingCash.length} movimento(s) sem classificação, ${report.unassigned.length} pagamento(s) sem conta classificada.${!flow?.complete ? " Confira também os saldos de abertura em Configurações." : ""}`}{" "}
              Os valores não representam um demonstrativo definitivo.
            </p>
          )}
          <div className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 text-left font-medium text-slate-500">
                    {mode === "dre" ? "Resultado gerencial" : "Fluxos de caixa"}
                  </th>
                  <th className="p-3 text-right font-medium text-slate-500">
                    {complete ? "Valor" : "Valor parcial"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className={`border-t ${row.subtotal ? "bg-slate-50 font-semibold" : ""}`}
                  >
                    <td className="px-4 py-3">{row.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.groups && row.amount !== null ? (
                        <button
                          className="hover:text-primary hover:underline"
                          onClick={() => setDetail(row)}
                          aria-label={`Ver composição de ${row.label}`}
                        >
                          {currency(row.amount / 100)}
                        </button>
                      ) : row.amount === null ? (
                        "Pendente"
                      ) : (
                        currency(row.amount / 100)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Demonstrativo gerencial; não substitui a escrituração contábil. Clique nos valores para
            conferir a composição.{" "}
            {mode === "dre"
              ? "Renegociar vencimentos não deve alterar a competência dos serviços."
              : "Cartões pendentes de depósito não são disponibilidade. Transferências entre caixa e bancos se anulam."}
          </p>
          {pending.size > 0 && (
            <details className="rounded-lg border bg-white p-3">
              <summary className="cursor-pointer text-sm">
                Revisar {pending.size} conta(s) sem competência ou classificação
              </summary>
              <ul className="mt-3 space-y-2 text-sm">
                {finance.titles
                  .filter((t) => pending.has(t.id))
                  .map((t) => (
                    <li key={t.id}>
                      <button
                        className="text-primary underline"
                        onClick={() => onSelectTitle(t.id)}
                      >
                        {t.description} · {currency(t.amount)}
                      </button>{" "}
                      ·{" "}
                      {t.competence_date
                        ? formatClinicalDate(t.competence_date)
                        : "Sem competência"}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}
      {ops.can_manage && (
        <details className="rounded-lg border bg-white p-3">
          <summary className="cursor-pointer text-sm">Revisar classificação e competência</summary>
          <div className="mt-3">
            <OperationForm
              title="Classificar conta"
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
                label="Conta"
                options={finance.titles
                  .filter((t) => t.status !== "cancelado")
                  .map((t) => ({
                    id: t.id,
                    name: `${t.description} · ${currency(t.amount)} · ${t.id.slice(0, 8)}`,
                  }))}
              />
              <Field name="date" label="Competência confirmada" type="date" />
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
          </div>
        </details>
      )}
      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{detail?.label}</SheetTitle>
            <SheetDescription>
              Composição no período selecionado. Valores de cartão são separados em bruto e taxa.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {mode === "dre"
              ? titleDetails.map((d) => (
                  <button
                    key={d.id}
                    className="block w-full rounded-lg border p-3 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setDetail(null);
                      onSelectTitle(d.id);
                    }}
                  >
                    <p>{d.description}</p>
                    <p>
                      {formatClinicalDate(d.date)} · {currency(d.amount / 100)}
                    </p>
                  </button>
                ))
              : cashDetails.map((d, i) => (
                  <div
                    key={`${d.entryId}:${d.titleId}:${i}`}
                    className="rounded-lg border p-3 text-sm"
                  >
                    <p>
                      {finance.titles.find((t) => t.id === d.titleId)?.description ||
                        "Movimento sem classificação"}
                    </p>
                    <p>
                      {formatClinicalDate(d.date)} · {currency(d.amount / 100)}
                    </p>
                    {d.titleId && (
                      <button
                        className="text-primary underline"
                        onClick={() => {
                          setDetail(null);
                          onSelectTitle(d.titleId!);
                        }}
                      >
                        Ver conta e histórico
                      </button>
                    )}
                  </div>
                ))}
            {(mode === "dre" ? titleDetails : cashDetails).length === 0 && (
              <p className="text-sm text-slate-500">Nenhum registro neste grupo.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

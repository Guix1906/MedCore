import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { currency, errorMessage } from "@/features/acompanhamentos/followup-utils";
import type { FinanceSnapshot } from "./finance-schema";
import type { OperationsSnapshot, StatementLine } from "./operations-schema";
import { parseStatementCsv } from "./operations-math";
import OperationForm, {
  Field,
  Reason,
  OperationInputError,
  fieldClass,
  formText,
} from "./OperationForm";

export default function BankReconciliation({
  finance,
  ops,
}: {
  finance: FinanceSnapshot;
  ops: OperationsSnapshot;
}) {
  const [account, setAccount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const active = ops.matches.filter((m) => !m.reversed_at);
  const accounts = finance.accounts.filter((a) => a.balance_kind === "available");
  const inScope = (entry: { account_id: string; date: string }) =>
    (!account || entry.account_id === account) &&
    (!start || entry.date >= start) &&
    (!end || entry.date <= end);
  const lines = ops.lines.filter(inScope);
  const entries = ops.entries
    .filter(inScope)
    .filter(
      (e) => !active.some((m) => m.source_kind === e.source_kind && m.source_id === e.source_id),
    );
  const pending = lines.filter((l) => !active.some((m) => m.line_id === l.id));
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">
        Conferencia manual: importar extrato nao cria receitas, despesas ou baixas. Vinculos exigem
        conta, data e valor identicos; nenhuma correspondencia e presumida. Depositos de cartao usam
        o liquido apos a taxa. Divergencias ficam pendentes.
      </p>
      {ops.can_manage && (
        <OperationForm
          title="Importar extrato CSV"
          execute={async (f) => {
            let lines: StatementLine[];
            try {
              const file = f.get("file");
              if (!(file instanceof File) || file.size > 2_000_000)
                throw new Error("Selecione um CSV de ate 2 MB.");
              lines = parseStatementCsv(await file.text());
            } catch (error) {
              throw new OperationInputError(errorMessage(error));
            }
            return supabase.rpc("import_financial_statement", {
              p_account: formText(f, "account"),
              p_lines: lines,
            });
          }}
        >
          <Field name="account" label="Conta do extrato" options={accounts} />
          <label className="text-sm">
            Arquivo CSV
            <input name="file" type="file" accept=".csv,text/csv" required className={fieldClass} />
          </label>
          <p className="text-xs sm:col-span-2">
            Cabecalho: external_id,date,amount,description. Data AAAA-MM-DD; valor com ponto
            decimal, negativo para saida. Use o identificador estavel do banco. Exemplo:
            FIT123,2026-09-19,97.00,Deposito cartao. Reimportar os mesmos identificadores nao
            duplica linhas. OFX deve ser convertido para este formato.
          </p>
        </OperationForm>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          Conta
          <select
            className={fieldClass}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Todas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
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
      {start && end && start > end ? (
        <p role="alert">Periodo invalido.</p>
      ) : (
        <>
          <p>
            {pending.length} linha(s) do extrato sem vinculo; {entries.length} movimento(s)
            interno(s) sem conciliacao nos filtros.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Data / conta</th>
                  <th>Referencia</th>
                  <th>Valor</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2">
                      {l.date} / {finance.accounts.find((a) => a.id === l.account_id)?.name}
                    </td>
                    <td>
                      {l.external_id} - {l.description}
                    </td>
                    <td>{currency(l.amount)}</td>
                    <td>{active.some((m) => m.line_id === l.id) ? "Conciliado" : "Pendente"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ops.can_manage && (
            <OperationForm
              title="Vincular linha ao movimento conferido"
              execute={(f, id) => {
                const [kind, source] = formText(f, "entry").split(":");
                return supabase.rpc("reconcile_financial_entry", {
                  p_id: id,
                  p_line: formText(f, "line"),
                  p_kind: kind,
                  p_source: source,
                  p_reason: formText(f, "reason"),
                });
              }}
            >
              <Field
                name="line"
                label="Linha pendente do banco"
                options={pending.map((l) => ({
                  id: l.id,
                  name: `${l.date} ${currency(l.amount)} ${l.external_id}`,
                }))}
              />
              <Field
                name="entry"
                label="Movimento interno sem vinculo"
                options={entries.map((e) => ({
                  id: `${e.source_kind}:${e.source_id}`,
                  name: `${e.date} ${currency(e.amount)} ${e.description} [${e.source_id.slice(0, 8)}]`,
                }))}
              />
              <Reason />
            </OperationForm>
          )}
        </>
      )}
      {ops.can_manage && (
        <OperationForm
          title="Desfazer vinculo incorreto (preserva historico)"
          execute={(f) =>
            supabase.rpc("reverse_financial_reconciliation", {
              p_id: formText(f, "match"),
              p_reason: formText(f, "reason"),
            })
          }
        >
          <Field
            name="match"
            label="Conciliacao ativa"
            options={active.map((m) => ({
              id: m.id,
              name: `${ops.lines.find((l) => l.id === m.line_id)?.external_id} - ${m.reason}`,
            }))}
          />
          <Reason />
        </OperationForm>
      )}
      <details>
        <summary>Historico de conciliacoes ({ops.matches.length})</summary>
        {ops.matches.map((m) => (
          <p key={m.id} className="text-sm">
            {ops.lines.find((l) => l.id === m.line_id)?.external_id} -{" "}
            {m.reversed_at ? `Desfeita: ${m.reversal_reason}` : "Ativa"} - {m.reason} - Autor:{" "}
            {m.created_by}
          </p>
        ))}
      </details>
    </section>
  );
}

import { useContext, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  currency,
  errorMessage,
  formatClinicalDate,
} from "@/features/acompanhamentos/followup-utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import type { OperationsSnapshot } from "./operations-schema";
import { cents } from "./finance-math";
import { readOfxFile } from "./ofx";
import OperationForm, {
  Field,
  Reason,
  OperationInputError,
  OperationLock,
  fieldClass,
  formText,
} from "./OperationForm";

export default function BankReconciliation({
  finance,
  ops,
  onOpenTitles,
}: {
  finance: FinanceSnapshot;
  ops: OperationsSnapshot;
  onOpenTitles: (type: FinancialTitle["type"]) => void;
}) {
  const { active: locked } = useContext(OperationLock);
  const [account, setAccount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState("pending");
  const [importing, setImporting] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof readOfxFile>> | null>(null);
  const [failure, setFailure] = useState("");
  const [selected, setSelected] = useState("");
  const generation = useRef(0);
  const accounts = finance.accounts.filter(
    (a) => a.balance_kind === "available" && a.type !== "caixa",
  );
  const active = ops.matches.filter((m) => !m.reversed_at);
  const matchFor = (id: string) => active.find((m) => m.line_id === id);
  const available = ops.entries.filter(
    (e) => !active.some((m) => m.source_kind === e.source_kind && m.source_id === e.source_id),
  );
  const candidates = (line: OperationsSnapshot["lines"][number]) =>
    available.filter(
      (e) =>
        e.account_id === line.account_id &&
        e.date === line.date &&
        cents(e.amount) === cents(line.amount),
    );
  const scoped = ops.lines.filter(
    (l) =>
      (!account || l.account_id === account) &&
      (!start || l.date >= start) &&
      (!end || l.date <= end),
  );
  const pending = scoped.filter((l) => !matchFor(l.id));
  const suggested = pending.filter((l) => candidates(l).length > 0);
  const lines = scoped.filter(
    (l) =>
      status === "all" ||
      (status === "matched"
        ? !!matchFor(l.id)
        : status === "suggested"
          ? !matchFor(l.id) && candidates(l).length > 0
          : status === "unmatched"
            ? !matchFor(l.id) && candidates(l).length === 0
            : !matchFor(l.id)),
  );
  const line = ops.lines.find((l) => l.id === selected);
  const match = line ? matchFor(line.id) : undefined;
  const validRange = !start || !end || start <= end;
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Conciliação OFX</h1>
          <p className="text-sm text-slate-500">
            Compare o extrato bancário com os movimentos registrados.
          </p>
        </div>
        {ops.can_manage && (
          <Button
            disabled={!!locked}
            onClick={() => {
              setImporting(true);
              setPreview(null);
              setFailure("");
            }}
          >
            <Upload size={16} />
            Importar OFX
          </Button>
        )}
      </header>
      <div className="flex flex-wrap gap-3 rounded-xl border bg-white p-3">
        <label className="min-w-48 text-sm">
          Conta bancária
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
        <label className="text-sm">
          De
          <input
            className={fieldClass}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Até
          <input
            className={fieldClass}
            type="date"
            min={start}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Situação
          <select className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pendentes</option>
            <option value="suggested">Com sugestão</option>
            <option value="matched">Conciliados</option>
            <option value="unmatched">Sem correspondência</option>
            <option value="all">Todas</option>
          </select>
        </label>
      </div>
      {!validRange ? (
        <p role="alert" className="text-red-700">
          Período inválido.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Pendentes", pending.length],
              ["Com sugestão", suggested.length],
              ["Conciliados", scoped.length - pending.length],
              ["Sem correspondência", pending.length - suggested.length],
            ].map(([label, count]) => (
              <div key={label} className="rounded-xl border bg-white px-4 py-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-semibold">{count}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Resumo da conta e período. Sugestões e sem correspondência são partes das pendências.
            Importar não cria receitas, despesas ou pagamentos. Sugestões nunca são confirmadas
            automaticamente.
          </p>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Extrato bancário", "Valor", "Registro do sistema", "Situação", "Ação"].map(
                    (label) => (
                      <th key={label} className="p-3 font-medium text-slate-500">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const m = matchFor(l.id);
                  const suggestions = candidates(l);
                  const entry = m
                    ? ops.entries.find(
                        (e) => e.source_kind === m.source_kind && e.source_id === m.source_id,
                      )
                    : suggestions.length === 1
                      ? suggestions[0]
                      : undefined;
                  return (
                    <tr className="border-t" key={l.id}>
                      <td className="p-3">
                        <p>
                          {formatClinicalDate(l.date)} ·{" "}
                          {finance.accounts.find((a) => a.id === l.account_id)?.name}
                        </p>
                        <p>{l.description}</p>
                        <p className="text-xs text-slate-400">{l.external_id}</p>
                      </td>
                      <td className="p-3 tabular-nums">{currency(l.amount)}</td>
                      <td className="p-3">
                        {entry ? (
                          <>
                            <p>{entry.description}</p>
                            <p className="text-xs text-slate-500">
                              {formatClinicalDate(entry.date)} · {currency(entry.amount)}
                            </p>
                          </>
                        ) : suggestions.length > 1 ? (
                          `${suggestions.length} candidatos: escolha após conferir`
                        ) : (
                          "Sem correspondência exata"
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        {m ? "Conciliado" : suggestions.length ? "Com sugestão" : "Pendente"}
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!locked}
                          onClick={() => setSelected(l.id)}
                        >
                          {m ? "Detalhes" : ops.can_manage ? "Conferir" : "Detalhes"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {lines.length === 0 && (
              <p className="p-8 text-center text-sm text-slate-500">
                Nenhuma linha para os filtros selecionados.
              </p>
            )}
          </div>
        </>
      )}
      <Dialog
        open={importing}
        onOpenChange={(open) => {
          if (!open && !locked && !reading) {
            setImporting(false);
            generation.current++;
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Importar extrato OFX</DialogTitle>
            <DialogDescription>
              Até 2 MB e 1.000 movimentos, de uma única conta em BRL. Reimportações idênticas não
              duplicam movimentos.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            Arquivo OFX
            <input
              type="file"
              accept=".ofx,application/x-ofx"
              disabled={!!locked || reading}
              className={fieldClass}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                const current = ++generation.current;
                setPreview(null);
                setFailure("");
                if (!file) return;
                setReading(true);
                try {
                  const parsed = await readOfxFile(file);
                  if (parsed.lines.some((l) => l.date > ops.business_date))
                    throw new Error("O extrato contém movimentos futuros. Confira o arquivo.");
                  if (current === generation.current) setPreview(parsed);
                } catch (error) {
                  if (current === generation.current) setFailure(errorMessage(error));
                } finally {
                  if (current === generation.current) setReading(false);
                }
              }}
            />
          </label>
          {reading && <p role="status">Lendo extrato...</p>}
          {failure && (
            <p role="alert" className="text-sm text-red-700">
              {failure}
            </p>
          )}
          {preview && (
            <OperationForm
              title="Conferir e importar"
              onSuccess={() => {
                setImporting(false);
                setPreview(null);
              }}
              execute={(form) => {
                if (!preview) throw new OperationInputError("Selecione e confira o arquivo.");
                return supabase.rpc("import_financial_statement", {
                  p_account: formText(form, "account"),
                  p_lines: preview.lines,
                });
              }}
            >
              <div className="rounded-lg bg-slate-50 p-3 text-sm sm:col-span-2">
                <p>
                  Banco: {preview.bank || "Não informado"} · Conta do arquivo: {preview.account}
                </p>
                <p>
                  {preview.lines.length} movimentos ·{" "}
                  {formatClinicalDate(
                    [...preview.lines].sort((a, b) => a.date.localeCompare(b.date))[0].date,
                  )}{" "}
                  a{" "}
                  {formatClinicalDate(
                    [...preview.lines].sort((a, b) => b.date.localeCompare(a.date))[0].date,
                  )}
                </p>
                <p>Confira se a conta selecionada corresponde à conta do arquivo.</p>
              </div>
              <Field
                name="account"
                label="Conta bancária no sistema"
                value={account}
                options={accounts.filter((a) => a.active)}
              />
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" required name="confirmed" />
                Conferi a conta, o período e a origem do arquivo.
              </label>
            </OperationForm>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!line}
        onOpenChange={(open) => {
          if (!open && !locked) setSelected("");
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {match ? "Conciliação registrada" : "Conferir correspondência"}
            </DialogTitle>
            <DialogDescription>
              {line
                ? `${formatClinicalDate(line.date)} · ${currency(line.amount)} · ${line.description}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {line &&
            (match ? (
              <>
                <p className="text-sm">Referência: {match.reason}</p>
                <p className="text-xs text-slate-500">Autor: {match.created_by}</p>
                {ops.can_manage && (
                  <details>
                    <summary className="cursor-pointer text-sm text-red-700">
                      Desfazer conciliação incorreta
                    </summary>
                    <OperationForm
                      title="Preservar histórico e desfazer vínculo"
                      onSuccess={() => setSelected("")}
                      execute={(f) =>
                        supabase.rpc("reverse_financial_reconciliation", {
                          p_id: match.id,
                          p_reason: formText(f, "reason"),
                        })
                      }
                    >
                      <Reason />
                    </OperationForm>
                  </details>
                )}
              </>
            ) : candidates(line).length > 0 && ops.can_manage ? (
              <OperationForm
                key={line.id}
                title="Vincular movimento conferido"
                onSuccess={() => setSelected("")}
                execute={(f, id) => {
                  const [kind, source] = formText(f, "entry").split(":");
                  return supabase.rpc("reconcile_financial_entry", {
                    p_id: id,
                    p_line: line.id,
                    p_kind: kind,
                    p_source: source,
                    p_reason: formText(f, "reason"),
                  });
                }}
              >
                <Field
                  name="entry"
                  label="Movimento com mesma conta, data e valor"
                  options={candidates(line).map((e) => ({
                    id: `${e.source_kind}:${e.source_id}`,
                    name: `${e.description || e.source_kind} · ${currency(e.amount)} · ${e.source_id.slice(0, 8)}`,
                  }))}
                />
                <Reason />
              </OperationForm>
            ) : (
              <div className="space-y-3 text-sm">
                <p>
                  Não há movimento disponível com a mesma conta, data e valor. Confira pagamentos,
                  transferências e depósitos de cartão antes de criar outro registro. Depósitos
                  agrupados não devem ser forçados contra um recebimento individual.
                </p>
                <Button
                  variant="outline"
                  disabled={!!locked}
                  onClick={() => {
                    setSelected("");
                    onOpenTitles(line.amount > 0 ? "receita" : "despesa");
                  }}
                >
                  Localizar conta a {line.amount > 0 ? "receber" : "pagar"}
                </Button>
              </div>
            ))}
        </DialogContent>
      </Dialog>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-500">Histórico de vínculos desfeitos</summary>
        {ops.matches
          .filter((m) => m.reversed_at && scoped.some((l) => l.id === m.line_id))
          .map((m) => (
            <p key={m.id} className="mt-2">
              {ops.lines.find((l) => l.id === m.line_id)?.external_id} · {m.reversal_reason} · Autor
              do vínculo: {m.created_by}
            </p>
          ))}
      </details>
    </section>
  );
}

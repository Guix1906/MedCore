import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import TreatmentFinance from "@/features/acompanhamentos/TreatmentFinance";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
  moneyCents,
} from "@/features/acompanhamentos/followup-utils";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { financialSummary, isFreeBalance, remaining, titleStatus } from "@/features/finance/finance-math";
import type { FinanceSnapshot } from "@/features/finance/finance-schema";
import CashFlow from "@/features/finance/CashFlow";
import FinanceOperations from "@/features/finance/FinanceOperations";
import PaymentHistory from "@/features/finance/PaymentHistory";
import FinanceTabs, { FinanceTabId } from "@/components/finance/FinanceTabs";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  AlertCircle,
  Building2,
  User,
  Wallet,
  Calendar,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro - MedCore" }] }),
  component: FinanceiroPage,
});
const input = "w-full rounded-lg border border-slate-200 p-2 text-sm";

function FinanceiroPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["financial-snapshot"], queryFn: getFinancialSnapshot });
  const [tab, setTab] = useState<FinanceTabId>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("tab") as FinanceTabId;
      if (
        p &&
        [
          "lancamentos",
          "receber",
          "pagar",
          "extrato",
          "fluxo",
          "dre",
          "contas",
          "centros-custo",
          "caixa",
          "cartoes",
          "repasses",
          "conciliacao",
          "planos",
          "relatorios",
        ].includes(p)
      ) {
        return p;
      }
    }
    return "lancamentos";
  });
  const [search, setSearch] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [account, setAccount] = useState("");
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return p.get("novo") === "true" || p.get("novo") === "lancamento" || p.get("novo") === "1";
    }
    return false;
  });

  const handleOpenCreating = () => {
    setCreating(true);
  };

  const handleCloseCreating = () => {
    setCreating(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("novo")) {
        url.searchParams.delete("novo");
        window.history.replaceState({}, "", url.toString());
      }
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (p.get("novo") === "true" || p.get("novo") === "lancamento" || p.get("novo") === "1") {
        setCreating(true);
      }
    }
  }, []);
  const [cancelId, setCancelId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [operationsLocked, setOperationsLocked] = useState(false);
  const handleTabChange = (nextTab: FinanceTabId) => {
    setTab(nextTab);
    if (nextTab === "receber" || nextTab === "pagar") {
      setStatus("open");
    } else {
      setStatus("all");
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", nextTab);
      window.history.replaceState({}, "", url.toString());
    }
  };
  const data = query.data;
  const baseTitles = useMemo(
    () =>
      (data?.titles || []).filter((t) => {
        if (scope !== "all" && (t.company_id || "legacy") !== scope) return false;
        if (tab === "receber" && t.type !== "receita") return false;
        if (tab === "pagar" && t.type !== "despesa") return false;
        if (status === "open" && remaining(t) <= 0) return false;
        if (
          status === "free_balance" &&
          (remaining(t) <= 0 || !isFreeBalance(t) || t.status === "cancelado")
        )
          return false;
        if (status === "paid" && (remaining(t) !== 0 || t.status === "cancelado")) return false;
        if (
          status === "overdue" &&
          (remaining(t) <= 0 || isFreeBalance(t) || t.due_date >= localDate())
        )
          return false;
        if (status === "cancelled" && t.status !== "cancelado") return false;
        return (
          !search ||
          [t.description, t.patient_name, t.payer_name, t.category].some((s) =>
            s?.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
        );
      }),
    [data, scope, tab, status, search],
  );
  const titleIds = new Set(baseTitles.map((t) => t.id));
  const filteredTitles = baseTitles.filter((t) => {
    if (isFreeBalance(t)) {
      if (status === "free_balance") return true;
      // Saldo livre não é projetado em um mês específico de calendário (quando filtros de início e fim estiverem ativos)
      return !start && !end;
    }
    return (!start || t.due_date >= start) && (!end || t.due_date <= end);
  });
  const payments =
    data?.payments.filter(
      (p) =>
        titleIds.has(p.transaction_id) &&
        (!start || p.paid_on >= start) &&
        (!end || p.paid_on <= end) &&
        (!account || p.account_id === account),
    ) || [];
  const stats = data
    ? financialSummary(data, baseTitles, start, end, tab === "extrato" ? account : "")
    : null;
  const currentTitle = data?.titles.find((t) => t.id === selected);
  const validRange = !start || !end || start <= end;
  const cancel = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.rpc("cancel_financial_title", {
        p_id: cancelId,
        p_reason: reason,
      });
      if (error) throw error;
      setCancelId("");
      setReason("");
      await refreshFinance(qc);
      toast.success("Título cancelado com justificativa.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppShell>
      <main className="p-6 space-y-5">
        <FinanceTabs
          activeTab={tab}
          onSelectTab={handleTabChange}
          disabled={operationsLocked}
        />
        <header className="flex flex-wrap justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Financeiro</h1>
            <p className="text-sm text-slate-600">
              Títulos, baixas parciais e movimentações realizadas.
            </p>
          </div>
          <button
            disabled={operationsLocked || !data?.scopes.some((s) => s.can_create)}
            onClick={handleOpenCreating}
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Plus size={16} strokeWidth={2.5} />
            Novo lançamento
          </button>
        </header>
        {query.isPending && <p>Carregando financeiro...</p>}
        {query.error && (
          <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
            {errorMessage(query.error)}
            <p>
              Verifique as permissões e a aplicação da migração financeira. Não será usado outro
              banco como alternativa. Dados anteriores, quando exibidos, podem estar desatualizados.
            </p>
            <button className="underline" onClick={() => query.refetch()}>
              Tentar novamente
            </button>
          </div>
        )}
        {data && (
          <>
            {data.scopes.length === 0 && (
              <p role="alert">
                Seu perfil não possui acesso financeiro. Solicite autorização ao administrador.
              </p>
            )}
            {["lancamentos", "receber", "pagar", "extrato"].includes(tab) && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <label className="text-sm">
                      Busca
                      <input
                        className={input}
                        placeholder="Paciente, pagador, descrição"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      Clínica
                      <select
                        className={input}
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                      >
                        <option value="all">Todas autorizadas</option>
                        {data.scopes.map((s) => (
                          <option key={s.id || "legacy"} value={s.id || "legacy"}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      De
                      <input
                        type="date"
                        className={input}
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      Até
                      <input
                        type="date"
                        className={input}
                        min={start}
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      Situação do título
                      <select
                        className={input}
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        <option value="all">Todas</option>
                        <option value="open">Em aberto / parcial</option>
                        <option value="free_balance">Saldos sem vencimento definido</option>
                        <option value="overdue">Vencidos</option>
                        <option value="paid">Quitados</option>
                        <option value="cancelled">Cancelados</option>
                      </select>
                    </label>
                    {tab === "extrato" && (
                      <label className="text-sm">
                        Conta
                        <select
                          className={input}
                          value={account}
                          onChange={(e) => setAccount(e.target.value)}
                        >
                          <option value="">Todas</option>
                          {data.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {!validRange ? (
                    <p role="alert" className="text-red-700">
                      A data inicial deve ser anterior ou igual à final.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-600">
                        Filtros de paciente, clínica e situação são compartilhados. Realizado usa a
                        data da baixa; títulos em aberto usam o vencimento. O resultado das baixas
                        inclui cartões e não é lucro nem saldo bancário disponível. Consulte
                        disponibilidade no Fluxo de caixa e DRE/DFC em Operações.
                        {tab === "extrato" &&
                          " A conta filtra apenas as baixas, pois títulos ainda não recebidos não têm conta efetiva."}
                      </p>
                      {stats && (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          {[
                            ["Recebido no período", stats.income],
                            ["Pago no período", stats.expense],
                            ["Resultado das baixas", stats.result],
                            ["A receber (vencimentos)", stats.receivable],
                            ["A pagar (vencimentos)", stats.payable],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-xl border bg-white p-4">
                              <p className="text-sm text-slate-600">{label}</p>
                              <p className="text-xl font-semibold">{currency(Number(value))}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {data.payments.some((p) => p.legacy) && (
                        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                          Há baixas importadas do legado. Confira datas e contas antes de usar os
                          totais como conciliação bancária.
                        </p>
                      )}
                      <div className="overflow-x-auto rounded-xl border bg-white">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              {(tab === "extrato"
                                ? [
                                    "Data da baixa",
                                    "Tipo / paciente",
                                    "Valor",
                                    "Conta / forma",
                                    "Situação",
                                    "Ação",
                                  ]
                                : [
                                    "Vencimento",
                                    "Paciente / pagador / origem",
                                    "Original",
                                    "Liquidado / saldo",
                                    "Situação",
                                    "Ações",
                                  ]
                              ).map((label) => (
                                <th key={label} className="p-3">
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tab === "extrato"
                              ? payments.map((p) => {
                                  const t = data.titles.find((t) => t.id === p.transaction_id)!;
                                  return (
                                    <tr key={p.id} className="border-t">
                                      <td className="p-3">{formatClinicalDate(p.paid_on)}</td>
                                      <td className="p-3">
                                        {t.type} · {t.patient_name || p.payer_name || "Avulso"}
                                      </td>
                                      <td className="p-3">{currency(p.amount)}</td>
                                      <td className="p-3">
                                        {data.accounts.find((a) => a.id === p.account_id)?.name ||
                                          "Não informada"}{" "}
                                        / {p.payment_method || "Não informada"}
                                      </td>
                                      <td className="p-3">
                                        {p.reversed_at ? "Estornado (fora dos totais)" : "Ativo"}
                                      </td>
                                      <td className="p-3">
                                        <button
                                          className="text-purple-700 underline"
                                          onClick={() => setSelected(t.id)}
                                        >
                                          Histórico
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })
                              : filteredTitles.map((t) => {
                                  const isFree = isFreeBalance(t);
                                  const titlePayments = (data?.payments || []).filter(
                                    (p) => p.transaction_id === t.id && !p.reversed_at,
                                  );
                                  const lastPayment =
                                    titlePayments.length > 0
                                      ? titlePayments.reduce(
                                          (latest, p) => (p.paid_on > latest.paid_on ? p : latest),
                                          titlePayments[0],
                                        )
                                      : null;
                                  return (
                                    <tr key={t.id} className="border-t hover:bg-slate-50/50">
                                      <td className="p-3">
                                        {isFree ? (
                                          <div>
                                            <span className="inline-flex items-center gap-1 text-[11.5px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700">
                                              Sem vencimento fixo
                                            </span>
                                            {lastPayment ? (
                                              <p className="text-[11px] text-slate-500 mt-1">
                                                Última baixa: {formatClinicalDate(lastPayment.paid_on)}
                                              </p>
                                            ) : (
                                              <p className="text-[11px] text-slate-400 mt-1">
                                                Nenhuma baixa
                                              </p>
                                            )}
                                          </div>
                                        ) : (
                                          formatClinicalDate(t.due_date)
                                        )}
                                      </td>
                                      <td className="p-3">
                                        <strong>{t.patient_name || "Avulso"}</strong>
                                        <p>{t.payer_name && `Pagador: ${t.payer_name}`}</p>
                                        <p>
                                          {t.type} · {t.description}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          {t.treatment_id
                                            ? "Plano de tratamento"
                                            : "Lançamento / atendimento"}
                                        </p>
                                      </td>
                                      <td className="p-3">{currency(t.amount)}</td>
                                      <td className="p-3">
                                        {currency(t.paid_amount)} / {currency(remaining(t))}
                                      </td>
                                      <td className="p-3">
                                        <span
                                          className={cn(
                                            "px-2 py-0.5 rounded-md text-xs font-semibold",
                                            titleStatus(t, localDate()).includes("Quitado")
                                              ? "bg-emerald-50 text-emerald-700"
                                              : isFree
                                                ? "bg-purple-50 text-purple-700"
                                                : titleStatus(t, localDate()).includes("Vencido")
                                                  ? "bg-rose-50 text-rose-700"
                                                  : "bg-slate-100 text-slate-700",
                                          )}
                                        >
                                          {titleStatus(t, localDate())}
                                        </span>
                                      </td>
                                      <td className="p-3 space-x-3">
                                        <button
                                          className="text-purple-700 underline font-medium"
                                          onClick={() => setSelected(t.id)}
                                        >
                                          {remaining(t) > 0 && t.can_settle
                                            ? "Baixar / histórico"
                                            : "Histórico"}
                                        </button>
                                        {t.can_cancel &&
                                          !t.treatment_id &&
                                          t.status !== "cancelado" &&
                                          !data.payments.some((p) => p.transaction_id === t.id) && (
                                            <button
                                              className="text-red-700 underline"
                                              onClick={() => {
                                                setCancelId(t.id);
                                                setReason("");
                                              }}
                                            >
                                              Cancelar
                                            </button>
                                          )}
                                      </td>
                                    </tr>
                                  );
                                })}
                          </tbody>
                        </table>
                        {(tab === "extrato" ? payments : filteredTitles).length === 0 && (
                          <p className="p-4">Nenhum registro para os filtros selecionados.</p>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            {tab === "fluxo" && <CashFlow finance={data} />}
            {tab === "contas" && <Accounts data={data} />}
            {tab === "planos" && <TreatmentFinance />}
            {tab === "centros-custo" && <CostCenters data={data} />}
            {["caixa", "cartoes", "repasses", "conciliacao", "dre", "relatorios"].includes(tab) && (
              <FinanceOperations
                finance={data}
                onLockChange={setOperationsLocked}
                subTab={
                  tab === "caixa"
                    ? "Caixa por turno"
                    : tab === "cartoes"
                      ? "Cartoes"
                      : tab === "repasses"
                        ? "Repasses"
                        : tab === "conciliacao"
                          ? "Conciliacao"
                          : "DRE / DFC"
                }
              />
            )}
            {creating && <NewTitle data={data} open={creating} onClose={handleCloseCreating} />}
            {currentTitle && (
              <PaymentHistory
                key={currentTitle.id}
                title={currentTitle}
                data={data}
                onClose={() => setSelected("")}
              />
            )}
            {cancelId && (
              <form onSubmit={cancel} className="rounded-xl border bg-white p-4 space-y-3">
                <label>
                  Justificativa do cancelamento
                  <textarea
                    required
                    minLength={5}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className={input}
                  />
                </label>
                <button disabled={busy} className="rounded bg-red-700 p-2 text-white">
                  Confirmar cancelamento
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCancelId("")}
                  className="ml-3"
                >
                  Voltar
                </button>
              </form>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

function NewTitle({
  data,
  open = true,
  onClose,
}: {
  data?: FinanceSnapshot;
  open?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const scopes = (data?.scopes || []).filter((s) => s.can_create);
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [scope, setScope] = useState(() => scopes[0]?.id || "legacy");
  const [type, setType] = useState<"receita" | "despesa">("receita");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(localDate());
  const [competence, setCompetence] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [patient, setPatient] = useState("");
  const [payer, setPayer] = useState("");

  useEffect(() => {
    if (scopes.length > 0 && scope === "legacy" && scopes[0]?.id) {
      setScope(scopes[0].id);
    }
  }, [scopes, scope]);

  const company = scope === "legacy" ? null : scope;
  const currentScope = scopes.find((s) => (s.id || "legacy") === scope);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const value = moneyCents(amount) / 100;
      if (value <= 0) throw new Error("Informe um valor positivo.");
      setSubmitted(true);
      const { error } = await supabase.rpc("create_financial_title", {
        p_id: id,
        p_type: type,
        p_amount: value,
        p_due_date: due,
        p_description: description,
        p_patient_id: patient || null,
        p_payer_name: payer || null,
        p_category: category || null,
        p_competence_date: competence || null,
        p_company_id: company,
      });
      if (error) {
        if (error.code === "P0001") setSubmitted(false);
        throw error;
      }
      await refreshFinance(qc);
      toast.success("Título criado com sucesso como pendente.");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle =
    "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600 transition-all";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl w-[95vw] sm:w-full max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-100 z-[100]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100 text-left">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shadow-sm shrink-0">
              <Wallet size={20} />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Novo lançamento
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-0.5">
                Cadastre um título a receber ou a pagar no financeiro.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={save} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
            {/* Tipo (Receita vs Despesa) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Tipo de lançamento
              </label>
              <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setType("receita")}
                  className={cn(
                    "flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer",
                    type === "receita"
                      ? "bg-white text-emerald-700 shadow-sm font-semibold"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  <ArrowDownLeft
                    size={16}
                    className={type === "receita" ? "text-emerald-600" : "text-slate-400"}
                  />
                  A receber (Receita)
                </button>
                <button
                  type="button"
                  disabled={!currentScope?.can_pay}
                  onClick={() => setType("despesa")}
                  title={
                    !currentScope?.can_pay
                      ? "Sem permissão para cadastrar despesas nesta unidade"
                      : undefined
                  }
                  className={cn(
                    "flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer",
                    type === "despesa"
                      ? "bg-white text-rose-700 shadow-sm font-semibold"
                      : "text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed",
                  )}
                >
                  <ArrowUpRight
                    size={16}
                    className={type === "despesa" ? "text-rose-600" : "text-slate-400"}
                  />
                  A pagar (Despesa)
                </button>
              </div>
            </div>

            <fieldset disabled={busy || submitted} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Clínica */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Building2 size={13} className="text-slate-400" />
                    Unidade / Clínica
                  </label>
                  <select
                    className={inputStyle}
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value);
                      setPatient("");
                      setType("receita");
                    }}
                  >
                    {scopes.map((s) => (
                      <option key={s.id || "legacy"} value={s.id || "legacy"}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Valor */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Valor (R$) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                      R$
                    </span>
                    <input
                      required
                      inputMode="decimal"
                      placeholder="0,00"
                      className={cn(inputStyle, "pl-11 font-semibold text-base text-slate-900")}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Vencimento & Competência */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-400" />
                    Data de Vencimento <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    type="date"
                    className={inputStyle}
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Competência (opcional)
                  </label>
                  <input
                    type="date"
                    className={inputStyle}
                    value={competence}
                    onChange={(e) => setCompetence(e.target.value)}
                  />
                </div>
              </div>

              {/* Descrição */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Descrição administrativa <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  placeholder="Ex: Consulta médica, Procedimento, Compra de insumos..."
                  className={inputStyle}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Categoria */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Categoria
                </label>
                <input
                  placeholder="Ex: Consultas, Exames, Procedimentos, Material..."
                  className={inputStyle}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>

              {/* Paciente & Responsável/Fornecedor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <User size={13} className="text-slate-400" />
                    Paciente (opcional)
                  </label>
                  <select
                    className={inputStyle}
                    value={patient}
                    onChange={(e) => {
                      const selPatientId = e.target.value;
                      setPatient(selPatientId);
                      if (selPatientId && !payer) {
                        const found = (data?.patients || []).find((p) => p.id === selPatientId);
                        if (found?.name) setPayer(found.name);
                      }
                    }}
                  >
                    <option value="">Sem vínculo com paciente</option>
                    {(data?.patients || [])
                      .filter((p) => !company || !p.company_id || p.company_id === company)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {type === "receita"
                      ? "Responsável Financeiro / Pagador"
                      : "Favorecido / Fornecedor"}{" "}
                    <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    placeholder={
                      type === "receita"
                        ? "Nome do paciente ou pagador"
                        : "Nome da empresa ou prestador"
                    }
                    className={inputStyle}
                    value={payer}
                    onChange={(e) => setPayer(e.target.value)}
                  />
                </div>
              </div>
            </fieldset>

            {/* Aviso informativo */}
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-xs text-slate-600 flex items-start gap-2.5">
              <AlertCircle size={15} className="text-slate-400 shrink-0 mt-0.5" />
              <span>
                Não inclua diagnósticos médicos ou dados clínicos sensíveis na descrição. Parcelas de orçamentos e tratamentos são geradas na aba <strong>Planos</strong>.
              </span>
            </div>

            {submitted && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <span>Solicitação enviada. Repetir não criará duplicidade.</span>
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 bg-slate-50/80 border-t border-slate-100 flex flex-row items-center justify-end gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="rounded-xl px-4 h-10 border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="rounded-xl px-5 h-10 bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-sm transition-all cursor-pointer"
            >
              {busy ? "Salvando..." : submitted ? "Repetir solicitação" : "Criar título pendente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Accounts({ data }: { data: FinanceSnapshot }) {
  const qc = useQueryClient();
  const scopes = data.scopes.filter((s) => s.can_accounts);
  const [id, setId] = useState(() => crypto.randomUUID());
  const [scope, setScope] = useState(scopes[0]?.id || "legacy");
  const [name, setName] = useState("");
  const [type, setType] = useState("corrente");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setSubmitted(true);
    try {
      const { error } = await supabase.rpc("create_financial_account", {
        p_id: id,
        p_name: name,
        p_type: type,
        p_company_id: scope === "legacy" ? null : scope,
      });
      if (error) {
        if (error.code === "P0001") setSubmitted(false);
        throw error;
      }
      setId(crypto.randomUUID());
      setName("");
      setSubmitted(false);
      await refreshFinance(qc);
      toast.success("Conta cadastrada.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4">
      <h2 className="font-bold">Contas financeiras</h2>
      <p className="text-sm text-slate-600">
        Cadastro para vincular baixas. Confirme a abertura e consulte os saldos na aba Fluxo de
        caixa. Contas de recebiveis de cartao ficam separadas de caixa e bancos.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {data.accounts.map((a) => (
          <div key={a.id} className="rounded-xl border bg-white p-4">
            <strong>{a.name}</strong>
            <p>
              {a.type} · {a.active ? "Ativa" : "Inativa"}
            </p>
            <p className="text-xs">{data.scopes.find((s) => s.id === a.company_id)?.name}</p>
          </div>
        ))}
      </div>
      {scopes.length > 0 && (
        <form onSubmit={save} className="rounded-xl border bg-white p-4 space-y-3">
          <h3 className="font-semibold">Nova conta</h3>
          <fieldset disabled={busy || submitted} className="grid gap-3 sm:grid-cols-3">
            <label>
              Clínica
              <select className={input} value={scope} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => (
                  <option key={s.id || "legacy"} value={s.id || "legacy"}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome
              <input
                required
                className={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Tipo
              <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="corrente">Conta corrente / controle de recebíveis</option>
                <option value="caixa">Caixa</option>
              </select>
            </label>
          </fieldset>
          <button disabled={busy} className="rounded bg-purple-600 p-2 text-white">
            {submitted ? "Repetir solicitação" : "Cadastrar conta"}
          </button>
        </form>
      )}
    </section>
  );
}

function CostCenters({ data }: { data: FinanceSnapshot }) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const categories = useMemo(() => {
    const map = new Map<string, { income: number; expense: number; count: number }>();
    for (const t of data.titles) {
      const cat = t.category?.trim() || "Sem categoria";
      const curr = map.get(cat) || { income: 0, expense: 0, count: 0 };
      if (t.type === "receita") {
        curr.income += t.paid_amount;
      } else {
        curr.expense += t.paid_amount;
      }
      curr.count += 1;
      map.set(cat, curr);
    }
    return Array.from(map.entries())
      .map(([name, stats]) => ({
        name,
        ...stats,
        balance: stats.income - stats.expense,
      }))
      .sort((a, b) => b.count - a.count);
  }, [data.titles]);

  const filtered = useMemo(() => {
    if (selectedCategory === "all") return data.titles;
    return data.titles.filter((t) => (t.category?.trim() || "Sem categoria") === selectedCategory);
  }, [data.titles, selectedCategory]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Centros de Custo e Categorias</h2>
          <p className="text-sm text-slate-600">
            Acompanhamento de receitas, despesas e margem por categoria e centro gerencial.
          </p>
        </div>
        <select
          className="rounded-lg border border-slate-200 p-2 text-sm bg-white"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="all">Todas as categorias ({categories.length})</option>
          {categories.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {categories.slice(0, 8).map((c) => (
          <div
            key={c.name}
            onClick={() => setSelectedCategory(selectedCategory === c.name ? "all" : c.name)}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              selectedCategory === c.name
                ? "border-purple-600 bg-purple-50/50 shadow-sm"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <strong className="text-sm font-semibold truncate">{c.name}</strong>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                {c.count} {c.count === 1 ? "título" : "títulos"}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex justify-between text-emerald-700">
                <span>Receitas:</span>
                <span>{currency(c.income)}</span>
              </div>
              <div className="flex justify-between text-rose-700">
                <span>Despesas:</span>
                <span>{currency(c.expense)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t pt-1">
                <span>Resultado:</span>
                <span className={c.balance >= 0 ? "text-emerald-700" : "text-rose-700"}>
                  {currency(c.balance)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3">Vencimento</th>
              <th className="p-3">Categoria / Descrição</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">Valor</th>
              <th className="p-3">Liquidado</th>
              <th className="p-3">Paciente / Origem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-3">{formatClinicalDate(t.due_date)}</td>
                <td className="p-3">
                  <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {t.category || "Sem categoria"}
                  </span>
                  <p className="font-medium text-slate-900 mt-0.5">{t.description}</p>
                </td>
                <td className="p-3">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                      t.type === "receita"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {t.type === "receita" ? "A Receber" : "A Pagar"}
                  </span>
                </td>
                <td className="p-3">{currency(t.amount)}</td>
                <td className="p-3">{currency(t.paid_amount)}</td>
                <td className="p-3">{t.patient_name || t.payer_name || "Avulso"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-4 text-center text-slate-500">Nenhum título nesta categoria.</p>
        )}
      </div>
    </section>
  );
}


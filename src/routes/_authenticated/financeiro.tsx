import type { DbRow, Json, IconType } from "@/lib/types";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Wallet,
  Search,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Coins,
  Calendar as CalendarIcon,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { financeService, patientsService } from "@/services/api";
import FinanceTabs from "@/components/finance/FinanceTabs";
import { CountUp, BRL as BRLFmt } from "@/components/finance/CountUp";
import { useAutoAnimate } from "@/hooks/use-auto-animate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useClinicCities } from "@/hooks/use-clinic-cities";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro • MedCore" },
      {
        name: "description",
        content: "Controle financeiro da clínica — receitas, despesas e recebimentos.",
      },
    ],
  }),
  component: FinanceiroPage,
});

type Tx = {
  id: string;
  type: "income" | "expense";
  amount: number;
  category: string | null;
  description: string | null;
  date: string;
  status: "pendente" | "concluido" | "cancelado" | string;
  payment_method: string | null;
  patient_id: string | null;
  notes: string | null;
  created_at: string;
};

type PatientRef = { id: string; name: string };

const formatDateBR = (dateStr: string) => {
  if (!dateStr) return "—";
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const PM_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  transferencia: "Transferência",
  boleto: "Boleto",
  convenio: "Convênio",
};

function FinanceiroPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [cityFilter, setCityFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [periodPreset, setPeriodPreset] = useState<"todos" | "hoje" | "semana" | "mes">("todos");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const { cities: availableCities } = useClinicCities();
  const [openNew, setOpenNew] = useState(false);
  const [editTx, setEditTx] = useState<Tx | null>(null);
  const [sortBy, setSortBy] = useState<{
    key: "date" | "amount" | "status" | "description";
    dir: "asc" | "desc";
  }>({ key: "date", dir: "desc" });
  const tbodyRef = useAutoAnimate<HTMLTableSectionElement>();
  const qc = useQueryClient();

  const applyPeriodPreset = (preset: "todos" | "hoje" | "semana" | "mes") => {
    setPeriodPreset(preset);
    const now = new Date();
    const toStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    if (preset === "todos") {
      setStartDate("");
      setEndDate("");
    } else if (preset === "hoje") {
      const today = toStr(now);
      setStartDate(today);
      setEndDate(today);
    } else if (preset === "semana") {
      const lastWeek = new Date(now);
      lastWeek.setDate(now.getDate() - 7);
      setStartDate(toStr(lastWeek));
      setEndDate(toStr(now));
    } else if (preset === "mes") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(toStr(firstDay));
      setEndDate(toStr(lastDay));
    }
  };

  const { data: txData, isLoading: loading, refetch: load } = useQuery({
    queryKey: ["transactions"],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const [phpTx, phpPat] = await Promise.all([
          financeService.getTransactions({ limit: 500 }),
          patientsService.getPatients({ limit: 500 }),
        ]);

        if (phpTx && Array.isArray(phpTx)) {
          const rows = phpTx.map((r: any) => ({
            ...r,
            type: r.type === "receita" ? "income" : r.type === "despesa" ? "expense" : r.type,
          })) as Tx[];

          return {
            rows,
            patients: (phpPat ?? []) as PatientRef[],
          };
        }
      } catch {}

      const [{ data: tx }, { data: pat }] = await Promise.all([
        supabase
          .from("transactions")
          .select(
            "id,type,amount,category,description,date,status,payment_method,patient_id,notes,created_at",
          )
          .order("date", { ascending: false })
          .limit(500),
        supabase.from("patients").select("id,name").order("name").limit(500),
      ]);

      const rows = ((tx ?? []) as DbRow[]).map((r) => ({
        ...r,
        type: r.type === "receita" ? "income" : r.type === "despesa" ? "expense" : r.type,
      })) as Tx[];

      return {
        rows,
        patients: (pat ?? []) as PatientRef[],
      };
    },
  });

  const rows = txData?.rows ?? [];
  const patients = txData?.patients ?? [];

  const patientMap = useMemo(
    () => Object.fromEntries(patients.map((p) => [p.id, p.name])),
    [patients],
  );

  const pendingSinais = useMemo(() => {
    return rows.filter(
      (r) =>
        r.status === "pendente" &&
        r.type === "income" &&
        (r.description?.toLowerCase().includes("restante") || r.description?.toLowerCase().includes("sinal")),
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (filter !== "all" && r.type !== filter) return false;
      if (cityFilter !== "todas") {
        const descMatch = r.description?.toLowerCase().includes(cityFilter.toLowerCase());
        const noteMatch = r.notes?.toLowerCase().includes(cityFilter.toLowerCase());
        if (!descMatch && !noteMatch) return false;
      }

      // Status filter
      if (statusFilter !== "todos") {
        const desc = r.description?.toLowerCase() ?? "";
        if (statusFilter === "sinal_pago") {
          if (r.status !== "concluido" || !desc.includes("sinal")) return false;
        } else if (statusFilter === "restante") {
          if (r.status !== "pendente" || !desc.includes("restante")) return false;
        } else if (statusFilter === "concluido") {
          if (r.status !== "concluido" || desc.includes("sinal")) return false;
        } else if (r.status !== statusFilter) {
          return false;
        }
      }

      // Date range filter
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;

      if (!s) return true;
      return (
        r.description?.toLowerCase().includes(s) ||
        r.category?.toLowerCase().includes(s) ||
        (r.patient_id && patientMap[r.patient_id]?.toLowerCase().includes(s))
      );
    });
    const dir = sortBy.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const k = sortBy.key;
      const av: string | number =
        k === "amount"
          ? Number(a.amount) || 0
          : k === "date"
            ? new Date(a.date).getTime()
            : ((a[k] ?? "") as string);
      const bv: string | number =
        k === "amount"
          ? Number(b.amount) || 0
          : k === "date"
            ? new Date(b.date).getTime()
            : ((b[k] ?? "") as string);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, q, filter, cityFilter, statusFilter, startDate, endDate, patientMap, sortBy]);

  const toggleSort = (key: typeof sortBy.key) =>
    setSortBy((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  const sortIcon = (key: typeof sortBy.key) =>
    sortBy.key !== key ? (
      <ArrowUpDown size={12} className="opacity-40" />
    ) : sortBy.dir === "asc" ? (
      <ArrowUp size={12} />
    ) : (
      <ArrowDown size={12} />
    );

  const stats = useMemo(() => {
    let income = 0,
      expense = 0,
      pending = 0,
      sinaisIncome = 0;
    for (const r of rows) {
      const a = Number(r.amount) || 0;
      if (r.status === "cancelado") continue;
      if (r.type === "income") {
        if (r.status === "concluido") {
          income += a;
          if (r.description?.toLowerCase().includes("sinal")) {
            sinaisIncome += a;
          }
        } else if (r.status === "pendente") {
          pending += a;
        }
      } else if (r.type === "expense" && r.status === "concluido") {
        expense += a;
      }
    }
    return { income, expense, pending, sinaisIncome, balance: income - expense };
  }, [rows]);

  const setStatus = async (id: string, status: string) => {
    try {
      await financeService.updateTransaction(id, { status: status as any });
      toast.success("Status atualizado");
      load();
      qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
      return;
    } catch {}

    const { error } = await supabase.from("transactions").update({ status }).eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else {
      toast.success("Status atualizado");
      load();
      qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
    }
  };

  const doDelete = async (t: Tx) => {
    try {
      await financeService.deleteTransaction(t.id);
      toast.success("Lançamento excluído");
      load();
      qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
      return;
    } catch {}

    const { error } = await supabase.from("transactions").delete().eq("id", t.id);
    if (error) toast.error("Erro ao excluir: " + error.message);
    else {
      toast.success("Lançamento excluído");
      load();
      qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
    }
  };

  const confirmDelete = async (t: Tx) => {
    const ok = await confirmDialog({
      title: "Excluir lançamento",
      description: `Tem certeza que deseja excluir "${t.description ?? "este lançamento"}"? Esta ação não pode ser desfeita.`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (ok) await doDelete(t);
  };

  return (
    <AppShell title="Financeiro">
      <FinanceTabs />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            label="Receitas (pagas)"
            value={stats.income}
            icon={<TrendingUp size={16} />}
            tint="#DCFCE7"
            fg="#166534"
          />
          <StatCard
            label="Sinais recebidos"
            value={stats.sinaisIncome}
            icon={<Coins size={16} />}
            tint="#EDE4FF"
            fg="#6B2FE0"
          />
          <StatCard
            label="Restante a receber"
            value={stats.pending}
            icon={<Wallet size={16} />}
            tint="#FEF3C7"
            fg="#92400E"
          />
          <StatCard
            label="Despesas (pagas)"
            value={stats.expense}
            icon={<TrendingDown size={16} />}
            tint="#FEE2E2"
            fg="#991B1B"
          />
          <StatCard
            label="Saldo líquido"
            value={stats.balance}
            icon={<Wallet size={16} />}
            tint="#DBEAFE"
            fg="#1E40AF"
          />
        </div>

        {/* Banner Rápido para Recepção: Sinais e Restantes Pendentes */}
        {pendingSinais.length > 0 && (
          <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <h4 className="text-[14px] font-bold text-amber-900 flex items-center gap-2">
                <AlertCircle size={18} className="text-amber-600" />
                Saldos Devedores A Cobrar na Recepção ({pendingSinais.length})
              </h4>
              <span className="text-[12px] font-bold text-amber-800 bg-amber-100/90 px-3 py-1 rounded-full border border-amber-300/50">
                Total Pendente: {BRL(pendingSinais.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0))}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingSinais.slice(0, 6).map((item) => (
                <div key={item.id} className="bg-white border border-amber-200/80 p-3.5 rounded-xl flex items-center justify-between shadow-2xs hover:border-amber-400 transition">
                  <div className="truncate pr-2">
                    <div className="text-[13px] font-bold text-[#111827] truncate">
                      {item.patient_id ? (patientMap[item.patient_id] ?? "Paciente") : "Paciente Sem Cadastro"}
                    </div>
                    <div className="text-[11.5px] text-[#6B7280] truncate mt-0.5">{item.description}</div>
                    <div className="text-[13px] font-extrabold text-amber-700 mt-1">{BRL(Number(item.amount) || 0)}</div>
                  </div>
                  <button
                    onClick={() => setStatus(item.id, "concluido")}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#8B47FF] text-white text-[12px] font-bold hover:bg-[#7A3AE6] transition shrink-0 shadow-2xs"
                  >
                    <CheckCircle2 size={14} /> Liquidar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por descrição, categoria ou paciente…"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] focus:outline-none focus:border-[#8B47FF]"
            />
          </div>

          <div className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-white border border-[#E5E7EB] text-[12px]">
            <MapPin size={14} className="text-[#8B47FF]" />
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="bg-transparent font-medium text-[#374151] outline-none cursor-pointer"
            >
              <option value="todas">🏙️ Todas as Cidades</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-white border border-[#E5E7EB] text-[12px]">
            <Filter size={14} className="text-[#8B47FF]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent font-medium text-[#374151] outline-none cursor-pointer"
            >
              <option value="todos">📌 Todos os Status</option>
              <option value="sinal_pago">🟪 Sinal Pago</option>
              <option value="restante">🟨 Restante A Cobrar</option>
              <option value="concluido">🟩 Pago Total</option>
              <option value="pendente">🟧 Pendente</option>
              <option value="cancelado">⚪ Cancelado</option>
            </select>
          </div>

          <div className="flex rounded-lg border border-[#E5E7EB] bg-white overflow-hidden text-[12px]">
            {(
              [
                ["todos", "Todo Período"],
                ["hoje", "Hoje"],
                ["semana", "7 Dias"],
                ["mes", "Este Mês"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => applyPeriodPreset(k)}
                className={`px-3 h-10 font-medium transition ${periodPreset === k ? "bg-[#8B47FF] text-white" : "text-[#374151] hover:bg-[#F9FAFB]"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-white border border-[#E5E7EB] rounded-lg px-2.5 h-10 text-[12px]">
            <CalendarIcon size={14} className="text-[#8B47FF]" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPeriodPreset("todos");
              }}
              className="bg-transparent text-[12px] font-medium outline-none text-[#374151]"
            />
            <span className="text-[#9CA3AF]">até</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPeriodPreset("todos");
              }}
              className="bg-transparent text-[12px] font-medium outline-none text-[#374151]"
            />
          </div>

          <div className="flex rounded-lg border border-[#E5E7EB] bg-white overflow-hidden text-[12px]">
            {(["all", "income", "expense"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 h-10 font-medium ${filter === f ? "bg-[#8B47FF] text-white" : "text-[#374151] hover:bg-[#F9FAFB]"}`}
              >
                {f === "all" ? "Todos" : f === "income" ? "Receitas" : "Despesas"}
              </button>
            ))}
          </div>

          <button
            onClick={() => setOpenNew(true)}
            className="ml-auto inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold hover:bg-[#7A3AE6]"
          >
            <Plus size={16} /> Novo lançamento
          </button>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F9FAFB] text-[#6B7280] text-left">
              <tr>
                <th
                  className="px-4 py-3 font-medium cursor-pointer select-none hover:text-[#111827]"
                  onClick={() => toggleSort("date")}
                >
                  <span className="inline-flex items-center gap-1">Data {sortIcon("date")}</span>
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer select-none hover:text-[#111827]"
                  onClick={() => toggleSort("description")}
                >
                  <span className="inline-flex items-center gap-1">
                    Descrição {sortIcon("description")}
                  </span>
                </th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Pagamento</th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer select-none hover:text-[#111827]"
                  onClick={() => toggleSort("status")}
                >
                  <span className="inline-flex items-center gap-1">
                    Status {sortIcon("status")}
                  </span>
                </th>
                <th
                  className="px-4 py-3 font-medium text-right cursor-pointer select-none hover:text-[#111827]"
                  onClick={() => toggleSort("amount")}
                >
                  <span className="inline-flex items-center gap-1 justify-end">
                    Valor {sortIcon("amount")}
                  </span>
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-[#F3F4F6] hover:bg-[#FAF7FF]">
                  <td className="px-4 py-3 text-[#374151]">
                    {formatDateBR(r.date)}
                  </td>
                  <td className="px-4 py-3 text-[#111827] font-medium">{r.description ?? "—"}</td>
                  <td className="px-4 py-3 text-[#374151]">{r.category ?? "—"}</td>
                  <td className="px-4 py-3 text-[#374151]">
                    {r.patient_id ? (patientMap[r.patient_id] ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-3 text-[#374151]">
                    {PM_LABEL[r.payment_method ?? ""] ?? r.payment_method ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} description={r.description} />
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${r.type === "income" ? "text-[#166534]" : "text-[#991B1B]"}`}
                  >
                    {r.type === "income" ? "+" : "−"} {BRL(Number(r.amount) || 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {r.status === "pendente" && (
                        <button
                          onClick={() => setStatus(r.id, "concluido")}
                          className="inline-flex items-center gap-1 text-[12px] font-bold text-[#8B47FF] hover:underline bg-[#EDE4FF] px-2.5 py-1 rounded-md"
                        >
                          <CheckCircle2 size={13} /> Liquidar
                        </button>
                      )}
                      <button
                        onClick={() => setEditTx(r)}
                        title="Editar"
                        className="h-8 w-8 rounded-lg hover:bg-[#EDE4FF] text-[#6B7280] hover:text-[#8B47FF] inline-flex items-center justify-center"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => confirmDelete(r)}
                        title="Excluir"
                        className="h-8 w-8 rounded-lg hover:bg-[#FEE2E2] text-[#6B7280] hover:text-[#991B1B] inline-flex items-center justify-center"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[#6B7280]">
                    Nenhum lançamento encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openNew && (
        <NewTxModal
          patients={patients}
          onClose={() => setOpenNew(false)}
          onCreated={() => {
            load();
            qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
            qc.invalidateQueries({ queryKey: ["finance-dashboard", "transactions"] });
          }}
        />
      )}

      {editTx && (
        <NewTxModal
          patients={patients}
          initial={editTx}
          onClose={() => setEditTx(null)}
          onCreated={() => {
            load();
            qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
            qc.invalidateQueries({ queryKey: ["finance-dashboard", "transactions"] });
          }}
        />
      )}
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  icon,
  tint,
  fg,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tint: string;
  fg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-[#6B7280]">{label}</div>
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center"
          style={{ background: tint, color: fg }}
        >
          {icon}
        </div>
      </div>
      <div className="mt-2 text-[20px] font-bold text-[#111827] tabular-nums">
        <CountUp value={value} format={BRLFmt} />
      </div>
    </div>
  );
}

function StatusPill({ status, description }: { status: string; description?: string | null }) {
  const desc = description?.toLowerCase() ?? "";
  const isSinal = desc.includes("sinal");
  const isRestante = desc.includes("restante");

  let s = { bg: "#F3F4F6", fg: "#6B7280", label: status };

  if (status === "concluido") {
    if (isSinal) {
      s = { bg: "#EDE4FF", fg: "#6B2FE0", label: "Sinal Pago" };
    } else {
      s = { bg: "#DCFCE7", fg: "#166534", label: "Pago Total" };
    }
  } else if (status === "pendente") {
    if (isRestante) {
      s = { bg: "#FEF3C7", fg: "#92400E", label: "Restante A Cobrar" };
    } else {
      s = { bg: "#FFEDD5", fg: "#C2410C", label: "Pendente" };
    }
  } else if (status === "cancelado") {
    s = { bg: "#F3F4F6", fg: "#6B7280", label: "Cancelado" };
  }

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold shadow-2xs"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function NewTxModal({
  patients,
  onClose,
  onCreated,
  initial,
}: {
  patients: PatientRef[];
  onClose: () => void;
  onCreated: () => void;
  initial?: Tx | null;
}) {
  const [f, setF] = useState({
    type: (initial?.type ?? "income") as "income" | "expense",
    amount: initial ? String(initial.amount) : "",
    category: initial?.category ?? "",
    description: initial?.description ?? "",
    date: (initial?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
    status: (initial?.status === "pendente" ? "pendente" : "concluido") as "concluido" | "pendente",
    payment_method: initial?.payment_method ?? "",
    patient_id: initial?.patient_id ?? "",
  });
  const [saving, setSaving] = useState(false);
  const inp =
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]";

  const save = async () => {
    const amt = parseFloat(f.amount.replace(",", "."));
    if (!amt || amt <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    setSaving(true);
    const payload = {
      type: f.type === "income" ? "receita" : "despesa",
      amount: amt,
      category: f.category || null,
      description: f.description || null,
      date: f.date,
      status: f.status,
      payment_method: f.payment_method || null,
      patient_id: f.patient_id || null,
    };
    const { error } = initial
      ? await supabase.from("transactions").update(payload).eq("id", initial.id)
      : await supabase.from("transactions").insert(payload);
    setSaving(false);
    if (!error) {
      toast.success(initial ? "Lançamento atualizado" : "Lançamento criado");
      onCreated();
      onClose();
    } else {
      toast.error("Erro ao salvar: " + error.message);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[520px] bg-white rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-[#111827]">Novo lançamento</h2>
          <button onClick={onClose} className="text-[#9CA3AF]">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex rounded-lg border border-[#E5E7EB] overflow-hidden">
            {(["income", "expense"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setF((p) => ({ ...p, type: t }))}
                className={`flex-1 h-10 text-[13px] font-semibold ${f.type === t ? (t === "income" ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#FEE2E2] text-[#991B1B]") : "text-[#374151] hover:bg-[#F9FAFB]"}`}
              >
                {t === "income" ? "Receita" : "Despesa"}
              </button>
            ))}
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Valor (R$) *</label>
            <input
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
              className={inp}
              placeholder="0,00"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Data *</label>
            <input
              type="date"
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
              className={inp}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280]">Descrição</label>
            <input
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              className={inp}
              placeholder="Ex.: Consulta cardiologia"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Categoria</label>
            <input
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
              className={inp}
              placeholder="Consulta, Exame, Aluguel…"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Forma de pagamento</label>
            <select
              value={f.payment_method}
              onChange={(e) => setF({ ...f, payment_method: e.target.value })}
              className={inp}
            >
              <option value="">—</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="cartao_credito">Cartão de crédito</option>
              <option value="cartao_debito">Cartão de débito</option>
              <option value="transferencia">Transferência</option>
              <option value="boleto">Boleto</option>
              <option value="convenio">Convênio</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Paciente</label>
            <select
              value={f.patient_id}
              onChange={(e) => setF({ ...f, patient_id: e.target.value })}
              className={inp}
            >
              <option value="">—</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Status *</label>
            <select
              value={f.status}
              onChange={(e) => setF({ ...f, status: e.target.value as "concluido" | "pendente" })}
              className={inp}
            >
              <option value="concluido">Pago</option>
              <option value="pendente">Pendente</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#374151]"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !f.amount}
            className="h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

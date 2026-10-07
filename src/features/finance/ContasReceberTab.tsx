import React, { useState, useMemo, useEffect } from "react";
import { ALL_PERIOD, PeriodFilter, dateSearchText, inPeriod, type Period } from "./PeriodFilter";
import {
  ArrowUpRight,
  Clock,
  AlertTriangle,
  CheckCircle2,
  RotateCw,
  Search,
  MessageCircle,
  Pencil,
  Trash2,
  Calendar,
  CreditCard,
  Building2,
  Layers,
  FileText,
  Copy,
  ExternalLink,
  ChevronDown,
  TrendingUp,
  Wallet,
  Bell,
  CalendarCheck2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { parseISO, startOfDay, format } from "date-fns";
import { getStoredLocalPatients } from "@/lib/local-patients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CountUp } from "@/components/finance/CountUp";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import { remaining, isFreeBalance } from "./finance-math";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui-app/StatusBadge";
import { AlertCircle, Clock3, Plus } from "lucide-react";

export interface ContasReceberTabProps {
  finance: FinanceSnapshot;
  onRefresh?: () => Promise<unknown> | void;
  refreshing?: boolean;
  onOpenNew?: (type?: "receita" | "despesa") => void;
  onEdit: (entry: FinancialTitle) => void;
  onReceive: (entry: FinancialTitle) => void;
  onDelete: (id: string) => void | Promise<void>;
}

export function ContasReceberTab({
  finance,
  onRefresh,
  refreshing = false,
  onOpenNew,
  onEdit,
  onReceive,
  onDelete,
}: ContasReceberTabProps) {
  const [subTab, setSubTab] = useState<
    "geral" | "hoje" | "parcelados" | "livre" | "clientes" | "cartoes"
  >("geral");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "pendente" | "vencido" | "pago">("todos");
  const [period, setPeriod] = useState<Period>(ALL_PERIOD);
  const [selectedAssociado, setSelectedAssociado] = useState<string>("todos");
  const [associadosList, setAssociadosList] = useState<string[]>([]);

  // Modal de Cobrança WhatsApp
  const [cobrarTitle, setCobrarTitle] = useState<FinancialTitle | null>(null);
  const [cobrarPhone, setCobrarPhone] = useState("");
  const [cobrarMessage, setCobrarMessage] = useState("");

  // Busca lista de associados/profissionais para o filtro
  useEffect(() => {
    async function loadAssociados() {
      try {
        const { data } = await supabase.from("profiles").select("full_name").not("full_name", "is", null);
        if (data && data.length > 0) {
          const names = Array.from(
            new Set((data as any[]).map((d: any) => d.full_name || d.name).filter(Boolean)),
          );
          setAssociadosList(names);
        }
      } catch {
        // Fallback silencioso
      }
    }
    loadAssociados();
  }, []);

  // Filtra todas as receitas ativas
  const receitas = useMemo(() => {
    return (finance?.titles || []).filter((t) => {
      if (t.status === "cancelado") return false;
      return t.type === "receita";
    });
  }, [finance?.titles]);

  // Parcelas por plano de acompanhamento: "Parcela 3 de 7" e o valor total do plano
  // Numeração pela ordem de vencimento (após repactuação os números gravados ficam salteados)
  const planInfo = useMemo(() => {
    const map = new Map<
      string,
      { parcelas: number; total: number; open: number; order: Map<string, number> }
    >();
    const byPlan = new Map<string, FinancialTitle[]>();
    receitas.forEach((t) => {
      if (!t.treatment_id) return;
      byPlan.set(t.treatment_id, [...(byPlan.get(t.treatment_id) ?? []), t]);
    });
    byPlan.forEach((titles, planId) => {
      const parts = titles
        .filter((t) => !/entrada/i.test(t.description || ""))
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      map.set(planId, {
        parcelas: parts.length,
        total: titles.reduce((s, t) => s + (Number(t.amount) || 0), 0),
        open: titles.reduce((s, t) => s + remaining(t), 0),
        order: new Map(parts.map((t, idx) => [t.id, idx + 1])),
      });
    });
    return map;
  }, [receitas]);

  const parcelaLabel = (t: FinancialTitle) => {
    if (!t.treatment_id || isFreeBalance(t)) return null;
    const info = planInfo.get(t.treatment_id);
    if (!info) return null;
    const plano = `Plano ${currency(info.total)}${info.open > 0 ? ` (falta ${currency(info.open)})` : " (quitado)"}`;
    if (/entrada/i.test(t.description || "")) return `Entrada · ${plano}`;
    const n = info.order.get(t.id);
    return `${n ? `Parcela ${n} de ${info.parcelas}` : `${info.parcelas} parcela(s)`} · ${plano}`;
  };

  // Texto da linha: num plano, "Entrada" / "Parcela 3 de 7" vem primeiro e o nome do plano vai
  // para a linha de detalhe (todas as linhas começavam com "Acompanhamento: Plano de…" e cortavam).
  const rowText = (t: FinancialTitle, person: string, free: boolean) => {
    const base = (t.description || "")
      .replace(
        person ? new RegExp(`^${person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–·:]\\s*`, "i") : /^$/,
        "",
      )
      .replace(/^Acompanhamento:\s*/i, "")
      .replace(/\s*-\s*(Parcela\s+\d+|Entrada)\s*$/i, "")
      .trim();
    if (t.treatment_id) {
      const info = planInfo.get(t.treatment_id);
      const n = info?.order.get(t.id);
      const kind = free
        ? "Saldo livre"
        : /entrada/i.test(t.description || "")
          ? "Entrada"
          : n
            ? `Parcela ${n} de ${info!.parcelas}`
            : "Parcela";
      const plano = info
        ? `${currency(info.total)}${info.open > 0 ? ` · falta ${currency(info.open)}` : " · quitado"}`
        : "";
      return { description: kind, details: [base, plano].filter(Boolean).join(" · ") };
    }
    return { description: base || "Atendimento", details: free ? "Saldo livre" : t.category || "" };
  };

  // Helper para verificar status de liquidação estrito cruzando título e pagamentos
  const getTitleStatus = (t: FinancialTitle) => {
    const directPayments = (finance?.payments || []).filter(
      (p) =>
        (p.transaction_id === t.id || (t.installment_id && p.transaction_id === t.installment_id)) &&
        !p.reversed_at,
    );
    const paymentsTotal = directPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const paidAmt = Math.max(Number(t.paid_amount) || 0, paymentsTotal);
    const titleAmt = Number(t.amount) || 0;
    const rem = Math.max(0, titleAmt - paidAmt);
    const isPaid =
      String(t.status).toLowerCase() === "pago" ||
      String(t.status).toLowerCase() === "quitado" ||
      rem <= 0.01 ||
      (titleAmt > 0 && paidAmt >= titleAmt - 0.01);

    return { rem, isPaid, paidAmt, valorDisplay: rem > 0 ? rem : titleAmt };
  };

  // Cálculos de KPIs, Vencem Hoje, Saldos Livres e Envelhecimento (Aging)
  const metrics = useMemo(() => {
    const today = startOfDay(new Date());
    const todayTime = today.getTime();

    let aReceberTotal = 0;
    let aReceberCount = 0;
    let emAtrasoTotal = 0;
    let emAtrasoCount = 0;
    let recebidoTotal = 0;
    let recebidoCount = 0;

    let vencemHojeTotal = 0;
    const vencemHojeList: FinancialTitle[] = [];

    let saldoLivreTotal = 0;
    const saldoLivreList: FinancialTitle[] = [];

    let rec_0_15_count = 0,
      rec_0_15_val = 0;
    let rec_15_30_count = 0,
      rec_15_30_val = 0;
    let rec_30_plus_count = 0,
      rec_30_plus_val = 0;

    let atr_1_15_count = 0,
      atr_1_15_val = 0;
    let atr_15_30_count = 0,
      atr_15_30_val = 0;
    let atr_30_plus_count = 0,
      atr_30_plus_val = 0;

    const overdueClients = new Set<string>();

    receitas.forEach((e) => {
      // Cards seguem o período escolhido (por vencimento); saldo livre não tem data e sempre entra
      if (!isFreeBalance(e) && !inPeriod(e.due_date, period)) return;
      const { rem, isPaid, paidAmt } = getTitleStatus(e);
      const paid = paidAmt;

      if (paid > 0) {
        recebidoTotal += paid;
        recebidoCount++;
      }

      if (isPaid) return;

      const amt = rem;
      const clientIdentifier = e.patient_id || e.patient_name || e.payer_name || e.id;
      const free = isFreeBalance(e);

      // Tratamento segregado para saldos livres (não distorce o aging de atrasos)
      if (free) {
        saldoLivreTotal += amt;
        saldoLivreList.push(e);
        return;
      }

      if (!e.due_date) {
        aReceberTotal += amt;
        aReceberCount++;
        rec_0_15_count++;
        rec_0_15_val += amt;
        return;
      }

      const dueTime = parseISO(e.due_date).getTime();
      const diff = Math.floor((dueTime - todayTime) / 86400000);

      // Cobranças agendadas exatamente para hoje
      if (diff === 0) {
        vencemHojeTotal += amt;
        vencemHojeList.push(e);
      }

      if (diff < 0) {
        // Em atraso
        emAtrasoTotal += amt;
        emAtrasoCount++;
        overdueClients.add(clientIdentifier);

        const absDiff = Math.abs(diff);
        if (absDiff <= 15) {
          atr_1_15_count++;
          atr_1_15_val += amt;
        } else if (absDiff <= 30) {
          atr_15_30_count++;
          atr_15_30_val += amt;
        } else {
          atr_30_plus_count++;
          atr_30_plus_val += amt;
        }
      } else {
        // A receber (a vencer ou hoje)
        aReceberTotal += amt;
        aReceberCount++;

        if (diff <= 15) {
          rec_0_15_count++;
          rec_0_15_val += amt;
        } else if (diff <= 30) {
          rec_15_30_count++;
          rec_15_30_val += amt;
        } else {
          rec_30_plus_count++;
          rec_30_plus_val += amt;
        }
      }
    });

    return {
      aReceberTotal,
      aReceberCount,
      emAtrasoTotal,
      emAtrasoClientesCount: overdueClients.size,
      recebidoTotal,
      recebidoCount,
      vencemHojeTotal,
      vencemHojeCount: vencemHojeList.length,
      vencemHojeList,
      saldoLivreTotal,
      saldoLivreCount: saldoLivreList.length,
      saldoLivreList,
      faixas: {
        aReceber: [
          { label: "0-15 dias", count: rec_0_15_count, val: rec_0_15_val },
          { label: "15-30 dias", count: rec_15_30_count, val: rec_15_30_val },
          { label: "30+ dias", count: rec_30_plus_count, val: rec_30_plus_val },
        ],
        emAtraso: [
          { label: "1-15 dias", count: atr_1_15_count, val: atr_1_15_val },
          { label: "15-30 dias", count: atr_15_30_count, val: atr_15_30_val },
          { label: "30+ dias", count: atr_30_plus_count, val: atr_30_plus_val },
        ],
      },
    };
  }, [receitas, period, finance?.payments]);

  // Previsão mês a mês (mês atual + 5) do saldo em aberto com vencimento
  const monthlyForecast = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return {
        key: format(d, "yyyy-MM"),
        label: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
        from: format(d, "yyyy-MM-dd"),
        to: format(end, "yyyy-MM-dd"),
        total: 0,
        count: 0,
        clients: new Set<string>(),
      };
    });
    receitas.forEach((t) => {
      if (!t.due_date || isFreeBalance(t)) return;
      const { rem, isPaid } = getTitleStatus(t);
      if (isPaid || rem <= 0) return;
      const m = months.find((x) => x.key === t.due_date!.slice(0, 7));
      if (!m) return;
      m.total += rem;
      m.count++;
      m.clients.add(t.patient_id || t.patient_name || t.payer_name || t.id);
    });
    return months;
  }, [receitas, finance?.payments]);
  const forecastMax = Math.max(1, ...monthlyForecast.map((m) => m.total));

  // Lista filtrada de títulos para exibição
  const filteredTitles = useMemo(() => {
    const today = startOfDay(new Date());

    const rows = receitas.filter((e) => {
      const { isPaid } = getTitleStatus(e);
      const isVencido = !isPaid && !isFreeBalance(e) && !!e.due_date && startOfDay(parseISO(e.due_date)) < today;

      // Filtro de sub-abas
      if (subTab === "hoje") {
        if (isPaid || isFreeBalance(e) || !e.due_date) return false;
        const dueTime = parseISO(e.due_date).getTime();
        const diff = Math.floor((dueTime - today.getTime()) / 86400000);
        if (diff !== 0) return false;
      } else if (subTab === "parcelados") {
        if (isFreeBalance(e)) return false;
        if (!e.treatment_id && !e.installment_id && !(e.description || "").includes("Parcela") && !(e.description || "").includes("Entrada")) {
          return false;
        }
      } else if (subTab === "livre") {
        if (!isFreeBalance(e)) return false;
      } else if (subTab === "cartoes") {
        const desc = (e.description || "").toLowerCase();
        const cat = (e.category || "").toLowerCase();
        if (
          !desc.includes("cartão") &&
          !desc.includes("boleto") &&
          !cat.includes("cartão") &&
          !cat.includes("boleto")
        ) {
          return false;
        }
      }

      // Filtro de status: Todos / Pendente / Vencido / Recebido (Pago)
      if (statusFilter === "pendente") {
        if (isPaid || isVencido) return false;
      } else if (statusFilter === "vencido") {
        if (isPaid || !isVencido) return false;
      } else if (statusFilter === "pago") {
        if (!isPaid) return false;
      }

      // Filtro de Associado
      if (selectedAssociado !== "todos") {
        const payer = (e.payer_name || "").toLowerCase();
        const desc = (e.description || "").toLowerCase();
        const sel = selectedAssociado.toLowerCase();
        if (!payer.includes(sel) && !desc.includes(sel)) return false;
      }

      // Período por vencimento
      if (!inPeriod(e.due_date, period)) return false;

      // Busca textual
      if (search.trim()) {
        const q = search.toLowerCase();
        const desc = (e.description || "").toLowerCase();
        const cat = (e.category || "").toLowerCase();
        const pat = (e.patient_name || "").toLowerCase();
        const pay = (e.payer_name || "").toLowerCase();
        const dates = dateSearchText(e.due_date, e.date);
        if (
          !desc.includes(q) &&
          !cat.includes(q) &&
          !pat.includes(q) &&
          !pay.includes(q) &&
          !dates.includes(q.trim())
        ) {
          return false;
        }
      }

      return true;
    });
    // Em aberto primeiro (atrasados no topo, por vencimento); recebidos depois, mais recentes primeiro
    const open = rows.filter((t) => !getTitleStatus(t).isPaid);
    const paid = rows.filter((t) => getTitleStatus(t).isPaid);
    const byDue = (a: FinancialTitle, b: FinancialTitle) =>
      (a.due_date || "9999").localeCompare(b.due_date || "9999");
    return [...open.sort(byDue), ...paid.sort((a, b) => byDue(b, a))];
  }, [receitas, subTab, statusFilter, selectedAssociado, search, period, finance?.payments]);

  // Agrupamento por cliente para a sub-aba "Central de Recebíveis por Cliente"
  const clientsGrouped = useMemo(() => {
    const map = new Map<string, { name: string; titles: FinancialTitle[]; total: number }>();
    filteredTitles.forEach((t) => {
      const clientName = t.patient_name || t.payer_name || "Cliente Avulso";
      const cur = map.get(clientName) || { name: clientName, titles: [], total: 0 };
      const { rem } = getTitleStatus(t);
      cur.titles.push(t);
      cur.total += rem > 0 ? rem : 0;
      map.set(clientName, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredTitles, finance?.payments]);

  // Abrir modal de cobrança com mensagem pronta
  const handleOpenCobrar = (title: FinancialTitle) => {
    setCobrarTitle(title);
    const client = title.patient_name || title.payer_name || "Prezado(a) Cliente";
    const desc = title.description || "honorários acordados";
    const val = currency(remaining(title) > 0 ? remaining(title) : title.amount);
    let dueStr = "sem vencimento fixado";
    if (title.due_date && !isFreeBalance(title)) {
      try {
        dueStr = format(parseISO(title.due_date), "dd/MM/yyyy");
      } catch {
        dueStr = title.due_date;
      }
    }
    const msg = `Olá, ${client}! Lembramos do vencimento referente a ${desc} no valor de ${val} com vencimento em ${dueStr}. Para sua comodidade, você pode solicitar a chave PIX ou boleto atualizado respondendo a esta mensagem. Caso já tenha efetuado o pagamento, por favor desconsidere este aviso.`;
    setCobrarMessage(msg);

    // Auto-preenchimento inteligente de telefone do paciente
    let phoneFound = "";
    if (title.patient_id) {
      try {
        const localPats = getStoredLocalPatients();
        const matched = localPats.find((p) => p.id === title.patient_id);
        if (matched?.phone) phoneFound = matched.phone;
      } catch {}
    }
    setCobrarPhone(phoneFound);
  };

  const handleSendWhatsApp = () => {
    const clean = cobrarPhone.replace(/\D/g, "");
    const encoded = encodeURIComponent(cobrarMessage);
    const url = clean
      ? `https://wa.me/55${clean}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank");
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(cobrarMessage);
    toast.success("Mensagem copiada para a área de transferência!");
  };

  return (
    <div className="min-w-0 space-y-6 pb-12">
      {/* ========================================================================= */}
      {/* 1. CABEÇALHO DA TELA COM ÍCONE AZUL E BOTÃO DE ATUALIZAR                   */}
      {/* ========================================================================= */}
      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          {onOpenNew && (
            <Button
              onClick={() => onOpenNew("receita")}
              className="h-9 px-4 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary-hover text-white shadow-xs rounded-xl cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nova Receita
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 border-border bg-card text-muted-foreground hover:bg-muted/60 shadow-xs cursor-pointer "
            onClick={() => void onRefresh?.()}
            disabled={refreshing || !onRefresh}
            title="Atualizar dados"
            aria-label="Atualizar dados"
          >
            <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. SUB-ABAS / PILLS (Geral, Vencem Hoje, Parcelados, Saldos Livres...)    */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setSubTab("geral")}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "geral"
              ? "bg-info text-white shadow-xs"
              : "border border-border bg-card text-muted-foreground hover:bg-muted/60",
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          Geral
        </button>

        <button
          type="button"
          onClick={() => setSubTab("hoje")}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "hoje"
              ? "bg-amber-600 text-white shadow-xs"
              : "border border-amber-500/30 bg-card text-amber-600 dark:text-amber-400 hover:bg-amber-500/10",
          )}
        >
          <Bell className="h-3.5 w-3.5" />
          Vencem Hoje
          {metrics.vencemHojeCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">
              {metrics.vencemHojeCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab("parcelados")}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "parcelados"
              ? "bg-info text-white shadow-xs"
              : "border border-border bg-card text-muted-foreground hover:bg-muted/60",
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          Parcelados (Com Vencimento)
        </button>

        <button
          type="button"
          onClick={() => setSubTab("livre")}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "livre"
              ? "bg-primary text-white shadow-xs"
              : "border border-primary/30 bg-card text-primary hover:bg-primary/10",
          )}
        >
          <Wallet className="h-3.5 w-3.5" />
          Saldos Livres
          {metrics.saldoLivreCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded text-[10px] bg-primary/15 font-semibold">
              {metrics.saldoLivreCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab("clientes")}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "clientes"
              ? "bg-destructive text-white shadow-xs"
              : "border border-destructive/25 bg-card text-destructive hover:bg-destructive/5",
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          Por Cliente
        </button>

        <button
          type="button"
          onClick={() => setSubTab("cartoes")}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "cartoes"
              ? "bg-info text-white shadow-xs font-semibold"
              : "border border-border bg-card text-muted-foreground hover:bg-muted/60",
          )}
        >
          <CreditCard className="h-3.5 w-3.5" />
          Cartões / Boletos
        </button>
      </div>

      {/* ========================================================================= */}
      {/* ALERTA DE COBRANÇAS DE HOJE (RÉGUA DIÁRIA PROATIVA)                       */}
      {/* ========================================================================= */}
      {metrics.vencemHojeCount > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 dark:bg-amber-950/20 p-4.5 space-y-3 shadow-xs animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded bg-amber-500/20">
                    Cobranças de Hoje
                  </span>
                  <h3 className="font-semibold text-sm text-foreground">
                    {metrics.vencemHojeCount} paciente(s) com parcela vencendo hoje ({currency(metrics.vencemHojeTotal)})
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lembre os pacientes para não perder o prazo de recebimento via WhatsApp ou confirme a baixa.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSubTab("hoje")}
              className="text-xs border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 cursor-pointer self-start sm:self-auto font-semibold"
            >
              Ver na Tabela ({metrics.vencemHojeCount})
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
            {metrics.vencemHojeList.slice(0, 6).map((item) => {
              const client = item.patient_name || item.payer_name || "Paciente";
              const val = remaining(item) > 0 ? remaining(item) : item.amount;
              return (
                <div
                  key={item.id}
                  className="bg-card border border-border/80 rounded-xl p-3 flex items-center justify-between gap-2 shadow-2xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-foreground truncate">{client}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{item.description}</div>
                    <div className="text-xs font-bold text-success mt-0.5">{currency(val)}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.status === "pago" || remaining(item) <= 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-2 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer"
                        onClick={() => onReceive(item)}
                        title="Visualizar histórico e recibo"
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Recebido
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] px-2 text-destructive border-destructive/25 hover:bg-destructive/10 cursor-pointer"
                          onClick={() => handleOpenCobrar(item)}
                          title="Enviar lembrete via WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5 mr-1" />
                          Cobrar
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-[11px] px-2.5 bg-success text-white hover:bg-success/90 cursor-pointer"
                          onClick={() => onReceive(item)}
                          title="Registrar recebimento"
                        >
                          Receber
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BANNER INFORMATIVO NA ABA DE SALDOS LIVRES */}
      {subTab === "livre" && (
        <div className="rounded-2xl border border-primary/25 bg-primary-soft/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-primary shadow-xs">
          <div className="space-y-0.5">
            <span className="font-bold uppercase tracking-wider block text-primary-hover">
              Modalidade Ativa: Saldos Livres ({metrics.saldoLivreCount} acompanhamentos em aberto)
            </span>
            <p className="text-foreground/80 leading-relaxed">
              Estes valores correspondem a acompanhamentos com pagamento sem vencimento fixado (Total: {currency(metrics.saldoLivreTotal)}).
              Eles não geram alarmes indevidos de inadimplência e recebem baixas parciais conforme os pagamentos do paciente.
              Caso o paciente decida fixar vencimentos, você pode repactuar em parcelas com data diretamente na ficha dele.
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. OS 4 CARDS DE MÉTRICAS (A RECEBER, EM ATRASO, SALDOS LIVRES, RECEBIDO) */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CARD 1: A RECEBER */}
        <div
          className={cn(
            "rounded-xl border border-border bg-card p-5 shadow-xs flex items-center justify-between cursor-pointer hover:border-info/40 transition-colors",
            subTab === "parcelados" && "ring-2 ring-info/50 border-info bg-info/5",
          )}
          onClick={() => setSubTab("parcelados")}
        >
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              A RECEBER (PREVISTO)
            </span>
            <p className="text-2xl font-semibold text-foreground tracking-tight">
              <CountUp value={metrics.aReceberTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">
              {metrics.aReceberCount} pagamentos com data
            </p>
          </div>
        </div>

        {/* CARD 2: EM ATRASO */}
        <div
          className={cn(
            "rounded-xl border border-border bg-card p-5 shadow-xs flex items-center justify-between cursor-pointer hover:border-destructive/35 transition-colors",
            statusFilter === "vencido" && "ring-2 ring-destructive/50 border-destructive bg-destructive/5",
          )}
          onClick={() => {
            setStatusFilter("vencido");
            setSubTab("geral");
          }}
        >
          <div className="space-y-1">
            <span className="text-xs font-semibold text-destructive uppercase tracking-wider flex items-center gap-1">
              EM ATRASO <ExternalLink className="h-3 w-3" />
            </span>
            <p className="text-2xl font-semibold text-destructive tracking-tight">
              <CountUp value={metrics.emAtrasoTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">
              {metrics.emAtrasoClientesCount} clientes com débitos
            </p>
          </div>
        </div>

        {/* CARD 3: SALDOS LIVRES */}
        <div
          className={cn(
            "rounded-xl border border-border bg-card p-5 shadow-xs flex items-center justify-between cursor-pointer hover:border-primary/40 transition-colors",
            subTab === "livre" && "ring-2 ring-primary/50 border-primary bg-primary-soft/50",
          )}
          onClick={() => setSubTab("livre")}
        >
          <div className="space-y-1">
            <span className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
              SALDOS LIVRES <ExternalLink className="h-3 w-3" />
            </span>
            <p className="text-2xl font-semibold text-foreground tracking-tight">
              <CountUp value={metrics.saldoLivreTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">
              {metrics.saldoLivreCount} planos a combinar
            </p>
          </div>
        </div>

        {/* CARD 4: RECEBIDO / PAGO */}
        <div
          className={cn(
            "rounded-xl border border-border bg-card p-5 shadow-xs flex items-center justify-between cursor-pointer hover:border-info/35 transition-colors",
            statusFilter === "pago" && "ring-2 ring-info/50 border-info bg-info/5",
          )}
          onClick={() => {
            setStatusFilter("pago");
            setSubTab("geral");
          }}
        >
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              RECEBIDO / PAGO <ExternalLink className="h-3 w-3" />
            </span>
            <p className="text-2xl font-semibold text-foreground tracking-tight">
              <CountUp value={metrics.recebidoTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">
              {metrics.recebidoCount} pagamentos recebidos
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. SEÇÃO EM 2 COLUNAS: RECEBIMENTOS POR VENCIMENTO & RECEBIMENTOS PREVISTOS */}
      {/* ========================================================================= */}
      <details className="group rounded-xl border border-border bg-card shadow-2xs">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground">
          Análise de recebimentos (por vencimento e previsão mensal)
          <span className="text-xs font-medium text-muted-foreground group-open:hidden">Mostrar</span>
          <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">Ocultar</span>
        </summary>
        <div className="border-t border-border-soft p-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* COLUNA ESQUERDA: RECEBIMENTOS POR VENCIMENTO */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            RECEBIMENTOS POR VENCIMENTO
          </h2>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-success uppercase tracking-wider block">
              A RECEBER
            </span>
            <div className="divide-y divide-border-soft">
              {metrics.faixas.aReceber.map((f) => (
                <div key={f.label} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{f.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-muted-foreground">{f.count} itens</span>
                    <strong className="font-semibold text-success tabular-nums min-w-[85px] text-right">
                      {currency(f.val)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <span className="text-xs font-semibold text-destructive uppercase tracking-wider block">
              EM ATRASO
            </span>
            <div className="divide-y divide-border-soft">
              {metrics.faixas.emAtraso.map((f) => (
                <div key={f.label} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{f.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-muted-foreground">{f.count} itens</span>
                    <strong className="font-semibold text-destructive tabular-nums min-w-[85px] text-right">
                      {currency(f.val)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA: RECEBIMENTOS PREVISTOS */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2">
            <div>
              <h2 className="font-semibold text-sm text-foreground">Recebimentos Previstos</h2>
              <p className="text-xs text-muted-foreground">
                Saldo em aberto por mês de vencimento · clique para ver os lançamentos
              </p>
            </div>
          </div>

          <div className="divide-y divide-border-soft py-2">
            {monthlyForecast.map((m) => {
              const active = period.from === m.from && period.to === m.to;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() =>
                    setPeriod(active ? ALL_PERIOD : { from: m.from, to: m.to, preset: "custom" })
                  }
                  className={cn(
                    "w-full py-2 px-2 rounded-lg text-left text-xs cursor-pointer hover:bg-muted/40 transition-colors",
                    active && "bg-success/10",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="capitalize font-medium text-foreground">{m.label}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">
                        {m.count} parcela(s) · {m.clients.size} cliente(s)
                      </span>
                      <strong className="font-semibold text-success tabular-nums min-w-[85px] text-right">
                        {currency(m.total)}
                      </strong>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-success"
                      style={{ width: `${(m.total / forecastMax) * 100}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-border-soft pt-3 text-center">
            <p className="text-xs text-muted-foreground">
              Clique num mês para filtrar a lista de lançamentos
            </p>
          </div>
        </div>
      </div>
        </div>
      </details>

      {/* ========================================================================= */}
      {/* 6. LISTA PRINCIPAL: HONORÁRIOS E RECEBIMENTOS                             */}
      {/* ========================================================================= */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-sm text-foreground">
            Honorários e Recebimentos ({filteredTitles.length})
          </h3>
          <span className="text-xs text-muted-foreground">
            Em aberto nesta lista:{" "}
            <strong className="text-success tabular-nums">
              {currency(filteredTitles.reduce((s, t) => s + getTitleStatus(t).rem, 0))}
            </strong>
          </span>
        </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-soft pb-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar lançamento, cliente ou data (dd/mm)..."
            className="pl-8 h-9 text-xs bg-card border-border rounded-lg placeholder:text-muted-foreground shadow-2xs"
          />
        </div>

        <PeriodFilter value={period} onChange={setPeriod} />

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Associado:</span>
            <Select value={selectedAssociado} onValueChange={setSelectedAssociado}>
              <SelectTrigger className="h-9 w-[190px] text-xs bg-card border-border rounded-lg text-foreground/80 shadow-2xs">
                <SelectValue placeholder="Todos os associados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os associados</SelectItem>
                {associadosList.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="inline-flex items-center bg-muted/60 p-0.5 rounded-lg border border-border shadow-2xs">
            <button
              type="button"
              onClick={() => setStatusFilter("todos")}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                statusFilter === "todos"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("pendente")}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                statusFilter === "pendente"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Pendente
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("vencido")}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                statusFilter === "vencido"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Vencido
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("pago")}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                statusFilter === "pago"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Recebido
            </button>
          </div>
        </div>
      </div>

        {filteredTitles.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum recebimento encontrado para os filtros selecionados.
          </div>
        ) : subTab === "clientes" ? (
          <div className="space-y-4">
            {clientsGrouped.map((grp) => (
              <div key={grp.name} className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border/50 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-info/10 text-info font-bold flex items-center justify-center text-xs">
                      {grp.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-foreground">{grp.name}</h4>
                      <span className="text-xs text-muted-foreground">
                        {grp.titles.length} lançamento(s) associado(s)
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-muted-foreground block">Total a Receber</span>
                    <strong className="font-semibold text-sm text-success">
                      {currency(grp.total)}
                    </strong>
                  </div>
                </div>

                <div className="divide-y divide-border-soft">
                  {grp.titles.map((t) => {
                    const { rem, isPaid, valorDisplay, paidAmt } = getTitleStatus(t);
                    return (
                      <div key={t.id} className="pt-2.5 pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">{t.description}</span>
                            {paidAmt > 0 && rem > 0 && (
                              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                                Sinal pago: {currency(paidAmt)}
                              </span>
                            )}
                            <span className={cn(
                              "text-[10px] font-semibold px-1.5 py-0.5 rounded-md",
                              isPaid ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                            )}>
                              {isPaid ? "Recebido" : "Pendente"}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Venc:{" "}
                            {isFreeBalance(t)
                              ? "Sem vencimento fixo"
                              : t.due_date
                                ? formatClinicalDate(t.due_date)
                                : "Sem data"}{" "}
                            · Valor: {currency(t.amount)}
                            {parcelaLabel(t) && ` · ${parcelaLabel(t)}`}
                            {rem > 0 && ` · Saldo a receber: ${currency(rem)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                          <strong className="font-semibold text-success tabular-nums">
                            {currency(valorDisplay)}
                          </strong>
                          {isPaid ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] px-2.5 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer"
                              onClick={() => onReceive(t)}
                              title="Visualizar histórico e recibo"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Recebido
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] px-2.5 text-destructive border-destructive/25 hover:bg-destructive/10 cursor-pointer"
                                onClick={() => handleOpenCobrar(t)}
                              >
                                Cobrar
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-[11px] px-3 bg-success text-white hover:bg-success/90 cursor-pointer"
                                onClick={() => onReceive(t)}
                              >
                                Receber
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
          {/* Celular / tela estreita: cards (a tabela larga empurrava Receber/Cobrar para fora da tela) */}
          <div className="divide-y divide-border-soft lg:hidden">
            {filteredTitles.map((t) => {
              const { rem, isPaid, paidAmt } = getTitleStatus(t);
              const free = isFreeBalance(t);
              const person = t.patient_name || t.payer_name || "";
              const { description, details } = rowText(t, person, free);
              const late = !isPaid && !free && !!t.due_date && startOfDay(parseISO(t.due_date)) < startOfDay(new Date());
              const status = isPaid
                ? { label: "Recebido", cls: "text-success" }
                : late
                  ? { label: "Vencido", cls: "text-destructive" }
                  : paidAmt > 0
                    ? { label: "Parcial", cls: "text-warning" }
                    : { label: "A receber", cls: "text-info" };
              return (
                <div key={t.id} className="flex items-start justify-between gap-3 py-3 text-xs">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-semibold text-foreground">{person || description}</p>
                    <p className="truncate text-muted-foreground">
                      {person ? `${description} · ` : ""}
                      {free ? "Sem vencimento" : t.due_date ? formatClinicalDate(t.due_date) : "—"}
                    </p>
                    {details && <p className="truncate text-muted-foreground">{details}</p>}
                    <p className={`font-medium ${status.cls}`}>
                      {status.label}
                      {!isPaid && paidAmt > 0 ? ` · falta ${currency(rem)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-semibold tabular-nums text-foreground">{currency(t.amount)}</span>
                    <div className="flex items-center gap-1">
                      {isPaid ? (
                        <button
                          type="button"
                          onClick={() => onReceive(t)}
                          className="h-8 cursor-pointer rounded-md px-2.5 font-medium text-muted-foreground hover:bg-muted"
                        >
                          Ver
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenCobrar(t)}
                            className="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted"
                            aria-label="Cobrar pelo WhatsApp"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onReceive(t)}
                            className="h-8 cursor-pointer rounded-md bg-success px-3 font-semibold text-white hover:bg-success/90"
                          >
                            Receber
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden lg:block">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                  <th className="w-[110px] py-2 pr-3 font-medium">Vencimento</th>
                  <th className="w-[22%] py-2 pr-3 font-medium">Paciente</th>
                  <th className="py-2 pr-3 font-medium">Descrição</th>
                  <th className="w-[110px] py-2 pr-3 font-medium">Situação</th>
                  <th className="w-[120px] py-2 pr-3 text-right font-medium">Valor</th>
                  <th className="w-[190px] py-2 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {filteredTitles.map((t) => {
                  const { rem, isPaid, paidAmt } = getTitleStatus(t);
                  const free = isFreeBalance(t);
                  const isVencido =
                    !isPaid && !free && !!t.due_date && startOfDay(parseISO(t.due_date)) < startOfDay(new Date());
                  const person = t.patient_name || t.payer_name || "";
                  // Descrição sem o nome do paciente repetido ("FULANO - Agendamento" -> "Agendamento")
                  const { description, details } = rowText(t, person, free);
                  const status = isPaid
                    ? { label: "Recebido", dot: "bg-success", text: "text-success" }
                    : isVencido
                      ? { label: "Vencido", dot: "bg-destructive", text: "text-destructive" }
                      : paidAmt > 0
                        ? { label: "Parcial", dot: "bg-warning", text: "text-warning" }
                        : { label: "A receber", dot: "bg-info", text: "text-info" };

                  return (
                    <tr key={t.id} className="align-middle transition-colors hover:bg-muted/40">
                      <td className="whitespace-nowrap py-3 pr-3 tabular-nums text-foreground">
                        {free ? <span className="text-muted-foreground">Sem vencimento</span> : t.due_date ? formatClinicalDate(t.due_date) : "—"}
                      </td>
                      <td className="truncate py-3 pr-3 font-medium text-foreground">{person || "—"}</td>
                      <td className="py-3 pr-3">
                        <p className="truncate font-medium text-foreground">{description}</p>
                        {(details || t.treatment_id) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {details}
                            {t.treatment_id && (
                              <>
                                {details ? " · " : ""}
                                <Link
                                  to="/acompanhamentos/$id"
                                  params={{ id: t.treatment_id }}
                                  search={{ tab: "financeiro" }}
                                  className="text-primary hover:underline"
                                >
                                  ver plano
                                </Link>
                              </>
                            )}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status.text}`}>
                          <span className={`size-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                          {status.label}
                        </span>
                        {paidAmt > 0 && rem > 0 && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {currency(paidAmt)} pago
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right tabular-nums">
                        <p className="font-semibold text-foreground">{currency(t.amount)}</p>
                        {!isPaid && paidAmt > 0 && (
                          <p className="text-xs text-warning">falta {currency(rem)}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-0.5">
                          {isPaid ? (
                            <button
                              type="button"
                              onClick={() => onReceive(t)}
                              className="h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Ver pagamentos e comprovante"
                            >
                              Ver
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => onReceive(t)}
                                className="mr-1 h-8 cursor-pointer rounded-md bg-success px-3 text-xs font-semibold text-white hover:bg-success/90"
                              >
                                Receber
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenCobrar(t)}
                                className="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="Cobrar pelo WhatsApp"
                                aria-label="Cobrar pelo WhatsApp"
                              >
                                <MessageCircle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => onEdit(t)}
                            className="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Editar"
                            aria-label="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(t.id)}
                            className="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Excluir"
                            aria-label="Excluir"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 7. MODAL DE COBRANÇA VIA WHATSAPP                                         */}
      {/* ========================================================================= */}
      <Dialog open={!!cobrarTitle} onOpenChange={(open) => !open && setCobrarTitle(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <MessageCircle className="h-4 w-4 text-success" />
              Notificação e Cobrança via WhatsApp
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Envie um lembrete cordial de cobrança ou copie o texto para enviar ao cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-foreground/80">
                WhatsApp / Telefone do Cliente
              </Label>
              <Input
                placeholder="Ex: 11999998888 (com DDD)"
                value={cobrarPhone}
                onChange={(e) => setCobrarPhone(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-foreground/80">
                Mensagem da Cobrança
              </Label>
              <textarea
                rows={4}
                value={cobrarMessage}
                onChange={(e) => setCobrarMessage(e.target.value)}
                className="w-full rounded-lg border border-border p-2.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-info resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 cursor-pointer"
              onClick={handleCopyMessage}
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar Mensagem
            </Button>
            <Button
              size="sm"
              className="bg-success hover:bg-success/90 text-white text-xs font-semibold gap-1.5 cursor-pointer"
              onClick={handleSendWhatsApp}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir no WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ContasReceberTab;

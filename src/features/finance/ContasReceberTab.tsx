import React, { useState, useMemo, useEffect } from "react";
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
} from "lucide-react";
import { parseISO, startOfDay, format } from "date-fns";
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

export interface ContasReceberTabProps {
  finance: FinanceSnapshot;
  onRefresh?: () => Promise<unknown> | void;
  refreshing?: boolean;
  onOpenNew?: (type?: "receita" | "despesa") => void;
  onEdit: (entry: FinancialTitle) => void;
  onReceive: (entry: FinancialTitle) => void;
  onDelete: (id: string) => void;
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
  const [subTab, setSubTab] = useState<"geral" | "clientes" | "cartoes" | "parcelados">("geral");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "pendente" | "vencido">("todos");
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
        const { data } = await supabase.from("profiles").select("name").not("name", "is", null);
        if (data && data.length > 0) {
          const names = Array.from(new Set(data.map((d: { name: string }) => d.name).filter(Boolean)));
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

  // Cálculos de KPIs e Envelhecimento (Aging por Vencimento)
  const metrics = useMemo(() => {
    const today = startOfDay(new Date());
    const todayTime = today.getTime();

    let aReceberTotal = 0;
    let aReceberCount = 0;
    let emAtrasoTotal = 0;
    let emAtrasoCount = 0;
    let recebidoTotal = 0;
    let recebidoCount = 0;

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
      const paid = Number(e.paid_amount ?? (e.status === "pago" ? e.amount : 0));
      const rem = remaining(e);
      const isPaid = e.status === "pago" || rem <= 0;

      if (paid > 0) {
        recebidoTotal += paid;
        recebidoCount++;
      }

      if (isPaid) return;

      const amt = rem;
      const clientIdentifier = e.patient_id || e.patient_name || e.payer_name || e.id;

      if (!e.due_date) {
        aReceberTotal += amt;
        aReceberCount++;
        rec_0_15_count++;
        rec_0_15_val += amt;
        return;
      }

      const dueTime = parseISO(e.due_date).getTime();
      const diff = Math.floor((dueTime - todayTime) / 86400000);

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
        // A receber (a vencer)
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
  }, [receitas]);

  // Lista filtrada de títulos para exibição
  const filteredTitles = useMemo(() => {
    const today = startOfDay(new Date());

    return receitas.filter((e) => {
      const rem = remaining(e);
      const isPaid = e.status === "pago" || rem <= 0;
      const isVencido = !isPaid && !!e.due_date && startOfDay(parseISO(e.due_date)) < today;

      // Filtro de sub-abas
      if (subTab === "cartoes") {
        const desc = (e.description || "").toLowerCase();
        const cat = (e.category || "").toLowerCase();
        if (!desc.includes("cartão") && !desc.includes("boleto") && !cat.includes("cartão") && !cat.includes("boleto")) {
          return false;
        }
      } else if (subTab === "parcelados") {
        if (!e.treatment_id && !e.installment_id && !(e.description || "").includes("Parcela")) {
          return false;
        }
      }

      // Filtro de status: Todos / Pendente / Vencido
      if (statusFilter === "todos") {
        if (isPaid) return false;
      } else if (statusFilter === "pendente") {
        if (isPaid || isVencido) return false;
      } else if (statusFilter === "vencido") {
        if (isPaid || !isVencido) return false;
      }

      // Filtro de Associado
      if (selectedAssociado !== "todos") {
        const payer = (e.payer_name || "").toLowerCase();
        const desc = (e.description || "").toLowerCase();
        const sel = selectedAssociado.toLowerCase();
        if (!payer.includes(sel) && !desc.includes(sel)) return false;
      }

      // Busca textual
      if (search.trim()) {
        const q = search.toLowerCase();
        const desc = (e.description || "").toLowerCase();
        const cat = (e.category || "").toLowerCase();
        const pat = (e.patient_name || "").toLowerCase();
        const pay = (e.payer_name || "").toLowerCase();
        if (!desc.includes(q) && !cat.includes(q) && !pat.includes(q) && !pay.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [receitas, subTab, statusFilter, selectedAssociado, search]);

  // Agrupamento por cliente para a sub-aba "Central de Recebíveis por Cliente"
  const clientsGrouped = useMemo(() => {
    const map = new Map<string, { name: string; titles: FinancialTitle[]; total: number }>();
    filteredTitles.forEach((t) => {
      const clientName = t.patient_name || t.payer_name || "Cliente Avulso";
      const cur = map.get(clientName) || { name: clientName, titles: [], total: 0 };
      cur.titles.push(t);
      cur.total += remaining(t) > 0 ? remaining(t) : t.amount;
      map.set(clientName, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredTitles]);

  // Abrir modal de cobrança com mensagem pronta
  const handleOpenCobrar = (title: FinancialTitle) => {
    setCobrarTitle(title);
    const client = title.patient_name || title.payer_name || "Prezado(a) Cliente";
    const desc = title.description || "honorários acordados";
    const val = currency(remaining(title) > 0 ? remaining(title) : title.amount);
    let dueStr = "sem vencimento definido";
    if (title.due_date) {
      try {
        dueStr = format(parseISO(title.due_date), "dd/MM/yyyy");
      } catch {
        dueStr = title.due_date;
      }
    }
    const msg = `Olá, ${client}! Lembramos do vencimento referente a ${desc} no valor de ${val} com vencimento em ${dueStr}. Para sua comodidade, você pode solicitar a chave PIX ou boleto atualizado respondendo a esta mensagem. Caso já tenha efetuado o pagamento, por favor desconsidere este aviso.`;
    setCobrarMessage(msg);
    setCobrarPhone("");
  };

  const handleSendWhatsApp = () => {
    const clean = cobrarPhone.replace(/\D/g, "");
    const encoded = encodeURIComponent(cobrarMessage);
    const url = clean ? `https://wa.me/55${clean}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank");
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(cobrarMessage);
    toast.success("Mensagem copiada para a área de transferência!");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ========================================================================= */}
      {/* 1. CABEÇALHO DA TELA COM ÍCONE AZUL E BOTÃO DE ATUALIZAR                   */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
            <ArrowUpRight className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Contas a Receber
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Honorários contratuais, parcelas de clientes e alertas de cobrança
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-xs cursor-pointer rounded-lg"
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
      {/* 2. SUB-ABAS / PILLS (Geral, Central de Recebíveis, Cartões, Honorários)      */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setSubTab("geral")}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "geral"
              ? "bg-blue-600 text-white shadow-xs"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          Geral
        </button>

        <button
          type="button"
          onClick={() => setSubTab("clientes")}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "clientes"
              ? "bg-rose-600 text-white shadow-xs"
              : "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50/50"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          Central de Recebíveis por Cliente
        </button>

        <button
          type="button"
          onClick={() => setSubTab("cartoes")}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "cartoes"
              ? "bg-blue-600 text-white shadow-xs font-semibold"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          <CreditCard className="h-3.5 w-3.5" />
          Cartões / Boletos
        </button>

        <button
          type="button"
          onClick={() => setSubTab("parcelados")}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer",
            subTab === "parcelados"
              ? "bg-blue-600 text-white shadow-xs font-semibold"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          Honorários Parcelados
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. OS 3 CARDS DE MÉTRICAS (A RECEBER, EM ATRASO, RECEBIDO MANUAL)          */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CARD 1: A RECEBER */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              A RECEBER
            </span>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              <CountUp value={metrics.aReceberTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              {metrics.aReceberCount} pagamentos previstos
            </p>
          </div>
          <div className="h-9 w-9 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4" />
          </div>
        </div>

        {/* CARD 2: EM ATRASO */}
        <div
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between cursor-pointer hover:border-rose-300 transition-colors"
          onClick={() => setStatusFilter("vencido")}
        >
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-rose-500 uppercase tracking-wider flex items-center gap-1">
              EM ATRASO <ExternalLink className="h-3 w-3" />
            </span>
            <p className="text-2xl font-bold text-rose-600 tracking-tight">
              <CountUp value={metrics.emAtrasoTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              {metrics.emAtrasoClientesCount} clientes com débitos
            </p>
          </div>
          <div className="h-9 w-9 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>

        {/* CARD 3: RECEBIDO (MANUAL) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              RECEBIDO (MANUAL)
            </span>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              <CountUp value={metrics.recebidoTotal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              {metrics.recebidoCount} pagamentos recebidos
            </p>
          </div>
          <div className="h-9 w-9 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. SEÇÃO EM 2 COLUNAS: RECEBIMENTOS POR VENCIMENTO & RECEBIMENTOS PREVISTOS */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* COLUNA ESQUERDA: RECEBIMENTOS POR VENCIMENTO */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            RECEBIMENTOS POR VENCIMENTO
          </h2>

          <div className="space-y-2">
            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">
              A RECEBER
            </span>
            <div className="divide-y divide-slate-100">
              {metrics.faixas.aReceber.map((f) => (
                <div key={f.label} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{f.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-400">{f.count} itens</span>
                    <strong className="font-bold text-emerald-600 tabular-nums min-w-[85px] text-right">
                      {currency(f.val)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wider block">
              EM ATRASO
            </span>
            <div className="divide-y divide-slate-100">
              {metrics.faixas.emAtraso.map((f) => (
                <div key={f.label} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{f.label}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-400">{f.count} itens</span>
                    <strong className="font-bold text-rose-600 tabular-nums min-w-[85px] text-right">
                      {currency(f.val)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA: RECEBIMENTOS PREVISTOS */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Recebimentos Previstos</h2>
              <p className="text-xs text-slate-400">Próximos 6 meses</p>
            </div>
          </div>

          <div className="py-12 flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 rounded-full bg-emerald-50/70 text-emerald-600 flex items-center justify-center mb-2.5">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <p className="text-xs text-slate-500">
              Nenhum recebimento previsto além do período
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3 text-center">
            <p className="text-[11px] text-slate-400">
              Atualizado automaticamente com parcelamentos de honorários
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 5. BARRA DE FILTROS: BUSCA, SELETOR DE ASSOCIADO E PILLS (TODOS/PENDENTE)  */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="relative w-full sm:w-[280px]">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar lançamento ou cliente..."
            className="pl-8 h-9 text-xs bg-white border-slate-200 rounded-lg placeholder:text-slate-400 shadow-2xs"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Associado:</span>
            <Select value={selectedAssociado} onValueChange={setSelectedAssociado}>
              <SelectTrigger className="h-9 w-[190px] text-xs bg-white border-slate-200 rounded-lg text-slate-700 shadow-2xs">
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

          <div className="inline-flex items-center bg-slate-50 p-0.5 rounded-lg border border-slate-200 shadow-2xs">
            <button
              type="button"
              onClick={() => setStatusFilter("todos")}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                statusFilter === "todos"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800"
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
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800"
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
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Vencido
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 6. LISTA PRINCIPAL: HONORÁRIOS E RECEBIMENTOS                             */}
      {/* ========================================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
        <h3 className="font-bold text-sm text-slate-900">
          Honorários e Recebimentos ({filteredTitles.length})
        </h3>

        {filteredTitles.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Nenhum recebimento encontrado para os filtros selecionados.
          </div>
        ) : subTab === "clientes" ? (
          <div className="divide-y divide-slate-100">
            {clientsGrouped.map((grp) => (
              <div key={grp.name} className="py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{grp.name}</h4>
                    <span className="text-xs text-slate-400">
                      {grp.titles.length} lançamento(s) associado(s)
                    </span>
                  </div>
                  <strong className="font-bold text-sm text-emerald-600">{currency(grp.total)}</strong>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredTitles.map((t) => {
              const rem = remaining(t);
              const isPaid = t.status === "pago" || rem <= 0;
              const isVencido = !isPaid && !!t.due_date && startOfDay(parseISO(t.due_date)) < startOfDay(new Date());

              const clientName = (t.patient_name || t.payer_name || "Cliente").toUpperCase();
              const associadoName = (t.payer_name || associadosList[0] || "GUILHERME SANTOS TEIXEIRA").toUpperCase();
              const formattedDue = t.due_date ? formatClinicalDate(t.due_date) : "Sem data";
              const tagCategory = t.category || "Honorários Iniciais / sinal";
              const valorDisplay = rem > 0 ? rem : t.amount;

              return (
                <div
                  key={t.id}
                  className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/50 rounded-lg px-2 transition-colors"
                >
                  {/* Informações à Esquerda */}
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900 truncate">
                        {t.description || "Honorários - Ação de Cobrança"}
                      </span>

                      {/* Tag 1: Categoria / Sub-categoria */}
                      <span className="inline-flex items-center text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                        {tagCategory}
                      </span>

                      {/* Tag 2: Status */}
                      <span
                        className={cn(
                          "inline-flex items-center text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full",
                          isPaid
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : isVencido
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                        )}
                      >
                        {isPaid ? "Recebido" : isVencido ? "Vencido" : "Pendente"}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 truncate">
                      Vencimento: {formattedDue} · Cliente: {clientName} ·{" "}
                      <span className="text-blue-600 font-medium">Associado: {associadoName}</span>
                    </p>
                  </div>

                  {/* Ações e Valor à Direita */}
                  <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                    <strong className="font-bold text-sm text-emerald-600 tabular-nums">
                      {currency(valorDisplay)}
                    </strong>

                    {/* Botão Cobrar */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-rose-200 bg-white text-rose-600 hover:bg-rose-50 text-xs font-semibold px-3 rounded-lg flex items-center gap-1.5 shadow-2xs cursor-pointer"
                      onClick={() => handleOpenCobrar(t)}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Cobrar
                    </Button>

                    {/* Botão Receber */}
                    <Button
                      size="sm"
                      className="h-8 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-4 rounded-lg shadow-2xs cursor-pointer"
                      onClick={() => onReceive(t)}
                    >
                      Receber
                    </Button>

                    {/* Botão Editar */}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                      title="Editar título"
                      onClick={() => onEdit(t)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>

                    {/* Botão Cancelar / Excluir */}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                      title="Excluir / Cancelar título"
                      onClick={() => onDelete(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 7. MODAL DE COBRANÇA VIA WHATSAPP                                         */}
      {/* ========================================================================= */}
      <Dialog open={!!cobrarTitle} onOpenChange={(open) => !open && setCobrarTitle(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              Notificação e Cobrança via WhatsApp
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Envie um lembrete cordial de cobrança ou copie o texto para enviar ao cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">WhatsApp / Telefone do Cliente</Label>
              <Input
                placeholder="Ex: 11999998888 (com DDD)"
                value={cobrarPhone}
                onChange={(e) => setCobrarPhone(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Mensagem da Cobrança</Label>
              <textarea
                rows={4}
                value={cobrarMessage}
                onChange={(e) => setCobrarMessage(e.target.value)}
                className="w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-600 resize-none"
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
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold gap-1.5 cursor-pointer"
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

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, localDate } from "@/features/acompanhamentos/followup-utils";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Building2,
  Tag,
  CreditCard,
  CheckCircle2,
  Wallet,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import { refreshFinance } from "./finance-api";
import { CategoryModal } from "./CategoriesManager";
import { getFinanceCategories } from "./finance-categories";
import { parseMoneyBR } from "@/lib/money";
import { todayLocal } from "@/lib/date-utils";

const EXPENSE_CATEGORIES_DEFAULT = [
  "Aluguel e Condomínio",
  "Água, Luz, Telefone e Internet",
  "Materiais e Insumos Médicos",
  "Medicamentos e Farmácia",
  "Equipamentos e Manutenção",
  "Salários e Pró-labore",
  "Honorários e Repasses Médicos",
  "Impostos, Taxas e Contabilidade",
  "Marketing e Publicidade",
  "Despesas Gerais e Administrativas",
];

const INCOME_CATEGORIES_DEFAULT = [
  "Consultas e Atendimentos",
  "Procedimentos e Cirurgias",
  "Venda de Produtos e Insumos",
  "Outras Receitas",
];

function parseMoneyValue(val: string | number): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  return parseMoneyBR(String(val).replace(/[^\d.,]/g, "")) ?? 0;
}

export default function NewTitle({
  finance,
  type,
  onClose,
  defaultPaidNow,
}: {
  finance: FinanceSnapshot;
  type: FinancialTitle["type"];
  onClose: () => void;
  defaultPaidNow?: boolean;
}) {
  const qc = useQueryClient();
  const isExpense = type === "despesa";

  const scopes = finance.scopes.filter((s) => s.can_create && (type === "receita" || s.can_pay));
  const [scope, setScope] = useState(scopes[0]?.id ?? "legacy");
  const company = scope === "legacy" ? null : scope;

  // Campos Essenciais
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => localDate());
  const [category, setCategory] = useState(isExpense ? "Despesas Gerais e Administrativas" : "Consultas e Atendimentos");
  const [payer, setPayer] = useState("");
  const [patient, setPatient] = useState("");

  // Opção de Baixa Imediata (já paga / recebida hoje à vista)
  const [isPaidNow, setIsPaidNow] = useState(defaultPaidNow ?? false);
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [selectedAccount, setSelectedAccount] = useState(() => {
    return finance.accounts[0]?.id || "00000000-0000-0000-0000-000000000001";
  });

  const [busy, setBusy] = useState(false);
  const [createCatOpen, setCreateCatOpen] = useState(false);

  // Classificação automática pela data: futura = prevista (a receber/a pagar);
  // hoje ou passada = realizada, se marcada como paga.
  const isFutureDate = Boolean(dueDate) && dueDate > localDate();
  React.useEffect(() => {
    if (isFutureDate) setIsPaidNow(false);
    else if (defaultPaidNow) setIsPaidNow(true);
  }, [isFutureDate, defaultPaidNow]);
  const classification = isPaidNow && !isFutureDate
    ? isExpense
      ? { label: "Saída", hint: "sai do caixa na data informada", cls: "border-destructive/30 bg-destructive/8 text-destructive" }
      : { label: "Entrada", hint: "entra no caixa na data informada", cls: "border-success/30 bg-success/10 text-success" }
    : isExpense
      ? { label: "Saída prevista", hint: "fica em contas a pagar até ser paga", cls: "border-destructive/20 bg-destructive/5 text-destructive/80" }
      : { label: "Entrada prevista", hint: "fica em contas a receber até ser recebida", cls: "border-success/20 bg-success/5 text-success/80" };

  // Busca categorias cadastradas (banco de dados + cache local)
  const categoriesQuery = useQuery({
    queryKey: ["financial-title-categories"],
    queryFn: getFinanceCategories,
    staleTime: 30000,
  });

  const availableCategories = React.useMemo(() => {
    const fromDb = (categoriesQuery.data || [])
      .filter((c: any) => c.type === (isExpense ? "expense" : "income"))
      .map((c: any) => c.name);

    const defaults = isExpense ? EXPENSE_CATEGORIES_DEFAULT : INCOME_CATEGORIES_DEFAULT;
    return Array.from(new Set([...defaults, ...fromDb])).filter(Boolean);
  }, [categoriesQuery.data, isExpense]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const numAmount = parseMoneyValue(amount);
    if (!description.trim()) {
      toast.error(isExpense ? "Por favor, informe a descrição da despesa." : "Por favor, informe a descrição da receita.");
      return;
    }
    if (numAmount <= 0) {
      toast.error("Por favor, informe um valor válido maior que R$ 0,00.");
      return;
    }
    if (!dueDate) {
      toast.error("Por favor, informe a data de vencimento.");
      return;
    }
    if (!category) {
      toast.error("Por favor, selecione uma categoria.");
      return;
    }

    setBusy(true);
    try {
      const titleId = crypto.randomUUID();
      const todayStr = todayLocal();
      // Competência calculada automaticamente a partir do vencimento (primeiro dia do mês)
      const competenceStr = dueDate.slice(0, 7) + "-01";
      const resolvedPayer = payer.trim() || (isExpense ? "Despesa da clínica" : "Cliente");

      const { error: titleError } = await supabase.rpc("create_financial_title", {
        p_id: titleId,
        p_type: type,
        p_amount: numAmount,
        p_due_date: dueDate,
        p_competence_date: competenceStr,
        p_description: description.trim(),
        p_category: category,
        p_company_id: company,
        p_patient_id: type === "receita" ? patient || null : null,
        p_payer_name: resolvedPayer,
      });
      if (titleError) throw titleError;

      // Se o usuário marcou como já pago, registra a baixa no mesmo fluxo do Financeiro
      if (isPaidNow && !isFutureDate) {
        // Conta precisa ser da mesma clínica do lançamento (ou "legado", sem clínica)
        const validAccounts = finance.accounts.filter(
          (a) => a.active && (!company || !a.company_id || a.company_id === company),
        );
        const accountId = validAccounts.some((a) => a.id === selectedAccount)
          ? selectedAccount
          : validAccounts[0]?.id;
        const { error: payError } = accountId
          ? await supabase.rpc("record_financial_payment", {
              p_id: crypto.randomUUID(),
              p_transaction_id: titleId,
              p_amount: numAmount,
              // Pagamento na data informada (lançamento retroativo cai no dia certo do caixa)
              p_paid_on: dueDate <= todayStr ? dueDate : todayStr,
              p_method: paymentMethod.toLowerCase(),
              p_account_id: accountId,
              p_payer_name: resolvedPayer,
            })
          : {
              error: new Error(
                "nenhuma conta financeira ativa nesta clínica. Cadastre em Financeiro → Contas",
              ),
            };
        if (payError) {
          await refreshFinance(qc);
          toast.warning("Lançamento criado, mas a baixa não foi registrada", {
            description: `${errorMessage(payError)}. Registre o pagamento pelo histórico do título.`,
          });
          onClose();
          return;
        }
      }
      await refreshFinance(qc);
      toast.success(
        `${classification.label} lançada com sucesso.`
      );
      onClose();
    } catch (err: any) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg p-0 gap-0 rounded-2xl border-border bg-card">
        {/* CABEÇALHO */}
        <div className="p-6 pb-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div
              className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 shadow-xs ${
                isExpense
                  ? "bg-destructive/10 text-destructive border border-destructive/20"
                  : "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
              }`}
            >
              {isExpense ? (
                <ArrowDownLeft className="h-6 w-6" strokeWidth={2.5} />
              ) : (
                <ArrowUpRight className="h-6 w-6" strokeWidth={2.5} />
              )}
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
                {isExpense ? "Nova Conta a Pagar" : "Nova Conta a Receber"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {isExpense
                  ? "Cadastre uma despesa da clínica de forma rápida e objetiva."
                  : "Cadastre uma receita ou cobrança manual da clínica."}
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* FORMULÁRIO ENXUTO */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {scopes.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Clínica
              </Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="h-10 text-sm rounded-xl">
                  <SelectValue placeholder="Selecione a clínica" />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((s) => (
                    <SelectItem key={s.id ?? "legacy"} value={s.id ?? "legacy"}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 1. DESCRIÇÃO DA DESPESA */}
          <div className="space-y-1.5">
            <Label htmlFor="title-desc" className="text-xs font-semibold text-foreground">
              {isExpense ? "Descrição da Despesa" : "Descrição da Receita"} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title-desc"
              autoFocus
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isExpense
                  ? "Ex: Aluguel da clínica, Energia elétrica, Sabesp, Materiais..."
                  : "Ex: Consulta particular avulsa, Procedimento..."
              }
              className="h-10 text-sm rounded-xl bg-background"
            />
          </div>

          {/* 2. VALOR E VENCIMENTO LADO A LADO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="title-amount" className="text-xs font-semibold text-foreground">
                Valor (R$) <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                  R$
                </span>
                <Input
                  id="title-amount"
                  required
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="h-10 pl-9 text-sm font-semibold rounded-xl bg-background"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title-due" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Data de Vencimento <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title-due"
                required
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-10 text-sm rounded-xl bg-background"
              />
            </div>
          </div>

          {/* 3. CATEGORIA */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" /> Categoria <span className="text-destructive">*</span>
              </Label>
              <button
                type="button"
                onClick={() => setCreateCatOpen(true)}
                className="text-xs text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
                title="Cadastrar nova categoria sem perder os dados preenchidos"
              >
                <Plus className="h-3 w-3" />
                Nova categoria
              </button>
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-10 text-sm rounded-xl bg-background">
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {availableCategories.map((cat) => (
                  <SelectItem key={cat} value={cat} className="text-sm">
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 4. FORNECEDOR / FAVORECIDO (OPCIONAL) */}
          <div className="space-y-1.5">
            <Label htmlFor="title-payer" className="text-xs font-semibold text-foreground">
              {isExpense ? "Fornecedor / Favorecido" : "Paciente / Pagador"}{" "}
              <span className="text-xs text-muted-foreground font-normal">(Opcional)</span>
            </Label>
            <Input
              id="title-payer"
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
              placeholder={
                isExpense
                  ? "Ex: Enel, Sabesp, Dental Cremer, Imobiliária (opcional)"
                  : "Ex: Nome do paciente ou pagador (opcional)"
              }
              className="h-10 text-sm rounded-xl bg-background"
            />
          </div>

          {/* Como o lançamento vai entrar no fluxo de caixa (classificação automática) */}
          <div className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 ${classification.cls}`}>
            <span className="text-sm font-semibold">Vai entrar como: {classification.label}</span>
            <span className="text-right text-[11px] opacity-80">{classification.hint}</span>
          </div>

          {/* 5. BOX DE QUITAÇÃO IMEDIATA (BAIXA RÁPIDA NO CAIXA / FLUXO DE CAIXA) */}
          {isFutureDate ? (
            <p className="rounded-2xl border border-border/80 bg-muted/30 p-4 text-xs text-muted-foreground">
              Data futura: o valor fica como <strong>previsto</strong>. Quando for pago, use
              <strong> Receber/Pagar</strong> na aba <strong>Previstos</strong> do Fluxo de caixa.
            </p>
          ) : (
          <div
            className={`rounded-2xl border p-4 space-y-3 transition-colors ${
              isPaidNow
                ? "border-emerald-500/40 bg-emerald-500/5 shadow-2xs"
                : "border-border/80 bg-muted/30"
            }`}
          >
            <div className="flex items-start gap-2.5 cursor-pointer" onClick={() => setIsPaidNow(!isPaidNow)}>
              <Checkbox
                id="is-paid-now"
                checked={isPaidNow}
                onCheckedChange={(checked) => setIsPaidNow(Boolean(checked))}
                className="mt-0.5 rounded-md"
              />
              <div className="space-y-0.5">
                <label
                  htmlFor="is-paid-now"
                  className="text-xs font-semibold text-foreground cursor-pointer select-none flex items-center gap-1.5"
                >
                  <span>
                    {isExpense
                      ? "Despesa à vista / já paga (Lançar no Fluxo de Caixa)"
                      : "Receita à vista / já recebida (Lançar no Fluxo de Caixa)"}
                  </span>
                  {isPaidNow && (
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      Fluxo de Caixa
                    </span>
                  )}
                </label>
                <p className="text-[11px] text-muted-foreground select-none">
                  {isExpense
                    ? "Lança imediatamente a saída no Fluxo de Caixa Realizado e debita da conta bancária da clínica."
                    : "Lança imediatamente a entrada no Fluxo de Caixa Realizado e credita na conta bancária da clínica."}
                </p>
              </div>
            </div>

            {isPaidNow && (
              <div className="pt-2 border-t border-emerald-500/20 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                    <CreditCard className="h-3 w-3" /> Forma de Pagamento
                  </Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-9 text-xs rounded-lg bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PIX">PIX</SelectItem>
                      <SelectItem value="DINHEIRO">Dinheiro</SelectItem>
                      <SelectItem value="CARTAO_DEBITO">Cartão de Débito</SelectItem>
                      <SelectItem value="CARTAO_CREDITO">Cartão de Crédito</SelectItem>
                      <SelectItem value="TRANSFERENCIA">Transferência / TED</SelectItem>
                      <SelectItem value="BOLETO">Boleto Bancário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                    <Wallet className="h-3 w-3" /> {isExpense ? "Conta de Saída" : "Conta de Entrada"}
                  </Label>
                  <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                    <SelectTrigger className="h-9 text-xs rounded-lg bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {finance.accounts
                        .filter((a) => a.active && (!company || !a.company_id || a.company_id === company))
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 pt-0.5">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>
                    Confirmado: este valor aparecerá instantaneamente no relatório e no gráfico do Fluxo de Caixa.
                  </span>
                </div>
              </div>
            )}
          </div>
          )}

          {/* BOTÕES DE AÇÃO */}
          <DialogFooter className="pt-3 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
              className="h-10 px-4 text-xs font-semibold rounded-xl cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className={`h-10 px-5 text-xs font-semibold rounded-xl text-white cursor-pointer shadow-xs gap-1.5 ${
                isExpense ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90"
              }`}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Salvando...
                </>
              ) : isExpense ? (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Salvar Despesa
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Salvar Receita
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <CategoryModal
        open={createCatOpen}
        onOpenChange={setCreateCatOpen}
        defaultType={isExpense ? "expense" : "income"}
        onSuccess={(newCat) => {
          setCategory(newCat.name);
          void categoriesQuery.refetch();
        }}
      />
    </Dialog>
  );
}

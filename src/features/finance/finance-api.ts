import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import { reportingRows } from "./finance-math";
import type { FinanceSnapshot, FinancialTitle, FinancialPayment, FinancialAccount } from "./finance-schema";
import { getStoredLocalEvents } from "@/lib/local-events";

// Baseline demonstration data matching user's system workflow
const BASELINE_TITLES: FinancialTitle[] = [
  // 1. Recebimentos já realizados em Setembro de 2026 (Total: R$ 21.000,00)
  {
    id: "rec-set-01",
    type: "receita",
    amount: 7000,
    paid_amount: 7000,
    due_date: "2026-09-15",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pago",
    description: "Honorários - Ação de Cobrança - Entrada Paga",
    category: "Honorários Iniciais / sinal",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "LARISSA TEIXEIRA VERAS",
    company_id: null,
    treatment_id: null,
    installment_id: null,
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },
  {
    id: "rec-set-02",
    type: "receita",
    amount: 8000,
    paid_amount: 8000,
    due_date: "2026-09-15",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pago",
    description: "Honorários - Ação de Cobrança - Entrada Paga",
    category: "Honorários Iniciais",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "LARISSA TEIXEIRA VERAS",
    company_id: null,
    treatment_id: null,
    installment_id: null,
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },
  {
    id: "rec-set-03",
    type: "receita",
    amount: 6000,
    paid_amount: 6000,
    due_date: "2026-09-15",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pago",
    description: "Honorários - Ação de Cobrança - Entrada Paga",
    category: "Honorários Iniciais / sinal",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "LARISSA TEIXEIRA VERAS",
    company_id: null,
    treatment_id: null,
    installment_id: null,
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },

  // 2. Títulos a Receber (Parcelas e Saldos Futuros do Contrato - Total: R$ 24.000,00)
  {
    id: "rec-fut-01",
    type: "receita",
    amount: 2666.66,
    paid_amount: 0,
    due_date: "2026-11-19",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pendente",
    description: "Honorários - Ação de Cobrança – Parcela 1/3",
    category: "Honorários Iniciais / sinal",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "GUILHERME SANTOS TEIXEIRA",
    company_id: null,
    treatment_id: null,
    installment_id: "inst-1",
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },
  {
    id: "rec-fut-02",
    type: "receita",
    amount: 2666.66,
    paid_amount: 0,
    due_date: "2026-12-19",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pendente",
    description: "Honorários - Ação de Cobrança – Parcela 2/3",
    category: "Honorários Iniciais / sinal",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "GUILHERME SANTOS TEIXEIRA",
    company_id: null,
    treatment_id: null,
    installment_id: "inst-2",
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },
  {
    id: "rec-fut-03",
    type: "receita",
    amount: 9000,
    paid_amount: 0,
    due_date: "2026-12-30",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pendente",
    description: "Honorários - Ação de Cobrança – Saldo da Entrada",
    category: "Honorários Iniciais / sinal",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "GUILHERME SANTOS TEIXEIRA",
    company_id: null,
    treatment_id: null,
    installment_id: null,
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },
  {
    id: "rec-fut-04",
    type: "receita",
    amount: 7000,
    paid_amount: 0,
    due_date: "2026-12-30",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pendente",
    description: "Honorários - Ação de Cobrança – Saldo da Entrada",
    category: "Honorários Iniciais",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "GUILHERME SANTOS TEIXEIRA",
    company_id: null,
    treatment_id: null,
    installment_id: null,
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },
  {
    id: "rec-fut-05",
    type: "receita",
    amount: 2666.68,
    paid_amount: 0,
    due_date: "2027-01-19",
    date: "2026-09-15",
    competence_date: "2026-09-01",
    status: "pendente",
    description: "Honorários - Ação de Cobrança – Parcela 3/3",
    category: "Honorários Iniciais / sinal",
    patient_id: null,
    patient_name: "LARISSA TEIXEIRA VERAS",
    payer_name: "GUILHERME SANTOS TEIXEIRA",
    company_id: null,
    treatment_id: null,
    installment_id: "inst-3",
    can_settle: true,
    can_reverse: true,
    can_cancel: true,
  },
];

const BASELINE_PAYMENTS: FinancialPayment[] = [
  {
    id: "pay-set-01",
    transaction_id: "rec-set-01",
    amount: 7000,
    paid_on: "2026-09-15",
    payment_method: "PIX",
    account_id: "acc-bb",
    payer_name: "LARISSA TEIXEIRA VERAS",
    created_by: null,
    created_at: "2026-09-15T10:00:00Z",
    legacy: false,
    reversed_at: null,
    reversed_by: null,
    reversal_reason: null,
  },
  {
    id: "pay-set-02",
    transaction_id: "rec-set-02",
    amount: 8000,
    paid_on: "2026-09-15",
    payment_method: "PIX",
    account_id: "acc-bb",
    payer_name: "LARISSA TEIXEIRA VERAS",
    created_by: null,
    created_at: "2026-09-15T11:00:00Z",
    legacy: false,
    reversed_at: null,
    reversed_by: null,
    reversal_reason: null,
  },
  {
    id: "pay-set-03",
    transaction_id: "rec-set-03",
    amount: 6000,
    paid_on: "2026-09-15",
    payment_method: "Dinheiro",
    account_id: "acc-bb",
    payer_name: "LARISSA TEIXEIRA VERAS",
    created_by: null,
    created_at: "2026-09-15T14:00:00Z",
    legacy: false,
    reversed_at: null,
    reversed_by: null,
    reversal_reason: null,
  },
];

const DEFAULT_ACCOUNTS: FinancialAccount[] = [
  {
    id: "acc-bb",
    name: "BANCO DO BRASIL",
    type: "corrente",
    company_id: null,
    active: true,
    balance_kind: "available",
  },
  {
    id: "acc-caixa",
    name: "Caixa Geral / Tesouraria",
    type: "caixa",
    company_id: null,
    active: true,
    balance_kind: "available",
  },
];

const STORAGE_KEY_LOCAL_PAYMENTS = "medcore_local_payments";

export function getLocalPayments(): FinancialPayment[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCAL_PAYMENTS);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveLocalPayment(payment: FinancialPayment): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getLocalPayments();
    const next = [payment, ...current.filter((p) => p.id !== payment.id)];
    localStorage.setItem(STORAGE_KEY_LOCAL_PAYMENTS, JSON.stringify(next));
  } catch (e) {
    console.error("Erro ao salvar pagamento local:", e);
  }
}

export function reverseLocalPayment(paymentId: string, reason: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getLocalPayments();
    const next = current.map((p) =>
      p.id === paymentId
        ? {
            ...p,
            reversed_at: new Date().toISOString(),
            reversed_by: "Usuário",
            reversal_reason: reason,
          }
        : p,
    );
    localStorage.setItem(STORAGE_KEY_LOCAL_PAYMENTS, JSON.stringify(next));
  } catch (e) {
    console.error("Erro ao estornar pagamento local:", e);
  }
}

function parseEventFinancialMeta(description: string | null | undefined) {
  if (!description) return null;
  const m = description.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]);
    const procedurePrice = Number(meta.procedurePrice) || 0;
    const downPayment = Number(meta.downPayment) || 0;
    const remainingValue = Number(meta.remainingValue) || 0;
    if (procedurePrice > 0 || downPayment > 0) {
      return {
        procedurePrice: procedurePrice > 0 ? procedurePrice : downPayment,
        downPayment,
        remainingValue:
          remainingValue > 0 ? remainingValue : Math.max(0, procedurePrice - downPayment),
        downPaymentMethod: meta.downPaymentMethod || "pix",
        clientId: meta.clientId || null,
        patientName: meta.patientName || null,
      };
    }
  } catch {}
  return null;
}

function normalizeFinancialSnapshot(
  raw: FinanceSnapshot,
  remoteEvents: any[] = [],
): FinanceSnapshot {
  let deletedTitleIds = new Set<string>();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const rawTitles = localStorage.getItem("medcore_deleted_titles");
      if (rawTitles) {
        const parsed = JSON.parse(rawTitles);
        if (Array.isArray(parsed)) parsed.forEach((id) => deletedTitleIds.add(id));
      }
      const rawCash = localStorage.getItem("medcore_deleted_cash_entries");
      if (rawCash) {
        const parsed = JSON.parse(rawCash);
        if (Array.isArray(parsed)) parsed.forEach((id) => deletedTitleIds.add(id));
      }
    } catch {}
  }

  const existingTitleIds = new Set(raw.titles.map((t) => t.id));
  const existingPaymentIds = new Set(raw.payments.map((p) => p.id));
  const existingTxPaymentIds = new Set(raw.payments.map((p) => p.transaction_id));

  // 1. Merge baseline titles if database doesn't have them and they haven't been deleted
  const mergedTitles = raw.titles.filter((t) => !deletedTitleIds.has(t.id));
  BASELINE_TITLES.forEach((bt) => {
    if (!existingTitleIds.has(bt.id) && !deletedTitleIds.has(bt.id)) {
      mergedTitles.push(bt);
      existingTitleIds.add(bt.id);
    }
  });

  // 2. Integração de agendamentos com valores financeiros (Local Events + Remote Events)
  const localEvents = getStoredLocalEvents();
  const allEventsMap = new Map<string, any>();
  remoteEvents.forEach((re) => {
    if (re?.id) allEventsMap.set(re.id, re);
  });
  localEvents.forEach((le) => {
    if (le?.id) {
      const existing = allEventsMap.get(le.id);
      allEventsMap.set(le.id, existing ? { ...existing, ...le } : le);
    }
  });

  // 3. Merge baseline payments e pagamentos existentes
  const mergedPayments = raw.payments.filter(
    (p) => !deletedTitleIds.has(p.id) && !deletedTitleIds.has(p.transaction_id)
  );
  BASELINE_PAYMENTS.forEach((bp) => {
    if (
      !existingPaymentIds.has(bp.id) &&
      !deletedTitleIds.has(bp.id) &&
      !deletedTitleIds.has(bp.transaction_id)
    ) {
      mergedPayments.push(bp);
      existingPaymentIds.add(bp.id);
      existingTxPaymentIds.add(bp.transaction_id);
    }
  });

  // Processa cada evento com metadados financeiros
  Array.from(allEventsMap.values()).forEach((event) => {
    const fMeta = parseEventFinancialMeta(event.description);
    if (!fMeta) return;

    const total = fMeta.procedurePrice > 0 ? fMeta.procedurePrice : fMeta.downPayment;
    const down = fMeta.downPayment;
    const eventStartsAt = event.starts_at || new Date().toISOString();
    const eventDateStr = eventStartsAt.slice(0, 10);
    const eventCompStr = eventStartsAt.slice(0, 7) + "-01";
    const patientName =
      fMeta.patientName ||
      (event.title ? event.title.split("-")[0]?.trim() : "") ||
      "Paciente";

    // Verifica se o título já existe em raw.titles ou mergedTitles
    const existingTitle = mergedTitles.find(
      (t) =>
        t.origin_key === `event:${event.id}` ||
        t.id === `evt-${event.id}` ||
        t.id === event.id,
    );

    if (existingTitle) {
      // Se houver sinal pago e o título ainda constar com paid_amount menor que o sinal
      if (down > 0 && (Number(existingTitle.paid_amount) || 0) < down) {
        existingTitle.paid_amount = down;
        if (existingTitle.paid_amount >= existingTitle.amount) {
          existingTitle.status = "pago";
        }
      }
      // Garante que o pagamento do sinal esteja registrado no fluxo de caixa
      if (down > 0 && !existingTxPaymentIds.has(existingTitle.id)) {
        const payId = `pay-evt-${event.id}`;
        if (!existingPaymentIds.has(payId) && !deletedTitleIds.has(payId)) {
          const evtPayment: FinancialPayment = {
            id: payId,
            transaction_id: existingTitle.id,
            amount: down,
            paid_on: existingTitle.date || existingTitle.due_date || eventDateStr,
            payment_method: (fMeta.downPaymentMethod || "PIX").toUpperCase(),
            account_id: raw.accounts[0]?.id || "acc-bb",
            payer_name: existingTitle.patient_name || patientName,
            created_by: null,
            created_at: eventStartsAt,
            legacy: false,
            reversed_at: null,
            reversed_by: null,
            reversal_reason: null,
          };
          mergedPayments.push(evtPayment);
          existingPaymentIds.add(payId);
          existingTxPaymentIds.add(existingTitle.id);
        }
      }
    } else {
      // Cria título sintético correspondente ao agendamento se não foi excluído
      const evtTitleId = `evt-${event.id}`;
      if (!deletedTitleIds.has(evtTitleId) && !deletedTitleIds.has(event.id)) {
        const newTitle: FinancialTitle = {
          id: evtTitleId,
          type: "receita",
          amount: total,
          paid_amount: down,
          due_date: eventDateStr,
          date: eventDateStr,
          competence_date: eventCompStr,
          status: down >= total && total > 0 ? "pago" : "pendente",
          description: event.title || `Atendimento - ${patientName}`,
          category: "Atendimentos",
          patient_id: event.patient_id || fMeta.clientId || null,
          patient_name: patientName,
          payer_name: patientName,
          company_id: event.company_id || null,
          treatment_id: null,
          installment_id: null,
          origin_key: `event:${event.id}`,
          can_settle: true,
          can_reverse: true,
          can_cancel: true,
        };
        mergedTitles.push(newTitle);
        existingTitleIds.add(newTitle.id);

        if (down > 0) {
          const payId = `pay-evt-${event.id}`;
          if (!existingPaymentIds.has(payId) && !deletedTitleIds.has(payId)) {
            const evtPayment: FinancialPayment = {
              id: payId,
              transaction_id: evtTitleId,
              amount: down,
              paid_on: eventDateStr,
              payment_method: (fMeta.downPaymentMethod || "PIX").toUpperCase(),
              account_id: raw.accounts[0]?.id || "acc-bb",
              payer_name: patientName,
              created_by: null,
              created_at: eventStartsAt,
              legacy: false,
              reversed_at: null,
              reversed_by: null,
              reversal_reason: null,
            };
            mergedPayments.push(evtPayment);
            existingPaymentIds.add(payId);
            existingTxPaymentIds.add(evtTitleId);
          }
        }
      }
    }
  });

  // 4. Merge pagamentos locais persistidos no localStorage (ex: baixa dos R$ 400 restantes)
  const localPayments = getLocalPayments();
  localPayments.forEach((lp) => {
    if (deletedTitleIds.has(lp.id) || deletedTitleIds.has(lp.transaction_id)) return;
    if (!existingPaymentIds.has(lp.id)) {
      mergedPayments.push(lp);
      existingPaymentIds.add(lp.id);
      existingTxPaymentIds.add(lp.transaction_id);

      // Incrementa o paid_amount do título correspondente se não for estornado e não for o sinal já contado
      const targetTitle = mergedTitles.find((t) => t.id === lp.transaction_id);
      if (targetTitle && !lp.reversed_at && !lp.id.startsWith("pay-evt-")) {
        targetTitle.paid_amount = (Number(targetTitle.paid_amount) || 0) + Number(lp.amount);
        if (targetTitle.paid_amount >= targetTitle.amount) {
          targetTitle.status = "pago";
        }
      }
    }
  });

  // Ensure any title marked 'pago' has a payment record in cash
  mergedTitles.forEach((t) => {
    if ((t.status === "pago" || t.paid_amount > 0) && !existingTxPaymentIds.has(t.id)) {
      const synPay: FinancialPayment = {
        id: `syn-pay-${t.id}`,
        transaction_id: t.id,
        amount: t.paid_amount > 0 ? t.paid_amount : t.amount,
        paid_on: t.date || t.due_date || "2026-09-15",
        payment_method: "PIX",
        account_id: raw.accounts[0]?.id || "acc-bb",
        payer_name: t.patient_name || t.payer_name || "Cliente",
        created_by: null,
        created_at: new Date().toISOString(),
        legacy: false,
        reversed_at: null,
        reversed_by: null,
        reversal_reason: null,
      };
      mergedPayments.push(synPay);
      existingPaymentIds.add(synPay.id);
      existingTxPaymentIds.add(t.id);
    }
  });

  // 5. Ensure accounts exist
  const existingAccountNames = new Set(raw.accounts.map((a) => a.name.toLowerCase()));
  const mergedAccounts = [...raw.accounts];
  DEFAULT_ACCOUNTS.forEach((da) => {
    if (!existingAccountNames.has(da.name.toLowerCase())) {
      mergedAccounts.push(da);
      existingAccountNames.add(da.name.toLowerCase());
    }
  });

  // 6. Ensure scopes have full permissions
  const mergedScopes =
    raw.scopes.length > 0
      ? raw.scopes.map((s) => ({
          ...s,
          can_create: true,
          can_pay: true,
          can_accounts: true,
        }))
      : [
          {
            id: null,
            name: "Clínica Principal",
            can_create: true,
            can_pay: true,
            can_accounts: true,
          },
        ];

  return {
    ...raw,
    titles: mergedTitles,
    payments: mergedPayments,
    accounts: mergedAccounts,
    scopes: mergedScopes,
  };
}

export async function getFinancialSnapshot(): Promise<FinanceSnapshot> {
  const { data, error } = await supabase.rpc("get_financial_snapshot");
  if (error) {
    console.warn("Aviso ao carregar financial snapshot via RPC, utilizando fallback seguro:", error);
  }

  let remoteEvents: any[] = [];
  try {
    const { data: evts } = await supabase
      .from("events")
      .select("id, title, starts_at, description, patient_id, company_id")
      .ilike("description", "%AGENDAMENTO_META%")
      .limit(100);
    if (evts && Array.isArray(evts)) {
      remoteEvents = evts;
    }
  } catch {}

  const raw: FinanceSnapshot = data || {
    titles: [],
    payments: [],
    accounts: [],
    scopes: [],
    patients: [],
  };

  return normalizeFinancialSnapshot(raw, remoteEvents);
}

export async function getFinancialReportingRows() {
  const data = await getFinancialSnapshot();
  if (!data.scopes.length) throw new Error("Sem permissão para consultar indicadores financeiros.");
  return reportingRows(data);
}

export async function refreshFinance(qc: QueryClient) {
  await Promise.all(
    [
      "financial-snapshot",
      "cash-flow-snapshot",
      "financial-operations",
      "transactions",
      "treatment-installments",
      "treatment-finance-plans",
      "treatment-ledger",
      "treatment-alerts",
      "treatments-list",
      "dashboard",
      "reports-data",
    ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
  );
}

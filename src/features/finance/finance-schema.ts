import type { CashFlowFunctions } from "./cash-flow-schema";
import type { OperationsFunctions } from "./operations-schema";

export type FinancialTitle = {
  id: string;
  type: "receita" | "despesa";
  amount: number;
  paid_amount: number;
  due_date: string;
  date: string;
  status: string;
  description: string | null;
  category: string | null;
  patient_id: string | null;
  patient_name: string | null;
  payer_name: string | null;
  company_id: string | null;
  treatment_id: string | null;
  installment_id: string | null;
  competence_date: string | null;
  can_settle: boolean;
  can_reverse: boolean;
  can_cancel: boolean;
};
export type FinancialPayment = {
  id: string;
  transaction_id: string;
  amount: number;
  paid_on: string;
  payment_method: string | null;
  account_id: string | null;
  payer_name: string | null;
  created_by: string | null;
  created_at: string;
  legacy: boolean;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
};
export type FinancialAccount = {
  id: string;
  name: string;
  type: string;
  company_id: string | null;
  active: boolean;
  balance_kind: "available" | "receivable" | null;
};
export type FinanceSnapshot = {
  titles: FinancialTitle[];
  payments: FinancialPayment[];
  accounts: FinancialAccount[];
  scopes: {
    id: string | null;
    name: string;
    can_create: boolean;
    can_pay: boolean;
    can_accounts: boolean;
  }[];
  patients: { id: string; name: string; company_id: string | null }[];
};
export type FinancialPlan = {
  id: string;
  title: string;
  patient_name: string | null;
  total_value: number;
  discount: number;
  down_payment: number;
  payment_type: string;
  down_payment_method: string | null;
  payment_method: string | null;
  installments_count: number;
  down_payment_due_date: string | null;
  first_due_date: string | null;
  can_configure: boolean;
  installments: {
    id: string;
    number: number;
    amount: number;
    due_date: string;
    payment_method: string | null;
    status: string;
  }[];
};
export type FinanceFunctions = CashFlowFunctions &
  OperationsFunctions & {
    get_financial_plans: { Args: never; Returns: FinancialPlan[] };
    get_financial_snapshot: { Args: never; Returns: FinanceSnapshot };
    record_financial_payment: {
      Args: {
        p_id: string;
        p_transaction_id: string;
        p_amount: number;
        p_paid_on: string;
        p_method: string;
        p_account_id: string;
        p_payer_name?: string | null;
      };
      Returns: string;
    };
    reverse_financial_payment: { Args: { p_id: string; p_reason: string }; Returns: undefined };
    cancel_financial_title: { Args: { p_id: string; p_reason: string }; Returns: undefined };
    create_financial_title: {
      Args: {
        p_id: string;
        p_type: string;
        p_amount: number;
        p_due_date: string;
        p_description: string;
        p_patient_id?: string | null;
        p_payer_name?: string | null;
        p_category?: string | null;
        p_competence_date?: string | null;
        p_company_id?: string | null;
      };
      Returns: string;
    };
    create_financial_account: {
      Args: { p_id: string; p_name: string; p_type: string; p_company_id?: string | null };
      Returns: string;
    };
    create_event_financial_title: {
      Args: { p_event_id: string; p_amount: number; p_due_date: string };
      Returns: string;
    };
  };

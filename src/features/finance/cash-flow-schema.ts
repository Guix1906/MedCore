export type CashAccount = {
  id: string;
  name: string;
  active: boolean;
  kind: "available" | "receivable" | null;
  opening_date: string | null;
  opening_amount: number | null;
  opening_reference: string | null;
  opening_confirmed_at: string | null;
};
export type AccountTransfer = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  date: string;
  description: string | null;
  responsible: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
};
export type CashFlowSnapshot = {
  accounts: CashAccount[];
  payments: {
    id: string;
    account_id: string | null;
    date: string;
    amount: number;
    type: "receita" | "despesa";
    legacy: boolean;
    reversed_at: string | null;
  }[];
  transfers: AccountTransfer[];
};
export type CashFlowFunctions = {
  get_cash_flow_snapshot: { Args: { p_company_id: string | null }; Returns: CashFlowSnapshot };
  confirm_financial_opening: {
    Args: {
      p_account_id: string;
      p_amount: number;
      p_date: string;
      p_kind: string;
      p_reference: string;
    };
    Returns: undefined;
  };
  record_account_transfer: {
    Args: {
      p_id: string;
      p_from: string;
      p_to: string;
      p_amount: number;
      p_date: string;
      p_description: string;
    };
    Returns: string;
  };
  reverse_account_transfer: { Args: { p_id: string; p_reason: string }; Returns: undefined };
};

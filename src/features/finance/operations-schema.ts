export type DreGroup =
  | "revenue"
  | "deductions"
  | "costs"
  | "operating"
  | "financial_income"
  | "financial_expense"
  | "taxes"
  | "excluded";
export type DfcGroup = "operating" | "investing" | "financing";
export type BankEntry = {
  source_kind: "payment" | "transfer_in" | "transfer_out" | "card";
  source_id: string;
  account_id: string;
  date: string;
  amount: number;
  description: string | null;
};
export type OperationsSnapshot = {
  can_manage: boolean;
  can_receive: boolean;
  user_id: string;
  business_date: string;
  classifications: {
    transaction_id: string;
    dre_group: DreGroup;
    dfc_group: DfcGroup;
    reason: string;
  }[];
  sessions: {
    id: string;
    account_id: string;
    business_date: string | null;
    managed: boolean;
    opened_by: string | null;
    opened_at: string;
    opening_amount: number;
    opening_reference: string | null;
    closed_at: string | null;
    closed_by: string | null;
    expected_amount: number | null;
    physical_amount: number | null;
    difference: number | null;
    current_expected: number | null;
    notes: string | null;
  }[];
  cards: {
    id: string;
    payment_id: string;
    transfer_id: string;
    fee_title_id: string | null;
    fee_payment_id: string | null;
    fee: number;
    reference: string;
    created_by: string;
    reversed_at: string | null;
    reversal_reason: string | null;
  }[];
  commissions: {
    id: string;
    payment_id: string;
    doctor_id: string;
    title_id: string;
    percent: number;
    amount: number;
    reason: string;
    created_by: string;
  }[];
  doctors: { id: string; name: string }[];
  lines: {
    id: string;
    account_id: string;
    external_id: string;
    date: string;
    amount: number;
    description: string;
  }[];
  matches: {
    id: string;
    line_id: string;
    source_kind: BankEntry["source_kind"];
    source_id: string;
    reason: string;
    created_by: string;
    reversed_at: string | null;
    reversal_reason: string | null;
  }[];
  entries: BankEntry[];
};
export type StatementLine = {
  external_id: string;
  date: string;
  amount: number;
  description: string;
};
export type OperationsFunctions = {
  retire_financial_shift_control: {
    Args: { p_account: string; p_amount: number; p_reason: string };
    Returns: undefined;
  };
  get_financial_operations: { Args: { p_company: string | null }; Returns: OperationsSnapshot };
  classify_financial_title: {
    Args: { p_id: string; p_competence: string; p_dre: string; p_dfc: string; p_reason: string };
    Returns: undefined;
  };
  open_financial_shift: {
    Args: { p_id: string; p_account: string; p_amount: number; p_reason: string };
    Returns: string;
  };
  close_financial_shift: {
    Args: { p_id: string; p_amount: number; p_reason: string };
    Returns: undefined;
  };
  settle_financial_card: {
    Args: {
      p_id: string;
      p_payment: string;
      p_bank: string;
      p_fee: number;
      p_date: string;
      p_reference: string;
    };
    Returns: string;
  };
  reverse_financial_card: { Args: { p_id: string; p_reason: string }; Returns: undefined };
  approve_financial_commission: {
    Args: {
      p_id: string;
      p_payment: string;
      p_doctor: string;
      p_percent: number;
      p_due: string;
      p_competence: string;
      p_reason: string;
    };
    Returns: string;
  };
  import_financial_statement: {
    Args: { p_account: string; p_lines: StatementLine[] };
    Returns: number;
  };
  reconcile_financial_entry: {
    Args: { p_id: string; p_line: string; p_kind: string; p_source: string; p_reason: string };
    Returns: string;
  };
  reverse_financial_reconciliation: {
    Args: { p_id: string; p_reason: string };
    Returns: undefined;
  };
};

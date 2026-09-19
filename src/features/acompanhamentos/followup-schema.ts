import type { FinanceFunctions } from "@/features/finance/finance-schema";

export type Evolution = {
  id: string;
  treatment_id: string;
  occurred_on: string;
  notes: string;
  weight_kg: number | null;
  parameters: string | null;
  next_step: string | null;
  is_return: boolean;
  created_by: string;
  created_at: string;
};
export type ClinicalPhoto = {
  id: string;
  treatment_id: string;
  storage_path: string;
  taken_on: string;
  title: string;
  objective: string;
  created_by: string;
  created_at: string;
};
export type MedicationUse = {
  id: string;
  treatment_id: string;
  medication_id: string;
  medication_name: string;
  dose: string;
  route: string | null;
  used_at: string;
  notes: string | null;
  inventory_item_id: string | null;
  quantity: number | null;
  created_by: string;
  created_at: string;
};
export type StatusHistory = {
  id: string;
  treatment_id: string;
  previous_status: string;
  status: string;
  justification: string;
  created_by: string;
  created_at: string;
};
export type TreatmentAlert = {
  id: string;
  treatment_id: string;
  patient_name: string;
  title: string;
  kind: string;
  target_date: string | null;
  amount: number | null;
};
type ReadTable<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
export type FollowupTables = {
  treatment_evolutions: ReadTable<Evolution>;
  treatment_status_history: ReadTable<StatusHistory>;
  treatment_medication_uses: ReadTable<MedicationUse>;
  treatment_photos: {
    Row: ClinicalPhoto;
    Insert: Omit<ClinicalPhoto, "id" | "created_at" | "created_by"> & { id?: string };
    Update: never;
    Relationships: [];
  };
};
export type FollowupFunctions = FinanceFunctions & {
  move_inventory_item: {
    Args: {
      p_id: string;
      p_item_id: string;
      p_type: string;
      p_quantity: number;
      p_reason: string | null;
    };
    Returns: undefined;
  };
  record_treatment_evolution: {
    Args: {
      p_id: string;
      p_treatment_id: string;
      p_occurred_on: string;
      p_notes: string;
      p_weight_kg?: number | null;
      p_parameters?: string | null;
      p_next_step?: string | null;
      p_is_return?: boolean;
    };
    Returns: string;
  };
  record_treatment_medication_use: {
    Args: {
      p_id: string;
      p_medication_id: string;
      p_dose: string;
      p_used_at: string;
      p_route?: string | null;
      p_notes?: string | null;
      p_inventory_item_id?: string | null;
      p_quantity?: number | null;
    };
    Returns: string;
  };
  configure_treatment_payment: {
    Args: {
      p_treatment_id: string;
      p_total: number;
      p_discount: number;
      p_down: number;
      p_type: string;
      p_down_method: string | null;
      p_method: string | null;
      p_count: number;
      p_down_due: string | null;
      p_first_due: string | null;
    };
    Returns: undefined;
  };
  pay_treatment_installment: {
    Args: { p_id: string; p_paid_date: string; p_method: string };
    Returns: undefined;
  };
  get_treatment_alerts: { Args: never; Returns: TreatmentAlert[] };
};

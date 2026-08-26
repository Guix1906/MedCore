/**
 * Tipos e Interfaces do Módulo de Acompanhamentos e Tratamentos
 */

export type TreatmentStatus = "em_andamento" | "pausado" | "finalizado" | "cancelado";

export type Treatment = {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  title: string;
  objective: string | null;
  start_date: string;
  end_date: string | null;
  status: TreatmentStatus;
  total_value: number;
  down_payment: number;
  discount: number;
  installments_count: number;
  payment_method: string | null;
  first_due_date: string | null;
  patient?: { name: string; phone?: string | null; email?: string | null } | null;
  doctor?: { name: string } | null;
  phases?: TreatmentPhase[];
  created_at: string;
};

export type TreatmentPhase = {
  id: string;
  treatment_id: string;
  title: string;
  order_index: number;
  status: "pendente" | "em_andamento" | "concluida";
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
};

export type TreatmentMedication = {
  id: string;
  treatment_id: string;
  name: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  status: "active" | "completed" | "suspended";
};

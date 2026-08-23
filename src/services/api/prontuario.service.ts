import { apiClient } from "./api-client";

export interface MedicalRecord {
  id: string;
  patient_id: string;
  doctor_id?: string | null;
  appointment_id?: string | null;
  clinical_history?: string | null;
  surgical_history?: string | null;
  family_history?: string | null;
  habits?: string | null;
  allergies?: string | null;
  complaint?: string | null;
  evolution?: string | null;
  diagnosis?: string | null;
  diagnosis_code?: string | null;
  conduct?: string | null;
  return_date?: string | null;
  return_notes?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_seconds?: number | null;
  created_at: string;
  updated_at?: string;
  prescriptions?: Prescription[];
  doctor_name?: string;
  patient_name?: string;
}

export interface Prescription {
  id: string;
  medical_record_id?: string | null;
  patient_id: string;
  doctor_id?: string | null;
  medication: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  created_at: string;
}

export const prontuarioService = {
  async getRecords(patientId?: string): Promise<MedicalRecord[]> {
    const endpoint = patientId ? `/medical-records?patient_id=${patientId}` : "/medical-records";
    return apiClient.get<MedicalRecord[]>(endpoint);
  },

  async getRecordById(id: string): Promise<MedicalRecord> {
    return apiClient.get<MedicalRecord>(`/medical-records/${id}`);
  },

  async createRecord(data: Partial<MedicalRecord>): Promise<MedicalRecord> {
    return apiClient.post<MedicalRecord>("/medical-records", data);
  },
};

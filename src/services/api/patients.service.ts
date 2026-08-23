import { apiClient } from "./api-client";

export interface Patient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpf: string | null;
  birth_date: string | null;
  gender: string | null;
  insurance: string | null;
  insurance_number?: string | null;
  address?: string | null;
  city: string | null;
  state: string | null;
  zip_code?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null;
  active: boolean;
  created_at: string;
  updated_at?: string;
  appointments?: any[];
  medical_records?: any[];
}

export const patientsService = {
  async getPatients(params?: { q?: string; active?: boolean; limit?: number }): Promise<Patient[]> {
    const query = new URLSearchParams();
    if (params?.q) query.set("q", params.q);
    if (params?.active !== undefined) query.set("active", params.active ? "1" : "0");
    if (params?.limit) query.set("limit", String(params.limit));

    const qs = query.toString();
    const endpoint = qs ? `/patients?${qs}` : "/patients";
    return apiClient.get<Patient[]>(endpoint);
  },

  async getPatientById(id: string): Promise<Patient> {
    return apiClient.get<Patient>(`/patients/${id}`);
  },

  async createPatient(data: Partial<Patient>): Promise<Patient> {
    return apiClient.post<Patient>("/patients", data);
  },

  async updatePatient(id: string, data: Partial<Patient>): Promise<Patient> {
    return apiClient.put<Patient>(`/patients/${id}`, data);
  },

  async deletePatient(id: string): Promise<void> {
    return apiClient.delete(`/patients/${id}`);
  },
};

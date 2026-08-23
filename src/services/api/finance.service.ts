import { apiClient } from "./api-client";

export interface Transaction {
  id: string;
  account_id?: string | null;
  category_id?: string | null;
  patient_id?: string | null;
  doctor_id?: string | null;
  appointment_id?: string | null;
  type: "income" | "expense";
  description: string;
  amount: number;
  date: string;
  due_date?: string | null;
  status: "completed" | "pending" | "cancelled";
  payment_method?: string | null;
  notes?: string | null;
  patient_name?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  account_name?: string | null;
  created_at: string;
}

export interface FinanceMetrics {
  total_income: number;
  total_expense: number;
  balance: number;
  pending_income: number;
  pending_expense: number;
}

export interface FinancialAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  active: boolean;
}

export interface FinancialCategory {
  id: string;
  name: string;
  type: "income" | "expense";
  color?: string | null;
  icon?: string | null;
}

export interface Treatment {
  id: string;
  patient_id: string;
  doctor_id?: string | null;
  title: string;
  description?: string | null;
  start_date: string;
  end_date?: string | null;
  status: string;
  total_value: number;
  number_of_installments: number;
  patient_name?: string;
  doctor_name?: string;
  medications?: any[];
  installments?: any[];
  created_at: string;
}

export const financeService = {
  // Transactions
  async getTransactions(params?: {
    type?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<Transaction[]> {
    const query = new URLSearchParams();
    if (params?.type) query.set("type", params.type);
    if (params?.status) query.set("status", params.status);
    if (params?.start_date) query.set("start_date", params.start_date);
    if (params?.end_date) query.set("end_date", params.end_date);
    if (params?.limit) query.set("limit", String(params.limit));

    const qs = query.toString();
    return apiClient.get<Transaction[]>(qs ? `/transactions?${qs}` : "/transactions");
  },

  async getMetrics(startDate?: string, endDate?: string): Promise<FinanceMetrics> {
    const query = new URLSearchParams();
    if (startDate) query.set("start_date", startDate);
    if (endDate) query.set("end_date", endDate);
    const qs = query.toString();
    return apiClient.get<FinanceMetrics>(qs ? `/finance/metrics?${qs}` : "/finance/metrics");
  },

  async createTransaction(data: Partial<Transaction>): Promise<Transaction> {
    return apiClient.post<Transaction>("/transactions", data);
  },

  async updateTransaction(id: string, data: Partial<Transaction>): Promise<Transaction> {
    return apiClient.put<Transaction>(`/transactions/${id}`, data);
  },

  async deleteTransaction(id: string): Promise<void> {
    return apiClient.delete(`/transactions/${id}`);
  },

  async getAccounts(): Promise<FinancialAccount[]> {
    return apiClient.get<FinancialAccount[]>("/financial-accounts");
  },

  async getCategories(): Promise<FinancialCategory[]> {
    return apiClient.get<FinancialCategory[]>("/financial-categories");
  },

  // Treatments & Acompanhamentos
  async getTreatments(params?: { patient_id?: string; status?: string }): Promise<Treatment[]> {
    const query = new URLSearchParams();
    if (params?.patient_id) query.set("patient_id", params.patient_id);
    if (params?.status) query.set("status", params.status);
    const qs = query.toString();
    return apiClient.get<Treatment[]>(qs ? `/treatments?${qs}` : "/treatments");
  },

  async getTreatmentById(id: string): Promise<Treatment> {
    return apiClient.get<Treatment>(`/treatments/${id}`);
  },

  async createTreatment(data: Partial<Treatment>): Promise<Treatment> {
    return apiClient.post<Treatment>("/treatments", data);
  },

  async updateTreatment(id: string, data: Partial<Treatment>): Promise<Treatment> {
    return apiClient.put<Treatment>(`/treatments/${id}`, data);
  },

  async deleteTreatment(id: string): Promise<void> {
    return apiClient.delete(`/treatments/${id}`);
  },

  async addMedication(treatmentId: string, medication: any): Promise<any> {
    return apiClient.post(`/treatments/${treatmentId}/medications`, medication);
  },

  async updateMedication(treatmentId: string, medicationId: string, medication: any): Promise<any> {
    return apiClient.put(`/treatments/${treatmentId}/medications/${medicationId}`, medication);
  },

  async deleteMedication(treatmentId: string, medicationId: string): Promise<void> {
    return apiClient.delete(`/treatments/${treatmentId}/medications/${medicationId}`);
  },
};

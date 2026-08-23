import { apiClient } from "./api-client";

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  role: string;
  full_name?: string;
  email?: string;
  avatar_url?: string;
}

export interface ClinicSettings {
  id: string;
  company_id?: string;
  clinic_name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  cnpj?: string;
  logo_url?: string;
}

export interface ServiceType {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

export const companyService = {
  async getMembers(): Promise<CompanyMember[]> {
    return apiClient.get<CompanyMember[]>("/company-members");
  },

  async getClinicSettings(): Promise<ClinicSettings> {
    return apiClient.get<ClinicSettings>("/clinic-settings");
  },

  async updateClinicSettings(data: Partial<ClinicSettings>): Promise<ClinicSettings> {
    return apiClient.put<ClinicSettings>("/clinic-settings", data);
  },

  async getServiceTypes(): Promise<ServiceType[]> {
    return apiClient.get<ServiceType[]>("/service-types");
  },

  async getCases(): Promise<any[]> {
    return apiClient.get<any[]>("/cases");
  },

  async getDoctors(): Promise<any[]> {
    return apiClient.get<any[]>("/doctors");
  },
};

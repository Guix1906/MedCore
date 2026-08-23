import { apiClient } from "./api-client";

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  date: string;
  start_time: string;
  end_time: string;
  type: string;
  status: string;
  notes?: string | null;
  insurance?: string | null;
  amount?: number | null;
  online: boolean;
  patient_name?: string;
  patient_phone?: string;
  patient_cpf?: string;
  doctor_name?: string;
  doctor_specialty?: string;
  created_at: string;
}

export interface TaskItem {
  id: string;
  company_id: string;
  user_id?: string | null;
  assigned_to?: string | null;
  title: string;
  description?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "todo" | "in_progress" | "done" | "cancelled";
  category?: string | null;
  created_at: string;
}

export interface EventItem {
  id: string;
  company_id: string;
  user_id?: string | null;
  patient_id?: string | null;
  doctor_id?: string | null;
  title: string;
  description?: string | null;
  start_time: string;
  end_time?: string | null;
  event_type: string;
  status: string;
  location?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface DeadlineItem {
  id: string;
  company_id: string;
  user_id?: string | null;
  title: string;
  description?: string | null;
  due_date: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "done" | "overdue";
  created_at: string;
}

export const agendaService = {
  // Appointments
  async getAppointments(params?: {
    date?: string;
    start_date?: string;
    end_date?: string;
    doctor_id?: string;
    patient_id?: string;
    status?: string;
  }): Promise<Appointment[]> {
    const query = new URLSearchParams();
    if (params?.date) query.set("date", params.date);
    if (params?.start_date) query.set("start_date", params.start_date);
    if (params?.end_date) query.set("end_date", params.end_date);
    if (params?.doctor_id) query.set("doctor_id", params.doctor_id);
    if (params?.patient_id) query.set("patient_id", params.patient_id);
    if (params?.status) query.set("status", params.status);

    const qs = query.toString();
    return apiClient.get<Appointment[]>(qs ? `/appointments?${qs}` : "/appointments");
  },

  async createAppointment(data: Partial<Appointment>): Promise<Appointment> {
    return apiClient.post<Appointment>("/appointments", data);
  },

  async updateAppointment(id: string, data: Partial<Appointment>): Promise<Appointment> {
    return apiClient.put<Appointment>(`/appointments/${id}`, data);
  },

  async deleteAppointment(id: string): Promise<void> {
    return apiClient.delete(`/appointments/${id}`);
  },

  // Tasks
  async getTasks(): Promise<TaskItem[]> {
    return apiClient.get<TaskItem[]>("/tasks");
  },

  async createTask(data: Partial<TaskItem>): Promise<TaskItem> {
    return apiClient.post<TaskItem>("/tasks", data);
  },

  async updateTask(id: string, data: Partial<TaskItem>): Promise<TaskItem> {
    return apiClient.put<TaskItem>(`/tasks/${id}`, data);
  },

  async deleteTask(id: string): Promise<void> {
    return apiClient.delete(`/tasks/${id}`);
  },

  // Events
  async getEvents(): Promise<EventItem[]> {
    return apiClient.get<EventItem[]>("/events");
  },

  async createEvent(data: Partial<EventItem>): Promise<EventItem> {
    return apiClient.post<EventItem>("/events", data);
  },

  async updateEvent(id: string, data: Partial<EventItem>): Promise<EventItem> {
    return apiClient.put<EventItem>(`/events/${id}`, data);
  },

  async deleteEvent(id: string): Promise<void> {
    return apiClient.delete(`/events/${id}`);
  },

  // Deadlines
  async getDeadlines(): Promise<DeadlineItem[]> {
    return apiClient.get<DeadlineItem[]>("/deadlines");
  },

  async createDeadline(data: Partial<DeadlineItem>): Promise<DeadlineItem> {
    return apiClient.post<DeadlineItem>("/deadlines", data);
  },

  async updateDeadline(id: string, data: Partial<DeadlineItem>): Promise<DeadlineItem> {
    return apiClient.put<DeadlineItem>(`/deadlines/${id}`, data);
  },

  async deleteDeadline(id: string): Promise<void> {
    return apiClient.delete(`/deadlines/${id}`);
  },
};

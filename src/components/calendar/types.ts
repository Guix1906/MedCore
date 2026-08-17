export interface CalendarAppointment {
  id: string;
  patient_id: string;
  patient_name: string;
  date: string; // 'YYYY-MM-DD'
  start_time: string; // 'HH:MM'
  end_time: string; // 'HH:MM'
  type: string;
  status: string;
  insurance?: string;
  notes?: string;
}

export type ViewMode = "day" | "week";

export interface DragState {
  appointmentId: string | null;
  originDate: string | null;
  originStart: string | null;
}

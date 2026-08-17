export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_data: Json | null
          old_data: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action: string
          company_id: string
          created_at: string
          entity_id: string | null
          entity_label: string | null
          entity_type: string
          id: string
          metadata: Json
          user_id: string
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          user_id: string
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          amount: number | null
          created_at: string
          date: string
          doctor_id: string
          end_time: string
          id: string
          insurance: string | null
          notes: string | null
          online: boolean
          patient_id: string
          start_time: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          date: string
          doctor_id: string
          end_time: string
          id?: string
          insurance?: string | null
          notes?: string | null
          online?: boolean
          patient_id: string
          start_time: string
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          date?: string
          doctor_id?: string
          end_time?: string
          id?: string
          insurance?: string | null
          notes?: string | null
          online?: boolean
          patient_id?: string
          start_time?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          patient_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          patient_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          patient_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_settings: {
        Row: {
          address: string | null
          clinic_name: string | null
          cnpj: string | null
          created_at: string
          email: string | null
          id: string
          opening_hours: string | null
          phone: string | null
          primary_color: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          clinic_name?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          opening_hours?: string | null
          phone?: string | null
          primary_color?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          clinic_name?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          opening_hours?: string | null
          phone?: string | null
          primary_color?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      commission_payouts: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          notes: string | null
          paid_at: string | null
          period_end: string
          period_start: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          period_end: string
          period_start: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          period_end?: string
          period_start?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_payouts_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      deadlines: {
        Row: {
          assigned_to: string | null
          case_id: string | null
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          due_date: string
          id: string
          is_double_term: boolean
          last_alert_at: string | null
          last_alert_level: string | null
          publication_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          case_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          due_date: string
          id?: string
          is_double_term?: boolean
          last_alert_at?: string | null
          last_alert_level?: string | null
          publication_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          case_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string
          id?: string
          is_double_term?: boolean
          last_alert_at?: string | null
          last_alert_level?: string | null
          publication_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deadlines_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadlines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          active: boolean
          auth_id: string | null
          avatar_url: string | null
          commission_config: Json | null
          created_at: string
          crm: string | null
          email: string
          id: string
          name: string
          phone: string | null
          role: string
          specialty: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          auth_id?: string | null
          avatar_url?: string | null
          commission_config?: Json | null
          created_at?: string
          crm?: string | null
          email: string
          id?: string
          name: string
          phone?: string | null
          role?: string
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          auth_id?: string | null
          avatar_url?: string | null
          commission_config?: Json | null
          created_at?: string
          crm?: string | null
          email?: string
          id?: string
          name?: string
          phone?: string | null
          role?: string
          specialty?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          assigned_to: string | null
          case_id: string | null
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          ends_at: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          location: string | null
          patient_id: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          case_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          ends_at?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          location?: string | null
          patient_id?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          case_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          ends_at?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          location?: string | null
          patient_id?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_categories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          id: string
          name: string
          type: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name: string
          type?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          type?: string
        }
        Relationships: []
      }
      financial_accounts: {
        Row: {
          account_number: string | null
          active: boolean
          agency: string | null
          bank: string | null
          created_at: string
          id: string
          initial_balance: number
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          active?: boolean
          agency?: string | null
          bank?: string | null
          created_at?: string
          id?: string
          initial_balance?: number
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          active?: boolean
          agency?: string | null
          bank?: string | null
          created_at?: string
          id?: string
          initial_balance?: number
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      financial_categories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          type: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          type: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          type?: string
        }
        Relationships: []
      }
      insurance_billings: {
        Row: {
          appointment_id: string | null
          approved_amount: number | null
          created_at: string
          doctor_id: string | null
          expected_payment_date: string | null
          gloss_amount: number | null
          gloss_reason: string | null
          guide_number: string | null
          id: string
          insurance_name: string
          notes: string | null
          patient_id: string | null
          procedure_name: string | null
          received_amount: number | null
          received_at: string | null
          sent_amount: number | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          approved_amount?: number | null
          created_at?: string
          doctor_id?: string | null
          expected_payment_date?: string | null
          gloss_amount?: number | null
          gloss_reason?: string | null
          guide_number?: string | null
          id?: string
          insurance_name: string
          notes?: string | null
          patient_id?: string | null
          procedure_name?: string | null
          received_amount?: number | null
          received_at?: string | null
          sent_amount?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          approved_amount?: number | null
          created_at?: string
          doctor_id?: string | null
          expected_payment_date?: string | null
          gloss_amount?: number | null
          gloss_reason?: string | null
          guide_number?: string | null
          id?: string
          insurance_name?: string
          notes?: string | null
          patient_id?: string | null
          procedure_name?: string | null
          received_amount?: number | null
          received_at?: string | null
          sent_amount?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_billings_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_billings_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_billings_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          active: boolean
          category: string | null
          code: string | null
          created_at: string
          expiry_date: string | null
          id: string
          location: string | null
          min_quantity: number
          name: string
          notes: string | null
          quantity: number
          supplier: string | null
          unit: string | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          location?: string | null
          min_quantity?: number
          name: string
          notes?: string | null
          quantity?: number
          supplier?: string | null
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          location?: string | null
          min_quantity?: number
          name?: string
          notes?: string | null
          quantity?: number
          supplier?: string | null
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          doctor_id: string | null
          id: string
          item_id: string
          quantity: number
          reason: string | null
          type: string
        }
        Insert: {
          created_at?: string
          doctor_id?: string | null
          id?: string
          item_id: string
          quantity: number
          reason?: string | null
          type: string
        }
        Update: {
          created_at?: string
          doctor_id?: string | null
          id?: string
          item_id?: string
          quantity?: number
          reason?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          allergies: string | null
          appointment_id: string | null
          clinical_history: string | null
          complaint: string | null
          conduct: string | null
          created_at: string
          diagnosis: string | null
          diagnosis_code: string | null
          doctor_id: string | null
          duration_seconds: number | null
          evolution: string | null
          family_history: string | null
          finished_at: string | null
          habits: string | null
          id: string
          medications: string | null
          patient_id: string
          return_date: string | null
          return_notes: string | null
          started_at: string | null
          surgical_history: string | null
          updated_at: string
        }
        Insert: {
          allergies?: string | null
          appointment_id?: string | null
          clinical_history?: string | null
          complaint?: string | null
          conduct?: string | null
          created_at?: string
          diagnosis?: string | null
          diagnosis_code?: string | null
          doctor_id?: string | null
          duration_seconds?: number | null
          evolution?: string | null
          family_history?: string | null
          finished_at?: string | null
          habits?: string | null
          id?: string
          medications?: string | null
          patient_id: string
          return_date?: string | null
          return_notes?: string | null
          started_at?: string | null
          surgical_history?: string | null
          updated_at?: string
        }
        Update: {
          allergies?: string | null
          appointment_id?: string | null
          clinical_history?: string | null
          complaint?: string | null
          conduct?: string | null
          created_at?: string
          diagnosis?: string | null
          diagnosis_code?: string | null
          doctor_id?: string | null
          duration_seconds?: number | null
          evolution?: string | null
          family_history?: string | null
          finished_at?: string | null
          habits?: string | null
          id?: string
          medications?: string | null
          patient_id?: string
          return_date?: string | null
          return_notes?: string | null
          started_at?: string | null
          surgical_history?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          archived: boolean
          archived_at: string | null
          body: string | null
          category: string | null
          created_at: string
          doctor_id: string | null
          id: string
          message: string | null
          priority: string
          read: boolean
          snoozed_until: string | null
          title: string
          type: string
        }
        Insert: {
          action_url?: string | null
          archived?: boolean
          archived_at?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          doctor_id?: string | null
          id?: string
          message?: string | null
          priority?: string
          read?: boolean
          snoozed_until?: string | null
          title: string
          type: string
        }
        Update: {
          action_url?: string | null
          archived?: boolean
          archived_at?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          doctor_id?: string | null
          id?: string
          message?: string | null
          priority?: string
          read?: boolean
          snoozed_until?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      patient_tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          label: string
          patient_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          label: string
          patient_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          label?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_tags_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          active: boolean
          address: string | null
          birth_date: string | null
          blood_type: string | null
          city: string | null
          cpf: string | null
          created_at: string
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          gender: string | null
          id: string
          insurance: string | null
          insurance_number: string | null
          name: string
          notes: string | null
          phone: string | null
          pipeline_stage_id: string | null
          state: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          birth_date?: string | null
          blood_type?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          gender?: string | null
          id?: string
          insurance?: string | null
          insurance_number?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          pipeline_stage_id?: string | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          birth_date?: string | null
          blood_type?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          gender?: string | null
          id?: string
          insurance?: string | null
          insurance_number?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          pipeline_stage_id?: string | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "patient_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_models: {
        Row: {
          created_at: string
          doctor_id: string | null
          id: string
          items: Json
          name: string
        }
        Insert: {
          created_at?: string
          doctor_id?: string | null
          id?: string
          items?: Json
          name: string
        }
        Update: {
          created_at?: string
          doctor_id?: string | null
          id?: string
          items?: Json
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescription_models_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          doctor_id: string | null
          dosage: string | null
          duration: string | null
          frequency: string | null
          id: string
          instructions: string | null
          medical_record_id: string | null
          medication: string
          patient_id: string
        }
        Insert: {
          created_at?: string
          doctor_id?: string | null
          dosage?: string | null
          duration?: string | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          medical_record_id?: string | null
          medication: string
          patient_id: string
        }
        Update: {
          created_at?: string
          doctor_id?: string | null
          dosage?: string | null
          duration?: string | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          medical_record_id?: string | null
          medication?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_medical_record_id_fkey"
            columns: ["medical_record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_company_id: string | null
          avatar_url: string | null
          created_at: string
          doctor_id: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active_company_id?: string | null
          avatar_url?: string | null
          created_at?: string
          doctor_id?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active_company_id?: string | null
          avatar_url?: string | null
          created_at?: string
          doctor_id?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_company_id_fkey"
            columns: ["active_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      secretary_doctors: {
        Row: {
          created_at: string
          doctor_id: string
          secretary_id: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          secretary_id: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          secretary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "secretary_doctors_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secretary_doctors_secretary_id_fkey"
            columns: ["secretary_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      service_types: {
        Row: {
          active: boolean
          commission_percent: number | null
          created_at: string
          duration_minutes: number | null
          id: string
          name: string
          price: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          commission_percent?: number | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          name: string
          price?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          commission_percent?: number | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          name?: string
          price?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          case_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          doctor_id: string | null
          due_date: string | null
          id: string
          origin: string | null
          patient_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          case_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          doctor_id?: string | null
          due_date?: string | null
          id?: string
          origin?: string | null
          patient_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          case_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          doctor_id?: string | null
          due_date?: string | null
          id?: string
          origin?: string | null
          patient_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          appointment_id: string | null
          category: string | null
          commission_amount: number | null
          commission_payout_id: string | null
          commission_status: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          date: string
          deleted_at: string | null
          description: string | null
          discount: number | null
          doctor_id: string | null
          due_date: string | null
          gross_amount: number | null
          id: string
          notes: string | null
          paid_at: string | null
          patient_id: string | null
          payment_method: string | null
          recurrence: string | null
          recurrence_parent_id: string | null
          status: string
          supplier: string | null
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          category?: string | null
          commission_amount?: number | null
          commission_payout_id?: string | null
          commission_status?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          deleted_at?: string | null
          description?: string | null
          discount?: number | null
          doctor_id?: string | null
          due_date?: string | null
          gross_amount?: number | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          patient_id?: string | null
          payment_method?: string | null
          recurrence?: string | null
          recurrence_parent_id?: string | null
          status?: string
          supplier?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          category?: string | null
          commission_amount?: number | null
          commission_payout_id?: string | null
          commission_status?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          deleted_at?: string | null
          description?: string | null
          discount?: number | null
          doctor_id?: string | null
          due_date?: string | null
          gross_amount?: number | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          patient_id?: string | null
          payment_method?: string | null
          recurrence?: string | null
          recurrence_parent_id?: string | null
          status?: string
          supplier?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_commission_payout_id_fkey"
            columns: ["commission_payout_id"]
            isOneToOne: false
            referencedRelation: "commission_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          notes: string | null
          number: number
          paid_date: string | null
          payment_method: string | null
          status: string
          transaction_id: string | null
          treatment_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          due_date: string
          id?: string
          notes?: string | null
          number: number
          paid_date?: string | null
          payment_method?: string | null
          status?: string
          transaction_id?: string | null
          treatment_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          notes?: string | null
          number?: number
          paid_date?: string | null
          payment_method?: string | null
          status?: string
          transaction_id?: string | null
          treatment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_installments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_installments_treatment_id_fkey"
            columns: ["treatment_id"]
            isOneToOne: false
            referencedRelation: "treatments"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_medications: {
        Row: {
          created_at: string
          dose: string | null
          end_date: string | null
          frequency: string | null
          id: string
          name: string
          notes: string | null
          period: string | null
          route: string | null
          start_date: string | null
          status: string
          treatment_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dose?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          name: string
          notes?: string | null
          period?: string | null
          route?: string | null
          start_date?: string | null
          status?: string
          treatment_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dose?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          name?: string
          notes?: string | null
          period?: string | null
          route?: string | null
          start_date?: string | null
          status?: string
          treatment_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_medications_treatment_id_fkey"
            columns: ["treatment_id"]
            isOneToOne: false
            referencedRelation: "treatments"
            referencedColumns: ["id"]
          },
        ]
      }
      treatments: {
        Row: {
          color: string | null
          created_at: string
          discount: number
          doctor_id: string | null
          down_payment: number
          end_date: string | null
          id: string
          installments_count: number
          notes: string | null
          objective: string | null
          patient_id: string
          payment_method: string | null
          return_days: number | null
          start_date: string
          status: string
          title: string
          total_value: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          discount?: number
          doctor_id?: string | null
          down_payment?: number
          end_date?: string | null
          id?: string
          installments_count?: number
          notes?: string | null
          objective?: string | null
          patient_id: string
          payment_method?: string | null
          return_days?: number | null
          start_date?: string
          status?: string
          title: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          discount?: number
          doctor_id?: string | null
          down_payment?: number
          end_date?: string | null
          id?: string
          installments_count?: number
          notes?: string | null
          objective?: string | null
          patient_id?: string
          payment_method?: string | null
          return_days?: number | null
          start_date?: string
          status?: string
          title?: string
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          doctor_id: string | null
          id: string
          notes: string | null
          patient_id: string
          preferred_period: string | null
          requested_at: string
          status: string
        }
        Insert: {
          created_at?: string
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          preferred_period?: string | null
          requested_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          preferred_period?: string | null
          requested_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      global_search_view: {
        Row: {
          created_at: string | null
          extra: string | null
          id: string | null
          kind: string | null
          label: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      generate_treatment_installments: {
        Args: { p_treatment_id: string }
        Returns: undefined
      }
      get_allowed_doctor_ids: { Args: never; Returns: string[] }
      get_my_doctor_id: { Args: never; Returns: string }
      is_clinic_member: { Args: never; Returns: boolean }
      is_company_member: { Args: { _company_id: string }; Returns: boolean }
    }
    Enums: {
      event_type: "hearing" | "meeting" | "deadline" | "other"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "todo" | "in_progress" | "done" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      event_type: ["hearing", "meeting", "deadline", "other"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["todo", "in_progress", "done", "cancelled"],
    },
  },
} as const

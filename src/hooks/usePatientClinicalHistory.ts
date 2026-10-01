import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { prontuarioService, agendaService } from "@/services/api";

export type ClinicalHistoryKind = "prontuario" | "consulta" | "evolucao";

export interface ClinicalHistoryItem {
  id: string;
  kind: ClinicalHistoryKind;
  title: string;
  date: string; // ISO date for sorting
  formattedDate: string;
  time?: string;
  doctorName?: string;
  status?: string;
  durationSeconds?: number;
  complaint?: string;
  clinicalHistory?: string;
  evolution?: string;
  conduct?: string;
  diagnosis?: string;
  diagnosisCode?: string;
  allergies?: string;
  medications?: string;
  habits?: string;
  surgicalHistory?: string;
  familyHistory?: string;
  returnDate?: string;
  returnNotes?: string;
  insurance?: string;
  type?: string;
  raw: any;
}

export function usePatientClinicalHistory(
  patientId?: string | null,
  patientName?: string | null,
) {
  const isExample =
    Boolean(patientName?.toLowerCase().includes("exemplo")) ||
    patientId === "example";

  return useQuery({
    queryKey: ["patient-clinical-history", patientId, patientName],
    staleTime: 10_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<ClinicalHistoryItem[]> => {
      const items: ClinicalHistoryItem[] = [];
      const seenIds = new Set<string>();

      // Se patientId não foi informado mas temos patientName, busca o ID no Supabase
      let resolvedId = patientId && patientId.trim() !== "" ? patientId : null;
      if (!resolvedId && patientName && !isExample) {
        const clean = patientName.replace(/\(.*?\)/g, "").trim();
        if (clean.length >= 2) {
          try {
            const { data: p } = await supabase
              .from("patients")
              .select("id")
              .ilike("name", `%${clean}%`)
              .limit(1)
              .maybeSingle();
            if (p?.id) {
              resolvedId = p.id;
            }
          } catch {}
        }
      }

      // 1, 2 e 3. Busca Registros Clínicos, Consultas e Evoluções em PARALELO
      if (resolvedId && !isExample) {
        void supabase.rpc("log_record_access", { p_patient_id: resolvedId, p_action: "view" });

        const fetchMedicalRecords = async () => {
          try {
            const { data: recs, error } = await supabase
              .from("medical_records")
              .select("*, doctors(name)")
              .eq("patient_id", resolvedId)
              .order("created_at", { ascending: false });

            if (!error && recs) {
              for (const r of recs as any[]) {
                if (seenIds.has(r.id)) continue;
                seenIds.add(r.id);

                const dateIso = r.created_at || r.finished_at || new Date().toISOString();
                const d = new Date(dateIso);
                const docName = r.doctors?.name ? `Dr(a). ${r.doctors.name}` : undefined;

                items.push({
                  id: r.id,
                  kind: "prontuario",
                  title: r.diagnosis || (r.complaint ? "Atendimento Clínico" : "Prontuário Médico"),
                  date: dateIso,
                  formattedDate: d.toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  }),
                  time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                  durationSeconds: r.duration_seconds || undefined,
                  complaint: r.complaint || undefined,
                  clinicalHistory: r.clinical_history || undefined,
                  evolution: r.evolution || undefined,
                  conduct: r.conduct || undefined,
                  diagnosis: r.diagnosis || undefined,
                  diagnosisCode: r.diagnosis_code || undefined,
                  allergies: r.allergies || undefined,
                  medications: r.medications || undefined,
                  habits: r.habits || undefined,
                  surgicalHistory: r.surgical_history || undefined,
                  familyHistory: r.family_history || undefined,
                  returnDate: r.return_date || undefined,
                  returnNotes: r.return_notes || undefined,
                  doctorName: docName,
                  status: "Finalizado",
                  raw: r,
                });
              }
            }
          } catch (err) {
            console.warn("Aviso ao buscar medical_records do Supabase:", err);
          }
        };

        const fetchAppointments = async () => {
          try {
            const { data: appts, error } = await supabase
              .from("appointments")
              .select(
                "id, date, start_time, end_time, status, type, notes, insurance, amount, doctor_id, doctors(name, specialty)",
              )
              .eq("patient_id", resolvedId)
              .order("date", { ascending: false });

            if (!error && appts) {
              for (const a of appts) {
                if (seenIds.has(a.id)) continue;
                seenIds.add(a.id);

                const timeStr = a.start_time ? String(a.start_time).slice(0, 5) : "";
                const dateIso = a.date
                  ? `${a.date}T${timeStr || "12:00"}:00`
                  : new Date().toISOString();
                const d = new Date(dateIso);
                const docName = (a.doctors as any)?.name
                  ? `Dr(a). ${(a.doctors as any).name}`
                  : undefined;

                items.push({
                  id: a.id,
                  kind: "consulta",
                  title: a.type || "Consulta Médica",
                  date: dateIso,
                  formattedDate: d.toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  }),
                  time: timeStr || undefined,
                  doctorName: docName,
                  status: formatAppointmentStatus(a.status),
                  insurance: a.insurance || undefined,
                  complaint: a.notes || undefined,
                  type: a.type || "Consulta",
                  raw: a,
                });
              }
            }
          } catch (err) {
            console.warn("Aviso ao buscar appointments:", err);
          }
        };

        const fetchEvolutions = async () => {
          try {
            const { data: treatments } = await supabase
              .from("treatments")
              .select("id, title")
              .eq("patient_id", resolvedId);

            if (treatments && treatments.length > 0) {
              const tIds = treatments.map((t) => t.id);
              const { data: evolutions, error } = await supabase
                .from("treatment_evolutions")
                .select("*")
                .in("treatment_id", tIds)
                .order("occurred_on", { ascending: false });

              if (!error && evolutions) {
                const treatMap = new Map(treatments.map((t) => [t.id, t.title]));
                for (const ev of evolutions) {
                  if (seenIds.has(ev.id)) continue;
                  seenIds.add(ev.id);

                  const dateIso = ev.occurred_on
                    ? `${ev.occurred_on}T12:00:00`
                    : ev.created_at || new Date().toISOString();
                  const d = new Date(dateIso);
                  const tTitle = treatMap.get(ev.treatment_id) || "Tratamento";

                  items.push({
                    id: ev.id,
                    kind: "evolucao",
                    title: `Evolução • ${tTitle}`,
                    date: dateIso,
                    formattedDate: d.toLocaleDateString("pt-BR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    }),
                    evolution: ev.notes,
                    complaint: ev.notes,
                    conduct: ev.next_step || undefined,
                    status: ev.is_return ? "Retorno" : "Evolução clínica",
                    raw: ev,
                  });
                }
              }
            }
          } catch (err) {
            console.warn("Aviso ao buscar treatment_evolutions:", err);
          }
        };

        const fetchPhpExtras = async () => {
          try {
            const [phpRecs, phpAppts] = await Promise.all([
              prontuarioService.getRecords(resolvedId).catch(() => []),
              agendaService.getAppointments({ patient_id: resolvedId }).catch(() => []),
            ]);

            if (Array.isArray(phpRecs)) {
              for (const r of phpRecs) {
                if (seenIds.has(r.id)) continue;
                seenIds.add(r.id);

                const dateIso = r.created_at || r.finished_at || new Date().toISOString();
                const d = new Date(dateIso);

                items.push({
                  id: r.id,
                  kind: "prontuario",
                  title: r.diagnosis || "Atendimento Clínico",
                  date: dateIso,
                  formattedDate: d.toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  }),
                  time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                  durationSeconds: r.duration_seconds || undefined,
                  complaint: r.complaint || undefined,
                  clinicalHistory: r.clinical_history || undefined,
                  evolution: r.evolution || undefined,
                  conduct: r.conduct || undefined,
                  diagnosis: r.diagnosis || undefined,
                  diagnosisCode: r.diagnosis_code || undefined,
                  allergies: r.allergies || undefined,
                  medications:
                    (r as any).medications ||
                    (Array.isArray((r as any).prescriptions)
                      ? (r as any).prescriptions
                          .map((p: any) => p.medication)
                          .filter(Boolean)
                          .join(", ")
                      : undefined),
                  habits: r.habits || undefined,
                  surgicalHistory: r.surgical_history || undefined,
                  familyHistory: r.family_history || undefined,
                  returnDate: r.return_date || undefined,
                  returnNotes: r.return_notes || undefined,
                  doctorName: r.doctor_name || undefined,
                  status: "Finalizado",
                  raw: r,
                });
              }
            }

            if (Array.isArray(phpAppts)) {
              for (const a of phpAppts) {
                if (seenIds.has(a.id)) continue;
                seenIds.add(a.id);

                const timeStr = a.start_time ? String(a.start_time).slice(0, 5) : "";
                const dateIso = a.date
                  ? `${a.date}T${timeStr || "12:00"}:00`
                  : new Date().toISOString();
                const d = new Date(dateIso);

                items.push({
                  id: a.id,
                  kind: "consulta",
                  title: a.type || "Consulta Agendada",
                  date: dateIso,
                  formattedDate: d.toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  }),
                  time: timeStr || undefined,
                  doctorName: a.doctor_name ? `Dr(a). ${a.doctor_name}` : undefined,
                  status: formatAppointmentStatus(a.status),
                  insurance: a.insurance || undefined,
                  complaint: a.notes || undefined,
                  type: a.type || "Consulta",
                  raw: a,
                });
              }
            }
          } catch {}
        };

        // Executa todas as buscas em paralelo
        await Promise.allSettled([
          fetchMedicalRecords(),
          fetchAppointments(),
          fetchEvolutions(),
          fetchPhpExtras(),
        ]);
      }


      // Ordena cronologicamente do mais recente para o mais antigo
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return items;
    },
  });
}

function formatAppointmentStatus(status?: string | null): string {
  if (!status) return "Agendado";
  const s = status.toLowerCase();
  if (s === "completed" || s === "concluido" || s === "realizado") return "Realizado";
  if (s === "confirmed" || s === "confirmado") return "Confirmado";
  if (s === "scheduled" || s === "agendado") return "Agendado";
  if (s === "cancelled" || s === "cancelado") return "Cancelado";
  if (s === "in_progress" || s === "em_andamento") return "Em atendimento";
  return status;
}

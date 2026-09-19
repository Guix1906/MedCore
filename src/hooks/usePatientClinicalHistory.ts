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
  evolution?: string;
  conduct?: string;
  diagnosis?: string;
  insurance?: string;
  type?: string;
  raw: any;
}

export function usePatientClinicalHistory(
  patientId?: string | null,
  patientName?: string | null,
) {
  const isExample =
    !patientId ||
    Boolean(patientName?.toLowerCase().includes("exemplo")) ||
    patientId === "example";

  return useQuery({
    queryKey: ["patient-clinical-history", patientId, patientName],
    staleTime: 10_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<ClinicalHistoryItem[]> => {
      const items: ClinicalHistoryItem[] = [];
      const seenIds = new Set<string>();

      // 1. Busca Registros Clínicos / Prontuários (medical_records) no Supabase
      if (patientId && !isExample) {
        try {
          const { data: recs, error } = await supabase
            .from("medical_records")
            .select("*")
            .eq("patient_id", patientId)
            .order("created_at", { ascending: false });

          if (!error && recs) {
            for (const r of recs) {
              if (seenIds.has(r.id)) continue;
              seenIds.add(r.id);

              const dateIso = r.created_at || r.finished_at || new Date().toISOString();
              const d = new Date(dateIso);

              items.push({
                id: r.id,
                kind: "prontuario",
                title: "Atendimento Clínico & Prontuário",
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
                conduct: r.conduct || undefined,
                diagnosis: r.diagnosis || undefined,
                status: "Finalizado",
                raw: r,
              });
            }
          }
        } catch (err) {
          console.warn("Aviso ao buscar medical_records do Supabase:", err);
        }

        // Tenta também via API PHP de prontuários caso haja registros adicionais
        try {
          const phpRecs = await prontuarioService.getRecords(patientId);
          if (Array.isArray(phpRecs)) {
            for (const r of phpRecs) {
              if (seenIds.has(r.id)) continue;
              seenIds.add(r.id);

              const dateIso = r.created_at || r.finished_at || new Date().toISOString();
              const d = new Date(dateIso);

              items.push({
                id: r.id,
                kind: "prontuario",
                title: "Atendimento Clínico",
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
                conduct: r.conduct || undefined,
                diagnosis: r.diagnosis || undefined,
                doctorName: r.doctor_name || undefined,
                status: "Finalizado",
                raw: r,
              });
            }
          }
        } catch {}
      }

      // 2. Busca Consultas e Agendamentos (appointments) para este paciente
      if (patientId && !isExample) {
        try {
          const { data: appts, error } = await supabase
            .from("appointments")
            .select("id, date, start_time, end_time, status, type, notes, insurance, amount, doctor_id, doctors(name, specialty)")
            .eq("patient_id", patientId)
            .order("date", { ascending: false });

          if (!error && appts) {
            for (const a of appts) {
              if (seenIds.has(a.id)) continue;
              seenIds.add(a.id);

              const timeStr = a.start_time ? String(a.start_time).slice(0, 5) : "";
              const dateIso = a.date ? `${a.date}T${timeStr || "12:00"}:00` : new Date().toISOString();
              const d = new Date(dateIso);

              const docName = (a.doctors as any)?.name ? `Dr(a). ${(a.doctors as any).name}` : undefined;

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

        // Tenta também via agendaService
        try {
          const phpAppts = await agendaService.getAppointments({ patient_id: patientId });
          if (Array.isArray(phpAppts)) {
            for (const a of phpAppts) {
              if (seenIds.has(a.id)) continue;
              seenIds.add(a.id);

              const timeStr = a.start_time ? String(a.start_time).slice(0, 5) : "";
              const dateIso = a.date ? `${a.date}T${timeStr || "12:00"}:00` : new Date().toISOString();
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
      }

      // 3. Busca Evoluções de Tratamentos (treatment_evolutions)
      if (patientId && !isExample) {
        try {
          const { data: treatments } = await supabase
            .from("treatments")
            .select("id, title")
            .eq("patient_id", patientId);

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

                const dateIso = ev.occurred_on ? `${ev.occurred_on}T12:00:00` : ev.created_at || new Date().toISOString();
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
      }

      // 4. Carrega registros do LocalStorage (persistência local imediata e dados de demonstração)
      try {
        const storedHistory =
          (patientId && localStorage.getItem("medcore_prontuario_history_" + patientId)) ||
          (patientName && localStorage.getItem("medcore_prontuario_history_" + patientName));

        if (storedHistory) {
          const localRecs = JSON.parse(storedHistory);
          if (Array.isArray(localRecs)) {
            for (const l of localRecs) {
              if (seenIds.has(l.id)) continue;
              seenIds.add(l.id);

              const dateIso = l.created_at || l.finished_at || new Date().toISOString();
              const d = new Date(dateIso);

              items.push({
                id: l.id || "local-" + Math.random(),
                kind: "prontuario",
                title: "Atendimento Clínico & Anamnese",
                date: dateIso,
                formattedDate: d.toLocaleDateString("pt-BR", {
                  weekday: "short",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                }),
                time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                durationSeconds: l.duration_seconds || undefined,
                complaint: l.complaint || undefined,
                conduct: l.conduct || undefined,
                status: "Finalizado",
                raw: l,
              });
            }
          }
        }

        // Se ainda estiver vazio, tenta snapshot singular
        if (items.length === 0) {
          const lastSnapshot =
            (patientId && localStorage.getItem("medcore_prontuario_" + patientId)) ||
            (patientName && localStorage.getItem("medcore_prontuario_" + patientName));

          if (lastSnapshot) {
            const parsed = JSON.parse(lastSnapshot);
            const pId = parsed.id || "snapshot-" + Date.now();
            if (!seenIds.has(pId)) {
              seenIds.add(pId);
              const dateIso = parsed.created_at || parsed.finished_at || new Date().toISOString();
              const d = new Date(dateIso);

              items.push({
                id: pId,
                kind: "prontuario",
                title: "Atendimento Clínico Gravado",
                date: dateIso,
                formattedDate: d.toLocaleDateString("pt-BR", {
                  weekday: "short",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                }),
                time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                durationSeconds: parsed.duration_seconds || undefined,
                complaint: parsed.complaint || undefined,
                conduct: parsed.conduct || undefined,
                status: "Finalizado",
                raw: parsed,
              });
            }
          }
        }
      } catch (err) {
        console.warn("Aviso ao carregar do localStorage:", err);
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

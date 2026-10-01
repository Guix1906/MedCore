import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Calendar,
  Clock,
  Play,
  ArrowRight,
  FileText,
  UserPlus,
  ChevronRight,
  CalendarCheck,
  Stethoscope,
  History,
} from "lucide-react";
import { patientsService, agendaService } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";

export interface HubPatientSelect {
  id: string;
  name: string;
  tab?: "prontuarios" | "anamnese";
}

export function ProntuarioHub({
  onSelectPatient,
}: {
  onSelectPatient: (patient: HubPatientSelect) => void;
}) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // 1. Busca em tempo real de pacientes com debounce
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const list = await patientsService.getPatients({ q, limit: 8 });
        setSearchResults(list || []);
      } catch {
        // Fallback Supabase
        const { data } = await supabase
          .from("patients")
          .select("id, name, cpf, phone, insurance")
          .ilike("name", `%${q}%`)
          .limit(8);
        setSearchResults(data || []);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [search]);

  // 2. Agendamentos de Hoje (Fila do Dia)
  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, []);

  const { data: todayQueue = [], isLoading: loadingQueue } = useQuery({
    queryKey: ["prontuario-hub-today-queue", todayStr],
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const items: {
        id: string;
        patientId: string;
        patientName: string;
        phone?: string;
        insurance?: string;
        startTime: string;
        type: string;
        status: string;
      }[] = [];
      const seenPatientIds = new Set<string>();

      // 1. Tenta buscar agendamentos (appointments) para hoje via Supabase
      try {
        const { data: appts } = await supabase
          .from("appointments")
          .select(
            "id, patient_id, date, start_time, status, type, insurance, patients(id, name, phone, insurance)",
          )
          .eq("date", todayStr)
          .order("start_time", { ascending: true });

        if (appts && Array.isArray(appts)) {
          for (const a of appts as any[]) {
            const pId = a.patient_id || a.patients?.id || "";
            const pName = a.patients?.name || "Paciente sem nome";
            items.push({
              id: a.id,
              patientId: pId,
              patientName: pName,
              phone: a.patients?.phone || undefined,
              insurance: a.insurance || a.patients?.insurance || "Particular",
              startTime: a.start_time ? String(a.start_time).slice(0, 5) : "00:00",
              type: a.type || "Consulta Clínica",
              status: a.status || "Agendado",
            });
            if (pId) seenPatientIds.add(pId);
          }
        }
      } catch (err) {
        console.warn("Aviso ao buscar appointments de hoje:", err);
      }

      // 2. Se vazio ou para complementar, busca via agendaService
      if (items.length === 0) {
        try {
          const apiAppts = await agendaService.getAppointments({ date: todayStr });
          if (Array.isArray(apiAppts) && apiAppts.length > 0) {
            for (const a of apiAppts) {
              if (items.some((i) => i.id === a.id)) continue;
              items.push({
                id: a.id,
                patientId: a.patient_id || "",
                patientName: a.patient_name || "Paciente",
                phone: a.patient_phone || undefined,
                insurance: a.insurance || "Particular",
                startTime: a.start_time ? String(a.start_time).slice(0, 5) : "00:00",
                type: a.type || "Consulta",
                status: a.status || "Agendado",
              });
            }
          }
        } catch {}
      }

      // 3. Complementa com eventos (events) marcados para hoje com paciente associado
      try {
        const { data: events } = await supabase
          .from("events")
          .select(
            "id, patient_id, title, starts_at, event_type, patients(id, name, phone, insurance)",
          )
          .gte("starts_at", `${todayStr}T00:00:00`)
          .lte("starts_at", `${todayStr}T23:59:59`)
          .order("starts_at", { ascending: true });

        if (events && Array.isArray(events)) {
          for (const ev of events as any[]) {
            const pId = ev.patient_id || ev.patients?.id || "";
            if (pId && seenPatientIds.has(pId)) continue;

            const pName =
              ev.patients?.name ||
              ev.title.replace(/^(consulta|atendimento|retorno)\s*[:-]?\s*/i, "").trim() ||
              ev.title;

            const timeStr = ev.starts_at
              ? new Date(ev.starts_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "00:00";

            items.push({
              id: ev.id,
              patientId: pId,
              patientName: pName,
              phone: ev.patients?.phone || undefined,
              insurance: ev.patients?.insurance || "Particular",
              startTime: timeStr,
              type: ev.event_type || "Atendimento Clínico",
              status: "Agendado",
            });
          }
        }
      } catch {}

      // Ordena por horário
      items.sort((a, b) => a.startTime.localeCompare(b.startTime));
      return items;
    },
  });

  // 3. Pacientes atendidos recentemente (últimos prontuários gravados no banco)
  const { data: recentPatients = [] } = useQuery({
    queryKey: ["prontuario-hub-recent-patients"],
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medical_records")
        .select("patient_id, created_at, patients(id, name, insurance)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      const items: { id: string; name: string; date: string; insurance?: string }[] = [];
      const seen = new Set<string>();
      for (const row of (data ?? []) as any[]) {
        if (!row.patient_id || seen.has(row.patient_id)) continue;
        seen.add(row.patient_id);
        items.push({
          id: row.patient_id,
          name: row.patients?.name || "Paciente",
          date: row.created_at,
          insurance: row.patients?.insurance || undefined,
        });
        if (items.length === 6) break;
      }
      return items;
    },
  });

  return (
    <div className="page-container min-h-full">
      <div className="mx-auto max-w-[1400px] space-y-6">
        {/* Banner de Boas-Vindas & Busca */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-sm"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Stethoscope size={22} className="shrink-0" />
                <span className="text-sm font-semibold uppercase tracking-wider">Prontuário</span>
              </div>
              <h1 className="mt-1 text-2xl md:text-[28px] font-semibold text-foreground">
                Central de Atendimentos & Prontuários
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Busque um paciente ou clique na fila para visualizar seus prontuários organizados ou
                iniciar uma nova consulta.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/pacientes"
                search={{ novo: true }}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border text-sm font-semibold text-foreground/80 hover:bg-surface transition-colors"
              >
                <UserPlus size={16} className="text-primary" /> Novo paciente
              </Link>
              <Link
                to="/agenda"
                search={{ taskId: undefined, deadlineId: undefined, eventId: undefined }}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors shadow-sm"
              >
                <Calendar size={16} /> Ver agenda completa
              </Link>
            </div>
          </div>

          {/* Campo de Busca Rápida */}
          <div className="relative mt-6">
            <div className="relative flex items-center">
              <Search
                size={18}
                className="absolute left-4 text-muted-foreground pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar paciente por nome, CPF ou telefone para abrir prontuário ou atender…"
                className="w-full h-12 pl-11 pr-4 rounded-xl border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:bg-card focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                autoFocus
              />
              {isSearching && (
                <div className="absolute right-4 text-xs font-medium text-primary">Buscando…</div>
              )}
            </div>

            {/* Dropdown de Resultados da Busca */}
            <AnimatePresence>
              {searchResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.18 }}
                  className="absolute left-0 right-0 top-14 z-50 overflow-hidden rounded-xl border border-hairline bg-glass-strong p-2 shadow-(--glass-shadow-lg) glass-blur-strong"
                >
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Pacientes encontrados ({searchResults.length})
                  </div>
                  <div className="divide-y divide-border-soft max-h-72 overflow-y-auto">
                    {searchResults.map((p) => (
                      <div
                        key={p.id}
                        className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-primary-soft/60 transition-colors text-left group"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            onSelectPatient({ id: p.id, name: p.name, tab: "prontuarios" })
                          }
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="h-9 w-9 rounded-full bg-primary/10 text-primary font-semibold text-sm flex items-center justify-center shrink-0">
                            {p.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                              {p.name}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {p.insurance || "Particular"} • {p.phone || p.cpf || "Sem contato"}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              onSelectPatient({ id: p.id, name: p.name, tab: "prontuarios" })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-surface text-foreground text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                            title="Ver prontuários anteriores"
                          >
                            <FileText size={13} className="text-primary" /> Prontuário
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectPatient({ id: p.id, name: p.name, tab: "anamnese" })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold shadow-xs hover:bg-primary-hover transition-colors cursor-pointer"
                            title="Iniciar novo atendimento"
                          >
                            <Play size={13} fill="currentColor" /> Atender
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Fila do Dia & Histórico Recente */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Fila de Atendimento do Dia (2 Colunas) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarCheck size={18} className="text-success" />
                <h2 className="text-[15px] font-semibold text-foreground">
                  Fila de Atendimento de Hoje
                </h2>
              </div>
              <span className="text-xs font-medium text-muted-foreground capitalize">
                {todayFormatted}
              </span>
            </div>

            <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
              {loadingQueue ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Carregando fila de agendamentos…
                </div>
              ) : todayQueue.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                    <Calendar size={22} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Nenhum agendamento para hoje
                    </div>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-0.5">
                      Você pode utilizar a busca acima para abrir os prontuários ou iniciar o
                      atendimento de qualquer paciente cadastrado.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border-soft">
                  {todayQueue.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 flex items-center justify-between gap-4 hover:bg-surface transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onSelectPatient({
                            id: item.patientId,
                            name: item.patientName,
                            tab: "prontuarios",
                          })
                        }
                        className="flex items-center gap-3.5 min-w-0 flex-1 text-left cursor-pointer group"
                      >
                        <div className="h-10 w-12 rounded-xl bg-primary-soft border border-primary/25 text-primary flex flex-col items-center justify-center font-semibold text-xs shrink-0">
                          <Clock size={12} className="mb-0.5" />
                          {item.startTime}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                            {item.patientName}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.type} • {item.insurance || "Particular"}{" "}
                            {item.phone ? `• ${item.phone}` : ""}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectPatient({
                              id: item.patientId,
                              name: item.patientName,
                              tab: "prontuarios",
                            })
                          }
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-card hover:bg-surface text-foreground text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                          title="Abrir prontuários deste paciente"
                        >
                          <FileText size={13} className="text-primary" /> Prontuário
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onSelectPatient({
                              id: item.patientId,
                              name: item.patientName,
                              tab: "anamnese",
                            })
                          }
                          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors shrink-0 shadow-xs cursor-pointer"
                          title="Iniciar atendimento de hoje"
                        >
                          <Play size={13} fill="currentColor" /> Atender
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Atendimentos Recentes & Atalhos (1 Coluna) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <History size={18} className="text-primary" />
              <h2 className="text-[15px] font-semibold text-foreground">Prontuários Recentes</h2>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              {recentPatients.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum prontuário registrado ainda.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentPatients.map((rp, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        onSelectPatient({ id: rp.id, name: rp.name, tab: "prontuarios" })
                      }
                      className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-primary-soft transition-colors text-left group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center font-semibold text-xs shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                          {rp.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate">
                            {rp.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(rp.date).toLocaleDateString("pt-BR")}{" "}
                            {rp.insurance ? `• ${rp.insurance}` : ""}
                          </div>
                        </div>
                      </div>

                      <ChevronRight
                        size={16}
                        className="text-muted-foreground group-hover:text-primary transition-colors shrink-0"
                      />
                    </button>
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-border-soft">
                <Link
                  to="/pacientes"
                  className="flex items-center justify-center gap-1.5 w-full py-2 text-sm font-semibold text-primary hover:underline"
                >
                  Ver todos os pacientes <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

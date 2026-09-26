import { useState, useMemo, useEffect } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  User,
  Calendar,
  Clock,
  Play,
  ArrowRight,
  FileText,
  UserPlus,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  CalendarCheck,
  Stethoscope,
  Activity,
  History,
} from "lucide-react";
import { patientsService, agendaService, prontuarioService } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";

const EASE_OUT = [0.16, 1, 0.3, 1];

export function ProntuarioHub({
  onSelectPatient,
}: {
  onSelectPatient: (patient: { id: string; name: string }) => void;
}) {
  const navigate = useNavigate();
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

  const { data: todayEvents = [], isLoading: loadingEvents } = useQuery({
    queryKey: ["prontuario-hub-today-events", todayStr],
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      try {
        const events = await agendaService.getEvents();
        if (events && Array.isArray(events)) {
          return events.filter((e) => {
            const dateOnly = (e.start_time || "").slice(0, 10);
            return dateOnly === todayStr;
          });
        }
      } catch {}

      // Fallback Supabase
      const { data } = await supabase
        .from("events")
        .select("id, title, description, starts_at, ends_at, assigned_to")
        .gte("starts_at", `${todayStr}T00:00:00`)
        .lte("starts_at", `${todayStr}T23:59:59`)
        .order("starts_at", { ascending: true });

      return (data || []).map((e) => ({
        id: e.id,
        title: e.title,
        start_time: e.starts_at,
        end_time: e.ends_at,
        assigned_to: e.assigned_to,
      }));
    },
  });

  // 3. Pacientes recentes (recuperados do histórico do localStorage ou banco)
  const [recentPatients, setRecentPatients] = useState<
    { id: string; name: string; date: string }[]
  >([]);

  useEffect(() => {
    try {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith("medcore_prontuario_history_"),
      );
      const items: { id: string; name: string; date: string }[] = [];
      const seen = new Set<string>();

      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list) && list.length > 0) {
            const first = list[0];
            const pId = first.patient_id || first.patient_name;
            if (pId && !seen.has(pId)) {
              seen.add(pId);
              items.push({
                id: first.patient_id || "",
                name: first.patient_name || "Paciente",
                date: first.created_at || new Date().toISOString(),
              });
            }
          }
        }
      }
      setRecentPatients(items.slice(0, 5));
    } catch {}
  }, []);

  const handleStartConsultation = (patientId: string, patientName: string) => {
    onSelectPatient({ id: patientId, name: patientName });
  };

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
                Central de atendimentos
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Busque um paciente ou selecione um agendamento da fila de hoje para iniciar a
                Anamnese.
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
                placeholder="Buscar paciente por nome, CPF ou telefone para iniciar atendimento imediato…"
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
                      <button
                        key={p.id}
                        onClick={() => handleStartConsultation(p.id, p.name)}
                        className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-primary-soft transition-colors text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/10 text-primary font-semibold text-sm flex items-center justify-center">
                            {p.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                              {p.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {p.insurance || "Particular"} • {p.phone || p.cpf || "Sem contato"}
                            </div>
                          </div>
                        </div>

                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold shadow-xs">
                          <Play size={13} fill="currentColor" /> Iniciar
                        </span>
                      </button>
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
              {loadingEvents ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Carregando fila de agendamentos…
                </div>
              ) : todayEvents.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                    <Calendar size={22} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Nenhum agendamento para hoje
                    </div>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-0.5">
                      Você pode utilizar a busca acima para iniciar o atendimento de qualquer
                      paciente cadastrado.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border-soft">
                  {todayEvents.map((evt: any) => {
                    const startTime = evt.start_time
                      ? new Date(evt.start_time).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "00:00";

                    return (
                      <div
                        key={evt.id}
                        className="p-4 flex items-center justify-between gap-4 hover:bg-surface transition-colors"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="h-10 w-12 rounded-xl bg-primary-soft border border-primary/25 text-primary flex flex-col items-center justify-center font-semibold text-xs shrink-0">
                            <Clock size={12} className="mb-0.5" />
                            {startTime}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">
                              {evt.title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Consulta / Atendimento Clínico
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleStartConsultation("", evt.title)}
                          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors shrink-0 shadow-xs"
                        >
                          <Play size={13} fill="currentColor" /> Atender
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Atendimentos Recentes & Atalhos (1 Coluna) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <History size={18} className="text-primary" />
              <h2 className="text-[15px] font-semibold text-foreground">Atendimentos Recentes</h2>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              {recentPatients.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum atendimento recente gravado neste dispositivo.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentPatients.map((rp, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleStartConsultation(rp.id, rp.name)}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-primary-soft transition-colors text-left group"
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
                            {new Date(rp.date).toLocaleDateString("pt-BR")}
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

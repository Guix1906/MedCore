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

  // Navegação por teclado na busca (↑ ↓ Enter) e atalho "/" para focar
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => setActiveIndex(0), [searchResults]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || target?.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      document.getElementById("hub-patient-search")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Situação de cada item da fila em relação ao horário atual
  const nowHHMM = new Date().toTimeString().slice(0, 5);
  const isDone = (status: string) => /conclu|finaliz|atendid|realizad|done|completed/i.test(status);
  const isCancelled = (status: string) => /cancel|falt|no.?show/i.test(status);
  const pending = todayQueue.filter((i) => !isDone(i.status) && !isCancelled(i.status));
  const nextItem = pending.find((i) => i.startTime >= nowHHMM) ?? pending[pending.length - 1];
  const doneCount = todayQueue.filter((i) => isDone(i.status)).length;
  const showResults = search.trim().length > 0;

  const initials = (name: string) =>
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();

  return (
    <div className="page-container min-h-full">
      <div className="mx-auto max-w-[1200px] space-y-6">
        {/* Cabeçalho enxuto */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium capitalize text-muted-foreground">{todayFormatted}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px]">
              Atendimentos
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/pacientes"
              search={{ novo: true }}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface"
            >
              <UserPlus size={16} className="text-primary" /> Novo paciente
            </Link>
            <Link
              to="/agenda"
              search={{ taskId: undefined, deadlineId: undefined, eventId: undefined }}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface"
            >
              <Calendar size={16} className="text-primary" /> Agenda
            </Link>
          </div>
        </header>

        {/* Busca: ação principal da tela */}
        <div className="relative">
          <Search
            size={20}
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="hub-patient-search"
            type="search"
            role="combobox"
            aria-expanded={showResults}
            aria-controls="hub-search-results"
            aria-activedescendant={showResults && searchResults[activeIndex] ? `hub-result-${activeIndex}` : undefined}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (!searchResults.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, searchResults.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                const p = searchResults[activeIndex];
                if (p) onSelectPatient({ id: p.id, name: p.name, tab: e.shiftKey ? "anamnese" : "prontuarios" });
              } else if (e.key === "Escape") {
                setSearch("");
              }
            }}
            placeholder="Buscar paciente por nome, CPF ou telefone"
            aria-label="Buscar paciente"
            autoFocus
            className="h-14 w-full rounded-2xl border border-border bg-card pl-14 pr-24 text-base text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
          <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {isSearching ? "Buscando…" : <kbd className="rounded-md border border-border px-1.5 py-0.5 font-sans">/</kbd>}
          </span>

          <AnimatePresence>
            {showResults && !isSearching && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.16 }}
                className="absolute left-0 right-0 top-16 z-50 overflow-hidden rounded-2xl border border-hairline bg-glass-strong p-1.5 shadow-(--glass-shadow-lg) glass-blur-strong"
              >
                {searchResults.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm text-muted-foreground">
                    Nenhum paciente encontrado para "{search.trim()}".
                    <Link
                      to="/pacientes"
                      search={{ novo: true }}
                      className="font-semibold text-primary hover:underline"
                    >
                      Cadastrar novo paciente
                    </Link>
                  </div>
                ) : (
                  <ul id="hub-search-results" role="listbox" className="max-h-80 overflow-y-auto">
                    {searchResults.map((p, idx) => (
                      <li
                        key={p.id}
                        id={`hub-result-${idx}`}
                        role="option"
                        aria-selected={idx === activeIndex}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${idx === activeIndex ? "bg-primary-soft/70" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectPatient({ id: p.id, name: p.name, tab: "prontuarios" })}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                            {initials(p.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">{p.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[p.insurance || "Particular", p.phone || p.cpf].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectPatient({ id: p.id, name: p.name, tab: "anamnese" })}
                          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
                        >
                          <Play size={12} fill="currentColor" /> Atender
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="border-t border-border-soft px-3 pt-1.5 pb-1 text-xs text-muted-foreground">
                  Enter abre o prontuário · Shift + Enter inicia o atendimento
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Fila de hoje */}
          <section className="space-y-3" aria-labelledby="hub-queue-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="hub-queue-title" className="text-base font-semibold text-foreground">
                Fila de hoje
              </h2>
              {todayQueue.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">{pending.length}</strong> a atender ·{" "}
                  <strong className="text-foreground">{doneCount}</strong> atendidos
                </p>
              )}
            </div>

            {loadingQueue ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-muted/60" />
                ))}
              </div>
            ) : todayQueue.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
                <CalendarCheck size={26} className="mx-auto text-muted-foreground/70" />
                <p className="mt-3 text-sm font-semibold text-foreground">Nenhum agendamento para hoje</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Busque um paciente acima para atender sem agendamento.
                </p>
                <Link
                  to="/agenda"
                  search={{ taskId: undefined, deadlineId: undefined, eventId: undefined }}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  Agendar paciente <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <ol className="space-y-2">
                {todayQueue.map((item) => {
                  const done = isDone(item.status);
                  const cancelled = isCancelled(item.status);
                  const isNext = item.id === nextItem?.id;
                  const late = !done && !cancelled && item.startTime < nowHHMM && !isNext;
                  return (
                    <li
                      key={item.id}
                      className={`flex items-center gap-4 rounded-2xl border bg-card p-3 pr-4 transition-colors ${
                        isNext ? "border-primary/40 shadow-sm ring-1 ring-primary/15" : "border-border"
                      } ${done || cancelled ? "opacity-60" : ""}`}
                    >
                      <div
                        className={`flex w-14 shrink-0 flex-col items-center rounded-xl py-1.5 ${
                          isNext ? "bg-primary text-primary-foreground" : "bg-surface text-foreground"
                        }`}
                      >
                        <span className="text-sm font-semibold tabular-nums">{item.startTime}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          item.patientId &&
                          onSelectPatient({ id: item.patientId, name: item.patientName, tab: "prontuarios" })
                        }
                        disabled={!item.patientId}
                        className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
                        title="Abrir prontuário"
                      >
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground hover:text-primary">
                            {item.patientName}
                          </span>
                          {isNext && (
                            <span className="shrink-0 rounded bg-primary/12 px-2 py-0.5 text-xs font-semibold text-primary">
                              Próximo
                            </span>
                          )}
                          {late && (
                            <span className="shrink-0 rounded bg-warning/12 px-2 py-0.5 text-xs font-semibold text-warning">
                              Atrasado
                            </span>
                          )}
                          {(done || cancelled) && (
                            <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                              {done ? "Atendido" : "Cancelado"}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[item.type, item.insurance].filter(Boolean).join(" · ")}
                        </span>
                      </button>

                      {item.patientId && !done && !cancelled && (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectPatient({ id: item.patientId, name: item.patientName, tab: "anamnese" })
                          }
                          className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors ${
                            isNext
                              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                              : "border border-border text-foreground hover:bg-surface"
                          }`}
                        >
                          <Play size={13} fill="currentColor" /> Atender
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Recentes */}
          <aside className="space-y-3" aria-labelledby="hub-recent-title">
            <div className="flex items-baseline justify-between">
              <h2 id="hub-recent-title" className="text-base font-semibold text-foreground">
                Atendidos recentemente
              </h2>
              <Link to="/pacientes" className="text-sm font-semibold text-primary hover:underline">
                Todos
              </Link>
            </div>
            {recentPatients.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
                Os pacientes atendidos aparecerão aqui para acesso rápido.
              </p>
            ) : (
              <ul className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border bg-card">
                {recentPatients.map((rp) => (
                  <li key={rp.id}>
                    <button
                      type="button"
                      onClick={() => onSelectPatient({ id: rp.id, name: rp.name, tab: "prontuarios" })}
                      className="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground group-hover:bg-primary/12 group-hover:text-primary">
                        {initials(rp.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{rp.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {new Date(rp.date).toLocaleDateString("pt-BR")}
                          {rp.insurance ? ` · ${rp.insurance}` : ""}
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-muted-foreground group-hover:text-primary" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

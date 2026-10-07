import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgePlus,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Stethoscope,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type EventKind =
  | "pessoa_criada"
  | "agendamento_criado"
  | "agendamento_concluido"
  | "agendamento_cancelado"
  | "atendimento_finalizado";

type TimelineEvent = {
  id: string;
  kind: EventKind;
  at: string;
  author?: string;
  details?: {
    status: string;
    date: string;
    start: string;
    end: string;
    professional?: string;
  };
};

const KIND_META: Record<EventKind, { label: string; icon: LucideIcon; tone: "green" | "purple" | "red" }> = {
  agendamento_concluido: { label: "Agendamento concluído", icon: CheckCircle2, tone: "green" },
  agendamento_cancelado: { label: "Agendamento cancelado", icon: XCircle, tone: "red" },
  atendimento_finalizado: { label: "Atendimento finalizado", icon: Stethoscope, tone: "green" },
  agendamento_criado: { label: "Agendamento criado", icon: CalendarDays, tone: "purple" },
  pessoa_criada: { label: "Pessoa criada", icon: BadgePlus, tone: "purple" },
};

const TONE_CLASS = {
  green: "bg-emerald-50 text-emerald-500 dark:bg-emerald-500/15",
  purple: "bg-primary/10 text-primary",
  red: "bg-red-50 text-red-500 dark:bg-red-500/15",
};

const DONE = ["completed", "concluido", "realizado", "finalizado"];
const CANCELLED = ["cancelled", "cancelado", "canceled"];

function statusLabel(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (DONE.includes(s)) return "Concluído";
  if (CANCELLED.includes(s)) return "Cancelado";
  if (s === "confirmed" || s === "confirmado") return "Confirmado";
  if (s === "in_progress" || s === "em_andamento") return "Em atendimento";
  return "Agendado";
}

function formatStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${weekday}, ${date} ${time}`;
}

function formatDay(date: string) {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return `${weekday}, ${d.toLocaleDateString("pt-BR")}`;
}

const hms = (t?: string | null) => (t ? String(t).slice(0, 8).padEnd(8, ":00").slice(0, 8) : "");

function initials(name: string) {
  return name
    .replace(/^(dr|dra)\(?a?\)?\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

async function loadTimeline(patientId: string, patientCreatedAt?: string | null): Promise<TimelineEvent[]> {
  const [patientRes, apptRes, recRes] = await Promise.all([
    supabase.from("patients").select("id, created_at").eq("id", patientId).maybeSingle(),
    supabase
      .from("appointments")
      .select("id, created_at, updated_at, date, start_time, end_time, status, doctors(name)")
      .eq("patient_id", patientId),
    supabase
      .from("medical_records")
      .select("id, created_at, doctors(name)")
      .eq("patient_id", patientId),
  ]);

  const appts = (apptRes.data ?? []) as any[];
  const recs = (recRes.data ?? []) as any[];

  // Autor de cada ação, quando a auditoria (activity_log) está disponível.
  const entityIds = [patientId, ...appts.map((a) => a.id), ...recs.map((r) => r.id)];
  const logs: any[] = [];
  try {
    const { data } = await supabase
      .from("activity_log")
      .select("entity_id, action, actor_id, created_at, new_data")
      .in("entity_id", entityIds)
      .order("created_at", { ascending: true });
    if (data) logs.push(...data);
  } catch {
    /* auditoria opcional */
  }

  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length) {
    try {
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
      for (const p of data ?? []) if (p.full_name) names.set(p.id, p.full_name);
    } catch {
      /* nomes opcionais */
    }
  }
  const actorOf = (log?: any) => (log?.actor_id ? names.get(log.actor_id) : undefined);
  const insertLog = (id: string) => logs.find((l) => l.entity_id === id && l.action === "insert");
  const statusLog = (id: string, statuses: string[]) =>
    [...logs]
      .reverse()
      .find(
        (l) =>
          l.entity_id === id &&
          l.action === "update" &&
          statuses.includes(String(l.new_data?.status || "").toLowerCase()),
      );

  const events: TimelineEvent[] = [];

  const createdAt = patientRes.data?.created_at || patientCreatedAt;
  if (createdAt) {
    events.push({
      id: `p-${patientId}`,
      kind: "pessoa_criada",
      at: createdAt,
      author: actorOf(insertLog(patientId)),
    });
  }

  for (const a of appts) {
    const doctor = a.doctors?.name as string | undefined;
    const created = insertLog(a.id);
    events.push({
      id: `ac-${a.id}`,
      kind: "agendamento_criado",
      at: a.created_at,
      author: actorOf(created) || doctor,
      details: {
        status: statusLabel(created?.new_data?.status ?? "scheduled"),
        date: a.date,
        start: hms(a.start_time),
        end: hms(a.end_time),
        professional: doctor,
      },
    });

    const s = String(a.status || "").toLowerCase();
    const finalKind = DONE.includes(s)
      ? "agendamento_concluido"
      : CANCELLED.includes(s)
        ? "agendamento_cancelado"
        : null;
    if (finalKind) {
      const log = statusLog(a.id, finalKind === "agendamento_concluido" ? DONE : CANCELLED);
      events.push({
        id: `af-${a.id}`,
        kind: finalKind,
        at: log?.created_at || a.updated_at || a.created_at,
        author: actorOf(log) || doctor,
      });
    }
  }

  for (const r of recs) {
    events.push({
      id: `r-${r.id}`,
      kind: "atendimento_finalizado",
      at: r.created_at,
      author: actorOf(insertLog(r.id)) || r.doctors?.name,
    });
  }

  return events
    .filter((e) => e.at)
    .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
}

export function PatientTimelineTab({
  patientId,
  patientCreatedAt,
}: {
  patientId: string;
  patientCreatedAt?: string | null;
}) {
  const [filters, setFilters] = useState<EventKind[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["patient-timeline", patientId],
    enabled: Boolean(patientId),
    staleTime: 10_000,
    queryFn: () => loadTimeline(patientId, patientCreatedAt),
  });

  const visible = useMemo(
    () => (filters.length ? events.filter((e) => filters.includes(e.kind)) : events),
    [events, filters],
  );

  const toggle = (k: EventKind) =>
    setFilters((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <section className="max-w-5xl">
      <h2 className="text-lg font-semibold text-foreground pb-4 border-b border-border">
        Linha do tempo
      </h2>

      <div className="relative flex flex-wrap items-center gap-2 py-4 border-b border-border">
        {filters.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-1.5 rounded bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
          >
            {KIND_META[k].label}
            <button
              type="button"
              onClick={() => toggle(k)}
              aria-label={`Remover filtro ${KIND_META[k].label}`}
              className="rounded-full hover:bg-primary/15 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-[15px] font-semibold text-primary hover:bg-primary/5 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Adicionar filtro
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
              {(Object.keys(KIND_META) as EventKind[]).map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={filters.includes(k)}
                    onChange={() => toggle(k)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  {KIND_META[k].label}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando linha do tempo...
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">
          {filters.length ? "Nenhum evento para os filtros selecionados." : "Nenhum evento registrado ainda."}
        </p>
      ) : (
        <ol className="pt-6">
          {visible.map((ev, i) => {
            const meta = KIND_META[ev.kind];
            const Icon = meta.icon;
            const last = i === visible.length - 1;
            return (
              <li key={ev.id} className="relative flex gap-3 pb-6">
                {!last && (
                  <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border" aria-hidden />
                )}
                <span
                  className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[meta.tone]}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[15px] leading-6">
                    <span className="font-semibold text-foreground">{meta.label}</span>
                    <span className="ml-2 text-muted-foreground">
                      {formatStamp(ev.at)}
                      {ev.author ? ` • ${ev.author.toUpperCase()}` : ""}
                    </span>
                  </p>
                  {ev.details && (
                    <div className="mt-2 space-y-2 text-[15px] text-muted-foreground">
                      <p className="flex items-center gap-2">
                        <span className="relative">
                          <Clock className="h-4 w-4" />
                          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
                        </span>
                        {ev.details.status}
                      </p>
                      <p className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4" />
                        {formatDay(ev.details.date)}
                        {ev.details.start ? ` • ${ev.details.start}` : ""}
                        {ev.details.end ? ` - ${ev.details.end}` : ""}
                      </p>
                      {ev.details.professional && (
                        <p className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[9px] font-bold text-emerald-700">
                            {initials(ev.details.professional)}
                          </span>
                          {ev.details.professional.toUpperCase()}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

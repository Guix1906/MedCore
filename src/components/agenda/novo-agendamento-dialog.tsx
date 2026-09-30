import { useEffect, useMemo, useRef, useState, memo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  UserPlus,
  X,
  Calendar as CalendarIcon,
  Clock,
  Tag as TagIcon,
  FileText,
  User,
  CheckCircle2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Activity } from "@/components/agenda/agenda-types";

type MemberOpt = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  role?: string | null;
};
type IdOpt = { id: string };

/**
 * Resolve o responsável escolhido (id de médico ou de usuário) nos dois vínculos usados
 * pela agenda: events.assigned_to (auth.users) e appointments.doctor_id (doctors).
 */
async function resolveProfessional(
  id: string | null | undefined,
): Promise<{ userId: string | null; doctorId: string | null }> {
  if (!id || !isUuid(id)) return { userId: null, doctorId: null };
  const { data } = await supabase
    .from("doctors")
    .select("id, auth_id")
    .or(`id.eq.${id},auth_id.eq.${id}`)
    .limit(1);
  const doctor = data?.[0];
  if (!doctor) return { userId: id, doctorId: null };
  return { userId: doctor.id === id ? doctor.auth_id ?? null : id, doctorId: doctor.id };
}
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { refreshFinance } from "@/features/finance/finance-api";
import { errorMessage } from "@/features/acompanhamentos/followup-utils";
import { patientsService, companyService, agendaService } from "@/services/api";
import { PatientModal } from "@/components/pacientes/PatientModal";
import { useAuth } from "@/hooks/use-auth";
import { useActiveCompany } from "@/hooks/use-active-company";
import { isUuid } from "@/lib/uuid";
import { mergeWithLocalPatients } from "@/lib/local-patients";
import { getStoredLocalDoctors, saveStoredLocalDoctor } from "@/lib/local-doctors";
import { useClinicCities } from "@/hooks/use-clinic-cities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/utils/cn";
import { qk } from "@/lib/query-keys";
import { logClient } from "@/lib/activity-log";

// ============================================================
// Design tokens (verde-limão premium, sem roxo)
// ============================================================
const GREEN = {
  grad: "bg-primary",
  gradSoft: "bg-primary/15",
  text: "text-primary",
  ring: "focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/60",
  border: "border-primary/40",
  hover: "hover:bg-primary/10",
  chip: "bg-primary/10 text-primary dark:text-primary border-primary/30",
};

const TYPES = [
  { id: "atendimento", label: "Agendamento" },
  { id: "bloqueio", label: "Bloqueio de horário" },
  { id: "lembrete", label: "Lembrete" },
  { id: "evento", label: "Evento" },
] as const;

const STATUS = [
  { id: "agendado", label: "Agendado", color: "#3b82f6" },
  { id: "confirmado", label: "Confirmado", color: "#10b981" },
  { id: "pendente", label: "Pendente", color: "#f59e0b" },
  { id: "remarcado", label: "Remarcado", color: "#0ea5e9" },
  { id: "cancelado", label: "Cancelado", color: "#ef4444" },
  { id: "concluido", label: "Concluído", color: "#6b7280" },
] as const;

const COLORS = [
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#64748b",
];

const TAG_PRESETS = [
  {
    label: "Urgente",
    cls: "bg-destructive/10 text-destructive dark:text-rose-400 border-destructive/30",
  },
  {
    label: "Cliente VIP",
    cls: "bg-warning/10 text-warning dark:text-amber-400 border-warning/30",
  },
  { label: "Audiência", cls: "bg-info/10 text-info dark:text-blue-400 border-info/30" },
  {
    label: "Tribunal",
    cls: "bg-muted-foreground/7 text-muted-foreground dark:text-muted-foreground border-muted-foreground/18",
  },
  { label: "Online", cls: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30" },
  { label: "Presencial", cls: "bg-primary/10 text-primary dark:text-primary border-primary/30" },
  {
    label: "Perícia",
    cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  },
  {
    label: "Sustentação Oral",
    cls: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30",
  },
];

function parseMeta(desc: string | null | undefined): Record<string, any> | null {
  if (!desc) return null;
  const m = desc.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function stripMeta(desc: string | null | undefined): string {
  if (!desc) return "";
  return desc.replace(/<!--AGENDAMENTO_META:.*?-->/s, "").trim();
}

// ============================================================
// Types
// ============================================================
type Participant = { id: string; name: string; role?: string; phone?: string; email?: string };
type Reminder = { id: string; when: string; kind: string };
type ChecklistItem = { id: string; text: string; done: boolean; due?: string; owner?: string };
type FileEntry = { id: string; name: string; size: number };

// ============================================================
// Section wrapper
// ============================================================
const Section = memo(function Section({
  title,
  icon: Icon,
  children,
  actions,
  collapsible = false,
}: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  actions?: React.ReactNode;
  collapsible?: boolean;
}) {
  if (collapsible)
    return (
      <details className="rounded-xl border border-border bg-card p-4 md:p-5">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">{title}</summary>
        <div className="mt-4">{children}</div>
      </details>
    );
  return (
    <section
      data-step={title}
      className="scroll-mt-4 rounded-xl border border-border bg-card p-4 md:p-5"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          {Icon && <Icon className="size-4 text-primary" />}
          {title}
        </h3>
        {actions}
      </header>
      {children}
    </section>
  );
});

const FieldLabel = memo(function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <Label className="text-sm font-medium text-foreground">
      {children}
      {required && <span className="text-destructive/80 ml-0.5">*</span>}
    </Label>
  );
});

// Inputs ultra-rápidos e responsivos com digitação instantânea sem lag
const FinancialNumberInput = memo(function FinancialNumberInput({
  value,
  onChange,
  placeholder = "0,00",
  className,
}: {
  value: number | string | "";
  onChange: (v: number | "") => void;
  placeholder?: string;
  className?: string;
}) {
  const [localText, setLocalText] = useState<string>(() =>
    value === "" || value === undefined || value === null ? "" : String(value),
  );

  useEffect(() => {
    const formatted = value === "" || value === undefined || value === null ? "" : String(value);
    setLocalText((prev) => {
      // Only sync if actual numerical value differs to avoid cursor jump while typing
      const prevNum = parseFloat(prev.replace(",", "."));
      const nextNum = parseFloat(formatted.replace(",", "."));
      if (prev === "" && formatted === "") return "";
      if (!isNaN(prevNum) && !isNaN(nextNum) && prevNum === nextNum) return prev;
      return formatted;
    });
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.,]/g, "");
    setLocalText(raw);
    if (raw === "") {
      onChange("");
      return;
    }
    const clean = raw.replace(",", ".");
    const num = parseFloat(clean);
    onChange(isNaN(num) ? "" : num);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={localText}
      onChange={handleChange}
      className={className}
    />
  );
});

const DebouncedInput = memo(function DebouncedInput({
  value,
  onChange,
  onBlur,
  ...rest
}: Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
  delay?: number;
}) {
  const [local, setLocal] = useState(value ?? "");

  useEffect(() => {
    setLocal(value ?? "");
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocal(val);
    onChange(val);
  };

  return <Input {...rest} value={local} onChange={handleChange} onBlur={onBlur} />;
});

const DebouncedTextarea = memo(function DebouncedTextarea({
  value,
  onChange,
  onBlur,
  ...rest
}: Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
  delay?: number;
}) {
  const [local, setLocal] = useState(value ?? "");

  useEffect(() => {
    setLocal(value ?? "");
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLocal(val);
    onChange(val);
  };

  return <Textarea {...rest} value={local} onChange={handleChange} onBlur={onBlur} />;
});

// ============================================================
// Main dialog
// ============================================================
export function NovoAgendamentoDialog({
  open,
  onOpenChange,
  defaultDate,
  onSaved,
  activityToEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate?: Date;
  onSaved?: (created?: Activity) => void;
  activityToEdit?: Activity | null;
}) {
  const { user } = useAuth();
  const { companyId } = useActiveCompany();
  const qc = useQueryClient();

  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("atendimento");
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [selectedClientObj, setSelectedClientObj] = useState<{
    id: string;
    name: string;
    cpf?: string | null;
    phone?: string | null;
  } | null>(null);
  const [assignedTo, setAssignedTo] = useState(user?.id ?? "");
  const [selectedDoctorObj, setSelectedDoctorObj] = useState<MemberOpt | null>(null);
  const [status, setStatus] = useState<(typeof STATUS)[number]["id"]>("agendado");
  const [color, setColor] = useState(COLORS[0]);
  const [notes, setNotes] = useState("");

  const initDate = defaultDate ?? new Date();
  const [day, setDay] = useState(toDateStr(initDate));
  const [start, setStart] = useState(toTimeStr(initDate));
  const [end, setEnd] = useState(toTimeStr(new Date(initDate.getTime() + 60 * 60_000)));
  const [recurrence, setRecurrence] = useState("none");

  const [locName, setLocName] = useState("");
  const [locRoom, setLocRoom] = useState("");
  const [locCity, setLocCity] = useState("");
  const [locState, setLocState] = useState("");
  const [locAddress, setLocAddress] = useState("");

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [caseId, setCaseId] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  // States for Bloqueio & Lembrete
  const [selectedProfs, setSelectedProfs] = useState<string[]>([]);
  const [allClinic, setAllClinic] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [dataExpanded, setDataExpanded] = useState(true);

  // States for Evento
  const [selectedProcedure, setSelectedProcedure] = useState("");
  const [allowOtherProcedures, setAllowOtherProcedures] = useState(false);
  const [dayEnd, setDayEnd] = useState("");

  // Dynamic Attributes & Financial Sinal/Deposit
  const { cities: availableCities } = useClinicCities();
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [procedurePrice, setProcedurePrice] = useState<number | "">("");
  const [downPayment, setDownPayment] = useState<number | "">("");
  const [downPaymentMethod, setDownPaymentMethod] = useState("pix");
  const [city, setCity] = useState(availableCities[0] ?? "");
  const [consultationType, setConsultationType] = useState("nova_consulta");
  const [quickPatientOpen, setQuickPatientOpen] = useState(false);
  const [planCoverage, setPlanCoverage] = useState<"incluso" | "avulso" | "extra">("avulso");
  const [linkedTreatmentId, setLinkedTreatmentId] = useState<string>("");

  useEffect(() => {
    if (!open) return;

    if (activityToEdit) {
      const meta = parseMeta(activityToEdit.description);
      const cleanNotes = stripMeta(activityToEdit.description);
      const startDate =
        activityToEdit.start instanceof Date ? activityToEdit.start : new Date(activityToEdit.start);
      const endDate = activityToEdit.end
        ? activityToEdit.end instanceof Date
          ? activityToEdit.end
          : new Date(activityToEdit.end)
        : new Date(startDate.getTime() + 60 * 60_000);

      const resolvedType =
        (meta?.type as any) ||
        (activityToEdit.kind === "tarefa"
          ? "atendimento"
          : activityToEdit.kind || "atendimento");
      setType(resolvedType);
      setTitle(activityToEdit.title || "");

      const patId = meta?.clientId || activityToEdit.caseId || "";
      setClientId(patId);
      if (patId || meta?.patientName || activityToEdit.title) {
        setSelectedClientObj({
          id: patId,
          name: meta?.patientName || activityToEdit.title || "Paciente",
        });
      } else {
        setSelectedClientObj(null);
      }

      setAssignedTo(activityToEdit.assignedTo || user?.id || "");
      setStatus((meta?.status as any) || activityToEdit.status || "agendado");
      setColor(meta?.color || COLORS[0]);
      setNotes(cleanNotes);

      setDay(toDateStr(startDate));
      setStart(toTimeStr(startDate));
      setEnd(toTimeStr(endDate));
      setDayEnd(toDateStr(endDate));
      setRecurrence(meta?.recurrence || "none");

      setLocName(meta?.locName || activityToEdit.location || "");
      setLocRoom(meta?.locRoom || "");
      setLocCity(meta?.locCity || "");
      setLocState(meta?.locState || "");
      setLocAddress(meta?.locAddress || "");

      setParticipants(meta?.participants || []);
      setCaseId(activityToEdit.caseId || "");
      setFiles(meta?.files || []);
      setReminders(meta?.reminders || []);
      setChecklist(meta?.checklist || []);
      setTags(meta?.tags || []);

      setSelectedProfs(
        meta?.selectedProfs ||
          (activityToEdit.assignedTo ? [activityToEdit.assignedTo] : []),
      );
      setAllClinic(!!meta?.allClinic);
      setAllDay(!!activityToEdit.allDay || !!meta?.allDay);
      setDataExpanded(true);

      setSelectedProcedure(meta?.selectedProcedure || "");
      setAllowOtherProcedures(!!meta?.allowOtherProcedures);
      setIsNewPatient(!!meta?.isNewPatient);

      setProcedurePrice(
        meta?.procedurePrice !== undefined && meta?.procedurePrice !== null
          ? meta.procedurePrice
          : "",
      );
      setDownPayment(
        meta?.downPayment !== undefined && meta?.downPayment !== null
          ? meta.downPayment
          : "",
      );
      setDownPaymentMethod(meta?.downPaymentMethod || "pix");
      setCity(meta?.city || availableCities[0] || "");
      setConsultationType(meta?.consultationType || "nova_consulta");
      setPlanCoverage(meta?.planCoverage || "avulso");
      setLinkedTreatmentId(meta?.linkedTreatmentId || "");
      return;
    }

    // reset when reopening
    const d = defaultDate ?? new Date();
    setType("atendimento");
    setTitle("");
    setClientId("");
    setSelectedClientObj(null);
    setAssignedTo(user?.id ?? "");
    setStatus("agendado");
    setColor(COLORS[0]);
    setNotes("");
    setDay(toDateStr(d));
    setStart(toTimeStr(d));
    setEnd(toTimeStr(new Date(d.getTime() + 60 * 60_000)));
    setRecurrence("none");
    setLocName("");
    setLocRoom("");
    setLocCity("");
    setLocState("");
    setLocAddress("");
    setParticipants([]);
    setCaseId("");
    setFiles([]);
    setReminders([]);
    setChecklist([]);
    setTags([]);
    setSelectedProfs(user?.id ? [user.id] : []);
    setAllClinic(false);
    setAllDay(false);
    setDataExpanded(true);
    setSelectedProcedure("");
    setAllowOtherProcedures(false);
    setDayEnd(toDateStr(d));
    setIsNewPatient(false);
    setProcedurePrice("");
    setDownPayment("");
    setDownPaymentMethod("pix");
    setCity(availableCities[0] ?? "");
    setConsultationType("nova_consulta");
    setPlanCoverage("avulso");
    setLinkedTreatmentId("");
  }, [open, activityToEdit, defaultDate]);
  // ------ Queries com Cache Imediato e Prioridade PHP ------
  const { data: clients = [] } = useQuery({
    queryKey: ["patients-picker"],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let rawList: { id: string; name: string; cpf: string | null; phone: string | null }[] = [];
      try {
        const list = await patientsService.getPatients({ limit: 1500 });
        if (list && Array.isArray(list)) {
          rawList = list.map((p) => ({
            id: p.id,
            name: p.name,
            cpf: p.cpf || null,
            phone: p.phone || null,
          }));
        }
      } catch {}

      if (rawList.length === 0) {
        try {
          const { data } = await supabase
            .from("patients")
            .select("id, name, cpf, phone")
            .order("name")
            .limit(1500);

          rawList = (data ?? []) as {
            id: string;
            name: string;
            cpf: string | null;
            phone: string | null;
          }[];
        } catch {}
      }

      return mergeWithLocalPatients(rawList);
    },
  });

  const { data: procedures = [] } = useQuery({
    queryKey: ["service_types-picker"],
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase.from("service_types").select("id, name, price").order("name");
      return (data ?? []) as { id: string; name: string; price: number | null }[];
    },
  });

  // Query patient consultation history when clientId changes (Optimized & Multi-layer)
  const { data: patientHistory = [], isFetching: isHistoryLoading } = useQuery({
    queryKey: ["patient-consultation-history", clientId, selectedClientObj?.name],
    enabled: open && !!clientId,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!clientId) return [];
      const historyMap = new Map<string, { id: string; date: Date; title: string }>();

      // 1. Consulta agendamentos na tabela 'appointments' do Supabase
      if (isUuid(clientId)) {
        try {
          const { data: apptData } = await supabase
            .from("appointments")
            .select("id, date, start_time, type, notes")
            .eq("patient_id", clientId)
            .order("date", { ascending: false })
            .limit(50);
          (apptData ?? []).forEach((a: any) => {
            const dateObj = new Date(`${a.date}T${a.start_time || "00:00"}:00`);
            historyMap.set(a.id, {
              id: a.id,
              date: isNaN(dateObj.getTime()) ? new Date(a.date) : dateObj,
              title: a.type || "Consulta",
            });
          });
        } catch {}
      }

      // 2. Consulta eventos na tabela 'events' do Supabase filtrando pelo paciente
      try {
        let query = supabase.from("events").select("id, title, starts_at, description, patient_id");
        if (isUuid(clientId)) {
          query = query.or(
            `patient_id.eq.${clientId},description.ilike.%"clientId":"${clientId}"%`,
          );
        } else {
          query = query.ilike("description", `%"clientId":"${clientId}"%`);
        }
        const { data: eventData } = await query.order("starts_at", { ascending: false }).limit(50);
        (eventData ?? []).forEach((e: any) => {
          if (!historyMap.has(e.id)) {
            historyMap.set(e.id, {
              id: e.id,
              date: new Date(e.starts_at),
              title: e.title || "Agendamento",
            });
          }
        });
      } catch {}

      // 3. Consulta agendamentos na API PHP
      try {
        const phpAppts = await agendaService.getAppointments({
          patient_id: clientId,
        });
        if (phpAppts && Array.isArray(phpAppts)) {
          phpAppts.forEach((a: any) => {
            if (!historyMap.has(a.id)) {
              const dateObj = new Date(`${a.date}T${a.start_time || "00:00"}:00`);
              historyMap.set(a.id, {
                id: a.id,
                date: isNaN(dateObj.getTime()) ? new Date(a.date || a.created_at) : dateObj,
                title: a.type || a.title || "Consulta",
              });
            }
          });
        }
      } catch {}

      const list = Array.from(historyMap.values());
      list.sort((a, b) => b.date.getTime() - a.date.getTime());
      return list;
    },
  });

  // Auto-detect patient classification only after fetch completes
  useEffect(() => {
    if (!clientId || isHistoryLoading) return;
    if (patientHistory.length === 0) {
      setIsNewPatient(true);
      setConsultationType("nova_consulta");
    } else {
      setIsNewPatient(false);
      if (patientHistory.length === 1) {
        setConsultationType("1_retorno");
      } else {
        setConsultationType("retorno_recorrente");
      }
    }
  }, [clientId, isHistoryLoading, patientHistory]);

  // Consulta tratamentos/planos ativos do paciente para vincular agendamento
  const { data: patientTreatments = [] } = useQuery({
    queryKey: ["patient-active-treatments", clientId],
    enabled: !!clientId && isUuid(clientId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatments")
        .select("id, title, status, start_date, end_date")
        .eq("patient_id", clientId)
        .in("status", ["active", "in_progress", "scheduled"])
        .order("start_date", { ascending: false });
      if (error) return [];
      return data || [];
    },
  });

  useEffect(() => {
    if (patientTreatments.length > 0) {
      setPlanCoverage("incluso");
      setLinkedTreatmentId(patientTreatments[0].id);
    } else {
      setPlanCoverage("avulso");
      setLinkedTreatmentId("");
    }
  }, [patientTreatments]);

  // Set default procedure list options grouped by category
  const DEFAULT_AGENDA_PROCEDURES = useMemo(
    () => [
      // Consultas
      { id: "proc-c1", name: "Consulta Médica Inicial", category: "🩺 Consultas" },
      { id: "proc-c2", name: "Consulta de Retorno", category: "🩺 Consultas" },

      // Procedimentos & Implantes
      { id: "proc-i1", name: "Implantes Hormonais", category: "💉 Procedimentos & Implantes" },
    ],
    [],
  );

  const allProceduresList = useMemo(() => {
    const list: { id: string; name: string; category: string }[] = procedures.map((p) => ({
      id: p.id,
      name: p.name,
      category: "⚙️ Serviços Cadastrados",
    }));
    DEFAULT_AGENDA_PROCEDURES.forEach((def) => {
      if (!list.some((p) => p.name.toLowerCase() === def.name.toLowerCase())) {
        list.push({ id: def.id, name: def.name, category: def.category });
      }
    });
    return list;
  }, [procedures, DEFAULT_AGENDA_PROCEDURES]);

  const groupedProceduresList = useMemo(() => {
    const map: Record<string, { id: string; name: string; category: string }[]> = {};
    allProceduresList.forEach((p) => {
      (map[p.category] ||= []).push(p);
    });
    return map;
  }, [allProceduresList]);

  const [showNewDoctorModal, setShowNewDoctorModal] = useState(false);

  const { data: members = [] } = useQuery({
    queryKey: qk.membersMini(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let list: MemberOpt[] = [];
      try {
        const phpDoctors = await companyService.getDoctors();
        if (phpDoctors && Array.isArray(phpDoctors) && phpDoctors.length > 0) {
          list = phpDoctors.map((d: any) => ({
            id: d.id,
            full_name: d.name || d.full_name,
            avatar_url: d.avatar_url || null,
            role: d.specialty || "Médico",
          }));
        }
      } catch {}

      if (list.length === 0) {
        try {
          const phpMembers = await companyService.getMembers();
          if (phpMembers && Array.isArray(phpMembers) && phpMembers.length > 0) {
            list = phpMembers.map((m: any) => ({
              id: m.id || m.user_id,
              full_name: m.full_name || m.name,
              avatar_url: m.avatar_url || null,
              role: m.role || "Profissional",
            }));
          }
        } catch {}
      }

      // Consulta médicos no Supabase
      try {
        const { data: docData } = await supabase
          .from("doctors")
          .select("id, name, specialty, role")
          .order("name");
        if (docData && docData.length > 0) {
          const existingIds = new Set(list.map((m) => m.id));
          docData.forEach((d: any) => {
            if (!existingIds.has(d.id)) {
              list.push({
                id: d.id,
                full_name: d.name,
                avatar_url: null,
                role: d.specialty || d.role || "Médico",
              });
              existingIds.add(d.id);
            }
          });
        }
      } catch {}

      // Consulta company_members no Supabase
      try {
        const { data: m } = await supabase
          .from("company_members")
          .select("user_id")
          .eq("company_id", companyId!);
        const ids = (m ?? []).map((x) => x.user_id);
        if (ids.length > 0) {
          const { data: p } = await supabase
            .from("profiles")
            .select("id, full_name, avatar_url")
            .in("id", ids);
          const existingIds = new Set(list.map((m) => m.id));
          (p ?? []).forEach((prof) => {
            if (!existingIds.has(prof.id)) {
              list.push({
                id: prof.id,
                full_name: prof.full_name,
                avatar_url: prof.avatar_url || null,
                role: "Profissional",
              });
              existingIds.add(prof.id);
            }
          });
        }
      } catch {}

      // 3. Mescla com médicos locais (garante que médico recém-criado nunca suma)
      try {
        const localDocs = getStoredLocalDoctors();
        if (localDocs.length > 0) {
          const existingIds = new Set(list.map((m) => m.id));
          localDocs.forEach((d) => {
            if (!existingIds.has(d.id)) {
              list.push({
                id: d.id,
                full_name: d.name,
                avatar_url: d.avatar_url || null,
                role: d.specialty || d.role || "Médico",
              });
              existingIds.add(d.id);
            }
          });
        }
      } catch {}

      return list;
    },
  });

  const { data: cases = [] } = useQuery({
    queryKey: qk.casesMini(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase
        .from("cases")
        .select("id, title, status")
        .eq("company_id", companyId!)
        .order("title");
      return ((data ?? []) as { id: string; title: string; status: string | null }[]).map((c) => ({
        ...c,
        cnj_number: null as string | null,
        polo_passivo: null as string | null,
        court: null as string | null,
      }));
    },
  });

  const selectedClient = useMemo(
    () =>
      clients.find((c: IdOpt) => c.id === clientId) ||
      (selectedClientObj?.id === clientId ? selectedClientObj : null),
    [clients, clientId, selectedClientObj],
  );
  const selectedCase = useMemo(() => cases.find((c: IdOpt) => c.id === caseId), [cases, caseId]);
  const responsible = useMemo(
    () =>
      members.find((m: MemberOpt) => m.id === assignedTo) ||
      (selectedDoctorObj?.id === assignedTo ? selectedDoctorObj : null),
    [members, assignedTo, selectedDoctorObj],
  );

  const allMembersList = useMemo(() => {
    let result = [...members];
    if (selectedDoctorObj && !result.some((m: MemberOpt) => m.id === selectedDoctorObj.id)) {
      result = [selectedDoctorObj, ...result];
    }
    return result;
  }, [members, selectedDoctorObj]);

  const statusMeta = useMemo(() => STATUS.find((s) => s.id === status) ?? STATUS[0], [status]);

  // Deriva o título automaticamente a partir do cliente + tipo
  useEffect(() => {
    if (activityToEdit) return;
    if (!clientId) {
      setTitle(labelOfType(type));
      return;
    }
    const clientName = selectedClient?.name ?? labelOfType(type);
    setTitle(`${clientName} - ${labelOfType(type)}`);
  }, [clientId, type, selectedClient?.name, activityToEdit]);

  const [partOpen, setPartOpen] = useState(false);

  // ------ Save ------
  const save = useMutation({
    mutationFn: async (asDraft: boolean) => {
      if (!companyId || !user) throw new Error("Empresa não selecionada");
      const finalTitle = title.trim() || labelOfType(type);
      const startsAt = new Date(`${day}T${start}:00`);
      const endsAt = new Date(`${type === "evento" ? dayEnd : day}T${end}:00`);
      if (isNaN(startsAt.getTime())) throw new Error("Data/horário inválidos");

      const location =
        [city, locName, locRoom, locAddress, [locCity, locState].filter(Boolean).join("/")]
          .filter(Boolean)
          .join(" • ") || null;

      const parseMoney = (v: any): number => {
        if (!v) return 0;
        if (typeof v === "number") return isNaN(v) ? 0 : v;
        const cleaned = String(v).replace(/\s/g, "").replace(",", ".");
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      };

      const isIncludedInPlan = type === "atendimento" && planCoverage === "incluso";
      const totalAmt = isIncludedInPlan ? 0 : parseMoney(procedurePrice);
      const sinalAmt = isIncludedInPlan ? 0 : parseMoney(downPayment);

      const meta = {
        v: 1,
        type,
        status,
        color,
        recurrence,
        clientId: clientId || null,
        patientName: selectedClient?.name || selectedClientObj?.name || null,
        participants:
          type === "lembrete"
            ? selectedProfs.map((id) => {
                const m = members.find((x) => x.id === id);
                return { id, name: m?.full_name ?? "Sem nome", role: "Colaborador" };
              })
            : participants,
        reminders,
        checklist,
        tags,
        files,
        draft: asDraft,
        // Custom properties
        selectedProfs: type === "bloqueio" || type === "evento" ? selectedProfs : undefined,
        allClinic: type === "bloqueio" ? allClinic : undefined,
        allDay: type === "lembrete" ? allDay : undefined,
        selectedProcedure:
          type === "evento" || type === "atendimento" ? selectedProcedure || undefined : undefined,
        allowOtherProcedures: type === "evento" ? allowOtherProcedures : undefined,
        isNewPatient: type === "atendimento" ? isNewPatient : undefined,
        planCoverage: type === "atendimento" ? planCoverage : undefined,
        linkedTreatmentId:
          type === "atendimento" && planCoverage === "incluso"
            ? linkedTreatmentId || patientTreatments[0]?.id || undefined
            : undefined,
        procedurePrice:
          !isIncludedInPlan && (totalAmt > 0 || sinalAmt > 0)
            ? totalAmt > 0
              ? totalAmt
              : sinalAmt
            : undefined,
        downPayment: !isIncludedInPlan && sinalAmt > 0 ? sinalAmt : 0,
        remainingValue:
          !isIncludedInPlan
            ? Math.max(0, (totalAmt > 0 ? totalAmt : sinalAmt) - sinalAmt)
            : 0,
        downPaymentMethod:
          !isIncludedInPlan ? downPaymentMethod : undefined,
        city: type === "atendimento" ? city : undefined,
        consultationType: type === "atendimento" ? consultationType : undefined,
      };

      const description = [
        notes.trim() || null,
        `\n\n<!--AGENDAMENTO_META:${JSON.stringify(meta)}-->`,
      ]
        .filter(Boolean)
        .join("");

      const finalAssignedTo =
        type === "bloqueio" || type === "evento" || type === "lembrete"
          ? selectedProfs[0] || user.id
          : assignedTo || null;

      if (!isUuid(companyId)) throw new Error("Clínica ativa inválida. Selecione a clínica e tente novamente.");
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData?.user) throw new Error("Sessão expirada. Entre novamente para salvar.");

      // O responsável pode vir da lista de médicos (doctors.id) ou de usuários (auth id):
      // events.assigned_to referencia o usuário e appointments.doctor_id o médico.
      const professional = await resolveProfessional(finalAssignedTo);
      const validPatientId = clientId && isUuid(clientId) ? clientId : null;
      const validCaseId = caseId && isUuid(caseId) ? caseId : null;

      const rawId = activityToEdit?.id;
      const cleanRawId = rawId && rawId.includes(":") ? rawId.split(":")[1] : rawId;
      const insertedId = cleanRawId || crypto.randomUUID();

      if (activityToEdit && activityToEdit.source === "task") {
        const { error } = await supabase
          .from("tasks")
          .update({
            title: finalTitle,
            description,
            due_date: startsAt.toISOString(),
            assigned_to: professional.userId,
            patient_id: validPatientId,
          })
          .eq("id", insertedId);
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("save_agenda_event", {
          p_event: {
            id: insertedId,
            company_id: companyId,
            title: finalTitle,
            description,
            event_type: "meeting",
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            location,
            case_id: validCaseId,
            assigned_to: professional.userId,
            patient_id: validPatientId,
          },
        });
        if (error) throw error;
      }

      const warnings: string[] = [];

      if (type === "atendimento" && validPatientId && professional.doctorId) {
        const { error } = await supabase.from("appointments").upsert({
          id: insertedId,
          patient_id: validPatientId,
          doctor_id: professional.doctorId,
          date: day,
          start_time: start,
          end_time: end,
          type: "consulta",
          status: status || "agendado",
          notes: notes.trim() || undefined,
        });
        if (error) warnings.push(`consulta não registrada (${error.message})`);
      }

      if (type === "atendimento" && !isIncludedInPlan && (totalAmt > 0 || sinalAmt > 0)) {
        const { error } = await supabase.rpc("schedule_appointment_finance", {
          p_event_id: insertedId,
          p_amount: totalAmt > 0 ? totalAmt : sinalAmt,
          p_sinal: sinalAmt,
          p_sinal_method: downPaymentMethod || "pix",
          p_due_date: day,
        });
        if (error) warnings.push(`cobrança não gerada (${error.message})`);
      }

      void refreshFinance(qc);

      if (warnings.length) {
        toast.warning("Agendamento salvo com pendências", {
          description: `${warnings.join("; ")}. Edite o agendamento para tentar novamente.`,
        });
      } else if (isIncludedInPlan) {
        toast.success(
          "Agendamento salvo e vinculado ao plano de tratamento do paciente (sem cobrança duplicada).",
        );
      }

      const createdActivity = {
        id: insertedId,
        kind: "evento",
        title: finalTitle,
        start: startsAt,
        end: endsAt,
        status: status,
        description,
        assignedTo: finalAssignedTo,
        location,
        caseId: caseId || null,
        source: "db",
        allDay: false,
        priority: "normal",
        raw: {},
      } as unknown as Activity;

      // Optimistic cache update
      qc.setQueriesData({ queryKey: ["agenda-events"] }, (old: any) => {
        const item = {
          id: insertedId,
          title: finalTitle,
          description,
          event_type: "meeting" as const,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          location,
          assigned_to: finalAssignedTo || null,
          case_id: caseId || null,
        };
        if (!Array.isArray(old)) return [item];
        const exists = old.some((e: any) => e.id === insertedId);
        return exists ? old.map((e: any) => (e.id === insertedId ? item : e)) : [item, ...old];
      });

      return { createdActivity, asDraft };
    },
    onSuccess: (data) => {
      const asDraft = data?.asDraft;
      toast.success(
        asDraft
          ? "Rascunho salvo"
          : activityToEdit
            ? "Agendamento atualizado com sucesso!"
            : "Agendamento criado com sucesso!",
      );
      logClient({
        action: activityToEdit ? "update" : "create",
        entity_type: "agendamento",
        entity_label: title.trim() || labelOfType(type),
      });
      qc.invalidateQueries({ queryKey: qk.agendaLists.events(companyId) });
      qc.invalidateQueries({ queryKey: ["agenda-events"] });
      qc.invalidateQueries({ queryKey: ["agenda"] });
      qc.invalidateQueries({ queryKey: qk.dashboard.all() });
      qc.invalidateQueries({ queryKey: ["dashboard", "events-appointments"] });
      qc.invalidateQueries({ queryKey: ["financial-snapshot"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
      qc.invalidateQueries({ queryKey: ["finance-dashboard", "transactions"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      onSaved?.(data?.createdActivity);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden max-h-[92dvh] flex flex-col [&>button.absolute]:hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline bg-card px-4 py-4 md:px-6">
            <div>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {activityToEdit
                  ? type === "bloqueio"
                    ? "Editar bloqueio de horário"
                    : type === "lembrete"
                      ? "Editar lembrete"
                      : type === "evento"
                        ? "Editar evento"
                        : "Editar Agendamento"
                  : type === "bloqueio"
                    ? "Novo bloqueio de horário"
                    : type === "lembrete"
                      ? "Novo lembrete"
                      : type === "evento"
                        ? "Novo evento"
                        : "Novo Agendamento"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {activityToEdit
                  ? "Edite todos os detalhes do agendamento."
                  : "Crie um novo agendamento com todos os detalhes."}
              </DialogDescription>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Fechar"
              className="group grid place-items-center h-10 w-10 rounded-full hover:bg-primary/10 transition-all cursor-pointer"
            >
              <X className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-transform duration-300 " />
            </button>
          </div>


          {/* Scroll body */}
          <div
            className="min-h-0 overflow-y-auto flex-1 px-4 md:px-6 py-4 space-y-4 bg-surface"
          >
            {/* Tipo */}
            <div data-step="Tipo" className="scroll-mt-4 space-y-1.5">
              <FieldLabel required>Tipo</FieldLabel>
              <div className="flex flex-wrap gap-2 p-1.5 rounded-xl border border-border/70 bg-background">
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                      type === t.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Form rendering */}
            {type === "bloqueio" ? (
              <>
                {/* Bloqueio de Horário Form */}
                <Section title="Dados básicos" icon={FileText}>
                  <div className="grid gap-4">
                    {/* Título */}
                    <div className="space-y-1.5">
                      <FieldLabel required>Título</FieldLabel>
                      <DebouncedInput
                        value={title}
                        onChange={setTitle}
                        placeholder="Bloqueio de horário"
                        className="h-11 rounded-xl"
                      />
                    </div>

                    {/* Profissionais + Clínica toda */}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <FieldLabel>Profissionais</FieldLabel>
                        <Popover open={partOpen && !allClinic} onOpenChange={setPartOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              disabled={allClinic}
                              className={cn(
                                "w-full h-11 rounded-xl border border-border/70 bg-background px-3 flex items-center justify-between text-sm transition text-left",
                                allClinic &&
                                  "opacity-50 cursor-not-allowed bg-muted/60 dark:bg-muted/10",
                              )}
                            >
                              <div className="flex flex-wrap gap-1.5 items-center overflow-hidden">
                                {selectedProfs.length === 0 ? (
                                  <span className="text-muted-foreground">
                                    Selecionar profissionais
                                  </span>
                                ) : (
                                  selectedProfs.map((id) => {
                                    const member = members.find((m) => m.id === id);
                                    if (!member) return null;
                                    return (
                                      <span
                                        key={id}
                                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-primary-soft text-primary border border-primary/25"
                                      >
                                        {member.full_name}
                                        <span
                                          role="button"
                                          tabIndex={0}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedProfs((prev) =>
                                              prev.filter((x) => x !== id),
                                            );
                                          }}
                                          className="hover:text-destructive transition-colors ml-1 cursor-pointer"
                                        >
                                          <X className="h-3 w-3" />
                                        </span>
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                              <div className="flex items-center gap-2 ml-2 shrink-0">
                                {selectedProfs.length > 0 && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedProfs([]);
                                    }}
                                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                                  >
                                    <X className="h-4 w-4" />
                                  </span>
                                )}
                                <span className="text-muted-foreground text-xs">▼</span>
                              </div>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] max-h-[200px] p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Buscar profissional..." />
                              <CommandList>
                                <CommandEmpty>Nenhum profissional encontrado.</CommandEmpty>
                                <CommandGroup>
                                  {members.map((m) => {
                                    const isSelected = selectedProfs.includes(m.id);
                                    return (
                                      <CommandItem
                                        key={m.id}
                                        value={m.full_name ?? ""}
                                        onSelect={() => {
                                          if (isSelected) {
                                            setSelectedProfs((prev) =>
                                              prev.filter((x) => x !== m.id),
                                            );
                                          } else {
                                            setSelectedProfs((prev) => [...prev, m.id]);
                                          }
                                        }}
                                      >
                                        <div className="flex items-center gap-2 w-full">
                                          <Checkbox checked={isSelected} />
                                          <span>{m.full_name ?? "Sem nome"}</span>
                                        </div>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="flex items-center gap-2 h-11 pb-2">
                        <button
                          type="button"
                          onClick={() => setAllClinic(!allClinic)}
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                            allClinic ? "bg-primary" : "bg-surface-2",
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow ring-0 transition duration-200 ease-in-out",
                              allClinic ? "translate-x-5" : "translate-x-0",
                            )}
                          />
                        </button>
                        <span className="text-sm font-medium text-foreground/80">Clínica toda</span>
                      </div>
                    </div>

                    {/* Observações */}
                    <div className="space-y-1.5">
                      <FieldLabel>Observações</FieldLabel>
                      <DebouncedTextarea
                        value={notes}
                        onChange={setNotes}
                        placeholder="Digite"
                        rows={3}
                        className="rounded-xl resize-none"
                      />
                    </div>
                  </div>
                </Section>

                {/* Data (Collapsible) */}
                <div className="rounded-2xl border border-border/70 bg-card/60 p-5 md:p-6 shadow-sm transition-all hover:shadow-md">
                  <div
                    onClick={() => setDataExpanded(!dataExpanded)}
                    className="flex items-center justify-between cursor-pointer select-none"
                  >
                    <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-primary" />
                      Data
                    </h3>
                    <span className="text-muted-foreground font-semibold">
                      {dataExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                  {dataExpanded && (
                    <div className="grid gap-4 mt-4">
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
                        <div className="space-y-1.5">
                          <FieldLabel required>Dia</FieldLabel>
                          <div className="relative">
                            <Input
                              type="date"
                              value={day}
                              onChange={(e) => setDay(e.target.value)}
                              className="h-11 rounded-xl pl-10"
                            />
                            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <FieldLabel required>Hora</FieldLabel>
                          <div className="relative">
                            <Input
                              type="time"
                              disabled={allDay}
                              value={start}
                              onChange={(e) => setStart(e.target.value)}
                              className={cn("h-11 rounded-xl pl-10", allDay && "opacity-50")}
                            />
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 h-11 pb-2">
                          <button
                            type="button"
                            onClick={() => setAllDay(!allDay)}
                            className={cn(
                              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                              allDay ? "bg-primary" : "bg-surface-2",
                            )}
                          >
                            <span
                              className={cn(
                                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow ring-0 transition duration-200 ease-in-out",
                                allDay ? "translate-x-5" : "translate-x-0",
                              )}
                            />
                          </button>
                          <span className="text-sm font-medium text-foreground/80">
                            Dia inteiro
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel required>Recorrência</FieldLabel>
                        <Select value={recurrence} onValueChange={setRecurrence}>
                          <SelectTrigger className="h-11 rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Não se repete</SelectItem>
                            <SelectItem value="daily">Todos os dias</SelectItem>
                            <SelectItem value="weekly">Semanal</SelectItem>
                            <SelectItem value="biweekly">Quinzenal</SelectItem>
                            <SelectItem value="monthly">Mensal</SelectItem>
                            <SelectItem value="yearly">Anual</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : type === "lembrete" ? (
              <>
                {/* Lembrete Form */}
                <Section title="Dados básicos" icon={FileText}>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Título */}
                      <div className="space-y-1.5">
                        <FieldLabel required>Título</FieldLabel>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Lembrete"
                          className="h-11 rounded-xl"
                        />
                      </div>

                      {/* Participantes */}
                      <div className="space-y-1.5">
                        <FieldLabel>Participantes</FieldLabel>
                        <Popover open={partOpen} onOpenChange={setPartOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="w-full h-11 rounded-xl border border-border/70 bg-background px-3 flex items-center justify-between text-sm transition text-left"
                            >
                              <div className="flex flex-wrap gap-1.5 items-center overflow-hidden">
                                {selectedProfs.length === 0 ? (
                                  <span className="text-muted-foreground">
                                    Selecionar participantes
                                  </span>
                                ) : (
                                  selectedProfs.map((id) => {
                                    const member = members.find((m) => m.id === id);
                                    if (!member) return null;
                                    return (
                                      <span
                                        key={id}
                                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-primary-soft text-primary border border-primary/25"
                                      >
                                        {member.full_name}
                                        <span
                                          role="button"
                                          tabIndex={0}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedProfs((prev) =>
                                              prev.filter((x) => x !== id),
                                            );
                                          }}
                                          className="hover:text-destructive transition-colors ml-1 cursor-pointer"
                                        >
                                          <X className="h-3 w-3" />
                                        </span>
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                              <div className="flex items-center gap-2 ml-2 shrink-0">
                                {selectedProfs.length > 0 && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedProfs([]);
                                    }}
                                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                                  >
                                    <X className="h-4 w-4" />
                                  </span>
                                )}
                                <span className="text-muted-foreground text-xs">▼</span>
                              </div>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] max-h-[200px] p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Buscar colaborador..." />
                              <CommandList>
                                <CommandEmpty>Nenhum colaborador encontrado.</CommandEmpty>
                                <CommandGroup>
                                  {members.map((m) => {
                                    const isSelected = selectedProfs.includes(m.id);
                                    return (
                                      <CommandItem
                                        key={m.id}
                                        value={m.full_name ?? ""}
                                        onSelect={() => {
                                          if (isSelected) {
                                            setSelectedProfs((prev) =>
                                              prev.filter((x) => x !== m.id),
                                            );
                                          } else {
                                            setSelectedProfs((prev) => [...prev, m.id]);
                                          }
                                        }}
                                      >
                                        <div className="flex items-center gap-2 w-full">
                                          <Checkbox checked={isSelected} />
                                          <span>{m.full_name ?? "Sem nome"}</span>
                                        </div>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {/* Observações */}
                    <div className="space-y-1.5">
                      <FieldLabel>Observações</FieldLabel>
                      <DebouncedTextarea
                        value={notes}
                        onChange={setNotes}
                        placeholder="Digite"
                        rows={3}
                        className="rounded-xl resize-none"
                      />
                    </div>
                  </div>
                </Section>

                {/* Data (Collapsible) */}
                <div className="rounded-2xl border border-border/70 bg-card/60 p-5 md:p-6 shadow-sm transition-all hover:shadow-md">
                  <div
                    onClick={() => setDataExpanded(!dataExpanded)}
                    className="flex items-center justify-between cursor-pointer select-none"
                  >
                    <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-primary" />
                      Data
                    </h3>
                    <span className="text-muted-foreground font-semibold">
                      {dataExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                  {dataExpanded && (
                    <div className="grid gap-4 mt-4">
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
                        <div className="space-y-1.5">
                          <FieldLabel required>Dia</FieldLabel>
                          <div className="relative">
                            <Input
                              type="date"
                              value={day}
                              onChange={(e) => setDay(e.target.value)}
                              className="h-11 rounded-xl pl-10"
                            />
                            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <FieldLabel required>Hora</FieldLabel>
                          <div className="relative">
                            <Input
                              type="time"
                              disabled={allDay}
                              value={start}
                              onChange={(e) => setStart(e.target.value)}
                              className={cn("h-11 rounded-xl pl-10", allDay && "opacity-50")}
                            />
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 h-11 pb-2">
                          <button
                            type="button"
                            onClick={() => setAllDay(!allDay)}
                            className={cn(
                              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                              allDay ? "bg-primary" : "bg-surface-2",
                            )}
                          >
                            <span
                              className={cn(
                                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow ring-0 transition duration-200 ease-in-out",
                                allDay ? "translate-x-5" : "translate-x-0",
                              )}
                            />
                          </button>
                          <span className="text-sm font-medium text-foreground/80">
                            Dia inteiro
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel required>Recorrência</FieldLabel>
                        <Select value={recurrence} onValueChange={setRecurrence}>
                          <SelectTrigger className="h-11 rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Não se repete</SelectItem>
                            <SelectItem value="daily">Todos os dias</SelectItem>
                            <SelectItem value="weekly">Semanal</SelectItem>
                            <SelectItem value="biweekly">Quinzenal</SelectItem>
                            <SelectItem value="monthly">Mensal</SelectItem>
                            <SelectItem value="yearly">Anual</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : type === "evento" ? (
              <>
                {/* Evento Form */}
                <Section title="Dados básicos" icon={FileText}>
                  <div className="grid gap-4">
                    {/* Título do evento */}
                    <div className="space-y-1.5">
                      <FieldLabel required>Título do evento</FieldLabel>
                      <DebouncedInput
                        value={title}
                        onChange={setTitle}
                        placeholder="Digite"
                        className="h-11 rounded-xl"
                      />
                    </div>

                    {/* Range de Data e Hora */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1.5">
                        <FieldLabel required>Data de início</FieldLabel>
                        <div className="relative">
                          <Input
                            type="date"
                            value={day}
                            onChange={(e) => setDay(e.target.value)}
                            className="h-11 rounded-xl pl-10"
                          />
                          <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel required>Hora de início</FieldLabel>
                        <div className="relative">
                          <Input
                            type="time"
                            value={start}
                            onChange={(e) => setStart(e.target.value)}
                            className="h-11 rounded-xl pl-10"
                          />
                          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel required>Data de fim</FieldLabel>
                        <div className="relative">
                          <Input
                            type="date"
                            value={dayEnd}
                            onChange={(e) => setDayEnd(e.target.value)}
                            className="h-11 rounded-xl pl-10"
                          />
                          <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel required>Hora de fim</FieldLabel>
                        <div className="relative">
                          <Input
                            type="time"
                            value={end}
                            onChange={(e) => setEnd(e.target.value)}
                            className="h-11 rounded-xl pl-10"
                          />
                          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>
                    </div>

                    {/* Profissionais */}
                    <div className="space-y-1.5">
                      <FieldLabel>Profissionais</FieldLabel>
                      <Popover open={partOpen} onOpenChange={setPartOpen}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="w-full h-11 rounded-xl border border-border/70 bg-background px-3 flex items-center justify-between text-sm transition text-left"
                          >
                            <div className="flex flex-wrap gap-1.5 items-center overflow-hidden">
                              {selectedProfs.length === 0 ? (
                                <span className="text-muted-foreground">
                                  Selecionar profissionais
                                </span>
                              ) : (
                                selectedProfs.map((id) => {
                                  const member = members.find((m) => m.id === id);
                                  if (!member) return null;
                                  return (
                                    <span
                                      key={id}
                                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-primary-soft text-primary border border-primary/25"
                                    >
                                      {member.full_name}
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedProfs((prev) => prev.filter((x) => x !== id));
                                        }}
                                        className="hover:text-destructive transition-colors ml-1 cursor-pointer"
                                      >
                                        <X className="h-3 w-3" />
                                      </span>
                                    </span>
                                  );
                                })
                              )}
                            </div>
                            <div className="flex items-center gap-2 ml-2 shrink-0">
                              {selectedProfs.length > 0 && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedProfs([]);
                                  }}
                                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                  <X className="h-4 w-4" />
                                </span>
                              )}
                              <span className="text-muted-foreground text-xs">▼</span>
                            </div>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[var(--radix-popover-trigger-width)] max-h-[200px] p-0"
                          align="start"
                        >
                          <Command>
                            <CommandInput placeholder="Buscar profissional..." />
                            <CommandList>
                              <CommandEmpty>Nenhum profissional encontrado.</CommandEmpty>
                              <CommandGroup>
                                {members.map((m) => {
                                  const isSelected = selectedProfs.includes(m.id);
                                  return (
                                    <CommandItem
                                      key={m.id}
                                      value={m.full_name ?? ""}
                                      onSelect={() => {
                                        if (isSelected) {
                                          setSelectedProfs((prev) =>
                                            prev.filter((x) => x !== m.id),
                                          );
                                        } else {
                                          setSelectedProfs((prev) => [...prev, m.id]);
                                        }
                                      }}
                                    >
                                      <div className="flex items-center gap-2 w-full">
                                        <Checkbox checked={isSelected} />
                                        <span>{m.full_name ?? "Sem nome"}</span>
                                      </div>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* Procedimentos */}
                    <div className="space-y-1.5">
                      <FieldLabel>Procedimento / Serviço</FieldLabel>
                      <Select
                        value={selectedProcedure || "__none"}
                        onValueChange={(v) => setSelectedProcedure(v === "__none" ? "" : v)}
                      >
                        <SelectTrigger className="h-11 rounded-xl font-medium border-primary/40 bg-primary/5">
                          <SelectValue placeholder="Pesquise/Selecione o procedimento" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[320px]">
                          <SelectItem value="__none">Nenhum (Somente consulta simples)</SelectItem>
                          {Object.entries(groupedProceduresList).map(([cat, items]) => (
                            <SelectGroup key={cat}>
                              <SelectLabel className="font-semibold text-xs text-primary uppercase tracking-wider px-2 py-1.5 bg-muted/40">
                                {cat}
                              </SelectLabel>
                              {items.map((p) => (
                                <SelectItem
                                  key={p.id}
                                  value={p.id}
                                  className="cursor-pointer font-normal pl-4"
                                >
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Switch permitindo outros procedimentos */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setAllowOtherProcedures(!allowOtherProcedures)}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                          allowOtherProcedures ? "bg-primary" : "bg-surface-2",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow ring-0 transition duration-200 ease-in-out",
                            allowOtherProcedures ? "translate-x-5" : "translate-x-0",
                          )}
                        />
                      </button>
                      <span className="text-sm font-medium text-foreground/80">
                        Permitir agendamentos de outros procedimentos nesta data
                      </span>
                    </div>
                  </div>
                </Section>
              </>
            ) : (
              <>
                {/* Agendamento (Default) Form */}
                <Section title="Dados básicos" icon={FileText}>
                  <div className="grid gap-4">
                    {/* Paciente */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <FieldLabel required>Paciente</FieldLabel>

                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => setQuickPatientOpen(true)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-soft border border-primary/25 text-primary hover:bg-primary/15 text-xs font-semibold transition-colors cursor-pointer"
                            title="Cadastrar novo paciente"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            <span>+ Novo paciente</span>
                          </button>

                        </div>
                      </div>
                      <ClientPicker
                        value={clientId}
                        onChange={(v, obj) => {
                          setClientId(v);
                          setSelectedClientObj(obj ?? null);
                        }}
                        clients={clients}
                        selectedClient={selectedClientObj}
                      />

                      {/* Resumo/Histórico do Paciente para a Secretaria */}
                      {clientId && (
                        <div className="mt-2.5 p-3 rounded-xl border border-primary/20 bg-primary/5 flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-primary" /> Ficha do Paciente
                            </span>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "text-xs font-semibold px-2 py-0.5 rounded-full",
                                  isNewPatient
                                    ? "bg-warning/15 text-warning"
                                    : "bg-success/15 text-success",
                                )}
                              >
                                {isNewPatient
                                  ? "Novo Paciente (1ª Consulta)"
                                  : "Paciente Recorrente"}
                              </span>
                              <span className="text-xs font-semibold bg-card border border-border px-2 py-0.5 rounded-full text-muted-foreground">
                                {patientHistory.length} consulta(s) anterior(es)
                              </span>
                            </div>
                          </div>
                          {patientHistory.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Último atendimento:{" "}
                              <span className="font-semibold text-foreground">
                                {patientHistory[0].date.toLocaleDateString("pt-BR")} —{" "}
                                {patientHistory[0].title}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Cidade de Atendimento + Tipo de Consulta */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <FieldLabel required>Cidade de Atendimento</FieldLabel>
                        <Select value={city} onValueChange={setCity}>
                          <SelectTrigger className="h-11 rounded-xl">
                            <SelectValue
                              placeholder={
                                availableCities.length === 0
                                  ? "Nenhuma cidade cadastrada"
                                  : "Selecione a cidade"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {availableCities.length === 0 ? (
                              <div className="p-3 text-xs text-muted-foreground text-center">
                                Nenhuma cidade cadastrada.
                                <br />
                                <span className="text-primary font-medium">
                                  Cadastre em Configurações.
                                </span>
                              </div>
                            ) : (
                              availableCities.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel required>Tipo de Atendimento</FieldLabel>
                        <Select
                          value={consultationType}
                          onValueChange={(v) => {
                            setConsultationType(v);
                            if (v === "nova_consulta") {
                              setIsNewPatient(true);
                            } else {
                              setIsNewPatient(false);
                            }
                          }}
                        >
                          <SelectTrigger className="h-11 rounded-xl">
                            <SelectValue placeholder="Selecione o tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="nova_consulta">Nova Consulta</SelectItem>
                            <SelectItem value="1_retorno">1º Retorno</SelectItem>
                            <SelectItem value="retorno_recorrente">Retorno Recorrente</SelectItem>
                            <SelectItem value="procedimento">Procedimento / Tratamento</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Responsável + Status + Cor */}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <FieldLabel>Responsável</FieldLabel>
                          <button
                            type="button"
                            onClick={() => setShowNewDoctorModal(true)}
                            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <UserPlus size={12} />+ Novo Médico
                          </button>
                        </div>
                        <Select
                          value={assignedTo || "__none"}
                          onValueChange={(v) => setAssignedTo(v === "__none" ? "" : v)}
                        >
                          <SelectTrigger className="h-11 rounded-xl">
                            <SelectValue placeholder="Selecionar responsável">
                              {responsible ? (
                                <span className="flex items-center gap-2">
                                  <Avatar
                                    name={responsible.full_name}
                                    url={responsible.avatar_url}
                                  />
                                  <span className="truncate">{responsible.full_name}</span>
                                </span>
                              ) : (
                                "Selecionar responsável"
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {allMembersList.map((m: MemberOpt) => (
                              <SelectItem key={m.id} value={m.id}>
                                <span className="flex items-center gap-2">
                                  <Avatar name={m.full_name} url={m.avatar_url} />
                                  <span className="flex flex-col">
                                    <span className="text-sm">{m.full_name ?? "Sem nome"}</span>
                                    {m.role && (
                                      <span className="text-xs text-muted-foreground">
                                        {m.role}
                                      </span>
                                    )}
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel>Status</FieldLabel>
                        <Select
                          value={status}
                          onValueChange={(v) => setStatus(v as (typeof STATUS)[number]["id"])}
                        >
                          <SelectTrigger className="h-11 rounded-xl">
                            <SelectValue>
                              <span className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ background: statusMeta.color }}
                                />
                                {statusMeta.label}
                              </span>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                <span className="flex items-center gap-2">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ background: s.color }}
                                  />
                                  {s.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel>Cor</FieldLabel>
                        <div className="flex items-center gap-1.5 p-2 rounded-xl border border-border/70 bg-background h-11">
                          {COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              aria-label={`Cor ${c}`}
                              onClick={() => setColor(c)}
                              className={cn(
                                "h-6 w-6 rounded-full transition-all duration-150 hover:scale-110",
                                color === c &&
                                  "ring-2 ring-offset-2 ring-offset-background ring-primary scale-110",
                              )}
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </Section>
                <Section title="Data e horário" icon={Clock}>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <FieldLabel required>Data</FieldLabel>
                        <div className="relative">
                          <DebouncedInput
                            type="date"
                            value={day}
                            onChange={setDay}
                            className="h-11 rounded-xl pl-10"
                          />
                          <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel required>Hora inicial</FieldLabel>
                        <div className="relative">
                          <DebouncedInput
                            type="time"
                            value={start}
                            onChange={setStart}
                            className="h-11 rounded-xl pl-10"
                          />
                          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel required>Hora final</FieldLabel>
                        <div className="relative">
                          <DebouncedInput
                            type="time"
                            value={end}
                            onChange={setEnd}
                            className="h-11 rounded-xl pl-10"
                          />
                          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  </div>
                </Section>
                <Section title="Plano, cobrança e observações" icon={FileText}>
                  <div className="grid gap-4">
                    {/* Cobertura de Plano de Tratamento */}
                    {patientTreatments.length > 0 && (
                      <div className="p-3.5 rounded-xl border border-sky-500/32 bg-sky-500/10 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-semibold text-xs text-sky-800 dark:text-sky-300 uppercase tracking-wider">
                            <TagIcon className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                            <span>Plano / Pacote Ativo do Paciente</span>
                          </div>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-500/20 dark:bg-sky-950 text-sky-800 dark:text-sky-200">
                            {patientTreatments.length === 1
                              ? "1 plano ativo"
                              : `${patientTreatments.length} planos ativos`}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          O paciente está sob protocolo contínuo. Escolha se esta consulta é uma
                          etapa coberta pelo plano ou um atendimento com cobrança avulsa.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div className="space-y-1">
                            <FieldLabel>Enquadramento da Consulta</FieldLabel>
                            <Select
                              value={planCoverage}
                              onValueChange={(v: "incluso" | "avulso" | "extra") =>
                                setPlanCoverage(v)
                              }
                            >
                              <SelectTrigger className="h-10 rounded-xl bg-background font-medium border-sky-400/50">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="incluso">
                                  Incluso no plano (sem cobrança)
                                </SelectItem>
                                <SelectItem value="avulso">
                                  Consulta avulsa (gera cobrança)
                                </SelectItem>
                                <SelectItem value="extra">
                                  Procedimento extra (gera cobrança)
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {patientTreatments.length > 1 ? (
                            <div className="space-y-1">
                              <FieldLabel>Vincular ao Tratamento</FieldLabel>
                              <Select
                                value={linkedTreatmentId}
                                onValueChange={setLinkedTreatmentId}
                              >
                                <SelectTrigger className="h-10 rounded-xl bg-background font-medium border-sky-400/50">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {patientTreatments.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.title}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <FieldLabel>Plano Vinculado</FieldLabel>
                              <div className="h-10 px-3 rounded-xl bg-background/80 border border-sky-500/16 text-xs font-semibold flex items-center text-foreground truncate">
                                {patientTreatments[0]?.title}
                              </div>
                            </div>
                          )}
                        </div>
                        {planCoverage === "incluso" && (
                          <div className="p-2.5 rounded-lg bg-success/10 border border-success/30 text-success dark:text-emerald-300 text-xs flex items-center gap-2 font-medium">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success dark:text-emerald-400" />
                            <span>
                              Consulta inclusa no pacote do paciente. Nenhuma cobrança financeira
                              adicional será gerada.
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Procedimento e Valores / Sinal */}
                    <div className="space-y-3 p-4 rounded-xl border border-border/70 bg-muted/20">

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <FieldLabel>Procedimento / Serviço</FieldLabel>
                          <Select
                            value={selectedProcedure || "__none"}
                            onValueChange={(v) => {
                              const val = v === "__none" ? "" : v;
                              setSelectedProcedure(val);
                              if (val && planCoverage !== "incluso") {
                                const found =
                                  procedures.find((p) => p.id === val) ||
                                  (allProceduresList.find((p) => p.id === val) as any);
                                if (found && found.price) {
                                  setProcedurePrice(found.price);
                                }
                              }
                            }}
                          >
                            <SelectTrigger className="h-11 rounded-xl bg-background font-medium border-primary/40">
                              <SelectValue placeholder="Selecionar procedimento na lista..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-[320px]">
                              <SelectItem value="__none">Nenhum (Somente agendamento)</SelectItem>
                              {Object.entries(groupedProceduresList).map(([cat, items]) => (
                                <SelectGroup key={cat}>
                                  <SelectLabel className="font-semibold text-xs text-primary uppercase tracking-wider px-2 py-1.5 bg-muted/40">
                                    {cat}
                                  </SelectLabel>
                                  {items.map((p) => (
                                    <SelectItem
                                      key={p.id}
                                      value={p.id}
                                      className="cursor-pointer font-normal pl-4"
                                    >
                                      {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <FieldLabel>Valor Total (R$)</FieldLabel>
                          {planCoverage === "incluso" ? (
                            <Input
                              type="text"
                              disabled
                              value="Incluso no Pacote (R$ 0,00)"
                              className="h-11 rounded-xl bg-muted text-muted-foreground font-semibold cursor-not-allowed"
                            />
                          ) : (
                            <FinancialNumberInput
                              placeholder="0,00"
                              value={procedurePrice}
                              onChange={setProcedurePrice}
                              className="h-11 rounded-xl bg-background font-semibold"
                            />
                          )}
                        </div>
                      </div>

                      {planCoverage !== "incluso" && (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <FieldLabel>Sinal recebido agora (R$)</FieldLabel>
                              <FinancialNumberInput
                                placeholder="0,00"
                                value={downPayment}
                                onChange={setDownPayment}
                                className="h-11 rounded-xl bg-background font-semibold"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <FieldLabel>Forma de pagamento do sinal</FieldLabel>
                              <Select value={downPaymentMethod} onValueChange={setDownPaymentMethod}>
                                <SelectTrigger className="h-11 rounded-xl bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pix">Pix</SelectItem>
                                  <SelectItem value="cartao_credito">Cartão de crédito</SelectItem>
                                  <SelectItem value="cartao_debito">Cartão de débito</SelectItem>
                                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                                  <SelectItem value="boleto">Boleto</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {(Number(procedurePrice) || 0) > 0 && (
                            <p className="text-sm text-muted-foreground">
                              Restante a receber no atendimento:{" "}
                              <span className="font-semibold text-foreground tabular-nums">
                                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                                  Math.max(0, (Number(procedurePrice) || 0) - (Number(downPayment) || 0)),
                                )}
                              </span>
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Observações */}
                    <div className="space-y-1.5">
                      <FieldLabel>Observações</FieldLabel>
                      <DebouncedTextarea
                        value={notes}
                        onChange={setNotes}
                        placeholder="Digite observações sobre este agendamento..."
                        rows={3}
                        className="rounded-xl resize-none"
                      />
                    </div>
                  </div>
                </Section>

              </>
            )}
          </div>

          {/* Footer */}
          {type === "bloqueio" || type === "lembrete" || type === "evento" ? (
            <div className="flex items-center justify-center border-t border-hairline bg-glass-strong px-4 py-3 glass-blur md:px-6">
              <Button
                onClick={() => save.mutate(false)}
                disabled={save.isPending}
                size="lg"
                className="px-8 font-semibold"
              >
                {save.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 border-t border-hairline bg-glass-strong px-4 py-3 glass-blur md:px-6">
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-11 px-5">
                Cancelar
              </Button>
              <Button
                onClick={() => save.mutate(false)}
                disabled={save.isPending}
                size="lg"
                className={cn("px-6 font-semibold", GREEN.grad, "hover:bg-primary-hover")}
              >
                {save.isPending
                  ? "Salvando..."
                  : activityToEdit
                    ? "Salvar Alterações"
                    : "Salvar Agendamento"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PatientModal
        open={quickPatientOpen}
        onClose={() => setQuickPatientOpen(false)}
        onSaved={(newPatient) => {
          if (newPatient?.id) {
            const item = {
              id: newPatient.id,
              name: newPatient.name,
              cpf: newPatient.cpf || null,
              phone: newPatient.phone || null,
            };
            setSelectedClientObj(item);
            setClientId(newPatient.id);
            setIsNewPatient(true);
            qc.setQueryData(["patients-picker"], (old: any = []) => {
              const exists = old.some((p: any) => p.id === newPatient.id);
              return exists
                ? old.map((p: any) => (p.id === newPatient.id ? item : p))
                : [item, ...old];
            });
            qc.invalidateQueries({ queryKey: ["patients-picker"] });
            qc.invalidateQueries({ queryKey: ["patients-list"] });
            qc.invalidateQueries({ queryKey: ["patients-mini"] });
            qc.invalidateQueries({ queryKey: ["patients"] });
          }
        }}
      />
      <NewDoctorDialog
        open={showNewDoctorModal}
        onClose={() => setShowNewDoctorModal(false)}
        companyId={companyId}
        onCreated={(newDoc) => {
          setSelectedDoctorObj(newDoc);
          setAssignedTo(newDoc.id);
          qc.setQueriesData({ queryKey: qk.membersMini(companyId) }, (old: any = []) => {
            const exists = old.some((m: any) => m.id === newDoc.id);
            return exists
              ? old.map((m: any) => (m.id === newDoc.id ? newDoc : m))
              : [newDoc, ...old];
          });
          qc.invalidateQueries({ queryKey: qk.membersMini(companyId) });
          qc.invalidateQueries({ queryKey: ["allowed-doctors"] });
          qc.invalidateQueries({ queryKey: ["dashboard", "doctors"] });
        }}
      />
    </>
  );
}

function NewDoctorDialog({
  open,
  onClose,
  onCreated,
  companyId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (doc: MemberOpt) => void;
  companyId?: string | null;
}) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [crm, setCrm] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("O nome do médico/profissional é obrigatório.");
      return;
    }
    setSaving(true);
    const newId = crypto.randomUUID();
    const cleanEmail = email.trim() || `medico.${newId.slice(0, 8)}@medcore.local`;
    const docObj: MemberOpt = {
      id: newId,
      full_name: name.trim(),
      role: specialty.trim() || "Médico",
      avatar_url: null,
    };

    saveStoredLocalDoctor({
      id: newId,
      name: name.trim(),
      email: cleanEmail,
      specialty: specialty.trim() || null,
      crm: crm.trim() || null,
      phone: phone.trim() || null,
      role: "medico",
      active: true,
    });

    const payload = {
      id: newId,
      name: name.trim(),
      email: cleanEmail,
      specialty: specialty.trim() || null,
      crm: crm.trim() || null,
      phone: phone.trim() || null,
      role: "medico",
      active: true,
    };

    try {
      const { error } = await supabase.from("doctors").insert(payload);
      if (error) {
        await supabase.from("doctors").insert({
          id: newId,
          name: name.trim(),
          email: cleanEmail,
          specialty: specialty.trim() || null,
          role: "medico",
          active: true,
        });
      }
    } catch (err) {
      console.warn("Erro ao salvar médico:", err);
    }

    setSaving(false);
    toast.success(`Médico Dr(a). ${name.trim()} cadastrado com sucesso!`);
    onCreated(docObj);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md rounded-2xl p-6 bg-background">
        <DialogTitle className="text-lg font-semibold text-foreground">
          Cadastrar Médico / Profissional
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Adicione um novo profissional para vincular aos agendamentos e prontuários.
        </DialogDescription>

        <form onSubmit={handleSave} className="space-y-3.5 mt-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Nome Completo *</Label>
            <Input
              required
              placeholder="Ex.: Dr. Roberto Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-xl"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Especialidade</Label>
              <Input
                placeholder="Ex.: Dermatologia"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">CRM / Registro</Label>
              <Input
                placeholder="Ex.: CRM 123456"
                value={crm}
                onChange={(e) => setCrm(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Telefone</Label>
              <Input
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">E-mail</Label>
              <Input
                type="email"
                placeholder="medico@clinica.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
            <Button type="button" variant="outline" onClick={onClose} className=" h-10">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className=" h-10 bg-primary text-primary-foreground font-semibold"
            >
              {saving ? "Salvando..." : "Salvar Médico"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Helpers
// ============================================================
function Avatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initials = (name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (url) return <img src={url} alt={name ?? ""} className="h-6 w-6 rounded-full object-cover" />;
  return (
    <span className="h-6 w-6 rounded-full grid place-items-center text-xs font-semibold text-white bg-primary">
      {initials}
    </span>
  );
}

const ClientPicker = memo(function ClientPicker({
  value,
  onChange,
  clients,
  selectedClient,
}: {
  value: string;
  onChange: (
    v: string,
    clientObj?: { id: string; name: string; cpf?: string | null; phone?: string | null } | null,
  ) => void;
  clients: { id: string; name: string; cpf?: string | null; phone?: string | null }[];
  selectedClient?: { id: string; name: string; cpf?: string | null; phone?: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = useMemo(
    () =>
      clients.find((c) => c.id === value) || (selectedClient?.id === value ? selectedClient : null),
    [clients, value, selectedClient],
  );

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const filteredClients = useMemo(() => {
    const normalize = (t: string) =>
      t
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const s = normalize(query.trim());
    if (!s) return clients.slice(0, 60);

    const sDigits = query.replace(/\D/g, "");

    return clients
      .filter((c) => {
        const nameNorm = normalize(c.name || "");
        if (nameNorm.includes(s)) return true;
        if (c.cpf && sDigits.length > 2 && c.cpf.replace(/\D/g, "").includes(sDigits)) return true;
        if (c.phone && sDigits.length > 2 && c.phone.replace(/\D/g, "").includes(sDigits))
          return true;
        return false;
      })
      .slice(0, 60);
  }, [clients, query]);

  return (
    <div ref={dropdownRef} className="relative w-full">
      {current ? (
        <div className="w-full h-12 px-3.5 rounded-2xl border-2 border-primary/60 bg-primary-soft/80 flex items-center justify-between transition-all">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground font-semibold text-xs flex items-center justify-center shrink-0">
              {current.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate leading-tight">
                {current.name}
              </p>
              {(current.cpf || current.phone) && (
                <p className="text-xs text-muted-foreground truncate">
                  {[current.cpf && `CPF: ${current.cpf}`, current.phone && `Tel: ${current.phone}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              type="button"
              onClick={() => {
                onChange("", null);
                setQuery("");
                setTimeout(() => {
                  setOpen(true);
                  inputRef.current?.focus();
                }, 50);
              }}
              className="text-xs font-semibold text-primary hover:underline px-2 py-1 rounded-md hover:bg-primary/10 cursor-pointer"
            >
              Trocar
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("", null);
                setQuery("");
              }}
              className="h-7 w-7 rounded-full hover:bg-destructive/15 hover:text-destructive grid place-items-center text-muted-foreground transition cursor-pointer"
              title="Remover paciente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex items-center cursor-pointer">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            name="search_patient_custom_input_no_autofill"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            placeholder="Clique para ver a lista de pacientes ou digite para buscar..."
            className="w-full h-12 pl-10 pr-10 rounded-2xl border-2 border-border/80 bg-background text-sm font-medium focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-muted-foreground cursor-pointer !cursor-pointer"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground grid place-items-center cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              ▼
            </span>
          )}
        </div>
      )}

      {/* Autocomplete Results Dropdown */}
      {open && !current && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-(--z-popover) max-h-[300px] space-y-1 overflow-y-auto rounded-2xl border border-hairline bg-glass-strong p-1.5 shadow-(--glass-shadow-lg) glass-blur-strong animate-in fade-in-0 zoom-in-95 duration-100">
          <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between border-b border-border/40 mb-1">
            <span>Pacientes cadastrados</span>
            <span className="text-primary font-semibold">{filteredClients.length}</span>
          </div>

          {filteredClients.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground font-medium">
              Nenhum paciente encontrado com "{query}".
            </div>
          ) : (
            filteredClients.map((c) => {
              const initials = c.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange(c.id, c);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full text-left p-2.5 rounded-xl flex items-center gap-3 hover:bg-primary-soft/70 border border-transparent transition-colors cursor-pointer"
                >
                  <div className="h-9 w-9 rounded-full bg-primary/15 text-primary font-semibold text-xs flex items-center justify-center shrink-0">
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                    {(c.cpf || c.phone) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {[c.cpf && `CPF: ${c.cpf}`, c.phone && `Tel: ${c.phone}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

function labelOfType(id: string) {
  return TYPES.find((t) => t.id === id)?.label ?? "Agendamento";
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeStr(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

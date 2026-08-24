import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  UserPlus,
  MapPin,
  ExternalLink,
  Paperclip,
  X,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  Bell,
  ListChecks,
  Tag as TagIcon,
  FileText,
  Camera,
  ScanLine,
  FolderOpen,
  Trash2,
  Download,
  Upload,
  User,
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
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { patientsService, companyService, agendaService, financeService } from "@/services/api";
import { PatientModal } from "@/components/pacientes/PatientModal";
import { useAuth } from "@/hooks/use-auth";
import { useActiveCompany } from "@/hooks/use-active-company";
import { isUuid, toValidUuid, ensureValidUuid } from "@/lib/uuid";
import { mergeWithLocalPatients } from "@/lib/local-patients";
import { saveStoredLocalEvent } from "@/lib/local-events";
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

const RECURRENCE = [
  { id: "none", label: "Não repetir" },
  { id: "daily", label: "Todos os dias" },
  { id: "weekly", label: "Semanal" },
  { id: "biweekly", label: "Quinzenal" },
  { id: "monthly", label: "Mensal" },
  { id: "yearly", label: "Anual" },
  { id: "custom", label: "Personalizada" },
] as const;

const REMINDER_WHEN = [
  { id: "5m", label: "5 minutos antes" },
  { id: "10m", label: "10 minutos antes" },
  { id: "15m", label: "15 minutos antes" },
  { id: "30m", label: "30 minutos antes" },
  { id: "1h", label: "1 hora antes" },
  { id: "2h", label: "2 horas antes" },
  { id: "1d", label: "1 dia antes" },
  { id: "2d", label: "2 dias antes" },
  { id: "1w", label: "1 semana antes" },
];

const REMINDER_KIND = [
  { id: "system", label: "Sistema" },
  { id: "email", label: "E-mail" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "push", label: "Push" },
];

const TAG_PRESETS = [
  { label: "Urgente", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30" },
  {
    label: "Cliente VIP",
    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  { label: "Audiência", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  {
    label: "Tribunal",
    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30",
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
}: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-5 md:p-6 shadow-sm transition-all hover:shadow-md">
      <header className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          {title}
        </h3>
        {actions}
      </header>
      {children}
    </section>
  );
});

const FieldLabel = memo(function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
      {required && <span className="text-rose-400 ml-0.5">*</span>}
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
    value === "" || value === undefined || value === null ? "" : String(value)
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate?: Date;
  onSaved?: (created?: Activity) => void;
}) {
  const { user } = useAuth();
  const { companyId } = useActiveCompany();
  const qc = useQueryClient();

  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("atendimento");
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [selectedClientObj, setSelectedClientObj] = useState<{ id: string; name: string; cpf?: string | null; phone?: string | null } | null>(null);
  const [assignedTo, setAssignedTo] = useState(user?.id ?? "");
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
  const [dropActive, setDropActive] = useState(false);

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

  useEffect(() => {
    if (!open) return;
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
  }, [open, defaultDate, user?.id, availableCities]);
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

  // Query patient consultation history when clientId changes (Optimized)
  const { data: patientHistory = [], isFetching: isHistoryLoading } = useQuery({
    queryKey: ["patient-consultation-history", clientId],
    enabled: open && !!clientId && !!companyId,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!clientId) return [];
      const { data } = await supabase
        .from("events")
        .select("id, title, starts_at, description")
        .eq("company_id", companyId!)
        .order("starts_at", { ascending: false })
        .limit(20);

      const targetTag = `"clientId":"${clientId}"`;
      const filtered = (data ?? []).filter((e) => e.description && e.description.includes(targetTag));

      return filtered.map((e) => ({
        id: e.id,
        date: new Date(e.starts_at),
        title: e.title,
      }));
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

  const { data: members = [] } = useQuery({
    queryKey: qk.membersMini(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const phpMembers = await companyService.getMembers();
        if (phpMembers && Array.isArray(phpMembers)) {
          return phpMembers.map((m: any) => ({
            id: m.id || m.user_id,
            full_name: m.full_name || m.name,
            avatar_url: m.avatar_url || null,
          }));
        }
      } catch {}

      const { data: m } = await supabase
        .from("company_members")
        .select("user_id")
        .eq("company_id", companyId!);
      const ids = (m ?? []).map((x) => x.user_id);
      if (ids.length === 0) return [];
      const { data: p } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      return (p ?? []) as { id: string; full_name: string | null; avatar_url: string | null }[];
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
    () => clients.find((c: IdOpt) => c.id === clientId) || (selectedClientObj?.id === clientId ? selectedClientObj : null),
    [clients, clientId, selectedClientObj],
  );
  const selectedCase = useMemo(() => cases.find((c: IdOpt) => c.id === caseId), [cases, caseId]);
  const responsible = useMemo(
    () => members.find((m: MemberOpt) => m.id === assignedTo),
    [members, assignedTo],
  );

  const statusMeta = useMemo(
    () => STATUS.find((s) => s.id === status) ?? STATUS[0],
    [status],
  );

  // Deriva o título automaticamente a partir do cliente + tipo
  useEffect(() => {
    if (!clientId) {
      setTitle(labelOfType(type));
      return;
    }
    const clientName = selectedClient?.name ?? labelOfType(type);
    setTitle(`${clientName} - ${labelOfType(type)}`);
  }, [clientId, type, selectedClient?.name]);

  // ------ File drop ------
  const inputFilesRef = useRef<HTMLInputElement | null>(null);
  const addFiles = (list: FileList | File[]) => {
    const items = Array.from(list).map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
    }));
    setFiles((prev) => [...prev, ...items]);
  };

  // ------ Participants combobox ------
  const [partOpen, setPartOpen] = useState(false);
  const addParticipant = (m: MemberOpt) => {
    if (participants.some((p) => p.id === m.id)) return;
    setParticipants((prev) => [
      ...prev,
      {
        id: m.id,
        name: m.full_name ?? "Sem nome",
        role: m.role ?? "Colaborador",
      },
    ]);
    setPartOpen(false);
  };

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

      const totalAmt = parseMoney(procedurePrice);
      const sinalAmt = parseMoney(downPayment);
      const restanteAmt = Math.max(0, totalAmt - sinalAmt);
      const todayStr = new Date().toISOString().slice(0, 10);
      const patientNameStr = selectedClient?.name ? ` - Paciente: ${selectedClient.name}` : "";

      const meta = {
        v: 1,
        type,
        status,
        color,
        recurrence,
        clientId: clientId || null,
        participants: type === "lembrete"
          ? selectedProfs.map(id => {
              const m = members.find(x => x.id === id);
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
        selectedProcedure: type === "evento" || type === "atendimento" ? (selectedProcedure || undefined) : undefined,
        allowOtherProcedures: type === "evento" ? allowOtherProcedures : undefined,
        isNewPatient: type === "atendimento" ? isNewPatient : undefined,
        procedurePrice: type === "atendimento" && (totalAmt > 0 || sinalAmt > 0) ? (totalAmt > 0 ? totalAmt : sinalAmt) : undefined,
        downPayment: type === "atendimento" && sinalAmt > 0 ? sinalAmt : 0,
        remainingValue: type === "atendimento" ? Math.max(0, (totalAmt > 0 ? totalAmt : sinalAmt) - sinalAmt) : 0,
        downPaymentMethod: type === "atendimento" ? downPaymentMethod : undefined,
        city: type === "atendimento" ? city : undefined,
        consultationType: type === "atendimento" ? consultationType : undefined,
      };

      const description = [
        notes.trim() || null,
        `\n\n<!--AGENDAMENTO_META:${JSON.stringify(meta)}-->`,
      ]
        .filter(Boolean)
        .join("");

      const finalAssignedTo = type === "bloqueio" || type === "evento" || type === "lembrete"
        ? (selectedProfs[0] || user.id)
        : (assignedTo || null);

      const validCreatedBy = isUuid(user?.id) ? user.id : ensureValidUuid(user?.id);
      const validCompanyId = isUuid(companyId) ? companyId : ensureValidUuid(companyId);
      const validAssignedTo = finalAssignedTo
        ? (isUuid(finalAssignedTo) ? finalAssignedTo : (finalAssignedTo === user?.id ? validCreatedBy : toValidUuid(finalAssignedTo)))
        : null;
      const validCaseId = caseId && isUuid(caseId) ? caseId : toValidUuid(caseId);
      const validPatientId = clientId && isUuid(clientId) ? clientId : toValidUuid(clientId);

      const insertedId = crypto.randomUUID();

      // 1. Salva imediatamente na camada local ultra-rápida (0ms de latência)
      saveStoredLocalEvent(
        {
          id: insertedId,
          title: finalTitle,
          description,
          event_type: "meeting",
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          location,
          assigned_to: finalAssignedTo || null,
          case_id: caseId || null,
        },
        validCompanyId,
      );

      // 2. Despacha sincronização remota assíncrona em background (sem bloquear o usuário)
      void (async () => {
        try {
          const { data: authData } = await supabase.auth.getUser();
          const supabaseAuthId = authData?.user?.id;
          const remoteCreatedBy = supabaseAuthId && isUuid(supabaseAuthId) ? supabaseAuthId : validCreatedBy;

          const { error: eventError } = await supabase.from("events").insert({
            id: insertedId,
            company_id: validCompanyId,
            created_by: remoteCreatedBy,
            title: finalTitle,
            description,
            event_type: "meeting",
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            location,
            case_id: validCaseId,
            assigned_to: validAssignedTo,
            patient_id: validPatientId,
          });

          if (eventError) {
            await supabase.from("events").insert({
              id: insertedId,
              company_id: validCompanyId,
              created_by: remoteCreatedBy,
              title: finalTitle,
              description,
              event_type: "meeting",
              starts_at: startsAt.toISOString(),
              ends_at: endsAt.toISOString(),
              location,
            });
          }
        } catch (e) {
          console.warn("Supabase background event sync:", e);
        }

        // Sincronização PHP em background
        agendaService
          .createAppointment({
            id: insertedId,
            patient_id: clientId || undefined,
            date: day,
            start_time: start,
            end_time: end,
            type: type,
            status: status,
            notes: notes || undefined,
          })
          .catch(() => {});

        // Transações de sinal e restante
        if (totalAmt > 0 || sinalAmt > 0) {
          const proc = selectedProcedure && selectedProcedure !== "__none"
            ? (procedures.find(p => p.id === selectedProcedure) || allProceduresList.find(p => p.id === selectedProcedure))
            : null;
          const procName = proc ? `Procedimento: ${proc.name}` : "Consulta / Atendimento";

          let dbDoctorId: string | null = null;
          if (validAssignedTo) {
            try {
              const { data: docData } = await supabase
                .from("doctors")
                .select("id")
                .eq("auth_id", validAssignedTo)
                .maybeSingle();
              if (docData && isUuid(docData.id)) dbDoctorId = docData.id;
            } catch {}
          }

          if (sinalAmt > 0) {
            try {
              await supabase.from("transactions").insert({
                amount: sinalAmt,
                type: "receita",
                status: "concluido",
                date: todayStr,
                description: `Sinal Pago (${downPaymentMethod.toUpperCase()}): ${procName}${patientNameStr}`,
                patient_id: validPatientId,
                doctor_id: dbDoctorId,
                payment_method: downPaymentMethod,
                category: "Procedimentos",
              });
            } catch {}
          }

          if (restanteAmt > 0) {
            try {
              await supabase.from("transactions").insert({
                amount: restanteAmt,
                type: "receita",
                status: "pendente",
                date: day,
                due_date: day,
                description: `Restante A Cobrar: ${procName}${patientNameStr}`,
                patient_id: validPatientId,
                doctor_id: dbDoctorId,
                category: "Procedimentos",
              });
            } catch {}
          }
        }
      })();

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
      qc.setQueriesData(
        { queryKey: ["agenda-events"] },
        (old: any) => {
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
        }
      );

      return { createdActivity, asDraft };
    },
    onSuccess: (data) => {
      const asDraft = data?.asDraft;
      toast.success(asDraft ? "Rascunho salvo" : "Agendamento criado");
      logClient({
        action: "create",
        entity_type: "agendamento",
        entity_label: title.trim() || labelOfType(type),
      });
      qc.invalidateQueries({ queryKey: qk.agendaLists.events(companyId) });
      qc.invalidateQueries({ queryKey: ["agenda-events"] });
      qc.invalidateQueries({ queryKey: qk.dashboard.all() });
      qc.invalidateQueries({ queryKey: ["dashboard", "transactions"] });
      qc.invalidateQueries({ queryKey: ["finance-dashboard", "transactions"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      onSaved?.(data?.createdActivity);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const mapsUrl = useMemo(() => {
    const q = [locName, locAddress, locCity, locState].filter(Boolean).join(", ");
    if (!q) return null;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }, [locName, locAddress, locCity, locState]);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col rounded-2xl border-border/70 [&>button.absolute]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-border/70 bg-gradient-to-b from-background to-background/60">
          <div>
            <DialogTitle className="text-2xl font-bold tracking-tight">
              {type === "bloqueio"
                ? "Novo bloqueio de horário"
                : type === "lembrete"
                  ? "Novo lembrete"
                  : type === "evento"
                    ? "Novo evento"
                    : "Novo Agendamento"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Crie um novo agendamento com todos os detalhes.
            </DialogDescription>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Fechar"
            className="group grid place-items-center h-10 w-10 rounded-full hover:bg-primary/10 transition-all cursor-pointer"
          >
            <X className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110" />
          </button>
        </div>

        {/* Scroll body */}
        <div className="overflow-y-auto flex-1 px-6 md:px-8 py-6 space-y-5 bg-gradient-to-b from-background/40 to-background/80">
          {/* Tipo */}
          <div className="space-y-1.5">
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
                              allClinic && "opacity-50 cursor-not-allowed bg-gray-50 dark:bg-muted/10"
                            )}
                          >
                            <div className="flex flex-wrap gap-1.5 items-center overflow-hidden">
                              {selectedProfs.length === 0 ? (
                                <span className="text-muted-foreground">Selecionar profissionais</span>
                              ) : (
                                selectedProfs.map((id) => {
                                  const member = members.find((m) => m.id === id);
                                  if (!member) return null;
                                  return (
                                    <span
                                      key={id}
                                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-[#F4EBFF] text-[#7F56D9] border border-[#D6BBFB]"
                                    >
                                      {member.full_name}
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedProfs((prev) => prev.filter((x) => x !== id));
                                        }}
                                        className="hover:text-red-500 transition-colors ml-1 cursor-pointer"
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
                              <span className="text-muted-foreground text-[10px]">▼</span>
                            </div>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-h-[200px] p-0" align="start">
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
                                          setSelectedProfs((prev) => prev.filter((x) => x !== m.id));
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
                          allClinic ? "bg-[#7C3AED]" : "bg-[#EAECF0]"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            allClinic ? "translate-x-5" : "translate-x-0"
                          )}
                        />
                      </button>
                      <span className="text-sm font-medium text-[#344054]">Clínica toda</span>
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
                            allDay ? "bg-[#7C3AED]" : "bg-[#EAECF0]"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                              allDay ? "translate-x-5" : "translate-x-0"
                            )}
                          />
                        </button>
                        <span className="text-sm font-medium text-[#344054]">Dia inteiro</span>
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
                                <span className="text-muted-foreground">Selecionar participantes</span>
                              ) : (
                                selectedProfs.map((id) => {
                                  const member = members.find((m) => m.id === id);
                                  if (!member) return null;
                                  return (
                                    <span
                                      key={id}
                                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-[#F4EBFF] text-[#7F56D9] border border-[#D6BBFB]"
                                    >
                                      {member.full_name}
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedProfs((prev) => prev.filter((x) => x !== id));
                                        }}
                                        className="hover:text-red-500 transition-colors ml-1 cursor-pointer"
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
                              <span className="text-muted-foreground text-[10px]">▼</span>
                            </div>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-h-[200px] p-0" align="start">
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
                                          setSelectedProfs((prev) => prev.filter((x) => x !== m.id));
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
                            allDay ? "bg-[#7C3AED]" : "bg-[#EAECF0]"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                              allDay ? "translate-x-5" : "translate-x-0"
                            )}
                          />
                        </button>
                        <span className="text-sm font-medium text-[#344054]">Dia inteiro</span>
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
                              <span className="text-muted-foreground">Selecionar profissionais</span>
                            ) : (
                              selectedProfs.map((id) => {
                                const member = members.find((m) => m.id === id);
                                if (!member) return null;
                                return (
                                  <span
                                    key={id}
                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-[#F4EBFF] text-[#7F56D9] border border-[#D6BBFB]"
                                  >
                                    {member.full_name}
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedProfs((prev) => prev.filter((x) => x !== id));
                                      }}
                                      className="hover:text-red-500 transition-colors ml-1 cursor-pointer"
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
                            <span className="text-muted-foreground text-[10px]">▼</span>
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-h-[200px] p-0" align="start">
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
                                        setSelectedProfs((prev) => prev.filter((x) => x !== m.id));
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
                    <Select value={selectedProcedure || "__none"} onValueChange={(v) => setSelectedProcedure(v === "__none" ? "" : v)}>
                      <SelectTrigger className="h-11 rounded-xl font-medium border-primary/40 bg-primary/5">
                        <SelectValue placeholder="Pesquise/Selecione o procedimento" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[320px]">
                        <SelectItem value="__none">Nenhum (Somente consulta simples)</SelectItem>
                        {Object.entries(groupedProceduresList).map(([cat, items]) => (
                          <SelectGroup key={cat}>
                            <SelectLabel className="font-bold text-xs text-primary uppercase tracking-wider px-2 py-1.5 bg-muted/40">
                              {cat}
                            </SelectLabel>
                            {items.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="cursor-pointer font-normal pl-4">
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
                        allowOtherProcedures ? "bg-primary" : "bg-[#EAECF0]"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          allowOtherProcedures ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                    <span className="text-sm font-medium text-[#344054]">
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#EDE9FE] text-xs font-semibold transition-colors cursor-pointer"
                          title="Cadastrar novo paciente"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>+ Novo paciente</span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setIsNewPatient(!isNewPatient)}
                            className={cn(
                              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                              isNewPatient ? "bg-[#7C3AED]" : "bg-[#EAECF0]"
                            )}
                          >
                            <span
                              className={cn(
                                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                isNewPatient ? "translate-x-4" : "translate-x-0"
                              )}
                            />
                          </button>
                          <span className="text-xs font-medium text-[#344054]">1ª Vez</span>
                        </div>
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
                          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-primary" /> Ficha do Paciente
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                                isNewPatient
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-800"
                              )}
                            >
                              {isNewPatient ? "Novo Paciente" : "Paciente Recorrente"}
                            </span>
                            <span className="text-[10px] font-semibold bg-white border border-border px-2 py-0.5 rounded-full text-muted-foreground">
                              {patientHistory.length} consulta(s) anterior(es)
                            </span>
                          </div>
                        </div>
                        {patientHistory.length > 0 && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            Último atendimento:{" "}
                            <span className="font-semibold text-foreground">
                              {patientHistory[0].date.toLocaleDateString("pt-BR")} — {patientHistory[0].title}
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
                          <SelectValue placeholder={availableCities.length === 0 ? "Nenhuma cidade cadastrada" : "Selecione a cidade"} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCities.length === 0 ? (
                            <div className="p-3 text-xs text-muted-foreground text-center">
                              Nenhuma cidade cadastrada.<br />
                              <span className="text-primary font-medium">Cadastre em Configurações.</span>
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
                      <Select value={consultationType} onValueChange={setConsultationType}>
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
                      <FieldLabel>Responsável</FieldLabel>
                      <Select
                        value={assignedTo || "__none"}
                        onValueChange={(v) => setAssignedTo(v === "__none" ? "" : v)}
                      >
                        <SelectTrigger className="h-11 rounded-xl">
                          <SelectValue placeholder="Selecionar responsável">
                            {responsible ? (
                              <span className="flex items-center gap-2">
                                <Avatar name={responsible.full_name} url={responsible.avatar_url} />
                                <span className="truncate">{responsible.full_name}</span>
                              </span>
                            ) : (
                              "Selecionar responsável"
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((m: MemberOpt) => (
                            <SelectItem key={m.id} value={m.id}>
                              <span className="flex items-center gap-2">
                                <Avatar name={m.full_name} url={m.avatar_url} />
                                <span className="flex flex-col">
                                  <span className="text-sm">{m.full_name ?? "Sem nome"}</span>
                                  {m.role && (
                                    <span className="text-[10px] text-muted-foreground">{m.role}</span>
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

                  {/* Procedimento e Valores / Sinal */}
                  <div className="space-y-3 p-4 rounded-xl border border-border/70 bg-muted/20">
                    <div className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Procedimento & Financeiro (Sinal / Restante)
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <FieldLabel>Procedimento / Serviço</FieldLabel>
                        <Select
                          value={selectedProcedure || "__none"}
                          onValueChange={(v) => {
                            const val = v === "__none" ? "" : v;
                            setSelectedProcedure(val);
                            if (val) {
                              const found = procedures.find((p) => p.id === val) || (allProceduresList.find((p) => p.id === val) as any);
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
                                <SelectLabel className="font-bold text-xs text-primary uppercase tracking-wider px-2 py-1.5 bg-muted/40">
                                  {cat}
                                </SelectLabel>
                                {items.map((p) => (
                                  <SelectItem key={p.id} value={p.id} className="cursor-pointer font-normal pl-4">
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
                        <FinancialNumberInput
                          placeholder="0,00"
                          value={procedurePrice}
                          onChange={setProcedurePrice}
                          className="h-11 rounded-xl bg-background font-semibold"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                      <div className="space-y-1.5">
                        <FieldLabel>Sinal Pago (R$)</FieldLabel>
                        <FinancialNumberInput
                          placeholder="0,00"
                          value={downPayment}
                          onChange={setDownPayment}
                          className="h-11 rounded-xl bg-background border-emerald-500/50 text-emerald-700 font-semibold"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel>Forma do Sinal</FieldLabel>
                        <Select value={downPaymentMethod} onValueChange={setDownPaymentMethod}>
                          <SelectTrigger className="h-11 rounded-xl bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pix">Pix</SelectItem>
                            <SelectItem value="cartao_credito">Cartão de Crédito</SelectItem>
                            <SelectItem value="cartao_debito">Cartão de Débito</SelectItem>
                            <SelectItem value="dinheiro">Dinheiro</SelectItem>
                            <SelectItem value="boleto">Boleto Bancário</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <FieldLabel>Restante A Cobrar (R$)</FieldLabel>
                        <Input
                          type="text"
                          readOnly
                          value={
                            (Number(procedurePrice) || 0) > 0 || (Number(downPayment) || 0) > 0
                              ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                                  Math.max(0, (Number(procedurePrice) || 0) - (Number(downPayment) || 0))
                                )
                              : "R$ 0,00"
                          }
                          className="h-11 rounded-xl bg-amber-500/10 border-amber-500/50 text-amber-900 font-bold cursor-not-allowed"
                        />
                      </div>
                    </div>
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
                  <div className="space-y-1.5">
                    <FieldLabel>Recorrência</FieldLabel>
                    <Select value={recurrence} onValueChange={setRecurrence}>
                      <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RECURRENCE.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {recurrence === "custom" && (
                      <div className="mt-3 rounded-xl border border-border/70 bg-muted/40 p-4 text-xs text-muted-foreground">
                        Recorrência personalizada — configure abaixo (intervalo, dias da semana e
                        término). Em breve.
                      </div>
                    )}
                  </div>
                </div>
              </Section>

              <Section
                title="Local"
                icon={MapPin}
                actions={
                  mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-primary hover:text-primary inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir no Google Maps
                    </a>
                  )
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <FieldLabel>Local</FieldLabel>
                    <DebouncedInput
                      value={locName}
                      onChange={setLocName}
                      placeholder="Nome do local"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel>Sala</FieldLabel>
                    <DebouncedInput
                      value={locRoom}
                      onChange={setLocRoom}
                      placeholder="Ex.: Sala 302"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel>Cidade</FieldLabel>
                    <DebouncedInput value={locCity} onChange={setLocCity} className="h-11 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel>Estado</FieldLabel>
                    <DebouncedInput
                      value={locState}
                      onChange={setLocState}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <FieldLabel>Endereço completo</FieldLabel>
                    <DebouncedInput
                      value={locAddress}
                      onChange={setLocAddress}
                      placeholder="Rua, número, bairro"
                      className="h-11 rounded-xl"
                    />
                  </div>
                </div>
              </Section>

              <Section
                title="Participantes"
                icon={UserPlus}
                actions={
                  <Popover open={partOpen} onOpenChange={setPartOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        size="sm"
                        className={cn("rounded-xl h-9", GREEN.grad, "text-white hover:opacity-90")}
                      >
                        <Plus className="h-4 w-4 mr-1" /> Adicionar participante
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[320px]" align="end">
                      <Command>
                        <CommandInput placeholder="Buscar colaborador..." />
                        <CommandList>
                          <CommandEmpty>Nenhum colaborador.</CommandEmpty>
                          <CommandGroup>
                            {members.map((m: MemberOpt) => (
                              <CommandItem
                                key={m.id}
                                value={m.full_name ?? m.id}
                                onSelect={() => addParticipant(m)}
                              >
                                <Avatar name={m.full_name} url={m.avatar_url} />
                                <span className="ml-2">{m.full_name ?? "Sem nome"}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                }
              >
                {participants.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">
                    Nenhum participante adicionado.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border/70">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-medium">Nome</th>
                          <th className="text-left px-4 py-2.5 font-medium">Cargo</th>
                          <th className="text-left px-4 py-2.5 font-medium">Telefone</th>
                          <th className="text-left px-4 py-2.5 font-medium">E-mail</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {participants.map((p) => (
                          <tr key={p.id} className="border-t border-border/70 hover:bg-muted/30">
                            <td className="px-4 py-2.5 flex items-center gap-2">
                              <Avatar name={p.name} /> {p.name}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">{p.role ?? "—"}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{p.phone ?? "—"}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{p.email ?? "—"}</td>
                            <td className="px-4 py-2.5">
                              <button
                                onClick={() =>
                                  setParticipants((prev) => prev.filter((x) => x.id !== p.id))
                                }
                                className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section title="Documentos" icon={Paperclip}>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropActive(true);
                  }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropActive(false);
                    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                  }}
                  onClick={() => inputFilesRef.current?.click()}
                  className={cn(
                    "rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all",
                    dropActive
                      ? "border-primary bg-primary/10"
                      : "border-border/70 hover:border-primary/50 hover:bg-primary/5",
                  )}
                >
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Arraste arquivos aqui ou clique para enviar</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, imagens ou ZIP</p>
                  <input
                    ref={inputFilesRef}
                    type="file"
                    hidden
                    multiple
                    accept=".pdf,.doc,.docx,.zip,image/*"
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                </div>
                {files.length > 0 && (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5"
                      >
                        <FileText className="h-5 w-5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{f.name}</p>
                          <p className="text-[11px] text-muted-foreground">{formatSize(f.size)}</p>
                        </div>
                        <button className="p-1.5 rounded-lg hover:bg-muted transition" title="Baixar">
                          <Download className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setFiles((prev) => prev.filter((x) => x.id !== f.id));
                          }}
                          className="p-1.5 rounded-lg hover:bg-rose-500/10 hover:text-rose-500 transition text-muted-foreground"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section
                title="Lembretes"
                icon={Bell}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl h-9"
                    onClick={() =>
                      setReminders((prev) => [
                        ...prev,
                        { id: crypto.randomUUID(), when: "15m", kind: "system" },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" /> Adicionar lembrete
                  </Button>
                }
              >
                {reminders.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum lembrete configurado.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {reminders.map((r) => (
                      <div key={r.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                        <Select
                          value={r.when}
                          onValueChange={(v) =>
                            setReminders((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, when: v } : x)),
                            )
                          }
                        >
                          <SelectTrigger className="h-10 rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {REMINDER_WHEN.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={r.kind}
                          onValueChange={(v) =>
                            setReminders((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, kind: v } : x)),
                            )
                          }
                        >
                          <SelectTrigger className="h-10 rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {REMINDER_KIND.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          onClick={() => setReminders((prev) => prev.filter((x) => x.id !== r.id))}
                          className="h-10 w-10 grid place-items-center rounded-xl hover:bg-rose-500/10 hover:text-rose-500 text-muted-foreground transition"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section
                title="Checklist"
                icon={ListChecks}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl h-9"
                    onClick={() =>
                      setChecklist((prev) => [
                        ...prev,
                        { id: crypto.randomUUID(), text: "", done: false },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" /> Adicionar item
                  </Button>
                }
              >
                {checklist.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma tarefa relacionada.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {checklist.map((it) => (
                      <div
                        key={it.id}
                        className="grid grid-cols-[auto_1fr_140px_1fr_auto] gap-2 items-center"
                      >
                        <Checkbox
                          checked={it.done}
                          onCheckedChange={(v) =>
                            setChecklist((prev) =>
                              prev.map((x) => (x.id === it.id ? { ...x, done: !!v } : x)),
                            )
                          }
                        />
                        <Input
                          value={it.text}
                          onChange={(e) =>
                            setChecklist((prev) =>
                              prev.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)),
                            )
                          }
                          placeholder="Descrição da tarefa"
                          className="h-10 rounded-xl"
                        />
                        <Input
                          type="date"
                          value={it.due ?? ""}
                          onChange={(e) =>
                            setChecklist((prev) =>
                              prev.map((x) => (x.id === it.id ? { ...x, due: e.target.value } : x)),
                            )
                          }
                          className="h-10 rounded-xl"
                        />
                        <Select
                          value={it.owner ?? "__none"}
                          onValueChange={(v) =>
                            setChecklist((prev) =>
                              prev.map((x) =>
                                x.id === it.id ? { ...x, owner: v === "__none" ? undefined : v } : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-10 rounded-xl">
                            <SelectValue placeholder="Responsável" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Sem responsável</SelectItem>
                            {members.map((m: MemberOpt) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          onClick={() => setChecklist((prev) => prev.filter((x) => x.id !== it.id))}
                          className="h-10 w-10 grid place-items-center rounded-xl hover:bg-rose-500/10 hover:text-rose-500 text-muted-foreground transition"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Anexos rápidos" icon={Paperclip}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <QuickAttach
                    icon={Camera}
                    label="Adicionar foto"
                    onClick={() => inputFilesRef.current?.click()}
                  />
                  <QuickAttach
                    icon={ScanLine}
                    label="Escanear documento"
                    onClick={() => toast.info("Em breve")}
                  />
                  <QuickAttach
                    icon={FileText}
                    label="Importar PDF"
                    onClick={() => inputFilesRef.current?.click()}
                  />
                  <QuickAttach
                    icon={FolderOpen}
                    label="Importar do Processo"
                    onClick={() => toast.info("Em breve")}
                  />
                </div>
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        {type === "bloqueio" || type === "lembrete" || type === "evento" ? (
          <div className="border-t border-border/70 px-6 md:px-8 py-4 flex items-center justify-center bg-background/95 backdrop-blur">
            <Button
              onClick={() => save.mutate(false)}
              disabled={save.isPending}
              className={cn(
                "rounded-xl h-[46px] px-8 text-white font-semibold border-0 bg-[#7C3AED] hover:bg-[#6D28D9] transition-all duration-200 hover:scale-[1.02]",
              )}
            >
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        ) : (
          <div className="border-t border-border/70 px-6 md:px-8 py-4 flex items-center justify-end gap-2 bg-background/95 backdrop-blur">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="rounded-xl h-11 px-5"
            >
              Cancelar
            </Button>
            <Button
              variant="outline"
              onClick={() => save.mutate(true)}
              disabled={save.isPending}
              className="rounded-xl h-11 px-5"
            >
              Salvar rascunho
            </Button>
            <Button
              onClick={() => save.mutate(false)}
              disabled={save.isPending}
              className={cn(
                "rounded-[14px] h-[46px] px-6 text-white font-semibold border-0",
                GREEN.grad,
                "shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-xl hover:shadow-primary/40 hover:scale-[1.02]",
              )}
            >
              {save.isPending ? "Salvando..." : "Salvar Agendamento"}
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
              return exists ? old.map((p: any) => (p.id === newPatient.id ? item : p)) : [item, ...old];
            });
            qc.invalidateQueries({ queryKey: ["patients-picker"] });
            qc.invalidateQueries({ queryKey: ["patients-list"] });
            qc.invalidateQueries({ queryKey: ["patients-mini"] });
            qc.invalidateQueries({ queryKey: ["patients"] });
          }
        }}
      />
    </>
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
    <span className="h-6 w-6 rounded-full grid place-items-center text-[10px] font-semibold text-white bg-primary">
      {initials}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-medium truncate">{value}</p>
    </div>
  );
}

function QuickAttach({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="flex flex-col items-center justify-center gap-2 h-24 rounded-xl border border-border/70 bg-card hover:border-primary/40 hover:bg-primary/5 transition-all group"
    >
      <Icon className="h-5 w-5 text-primary group-hover:scale-110 transition-transform" />
      <span className="text-xs font-medium text-foreground/80">{label}</span>
    </button>
  );
}

const ClientPicker = memo(function ClientPicker({
  value,
  onChange,
  clients,
  selectedClient,
}: {
  value: string;
  onChange: (v: string, clientObj?: { id: string; name: string; cpf?: string | null; phone?: string | null } | null) => void;
  clients: { id: string; name: string; cpf?: string | null; phone?: string | null }[];
  selectedClient?: { id: string; name: string; cpf?: string | null; phone?: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = useMemo(
    () => clients.find((c) => c.id === value) || (selectedClient?.id === value ? selectedClient : null),
    [clients, value, selectedClient]
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
        if (c.phone && sDigits.length > 2 && c.phone.replace(/\D/g, "").includes(sDigits)) return true;
        return false;
      })
      .slice(0, 60);
  }, [clients, query]);

  return (
    <div ref={dropdownRef} className="relative w-full">
      {current ? (
        <div className="w-full h-12 px-3.5 rounded-2xl border-2 border-primary/60 bg-violet-50/80 flex items-center justify-between transition-all">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center shrink-0">
              {current.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground truncate leading-tight">
                {current.name}
              </p>
              {(current.cpf || current.phone) && (
                <p className="text-[11px] text-muted-foreground truncate">
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
              className="h-7 w-7 rounded-full hover:bg-rose-100 hover:text-rose-600 grid place-items-center text-muted-foreground transition cursor-pointer"
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
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[200] max-h-[300px] overflow-y-auto rounded-2xl border-2 border-primary/30 bg-background p-1.5 shadow-2xl space-y-1 animate-in fade-in-0 zoom-in-95 duration-100">
          <div className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between border-b border-border/40 mb-1">
            <span>Pacientes cadastrados</span>
            <span className="text-primary font-bold">{filteredClients.length}</span>
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
                  className="w-full text-left p-2.5 rounded-xl flex items-center gap-3 hover:bg-violet-50/70 border border-transparent transition-colors cursor-pointer"
                >
                  <div className="h-9 w-9 rounded-full bg-primary/15 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                    {(c.cpf || c.phone) && (
                      <p className="text-[11px] text-muted-foreground truncate">
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
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

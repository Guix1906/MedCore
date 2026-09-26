import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { refreshFinance } from "@/features/finance/finance-api";
import type { FinanceSnapshot } from "@/features/finance/finance-schema";
import { currency } from "@/features/acompanhamentos/followup-utils";
import {
  Trash2,
  X,
  Pencil,
  Copy,
  MessageCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Users,
  Bell,
  ListChecks,
  Tag,
  Paperclip,
  FileText,
  User,
  Ticket,
  DollarSign,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Calendar,
  Check,
  Play,
} from "lucide-react";
import {
  PatientDetailsModal,
  type PatientDetailsData,
} from "@/components/pacientes/PatientDetailsModal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KIND_COLOR, type Activity } from "@/components/agenda/agenda-types";
import { pad2 } from "@/lib/date-utils";
import { AddToGoogleCalendarButton } from "./AddToGoogleCalendarButton";
import { cn } from "@/utils/cn";

type Meta = {
  v?: number;
  type?: string;
  status?: string;
  color?: string;
  recurrence?: string;
  clientId?: string | null;
  participants?: { id: string; name: string; role?: string }[];
  reminders?: { id: string; label: string }[] | string[];
  checklist?: { id: string; text: string; done: boolean; due?: string; owner?: string }[];
  tags?: string[];
  files?: { id: string; name: string; size?: number }[];
  planCoverage?: "incluso" | "avulso" | "extra";
  linkedTreatmentId?: string;
  procedurePrice?: number;
  downPayment?: number;
  remainingValue?: number;
  downPaymentMethod?: string;
};

function parseMeta(description: string | null): { text: string; meta: Meta | null } {
  if (!description) return { text: "", meta: null };
  const m = description.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
  if (!m) return { text: description, meta: null };
  try {
    const meta = JSON.parse(m[1]) as Meta;
    const text = description.replace(m[0], "").trim();
    return { text, meta };
  } catch {
    return { text: description, meta: null };
  }
}

function initialsOf(name: string | null | undefined) {
  if (!name) return "GU";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "GU";
}

function Row({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-start gap-3 border-b border-border-soft">
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

function StatusIconBadge({ kind, color }: { kind: "clock" | "x" | "check"; color: string }) {
  return (
    <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
      {kind === "clock" && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 text-foreground/80"
        >
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </svg>
      )}
      {kind === "x" && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 text-foreground/80"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5l5 5m0-5l-5 5" />
        </svg>
      )}
      {kind === "check" && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 text-foreground/80"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12l2.5 2.5 4.5-4.5" />
        </svg>
      )}

      <span
        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white shadow-2xs shrink-0"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

const STATUS_OPTIONS: Array<{
  value: string;
  label: string;
  kind: "clock" | "x" | "check";
  color: string;
  defaultColor: string;
}> = [
  {
    value: "Agendado",
    label: "Agendado",
    kind: "clock",
    color: "#8B5CF6",
    defaultColor: "#8B5CF6",
  },
  {
    value: "Confirmado",
    label: "Confirmado",
    kind: "clock",
    color: "#3B82F6",
    defaultColor: "#3B82F6",
  },
  {
    value: "Remarcado",
    label: "Remarcado",
    kind: "clock",
    color: "#F59E0B",
    defaultColor: "#F59E0B",
  },
  { value: "Cancelado", label: "Cancelado", kind: "x", color: "#EF4444", defaultColor: "#EF4444" },
  {
    value: "Não compareceu",
    label: "Não compareceu",
    kind: "x",
    color: "#475569",
    defaultColor: "#475569",
  },
  {
    value: "Aguardando",
    label: "Aguardando",
    kind: "check",
    color: "#3B82F6",
    defaultColor: "#0284C7",
  },
  {
    value: "Em atendimento",
    label: "Em atendimento",
    kind: "check",
    color: "#F59E0B",
    defaultColor: "#F59E0B",
  },
  {
    value: "Concluído",
    label: "Concluído",
    kind: "check",
    color: "#10B981",
    defaultColor: "#10B981",
  },
];

function StatusSelectDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string, defaultColor: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = STATUS_OPTIONS.find((s) => s.value === value) || STATUS_OPTIONS[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full h-11 px-3 bg-card rounded-xl flex items-center justify-between transition-all shadow-2xs cursor-pointer select-none",
          open
            ? "border-2 border-primary ring-3 ring-primary/20"
            : "border border-border hover:border-input",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusIconBadge kind={selectedOption.kind} color={selectedOption.color} />
          <span className="text-sm font-medium text-foreground truncate">
            {selectedOption.label}
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-50 min-w-[200px] overflow-hidden rounded-xl border border-hairline bg-glass-strong py-1 shadow-(--glass-shadow-lg) glass-blur-strong animate-in fade-in-0 zoom-in-95 duration-100">
          <div className="max-h-[260px] overflow-y-auto custom-scrollbar">
            {STATUS_OPTIONS.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value, opt.defaultColor);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full px-3.5 py-2.5 flex items-center justify-between text-left transition-all cursor-pointer select-none",
                    isSelected
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "hover:bg-muted/60 text-foreground/80 font-medium",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <StatusIconBadge kind={opt.kind} color={isSelected ? "#FFFFFF" : opt.color} />
                    <span className="text-sm truncate">{opt.label}</span>
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-white shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const BRAND_COLORS = [
  { hex: "#7C3AED", label: "Roxo" },
  { hex: "#2563EB", label: "Azul" },
  { hex: "#16A34A", label: "Verde" },
  { hex: "#D97706", label: "Laranja" },
  { hex: "#E11D48", label: "Rosa/Vermelho" },
  { hex: "#0D9488", label: "Teal" },
  { hex: "#4F46E5", label: "Índigo" },
  { hex: "#64748B", label: "Cinza" },
];

function ColorPickerDropdown({
  color,
  onChange,
}: {
  color: string;
  onChange: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const safeHex = useMemo(() => {
    if (color && /^#[0-9A-Fa-f]{6}$/.test(color)) return color;
    return "#7C3AED";
  }, [color]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Escolher cor do evento"
          className="w-full h-11 px-3 bg-card border border-border rounded-xl flex items-center justify-between hover:border-input transition shadow-2xs cursor-pointer"
        >
          <span
            className="h-5 w-5 rounded-md border border-border/80 shadow-2xs shrink-0"
            style={{ backgroundColor: safeHex }}
          />
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-48 space-y-2.5 rounded-2xl p-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Selecione uma cor
        </div>
        <div className="grid grid-cols-4 gap-2">
          {BRAND_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => {
                onChange(c.hex);
                setOpen(false);
              }}
              aria-label={c.label}
              aria-pressed={safeHex.toLowerCase() === c.hex.toLowerCase()}
              className={cn(
                "h-7 w-7 rounded-full border flex items-center justify-center transition hover:scale-110 cursor-pointer",
                safeHex.toLowerCase() === c.hex.toLowerCase()
                  ? "ring-2 ring-primary ring-offset-1 ring-offset-card border-transparent"
                  : "border-border",
              )}
              style={{ backgroundColor: c.hex }}
              title={c.label}
            >
              {safeHex.toLowerCase() === c.hex.toLowerCase() && (
                <Check className="h-3.5 w-3.5 text-white drop-shadow-sm" />
              )}
            </button>
          ))}
        </div>
        <div className="pt-2 border-t border-border-soft flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">Hex</span>
          <input
            type="text"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#7C3AED"
            aria-label="Cor em hexadecimal"
            className="w-full h-7 px-2 text-xs font-mono bg-muted/60 border border-border rounded-md focus:outline-none focus:border-primary"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Modal Quadrado Centralizado no Meio da Tela: "Editar agendamento"
 * Idêntico à imagem fornecida pelo usuário
 */
export function EditAppointmentModal({
  activity,
  open,
  onClose,
  ownerName,
  onSaved,
}: {
  activity: Activity | null;
  open: boolean;
  onClose: () => void;
  ownerName: string | null;
  onSaved: () => void;
}) {
  const [patientName, setPatientName] = useState<string>("");
  const [professionalName, setProfessionalName] = useState<string>("Amanda Thais");
  const [status, setStatus] = useState<string>("Agendado");
  const [color, setColor] = useState<string>("#7C5CFC");
  const [notes, setNotes] = useState<string>("");

  const [procedures, setProcedures] = useState<Array<{ id: string; name: string }>>([]);
  const [dateSectionOpen, setDateSectionOpen] = useState<boolean>(true);

  const [dayDate, setDayDate] = useState<string>("2026-08-06");
  const [startTime, setStartTime] = useState<string>("09:15");
  const [endTime, setEndTime] = useState<string>("11:00");
  const [recurrence, setRecurrence] = useState<string>("Não se repete");

  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!activity) return;

    setNotes(
      activity.description
        ? activity.description.replace(/<!--AGENDAMENTO_META:.*?-->/s, "").trim()
        : "",
    );
    if (ownerName) setProfessionalName(ownerName);
    if (activity.title) setPatientName(activity.title);

    const d = activity.start instanceof Date ? activity.start : new Date(activity.start);
    if (!isNaN(d.getTime())) {
      const dateFormatted = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      setDayDate(dateFormatted);
      const startFormatted = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      setStartTime(startFormatted);
    }

    if (activity.end) {
      const e = activity.end instanceof Date ? activity.end : new Date(activity.end);
      if (!isNaN(e.getTime())) {
        const endFormatted = `${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
        setEndTime(endFormatted);
      }
    } else {
      setEndTime("11:00");
    }

    if (activity.status) setStatus(activity.status);
  }, [activity, ownerName]);

  if (!activity) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const id =
        activity.id && activity.id.includes(":") ? activity.id.split(":")[1] : activity.id || "";

      const [year, month, day] = dayDate.split("-").map(Number);
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);

      const newStart = new Date(
        year || 2026,
        (month || 8) - 1,
        day || 6,
        startH || 9,
        startM || 15,
      );
      const newEnd = new Date(year || 2026, (month || 8) - 1, day || 6, endH || 11, endM || 0);

      const match = activity.description?.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
      let existingMeta: Record<string, any> = {};
      if (match && match[1]) {
        try {
          existingMeta = JSON.parse(match[1]);
        } catch {}
      }

      const metaObj = {
        ...existingMeta,
        color,
        status,
        recurrence,
        patientName,
        professionalName,
      };
      const metaJson = `<!--AGENDAMENTO_META:${JSON.stringify(metaObj)}-->`;
      const fullDescription = `${notes}\n\n${metaJson}`.trim();

      if (activity.source === "event") {
        const { error } = await supabase
          .from("events")
          .update({
            title: patientName || activity.title,
            starts_at: newStart.toISOString(),
            ends_at: newEnd.toISOString(),
            description: fullDescription,
          })
          .eq("id", id);
        if (error) throw error;
      } else if (activity.source === "task") {
        const { error } = await supabase
          .from("tasks")
          .update({
            title: patientName || activity.title,
            due_date: newStart.toISOString(),
            description: fullDescription,
          })
          .eq("id", id);
        if (error) throw error;
      }

      activity.title = patientName || activity.title;
      activity.start = newStart;
      activity.end = newEnd;
      activity.description = fullDescription;
      activity.status = status;

      toast.success("Agendamento salvo com sucesso!");
      onSaved();
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao salvar agendamento", {
        description: err?.message || "Ocorreu um erro ao salvar alterações.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddProcedure = () => {
    const name = prompt("Nome do procedimento ou produto:");
    if (name) {
      setProcedures((prev) => [...prev, { id: String(Date.now()), name }]);
      toast.success("Procedimento adicionado");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[460px] p-0 rounded-2xl bg-card shadow-2xl overflow-hidden border border-border text-foreground">
        <DialogDescription className="sr-only">Formulário Editar agendamento</DialogDescription>

        {/* 1. Header: Editar agendamento */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-border-soft bg-card">
          <div className="flex items-center gap-2.5">
            <DialogTitle className="text-lg font-semibold text-foreground leading-none">
              Editar agendamento
            </DialogTitle>

            {/* 3 Icon Badges next to title */}
            <div className="flex items-center gap-1.5 ml-1">
              <span
                title="Cupom / Desconto"
                className="h-7 w-7 rounded-full bg-muted grid place-items-center text-muted-foreground hover:bg-surface-2 transition cursor-pointer"
              >
                <Ticket className="h-3.5 w-3.5" />
              </span>
              <span
                title="Financeiro"
                className="h-7 w-7 rounded-full bg-success/15 grid place-items-center text-success hover:bg-success/25 transition cursor-pointer"
              >
                <DollarSign className="h-3.5 w-3.5" />
              </span>
              <span
                title="Atenção"
                className="h-7 w-7 rounded-full bg-warning/15 grid place-items-center text-warning hover:bg-warning/25 transition cursor-pointer"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>

        {/* 2. Form Body Scrollable */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh] bg-card">
          {/* Seção 1: Dados básicos */}
          <div>
            <h3 className="text-[15px] font-semibold text-foreground mb-4">Dados básicos</h3>

            {/* Field: Paciente */}
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">Paciente</label>
                <button
                  type="button"
                  onClick={() => {
                    const np = prompt("Nome do novo paciente:");
                    if (np) {
                      setPatientName(np);
                      toast.success(`Paciente ${np} adicionado`);
                    }
                  }}
                  className="text-sm font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  + Adicionar
                </button>
              </div>

              <div className="relative">
                <div className="w-full h-11 px-3 bg-card border border-border rounded-xl flex items-center justify-between hover:border-input transition shadow-2xs">
                  <div className="flex items-center gap-2.5 min-w-0 w-full">
                    <span className="h-7 w-7 rounded-full bg-primary/15 text-primary font-semibold text-xs grid place-items-center shrink-0">
                      {initialsOf(patientName)}
                    </span>
                    <input
                      type="text"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      className="w-full bg-transparent text-sm font-medium text-foreground focus:outline-none"
                    />
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-1" />
                </div>
              </div>
            </div>

            {/* Grid 3 colunas: Profissional, Status, Cor */}
            <div className="grid grid-cols-12 gap-3 mb-4">
              {/* Profissional */}
              <div className="col-span-5 space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Profissional</label>
                <div className="relative">
                  <div className="w-full h-11 px-3 bg-card border border-border rounded-xl flex items-center justify-between hover:border-input transition shadow-2xs">
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="h-6 w-6 rounded-full bg-primary-soft text-primary font-semibold text-xs grid place-items-center shrink-0">
                        {initialsOf(professionalName)}
                      </span>
                      <input
                        type="text"
                        value={professionalName}
                        onChange={(e) => setProfessionalName(e.target.value)}
                        className="w-full bg-transparent text-sm font-medium text-foreground focus:outline-none truncate"
                      />
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="col-span-4 space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <StatusSelectDropdown
                  value={status}
                  onChange={(newStatus, newColor) => {
                    setStatus(newStatus);
                    setColor(newColor);
                  }}
                />
              </div>

              {/* Cor */}
              <div className="col-span-3 space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Cor</label>
                <ColorPickerDropdown color={color} onChange={setColor} />
              </div>
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Observações</label>
              <input
                type="text"
                placeholder="Digite"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full h-11 px-3 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition shadow-2xs"
              />
            </div>
          </div>

          {/* Seção 2: Procedimentos/Produtos */}
          <div className="pt-4 border-t border-border-soft">
            <h3 className="text-[15px] font-semibold text-foreground mb-3">
              Procedimentos/Produtos
            </h3>

            {procedures.length > 0 && (
              <div className="space-y-2 mb-3">
                {procedures.map((p, idx) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2.5 bg-muted/60 border border-border rounded-xl text-xs"
                  >
                    <span className="font-medium text-foreground/80">{p.name}</span>
                    <button
                      type="button"
                      onClick={() => setProcedures((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleAddProcedure}
              className="text-sm font-medium text-primary hover:underline flex items-center gap-1.5 cursor-pointer"
            >
              + Adicionar Procedimentos/Produtos
            </button>
          </div>

          {/* Seção 3: Data */}
          <div className="pt-4 border-t border-border-soft">
            <div
              className="flex items-center justify-between mb-4 cursor-pointer select-none"
              onClick={() => setDateSectionOpen(!dateSectionOpen)}
            >
              <h3 className="text-[15px] font-semibold text-foreground">Data</h3>
              <ChevronUp
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  !dateSectionOpen && "rotate-180",
                )}
              />
            </div>

            {dateSectionOpen && (
              <div className="space-y-4">
                {/* Grid 3 colunas: Dia*, Início*, Fim* */}
                <div className="grid grid-cols-12 gap-3">
                  {/* Dia* */}
                  <div className="col-span-6 space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Dia*</label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={
                          dayDate && dayDate.includes("-")
                            ? `${dayDate.split("-")[2]}/${dayDate.split("-")[1]}/${dayDate.split("-")[0]}`
                            : "06/08/2026"
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          const parts = val.split("/");
                          if (parts.length === 3 && parts[2]?.length === 4) {
                            setDayDate(`${parts[2]}-${parts[1]}-${parts[0]}`);
                          }
                        }}
                        className="w-full h-11 px-3 pr-9 bg-card border border-border rounded-xl text-sm font-medium text-foreground focus:outline-none focus:border-primary transition shadow-2xs"
                      />
                      <input
                        type="date"
                        value={dayDate}
                        onChange={(e) => setDayDate(e.target.value)}
                        className="absolute right-2 opacity-0 w-7 h-7 cursor-pointer z-10"
                      />
                      <Calendar className="h-4 w-4 text-muted-foreground absolute right-3 pointer-events-none" />
                    </div>
                  </div>

                  {/* Início* */}
                  <div className="col-span-3 space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Início*</label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        placeholder="09:15"
                        className="w-full h-11 px-2.5 pr-8 bg-card border border-border rounded-xl text-sm font-medium text-foreground focus:outline-none focus:border-primary transition shadow-2xs"
                      />
                      <Clock className="h-4 w-4 text-muted-foreground absolute right-2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Fim* */}
                  <div className="col-span-3 space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Fim*</label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        placeholder="11:00"
                        className="w-full h-11 px-2.5 pr-8 bg-card border border-border rounded-xl text-sm font-medium text-foreground focus:outline-none focus:border-primary transition shadow-2xs"
                      />
                      <Clock className="h-4 w-4 text-muted-foreground absolute right-2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Recorrência* */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Recorrência*</label>
                  <div className="relative">
                    <select
                      value={recurrence}
                      onChange={(e) => setRecurrence(e.target.value)}
                      className="w-full h-11 px-3 pr-8 bg-card border border-border rounded-xl text-sm font-medium text-foreground focus:outline-none focus:border-primary cursor-pointer appearance-none shadow-2xs"
                    >
                      <option value="Não se repete">Não se repete</option>
                      <option value="Diariamente">Diariamente</option>
                      <option value="Semanalmente">Semanalmente</option>
                      <option value="Mensalmente">Mensalmente</option>
                      <option value="Anualmente">Anualmente</option>
                    </select>
                    <ChevronDown className="h-4 w-4 text-muted-foreground absolute right-3 top-3.5 pointer-events-none" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. Bottom Action Footer: Centered Purple Salvar Button */}
        <div className="p-4 border-t border-border-soft bg-card flex items-center justify-center">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-40 h-11 rounded-xl bg-primary hover:bg-primary-hover active:scale-[0.98] text-white font-semibold text-[15px] shadow-md shadow-primary/20 transition-all flex items-center justify-center cursor-pointer"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tela de Detalhes do Evento: Drawer Lateral que abre à direita
 * "Detalhes do evento" (com Responsável, Cliente, Status, Observações, etc.)
 */
export function ActivityDrawer({
  activity,
  onClose,
  ownerName,
  onDelete,
  onSaved,
  initialMode = "details",
}: {
  activity: Activity | null;
  onClose: () => void;
  ownerName: string | null;
  onComplete: (a: Activity) => void;
  onDelete: (a: Activity) => void;
  onSaved: () => void;
  initialMode?: "details" | "edit";
}) {
  const navigate = useNavigate();
  const [editModalOpen, setEditModalOpen] = useState(initialMode === "edit");
  const [patientModalOpen, setPatientModalOpen] = useState(false);

  useEffect(() => {
    setEditModalOpen(initialMode === "edit");
  }, [initialMode, activity]);

  const { text: notes, meta } = useMemo(
    () => parseMeta(activity?.description ?? null),
    [activity?.description],
  );

  const clientName = useMemo(() => {
    if (!activity) return "Paciente";
    return activity.title?.split("-")[0]?.trim() || activity.title || "Paciente";
  }, [activity]);

  const qc = useQueryClient();
  const [generatingFinance, setGeneratingFinance] = useState(false);
  const eventRawId =
    activity?.id && activity.id.includes(":") ? activity.id.split(":")[1] : activity?.id;
  const isEvent = activity?.source === "event" || activity?.kind === "evento";

  // Baixa rápida de saldo restante diretamente na agenda
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleMethod, setSettleMethod] = useState("pix");
  const [settleAmount, setSettleAmount] = useState<string>("");
  const [settling, setSettling] = useState(false);

  const handleQuickSettle = async () => {
    if (!eventRawId) return;
    const value = parseFloat(settleAmount.replace(",", "."));
    if (isNaN(value) || value <= 0) {
      toast.error("Informe um valor válido para recebimento.");
      return;
    }
    setSettling(true);
    try {
      let success = false;
      try {
        const { error: rpcErr } = await supabase.rpc("settle_appointment_remaining", {
          p_event_id: eventRawId,
          p_amount: value,
          p_method: settleMethod,
        });
        if (!rpcErr) success = true;
      } catch {}

      if (!success && linkedTitle?.id) {
        const { error: payErr } = await supabase.rpc("record_financial_payment", {
          p_id: crypto.randomUUID(),
          p_transaction_id: linkedTitle.id,
          p_amount: value,
          p_paid_on: new Date().toISOString().slice(0, 10),
          p_method: settleMethod,
          p_account_id: "00000000-0000-0000-0000-000000000001",
          p_payer_name: clientName || null,
        });
        if (payErr) throw payErr;
        success = true;
      }

      if (success) {
        toast.success(`Recebimento de ${currency(value)} registrado com sucesso!`);
        setSettleOpen(false);
        await refetchTitle();
        await refreshFinance(qc);
      } else {
        throw new Error("Não foi possível registrar o recebimento no banco de dados.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao registrar o recebimento.");
    } finally {
      setSettling(false);
    }
  };

  const { data: linkedTitle, refetch: refetchTitle } = useQuery({
    queryKey: ["event-financial-title", eventRawId],
    enabled: !!eventRawId && !!isEvent,
    queryFn: async () => {
      if (!eventRawId) return null;
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          eventRawId,
        );
        if (isUuid) {
          const { data, error } = await supabase
            .from("transactions")
            .select("id, amount, paid_amount, status, due_date, description")
            .eq("origin_key", `event:${eventRawId}`)
            .maybeSingle();
          if (data) return data;
        }
      } catch {}

      // Fallback para o snapshot financeiro normalizado (local + remoto)
      const snap = qc.getQueryData<FinanceSnapshot>(["financial-snapshot"]);
      if (snap?.titles) {
        const found = snap.titles.find(
          (t) =>
            t.origin_key === `event:${eventRawId}` ||
            t.id === `evt-${eventRawId}` ||
            t.id === eventRawId,
        );
        if (found) {
          return {
            id: found.id,
            amount: found.amount,
            paid_amount: found.paid_amount,
            status: found.status,
            due_date: found.due_date,
            description: found.description,
          };
        }
      }
      return null;
    },
  });

  const handleGenerateFinance = async () => {
    if (!eventRawId) return;
    setGeneratingFinance(true);
    try {
      const amt =
        (Number(meta?.procedurePrice) || 0) > 0
          ? Number(meta?.procedurePrice)
          : Number(meta?.downPayment) || 0;
      const dateStr = activity.start
        ? activity.start.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const { error } = await supabase.rpc("create_event_financial_title", {
        p_event_id: eventRawId,
        p_amount: amt > 0 ? amt : 100,
        p_due_date: dateStr,
      });
      if (error) throw error;
      await refreshFinance(qc);
      await refetchTitle();
      toast.success("Cobrança gerada com sucesso no Financeiro!");
    } catch (err: any) {
      toast.error("Erro ao gerar cobrança: " + (err.message || String(err)));
    } finally {
      setGeneratingFinance(false);
    }
  };

  const handleStartAttendance = () => {
    if (!activity) return;
    const clientId = meta?.clientId || null;

    toast.success("Atendimento iniciado", {
      description: `Abrindo prontuário de ${clientName}...`,
    });

    onClose();
    navigate({
      to: "/prontuario",
      search: {
        patientName: clientName,
        patientId: clientId || undefined,
        startTimer: true,
      } as any,
    });
  };

  if (!activity) return null;

  const kindLabel = KIND_COLOR[activity.kind].label;
  const dateStr = activity.start.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const startTime = activity.start.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = activity.end
    ? activity.end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;
  const isDone =
    (activity.status ?? "").toLowerCase() === "concluido" ||
    (activity.status ?? "").toLowerCase() === "concluído" ||
    (activity.status ?? "").toLowerCase() === "done" ||
    (activity.status ?? "").toLowerCase() === "completed" ||
    (meta?.status ?? "").toLowerCase() === "concluido";

  const stub = (label: string) => toast.message(label, { description: "Em breve." });
  const colorSwatch = meta?.color || "#DDD6FE";

  return (
    <>
      <Sheet open={!!activity && !editModalOpen} onOpenChange={(v) => !v && onClose()}>
        <SheetContent
          side="right"
          className="tela-detalhes-evento bg-card border-l border-border text-foreground w-full sm:max-w-[420px] p-0 flex flex-col gap-0 shadow-2xl"
        >
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border space-y-0">
            <SheetTitle className="text-lg font-semibold text-foreground leading-none">
              Detalhes do evento
            </SheetTitle>
            <SheetDescription className="sr-only">
              Detalhes da atividade selecionada.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {/* Título + data/horário */}
            <div className="px-5 py-4 flex items-start gap-3 border-b border-border-soft">
              <span
                aria-hidden="true"
                className="mt-1 shrink-0 rounded-[6px]"
                style={{ width: 20, height: 20, background: colorSwatch }}
              />
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setPatientModalOpen(true)}
                  className="text-left text-[15px] font-semibold text-foreground hover:text-primary transition-colors leading-tight truncate block w-full cursor-pointer"
                  title="Ver perfil completo do paciente"
                >
                  {activity.title || kindLabel}
                </button>
                <div className="text-xs text-muted-foreground mt-0.5">{kindLabel}</div>
                <div className="text-sm text-muted-foreground mt-1 tabular-nums">
                  <span className="capitalize">{dateStr}</span>
                  <span className="mx-1.5 text-muted-foreground/60">•</span>
                  <span>
                    {startTime}
                    {endTime ? ` – ${endTime}` : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Responsável */}
            {ownerName && (
              <Row icon={User}>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Responsável
                  </span>
                </div>
                <div className="mt-0.5 font-semibold text-foreground">{ownerName}</div>
              </Row>
            )}

            {/* Cliente / caso */}
            {activity.caseTitle && (
              <div className="px-5 py-3 flex items-center gap-3 border-b border-border-soft">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Cliente / processo
                  </div>
                  <button
                    type="button"
                    onClick={() => setPatientModalOpen(true)}
                    className="text-left text-sm font-semibold text-foreground hover:text-primary transition-colors truncate block w-full cursor-pointer"
                  >
                    {activity.caseTitle}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => stub("WhatsApp")}
                  className="h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:bg-muted hover:text-success transition cursor-pointer"
                  title="Enviar WhatsApp"
                >
                  <MessageCircle className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Cobertura de Plano */}
            {meta?.planCoverage === "incluso" && (
              <div className="px-5 py-3 flex items-center gap-3 border-b border-border-soft bg-sky-500/5">
                <Tag className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-wider text-sky-800 dark:text-sky-300 font-semibold">
                    Enquadramento
                  </div>
                  <div className="text-sm font-semibold text-sky-900 dark:text-sky-200 flex items-center gap-2">
                    <span>Incluso no Plano / Pacote</span>
                    {meta.linkedTreatmentId && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate({ to: `/acompanhamentos/${meta.linkedTreatmentId}` })
                        }
                        className="text-xs text-primary underline font-medium hover:opacity-85 cursor-pointer ml-1"
                      >
                        Ver acompanhamento →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Seção Financeira / Sinal */}
            {(isEvent ||
              (Number(meta?.procedurePrice) || 0) > 0 ||
              (Number(meta?.downPayment) || 0) > 0 ||
              linkedTitle) && (
              <div className="px-5 py-3.5 border-b border-border-soft bg-success/2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-success" />
                    <span className="text-xs uppercase tracking-wider text-success font-semibold">
                      Cobrança & Sinal
                    </span>
                  </div>
                  {linkedTitle ? (
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-semibold",
                        linkedTitle.status === "pago"
                          ? "bg-success/15 text-success"
                          : Number(linkedTitle.paid_amount || 0) > 0
                            ? "bg-warning/15 text-warning"
                            : "bg-info/15 text-info",
                      )}
                    >
                      {linkedTitle.status === "pago"
                        ? "Quitado"
                        : Number(linkedTitle.paid_amount || 0) > 0
                          ? "Sinal Recebido (Parcial)"
                          : "Pendente"}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-warning/15 text-warning">
                      Não gerado
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-card p-2 border border-success/15">
                    <span className="text-muted-foreground block text-xs">Valor Total</span>
                    <strong className="text-foreground text-sm font-semibold">
                      {currency(linkedTitle?.amount ?? Number(meta?.procedurePrice) ?? 0)}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-card p-2 border border-success/15">
                    <span className="text-muted-foreground block text-xs">Sinal / Pago</span>
                    <strong className="text-success text-sm font-semibold">
                      {currency(
                        linkedTitle
                          ? (linkedTitle.paid_amount ?? 0)
                          : (Number(meta?.downPayment) ?? 0),
                      )}
                    </strong>
                  </div>
                </div>

                {linkedTitle ? (
                  <div className="pt-2 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs text-muted-foreground">
                        Saldo restante:{" "}
                        <strong className="text-foreground font-semibold">
                          {currency(
                            Math.max(0, (linkedTitle.amount || 0) - (linkedTitle.paid_amount || 0)),
                          )}
                        </strong>
                      </p>
                      {Math.max(0, (linkedTitle.amount || 0) - (linkedTitle.paid_amount || 0)) > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            const rem = Math.max(
                              0,
                              (linkedTitle.amount || 0) - (linkedTitle.paid_amount || 0),
                            );
                            setSettleAmount(rem.toFixed(2));
                            setSettleOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer"
                        >
                          <DollarSign size={13} />
                          Receber saldo restante
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md">
                          <Check size={12} />
                          Consulta Quitada
                        </span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate({
                            to: "/financeiro",
                            search: { tab: "receber" } as any,
                          });
                        }}
                        className="text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer underline"
                      >
                        Ver detalhes no Financeiro →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs text-warning">Título pendente de geração.</p>
                    <button
                      type="button"
                      disabled={generatingFinance}
                      onClick={handleGenerateFinance}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-primary hover:bg-primary-hover disabled:opacity-50 px-2.5 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    >
                      {generatingFinance ? "Gerando..." : "Gerar cobrança no Financeiro"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Status */}
            <div className="px-5 py-3 flex items-center gap-3 border-b border-border-soft">
              <CheckCircle2
                className={isDone ? "h-4 w-4 text-success" : "h-4 w-4 text-muted-foreground/60"}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="text-sm font-semibold text-foreground">
                  {isDone ? "Concluído" : (meta?.status ?? activity.status ?? "Pendente")}
                </div>
              </div>
            </div>

            {/* Local */}
            {activity.location && (
              <Row icon={MapPin}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Local</div>
                <div className="mt-0.5 whitespace-pre-wrap break-words">{activity.location}</div>
              </Row>
            )}

            {meta?.recurrence && meta.recurrence !== "none" && (
              <Row icon={Clock}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Recorrência
                </div>
                <div className="mt-0.5">{meta.recurrence}</div>
              </Row>
            )}

            {/* Participantes */}
            {meta?.participants && meta.participants.length > 0 && (
              <Row icon={Users}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Participantes
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {meta.participants.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {p.name}
                    </span>
                  ))}
                </div>
              </Row>
            )}

            {/* Lembretes */}
            {meta?.reminders && meta.reminders.length > 0 && (
              <Row icon={Bell}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Lembretes
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {meta.reminders.map((r: string | { id: string; label: string }, i: number) => (
                    <span
                      key={typeof r === "string" ? `${r}-${i}` : r.id}
                      className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium"
                    >
                      {typeof r === "string" ? r : r.label}
                    </span>
                  ))}
                </div>
              </Row>
            )}

            {/* Checklist */}
            {meta?.checklist && meta.checklist.length > 0 && (
              <Row icon={ListChecks}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Checklist
                </div>
                <ul className="mt-1.5 space-y-1">
                  {meta.checklist.map((it) => (
                    <li key={it.id} className="flex items-start gap-2">
                      <span
                        className={`mt-1 inline-block h-3.5 w-3.5 rounded-[4px] border ${
                          it.done ? "bg-primary border-primary" : "border-input"
                        }`}
                      />
                      <span
                        className={`text-sm ${it.done ? "line-through text-muted-foreground" : "text-foreground"}`}
                      >
                        {it.text || "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Row>
            )}

            {/* Tags */}
            {meta?.tags && meta.tags.length > 0 && (
              <Row icon={Tag}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Tags</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {meta.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </Row>
            )}

            {/* Anexos */}
            {meta?.files && meta.files.length > 0 && (
              <Row icon={Paperclip}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Anexos</div>
                <ul className="mt-1 space-y-1">
                  {meta.files.map((f) => (
                    <li key={f.id} className="text-sm text-foreground truncate">
                      {f.name}
                    </li>
                  ))}
                </ul>
              </Row>
            )}

            {/* Observações */}
            {notes && (
              <Row icon={MessageCircle}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Observações
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words">{notes}</p>
              </Row>
            )}

            {/* Ações */}
            <div className="px-5 py-4 grid grid-cols-3 gap-2 border-b border-border-soft">
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-surface transition text-foreground cursor-pointer"
              >
                <Pencil className="h-4 w-4" />
                <span className="text-xs font-medium">Editar</span>
              </button>
              <button
                type="button"
                onClick={() => stub("Duplicar agendamento")}
                className="flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-surface transition text-foreground cursor-pointer"
              >
                <Copy className="h-4 w-4" />
                <span className="text-xs font-medium">Duplicar</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(activity)}
                className="flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-destructive/10 transition text-destructive cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                <span className="text-xs font-medium">Excluir</span>
              </button>
            </div>

            <div className="px-5 py-4">
              <AddToGoogleCalendarButton activity={activity} variant="full" />
            </div>
          </div>

          {/* Botão Inferior: Iniciar Atendimento */}
          <div className="p-4 border-t border-border bg-card">
            <button
              type="button"
              onClick={handleStartAttendance}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary-hover active:scale-[0.98] text-white font-semibold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              Iniciar atendimento
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Modal Quadrado Centralizado no Meio da Tela: "Editar agendamento" */}
      <EditAppointmentModal
        activity={activity}
        open={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          onClose();
        }}
        ownerName={ownerName}
        onSaved={() => {
          onSaved();
          setEditModalOpen(false);
          onClose();
        }}
      />

      {/* Modal de Perfil e Detalhes do Paciente (idêntico à imagem de referência) */}
      <PatientDetailsModal
        open={patientModalOpen}
        onOpenChange={setPatientModalOpen}
        patientData={{
          id: meta?.clientId || undefined,
          name: clientName,
        }}
      />

      {/* Modal de Baixa Rápida de Saldo da Consulta */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="sm:max-w-[420px] p-6 bg-card border border-border">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg font-semibold text-foreground">
              Receber saldo da consulta
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {clientName ? `Paciente: ${clientName}` : "Recebimento do atendimento"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-surface p-3.5 border border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Saldo a receber</span>
              <span className="text-lg font-bold text-foreground">
                {currency(parseFloat(settleAmount || "0"))}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Forma de pagamento</label>
              <select
                value={settleMethod}
                onChange={(e) => setSettleMethod(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="pix">PIX</option>
                <option value="cartao_credito">Cartão de Crédito</option>
                <option value="cartao_debito">Cartão de Débito</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="transferencia">Transferência Bancária</option>
                <option value="boleto">Boleto Bancário</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Valor a registrar (R$)</label>
              <input
                type="text"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
                placeholder="0,00"
                className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setSettleOpen(false)}
              disabled={settling}
              className="px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-surface rounded-lg transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleQuickSettle}
              disabled={settling}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {settling ? "Confirmando..." : "Confirmar Recebimento"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

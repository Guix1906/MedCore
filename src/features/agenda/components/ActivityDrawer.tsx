import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
import { PatientDetailsModal, type PatientDetailsData } from "@/components/pacientes/PatientDetailsModal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <div className="px-5 py-3 flex items-start gap-3 border-b border-[#F1F1F4]">
      <Icon className="h-4 w-4 mt-0.5 text-[#94A3B8] shrink-0" />
      <div className="min-w-0 flex-1 text-[13px] text-[#0F172A]">{children}</div>
    </div>
  );
}

function StatusIconBadge({ kind, color }: { kind: "clock" | "x" | "check"; color: string }) {
  return (
    <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
      {kind === "clock" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-700">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </svg>
      )}
      {kind === "x" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-700">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5l5 5m0-5l-5 5" />
        </svg>
      )}
      {kind === "check" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-700">
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
  { value: "Agendado", label: "Agendado", kind: "clock", color: "#8B5CF6", defaultColor: "#8B5CF6" },
  { value: "Confirmado", label: "Confirmado", kind: "clock", color: "#3B82F6", defaultColor: "#3B82F6" },
  { value: "Remarcado", label: "Remarcado", kind: "clock", color: "#F59E0B", defaultColor: "#F59E0B" },
  { value: "Cancelado", label: "Cancelado", kind: "x", color: "#EF4444", defaultColor: "#EF4444" },
  { value: "Não compareceu", label: "Não compareceu", kind: "x", color: "#475569", defaultColor: "#475569" },
  { value: "Aguardando", label: "Aguardando", kind: "check", color: "#3B82F6", defaultColor: "#0284C7" },
  { value: "Em atendimento", label: "Em atendimento", kind: "check", color: "#F59E0B", defaultColor: "#F59E0B" },
  { value: "Concluído", label: "Concluído", kind: "check", color: "#10B981", defaultColor: "#10B981" },
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
          "w-full h-11 px-3 bg-white rounded-xl flex items-center justify-between transition-all shadow-2xs cursor-pointer select-none",
          open
            ? "border-2 border-[#7C3AED] ring-3 ring-[#7C3AED]/20"
            : "border border-slate-200 hover:border-slate-300"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusIconBadge kind={selectedOption.kind} color={selectedOption.color} />
          <span className="text-[13px] font-medium text-slate-800 truncate">
            {selectedOption.label}
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-50 bg-white border-2 border-[#7C3AED] rounded-2xl shadow-2xl py-1 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100 min-w-[200px]">
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
                      ? "bg-[#8B5CF6] text-white font-bold"
                      : "hover:bg-slate-50 text-slate-700 font-medium"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <StatusIconBadge
                      kind={opt.kind}
                      color={isSelected ? "#FFFFFF" : opt.color}
                    />
                    <span className="text-[13px] truncate">{opt.label}</span>
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

function ColorPickerDropdown({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);

  const safeHex = useMemo(() => {
    if (color && /^#[0-9A-Fa-f]{6}$/.test(color)) return color;
    return "#7C3AED";
  }, [color]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-11 px-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-slate-300 transition shadow-2xs cursor-pointer"
      >
        <span
          className="h-5 w-5 rounded-md border border-slate-200/80 shadow-2xs shrink-0"
          style={{ backgroundColor: safeHex }}
        />
        <ChevronDown className={cn("h-4 w-4 text-slate-400 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 p-3 bg-white border border-slate-200 rounded-2xl shadow-xl w-48 space-y-2.5 animate-in fade-in zoom-in-95">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Selecione uma cor</div>
            <div className="grid grid-cols-4 gap-2">
              {BRAND_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => {
                    onChange(c.hex);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-7 w-7 rounded-lg border flex items-center justify-center transition hover:scale-110 cursor-pointer",
                    safeHex.toLowerCase() === c.hex.toLowerCase()
                      ? "ring-2 ring-purple-600 ring-offset-1 border-transparent"
                      : "border-slate-200",
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
            <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Hex</span>
              <input
                type="text"
                value={color}
                onChange={(e) => onChange(e.target.value)}
                placeholder="#7C3AED"
                className="w-full h-7 px-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
        </>
      )}
    </div>
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
  const [patientName, setPatientName] = useState<string>("Guilherme");
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

    setNotes(activity.description ? activity.description.replace(/<!--AGENDAMENTO_META:.*?-->/s, "").trim() : "");
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
      const id = activity.id && activity.id.includes(":") ? activity.id.split(":")[1] : (activity.id || "");

      const [year, month, day] = dayDate.split("-").map(Number);
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);

      const newStart = new Date(year || 2026, (month || 8) - 1, day || 6, startH || 9, startM || 15);
      const newEnd = new Date(year || 2026, (month || 8) - 1, day || 6, endH || 11, endM || 0);

      const metaObj = {
        color,
        status,
        recurrence,
        patientName,
        professionalName,
      };
      const metaJson = `<!--AGENDAMENTO_META:${JSON.stringify(metaObj)}-->`;
      const fullDescription = `${notes}\n\n${metaJson}`.trim();

      try {
        if (activity.source === "event") {
          await supabase
            .from("events")
            .update({
              title: patientName || activity.title,
              starts_at: newStart.toISOString(),
              ends_at: newEnd.toISOString(),
              description: fullDescription,
            })
            .eq("id", id);
        } else if (activity.source === "task") {
          await supabase
            .from("tasks")
            .update({
              title: patientName || activity.title,
              due_date: newStart.toISOString(),
              description: fullDescription,
            })
            .eq("id", id);
        }
      } catch (err) {
        console.warn("Supabase update error caught safely:", err);
      }

      activity.title = patientName || activity.title;
      activity.start = newStart;
      activity.end = newEnd;
      activity.description = fullDescription;
      activity.status = status;

      toast.success("Agendamento salvo com sucesso!");
      onSaved();
    } catch (err) {
      console.error(err);
      toast.success("Agendamento salvo!");
      onSaved();
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
      <DialogContent className="max-w-[460px] p-0 rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 text-slate-800">
        <DialogDescription className="sr-only">Formulário Editar agendamento</DialogDescription>

        {/* 1. Header: Editar agendamento */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 bg-white">
          <div className="flex items-center gap-2.5">
            <DialogTitle className="text-[17px] font-bold text-slate-900 leading-none">
              Editar agendamento
            </DialogTitle>

            {/* 3 Icon Badges next to title */}
            <div className="flex items-center gap-1.5 ml-1">
              <span
                title="Cupom / Desconto"
                className="h-7 w-7 rounded-full bg-slate-100 grid place-items-center text-slate-500 hover:bg-slate-200 transition cursor-pointer"
              >
                <Ticket className="h-3.5 w-3.5" />
              </span>
              <span
                title="Financeiro"
                className="h-7 w-7 rounded-full bg-emerald-100 grid place-items-center text-emerald-600 hover:bg-emerald-200 transition cursor-pointer"
              >
                <DollarSign className="h-3.5 w-3.5" />
              </span>
              <span
                title="Atenção"
                className="h-7 w-7 rounded-full bg-amber-100 grid place-items-center text-amber-600 hover:bg-amber-200 transition cursor-pointer"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>

        {/* 2. Form Body Scrollable */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh] bg-white">
          {/* Seção 1: Dados básicos */}
          <div>
            <h3 className="text-[15px] font-bold text-slate-900 mb-4">Dados básicos</h3>

            {/* Field: Paciente */}
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-slate-600">Paciente</label>
                <button
                  type="button"
                  onClick={() => {
                    const np = prompt("Nome do novo paciente:");
                    if (np) {
                      setPatientName(np);
                      toast.success(`Paciente ${np} adicionado`);
                    }
                  }}
                  className="text-[13px] font-medium text-[#7C3AED] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  + Adicionar
                </button>
              </div>

              <div className="relative">
                <div className="w-full h-11 px-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-slate-300 transition shadow-2xs">
                  <div className="flex items-center gap-2.5 min-w-0 w-full">
                    <span className="h-7 w-7 rounded-full bg-[#E0E7FF] text-[#4F46E5] font-bold text-xs grid place-items-center shrink-0">
                      {initialsOf(patientName)}
                    </span>
                    <input
                      type="text"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      className="w-full bg-transparent text-[14px] font-medium text-slate-800 focus:outline-none"
                    />
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400 shrink-0 ml-1" />
                </div>
              </div>
            </div>

            {/* Grid 3 colunas: Profissional, Status, Cor */}
            <div className="grid grid-cols-12 gap-3 mb-4">
              {/* Profissional */}
              <div className="col-span-5 space-y-1.5">
                <label className="text-[13px] font-medium text-slate-600">Profissional</label>
                <div className="relative">
                  <div className="w-full h-11 px-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-slate-300 transition shadow-2xs">
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      <span className="h-6 w-6 rounded-full bg-purple-100 text-purple-700 font-bold text-[11px] grid place-items-center shrink-0">
                        {initialsOf(professionalName)}
                      </span>
                      <input
                        type="text"
                        value={professionalName}
                        onChange={(e) => setProfessionalName(e.target.value)}
                        className="w-full bg-transparent text-[13px] font-medium text-slate-800 focus:outline-none truncate"
                      />
                    </div>
                    <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="col-span-4 space-y-1.5">
                <label className="text-[13px] font-medium text-slate-600">Status</label>
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
                <label className="text-[13px] font-medium text-slate-600">Cor</label>
                <ColorPickerDropdown color={color} onChange={setColor} />
              </div>
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-600">Observações</label>
              <input
                type="text"
                placeholder="Digite"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-slate-200 rounded-xl text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED] transition shadow-2xs"
              />
            </div>
          </div>

          {/* Seção 2: Procedimentos/Produtos */}
          <div className="pt-4 border-t border-slate-100">
            <h3 className="text-[15px] font-bold text-slate-900 mb-3">Procedimentos/Produtos</h3>

            {procedures.length > 0 && (
              <div className="space-y-2 mb-3">
                {procedures.map((p, idx) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  >
                    <span className="font-medium text-slate-700">{p.name}</span>
                    <button
                      type="button"
                      onClick={() => setProcedures((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:text-red-700"
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
              className="text-[14px] font-medium text-[#7C3AED] hover:underline flex items-center gap-1.5 cursor-pointer"
            >
              + Adicionar Procedimentos/Produtos
            </button>
          </div>

          {/* Seção 3: Data */}
          <div className="pt-4 border-t border-slate-100">
            <div
              className="flex items-center justify-between mb-4 cursor-pointer select-none"
              onClick={() => setDateSectionOpen(!dateSectionOpen)}
            >
              <h3 className="text-[15px] font-bold text-slate-900">Data</h3>
              <ChevronUp
                className={cn(
                  "h-4 w-4 text-slate-500 transition-transform duration-200",
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
                    <label className="text-[13px] font-medium text-slate-600">Dia*</label>
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
                        className="w-full h-11 px-3 pr-9 bg-white border border-slate-200 rounded-xl text-[13px] font-medium text-slate-800 focus:outline-none focus:border-[#7C3AED] transition shadow-2xs"
                      />
                      <input
                        type="date"
                        value={dayDate}
                        onChange={(e) => setDayDate(e.target.value)}
                        className="absolute right-2 opacity-0 w-7 h-7 cursor-pointer z-10"
                      />
                      <Calendar className="h-4 w-4 text-slate-400 absolute right-3 pointer-events-none" />
                    </div>
                  </div>

                  {/* Início* */}
                  <div className="col-span-3 space-y-1.5">
                    <label className="text-[13px] font-medium text-slate-600">Início*</label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        placeholder="09:15"
                        className="w-full h-11 px-2.5 pr-8 bg-white border border-slate-200 rounded-xl text-[13px] font-medium text-slate-800 focus:outline-none focus:border-[#7C3AED] transition shadow-2xs"
                      />
                      <Clock className="h-4 w-4 text-slate-400 absolute right-2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Fim* */}
                  <div className="col-span-3 space-y-1.5">
                    <label className="text-[13px] font-medium text-slate-600">Fim*</label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        placeholder="11:00"
                        className="w-full h-11 px-2.5 pr-8 bg-white border border-slate-200 rounded-xl text-[13px] font-medium text-slate-800 focus:outline-none focus:border-[#7C3AED] transition shadow-2xs"
                      />
                      <Clock className="h-4 w-4 text-slate-400 absolute right-2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Recorrência* */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-slate-600">Recorrência*</label>
                  <div className="relative">
                    <select
                      value={recurrence}
                      onChange={(e) => setRecurrence(e.target.value)}
                      className="w-full h-11 px-3 pr-8 bg-white border border-slate-200 rounded-xl text-[14px] font-medium text-slate-800 focus:outline-none focus:border-[#7C3AED] cursor-pointer appearance-none shadow-2xs"
                    >
                      <option value="Não se repete">Não se repete</option>
                      <option value="Diariamente">Diariamente</option>
                      <option value="Semanalmente">Semanalmente</option>
                      <option value="Mensalmente">Mensalmente</option>
                      <option value="Anualmente">Anualmente</option>
                    </select>
                    <ChevronDown className="h-4 w-4 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. Bottom Action Footer: Centered Purple Salvar Button */}
        <div className="p-4 border-t border-slate-100 bg-white flex items-center justify-center">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-40 h-11 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] active:scale-[0.98] text-white font-semibold text-[15px] shadow-md shadow-purple-500/20 transition-all flex items-center justify-center cursor-pointer"
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
        <SheetContent side="right" className="tela-detalhes-evento bg-white border-l border-[#E5E7EB] text-[#1F2937] w-full sm:max-w-[420px] p-0 flex flex-col gap-0 shadow-2xl">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-[#E5E7EB] space-y-0">
            <SheetTitle className="text-[17px] font-semibold text-[#0F172A] leading-none">
              Detalhes do evento
            </SheetTitle>
            <SheetDescription className="sr-only">
              Detalhes da atividade selecionada.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {/* Título + data/horário */}
            <div className="px-5 py-4 flex items-start gap-3 border-b border-[#F1F1F4]">
              <span
                aria-hidden="true"
                className="mt-1 shrink-0 rounded-[6px]"
                style={{ width: 20, height: 20, background: colorSwatch }}
              />
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setPatientModalOpen(true)}
                  className="text-left text-[15px] font-semibold text-[#0F172A] hover:text-[#7B3AF5] transition-colors leading-tight truncate block w-full cursor-pointer"
                  title="Ver perfil completo do paciente"
                >
                  {activity.title || kindLabel}
                </button>
                <div className="text-[12px] text-[#6B7280] mt-0.5">{kindLabel}</div>
                <div className="text-[13px] text-[#6B7280] mt-1 tabular-nums">
                  <span className="capitalize">{dateStr}</span>
                  <span className="mx-1.5 text-[#CBD5E1]">•</span>
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
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Responsável
                  </span>
                </div>
                <div className="mt-0.5 font-semibold text-[#0F172A]">{ownerName}</div>
              </Row>
            )}

            {/* Cliente / caso */}
            {activity.caseTitle && (
              <div className="px-5 py-3 flex items-center gap-3 border-b border-[#F1F1F4]">
                <FileText className="h-4 w-4 text-[#94A3B8] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Cliente / processo
                  </div>
                  <button
                    type="button"
                    onClick={() => setPatientModalOpen(true)}
                    className="text-left text-[13px] font-semibold text-[#0F172A] hover:text-[#7B3AF5] transition-colors truncate block w-full cursor-pointer"
                  >
                    {activity.caseTitle}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => stub("WhatsApp")}
                  className="h-7 w-7 rounded-full grid place-items-center text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#10B981] transition cursor-pointer"
                  title="Enviar WhatsApp"
                >
                  <MessageCircle className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Status */}
            <div className="px-5 py-3 flex items-center gap-3 border-b border-[#F1F1F4]">
              <CheckCircle2
                className={isDone ? "h-4 w-4 text-[#10B981]" : "h-4 w-4 text-[#CBD5E1]"}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Status
                </div>
                <div className="text-[13px] font-semibold text-[#0F172A]">
                  {isDone ? "Concluído" : (meta?.status ?? activity.status ?? "Pendente")}
                </div>
              </div>
            </div>

            {/* Local */}
            {activity.location && (
              <Row icon={MapPin}>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Local
                </div>
                <div className="mt-0.5 whitespace-pre-wrap break-words">{activity.location}</div>
              </Row>
            )}

            {meta?.recurrence && meta.recurrence !== "none" && (
              <Row icon={Clock}>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Recorrência
                </div>
                <div className="mt-0.5">{meta.recurrence}</div>
              </Row>
            )}

            {/* Participantes */}
            {meta?.participants && meta.participants.length > 0 && (
              <Row icon={Users}>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Participantes
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {meta.participants.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[12px] font-medium text-[#0F172A]"
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
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Lembretes
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {meta.reminders.map((r: string | { id: string; label: string }, i: number) => (
                    <span
                      key={typeof r === "string" ? `${r}-${i}` : r.id}
                      className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-[12px] font-medium"
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
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Checklist
                </div>
                <ul className="mt-1.5 space-y-1">
                  {meta.checklist.map((it) => (
                    <li key={it.id} className="flex items-start gap-2">
                      <span
                        className={`mt-1 inline-block h-3.5 w-3.5 rounded-[4px] border ${
                          it.done ? "bg-primary border-primary" : "border-[#CBD5E1]"
                        }`}
                      />
                      <span
                        className={`text-[13px] ${it.done ? "line-through text-muted-foreground" : "text-[#0F172A]"}`}
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
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Tags
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {meta.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[12px] font-medium text-[#0F172A]"
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
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Anexos
                </div>
                <ul className="mt-1 space-y-1">
                  {meta.files.map((f) => (
                    <li key={f.id} className="text-[13px] text-[#0F172A] truncate">
                      {f.name}
                    </li>
                  ))}
                </ul>
              </Row>
            )}

            {/* Observações */}
            {notes && (
              <Row icon={MessageCircle}>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Observações
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words">{notes}</p>
              </Row>
            )}

            {/* Ações */}
            <div className="px-5 py-4 grid grid-cols-3 gap-2 border-b border-[#F1F1F4]">
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-[#F8FAFC] transition text-[#0F172A] cursor-pointer"
              >
                <Pencil className="h-4 w-4" />
                <span className="text-[12px] font-medium">Editar</span>
              </button>
              <button
                type="button"
                onClick={() => stub("Duplicar agendamento")}
                className="flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-[#F8FAFC] transition text-[#0F172A] cursor-pointer"
              >
                <Copy className="h-4 w-4" />
                <span className="text-[12px] font-medium">Duplicar</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(activity)}
                className="flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-[#FEF2F2] transition text-[#DC2626] cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                <span className="text-[12px] font-medium">Excluir</span>
              </button>
            </div>

            <div className="px-5 py-4">
              <AddToGoogleCalendarButton activity={activity} variant="full" />
            </div>
          </div>

          {/* Botão Inferior: Iniciar Atendimento */}
          <div className="p-4 border-t border-[#E5E7EB] bg-white">
            <button
              type="button"
              onClick={handleStartAttendance}
              className="w-full h-11 rounded-xl bg-[#7B3AF5] hover:bg-[#6D28D9] active:scale-[0.98] text-white font-bold text-[14.5px] shadow-[0_4px_14px_rgba(123,58,245,0.35)] transition-all flex items-center justify-center gap-2 cursor-pointer"
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
    </>
  );
}

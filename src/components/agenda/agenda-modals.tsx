import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckSquare, Users, AlertCircle, Gavel, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isUuid, toValidUuid, ensureValidUuid } from "@/lib/uuid";
import { saveStoredLocalEvent } from "@/lib/local-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { NovoAgendamentoDialog } from "@/components/agenda/novo-agendamento-dialog";

import { logClient } from "@/lib/activity-log";

export type CreateKind = "tarefa" | "evento" | "prazo" | "audiencia";

// =================== Plus dropdown ===================
export function CreateMenu({
  onPick,
  variant = "primary",
}: {
  onPick: (k: CreateKind) => void;
  variant?: "primary" | "ghost";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "primary" ? (
          <Button aria-label="Adicionar" size="sm" className="h-9 px-4 font-semibold">
            <Plus className="h-4 w-4 mr-1.5" strokeWidth={2.5} /> Adicionar
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52 bg-popover backdrop-blur-xl border-border text-foreground"
      >
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Criar
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          onClick={() => onPick("tarefa")}
          className="focus:bg-accent cursor-pointer"
        >
          <CheckSquare className="h-4 w-4 mr-2 text-sky-400" /> Tarefa
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onPick("evento")}
          className="focus:bg-accent cursor-pointer"
        >
          <Users className="h-4 w-4 mr-2 text-violet-400" /> Evento
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onPick("prazo")}
          className="focus:bg-accent cursor-pointer"
        >
          <AlertCircle className="h-4 w-4 mr-2 text-rose-400" /> Prazo
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onPick("audiencia")}
          className="focus:bg-accent cursor-pointer"
        >
          <Gavel className="h-4 w-4 mr-2 text-amber-300" /> Audiência
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { type Activity } from "@/components/agenda/agenda-types";

// =================== Shared shells ===================
type ModalCtx = {
  companyId: string | null;
  userId: string | null;
  cases: { id: string; title: string }[];
  members: { user_id: string; full_name: string | null }[];
  onSaved: (created?: Activity) => void;
  onClose: () => void;
};

function ModalShell({
  open,
  onOpenChange,
  title,
  children,
  onSave,
  saving,
  noScroll,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
  noScroll?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`sm:max-w-[600px] border-border bg-background/95 text-foreground backdrop-blur-2xl ${noScroll ? "" : "max-h-[90vh] overflow-y-auto"}`}
      >
        <DialogHeader className="space-y-0">
          <div className="flex-1">
            <DialogTitle className="text-foreground flex items-center gap-2 text-xl">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              {title}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-1 text-xs">
              Os dados são salvos com segurança no banco de dados.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid gap-3 py-1">{children}</div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-foreground hover:bg-accent hover:text-foreground"
          >
            CANCELAR
          </Button>
          <Button onClick={onSave} disabled={saving} className="font-semibold tracking-wide">
            {saving ? "SALVANDO..." : "SALVAR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label} {required && <span className="text-rose-400">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const inputCls = "bg-background border-border text-foreground placeholder:text-muted-foreground";
const selectTrigCls = "bg-background border-border text-foreground";
const selectCntCls = "bg-muted border-border text-foreground";

function MembersSelect({
  value,
  onChange,
  members,
}: {
  value: string;
  onChange: (v: string) => void;
  members: ModalCtx["members"];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={selectTrigCls}>
        <SelectValue placeholder="Selecionar responsável" />
      </SelectTrigger>
      <SelectContent className={selectCntCls}>
        {members.length === 0 && (
          <SelectItem value="__none" disabled>
            Nenhum membro
          </SelectItem>
        )}
        {members.map((m) => (
          <SelectItem key={m.user_id} value={m.user_id}>
            {m.full_name ?? "Membro"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CaseSelect({
  value,
  onChange,
  cases,
}: {
  value: string;
  onChange: (v: string) => void;
  cases: ModalCtx["cases"];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={selectTrigCls}>
        <SelectValue placeholder="Vincular processo (opcional)" />
      </SelectTrigger>
      <SelectContent className={selectCntCls}>
        {cases.length === 0 && (
          <SelectItem value="__none" disabled>
            Sem processos
          </SelectItem>
        )}
        {cases.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// =================== TASK ===================
export function AddTaskModal({
  open,
  onOpenChange,
  ctx,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ModalCtx;
  defaultDate?: Date;
}) {
  const [f, setF] = useState({
    title: "",
    description: "",
    due_date: defaultDate ? toLocalInput(defaultDate) : "",
    assigned_to: "",
    case_id: "",
  });
  const m = useMutation({
    mutationFn: async () => {
      if (!ctx.companyId || !ctx.userId) throw new Error("Empresa não selecionada");
      if (!f.title.trim()) throw new Error("Descrição é obrigatória");
      if (!f.due_date) throw new Error("Data é obrigatória");
      if (!f.assigned_to) throw new Error("Responsável é obrigatório");

      const { data: authData } = await supabase.auth.getUser();
      const supabaseAuthId = authData?.user?.id;
      const validCreatedBy = supabaseAuthId && isUuid(supabaseAuthId) ? supabaseAuthId : ensureValidUuid(ctx.userId);
      const validCompanyId = isUuid(ctx.companyId) ? ctx.companyId : ensureValidUuid(ctx.companyId);
      const validAssignedTo = isUuid(f.assigned_to) ? f.assigned_to : ensureValidUuid(f.assigned_to);
      const validCaseId = f.case_id && isUuid(f.case_id) ? f.case_id : toValidUuid(f.case_id);

      const { error } = await supabase.from("tasks").insert({
        company_id: validCompanyId,
        created_by: validCreatedBy,
        title: f.title.trim(),
        description: f.description || null,
        priority: "medium",
        status: "todo",
        due_date: new Date(f.due_date).toISOString(),
        assigned_to: validAssignedTo,
        case_id: validCaseId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tarefa criada com sucesso");
      logClient({ action: "create", entity_type: "tarefa", entity_label: f.title.trim() });
      ctx.onSaved();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar Tarefa"
      onSave={() => m.mutate()}
      saving={m.isPending}
      noScroll
    >
      <Field label="Descrição da tarefa" required>
        <Textarea
          rows={2}
          className={inputCls}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          placeholder="O que precisa ser feito?"
          autoFocus
        />
      </Field>
      <Field label="Data" required>
        <DateTimePicker value={f.due_date} onChange={(v) => setF({ ...f, due_date: v })} />
      </Field>
      <Field label="Responsável" required>
        <MembersSelect
          value={f.assigned_to}
          onChange={(v) => setF({ ...f, assigned_to: v })}
          members={ctx.members}
        />
      </Field>
      <Field label="Processo / caso vinculado">
        <CaseSelect
          value={f.case_id}
          onChange={(v) => setF({ ...f, case_id: v })}
          cases={ctx.cases}
        />
      </Field>
      <Field label="Observações">
        <Textarea
          rows={2}
          className={inputCls}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Notas adicionais..."
        />
      </Field>
    </ModalShell>
  );
}

// =================== EVENT ===================
export function AddEventModal({
  open,
  onOpenChange,
  ctx,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ModalCtx;
  defaultDate?: Date;
}) {
  const [f, setF] = useState({
    title: "",
    description: "",
    starts_at: defaultDate ? toLocalInput(defaultDate) : "",
    ends_at: "",
    all_day: false,
    location: "",
    location_kind: "presencial",
    case_id: "",
    assigned_to: "",
  });
  const m = useMutation({
    mutationFn: async () => {
      if (!ctx.companyId || !ctx.userId) throw new Error("Empresa não selecionada");
      if (!f.title.trim()) throw new Error("Título é obrigatório");
      if (!f.starts_at) throw new Error("Data de início é obrigatória");
      const start = new Date(f.starts_at);
      const end = f.ends_at ? new Date(f.ends_at) : null;
      if (f.all_day) start.setHours(0, 0, 0, 0);

      const validCreatedBy = isUuid(ctx.userId) ? ctx.userId : ensureValidUuid(ctx.userId);
      const validCompanyId = isUuid(ctx.companyId) ? ctx.companyId : ensureValidUuid(ctx.companyId);
      const validAssignedTo = f.assigned_to && isUuid(f.assigned_to) ? f.assigned_to : toValidUuid(f.assigned_to);
      const validCaseId = f.case_id && isUuid(f.case_id) ? f.case_id : toValidUuid(f.case_id);
      const location = f.location
        ? `${f.location}${f.location_kind !== "presencial" ? ` (${f.location_kind})` : ""}`
        : null;

      const insertedId = crypto.randomUUID();

      // Salva na camada local imediatamente (0ms)
      saveStoredLocalEvent(
        {
          id: insertedId,
          title: f.title.trim(),
          description: f.description || null,
          event_type: "meeting",
          starts_at: start.toISOString(),
          ends_at: end ? end.toISOString() : null,
          location,
          case_id: f.case_id || null,
          assigned_to: f.assigned_to || null,
        },
        validCompanyId,
      );

      // Sincronização remota em background
      void (async () => {
        try {
          const { data: authData } = await supabase.auth.getUser();
          const supabaseAuthId = authData?.user?.id;
          const remoteCreatedBy = supabaseAuthId && isUuid(supabaseAuthId) ? supabaseAuthId : validCreatedBy;

          const { error } = await supabase.from("events").insert({
            id: insertedId,
            company_id: validCompanyId,
            created_by: remoteCreatedBy,
            title: f.title.trim(),
            description: f.description || null,
            event_type: "meeting",
            starts_at: start.toISOString(),
            ends_at: end ? end.toISOString() : null,
            location,
            case_id: validCaseId,
            assigned_to: validAssignedTo,
          });

          if (error) {
            await supabase.from("events").insert({
              id: insertedId,
              company_id: validCompanyId,
              created_by: remoteCreatedBy,
              title: f.title.trim(),
              description: f.description || null,
              event_type: "meeting",
              starts_at: start.toISOString(),
              ends_at: end ? end.toISOString() : null,
              location,
            });
          }
        } catch {}
      })();
    },
    onSuccess: () => {
      toast.success("Evento criado com sucesso");
      ctx.onSaved();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar Evento"
      onSave={() => m.mutate()}
      saving={m.isPending}
    >
      <Field label="Título do evento" required>
        <Input
          className={inputCls}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          autoFocus
          placeholder="Ex.: Reunião com cliente"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início" required>
          <DateTimePicker
            value={f.starts_at}
            onChange={(v) => setF({ ...f, starts_at: v })}
            disabled={f.all_day}
          />
        </Field>
        <Field label="Fim">
          <DateTimePicker
            value={f.ends_at}
            onChange={(v) => setF({ ...f, ends_at: v })}
            disabled={f.all_day}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={f.all_day}
          onCheckedChange={(v) => setF({ ...f, all_day: !!v })}
          className="border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
        />
        Dia todo
      </label>
      <div className="grid grid-cols-[1fr_180px] gap-3">
        <Field label="Local">
          <Input
            className={inputCls}
            value={f.location}
            onChange={(e) => setF({ ...f, location: e.target.value })}
            placeholder="Endereço, sala ou link"
          />
        </Field>
        <Field label="Modalidade">
          <Select value={f.location_kind} onValueChange={(v) => setF({ ...f, location_kind: v })}>
            <SelectTrigger className={selectTrigCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={selectCntCls}>
              <SelectItem value="presencial">Presencial</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="hibrido">Híbrido</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Responsável">
          <MembersSelect
            value={f.assigned_to}
            onChange={(v) => setF({ ...f, assigned_to: v })}
            members={ctx.members}
          />
        </Field>
        <Field label="Processo vinculado">
          <CaseSelect
            value={f.case_id}
            onChange={(v) => setF({ ...f, case_id: v })}
            cases={ctx.cases}
          />
        </Field>
      </div>
      <Field label="Descrição">
        <Textarea
          rows={3}
          className={inputCls}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>
    </ModalShell>
  );
}

// =================== DEADLINE (Prazo) ===================
export function AddDeadlineModal({
  open,
  onOpenChange,
  ctx,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ModalCtx;
  defaultDate?: Date;
}) {
  const [f, setF] = useState({
    title: "",
    kind: "fatal",
    due_date: defaultDate ? toLocalDate(defaultDate) : "",
    hour_limit: "18:00",
    case_id: "",
    assigned_to: "",
    is_double_term: false,
    description: "",
  });
  const m = useMutation({
    mutationFn: async () => {
      if (!ctx.companyId || !ctx.userId) throw new Error("Empresa não selecionada");
      if (!f.title.trim()) throw new Error("Descrição é obrigatória");
      if (!f.due_date) throw new Error("Data fatal é obrigatória");
      if (!f.case_id) throw new Error("Processo vinculado é obrigatório");
      if (!f.assigned_to) throw new Error("Responsável é obrigatório");
      const meta =
        `[${f.kind.toUpperCase()} • limite ${f.hour_limit}]\n${f.description ?? ""}`.trim();

      const { data: authData } = await supabase.auth.getUser();
      const supabaseAuthId = authData?.user?.id;
      const validCreatedBy = supabaseAuthId && isUuid(supabaseAuthId) ? supabaseAuthId : ensureValidUuid(ctx.userId);
      const validCompanyId = isUuid(ctx.companyId) ? ctx.companyId : ensureValidUuid(ctx.companyId);
      const validAssignedTo = f.assigned_to && isUuid(f.assigned_to) ? f.assigned_to : toValidUuid(f.assigned_to);
      const validCaseId = f.case_id && isUuid(f.case_id) ? f.case_id : toValidUuid(f.case_id);

      const { error } = await supabase.from("deadlines").insert({
        company_id: validCompanyId,
        created_by: validCreatedBy,
        title: f.title.trim(),
        description: meta || null,
        due_date: f.due_date,
        case_id: validCaseId,
        assigned_to: validAssignedTo,
        is_double_term: f.is_double_term,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Prazo cadastrado com sucesso");
      logClient({ action: "create", entity_type: "prazo", entity_label: f.title.trim() });
      ctx.onSaved();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar Prazo"
      onSave={() => m.mutate()}
      saving={m.isPending}
    >
      <Field label="Descrição do prazo" required>
        <Textarea
          rows={2}
          className={inputCls}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          autoFocus
          placeholder="Ex.: Apresentar contestação"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Tipo" required>
          <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
            <SelectTrigger className={selectTrigCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={selectCntCls}>
              <SelectItem value="fatal">Fatal</SelectItem>
              <SelectItem value="recomendado">Recomendado</SelectItem>
              <SelectItem value="interno">Interno</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Data fatal" required>
          <DateTimePicker
            mode="date"
            value={f.due_date}
            onChange={(v) => setF({ ...f, due_date: v })}
          />
        </Field>
        <Field label="Hora limite">
          <Input
            type="time"
            className={inputCls}
            value={f.hour_limit}
            onChange={(e) => setF({ ...f, hour_limit: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Processo vinculado" required>
        <CaseSelect
          value={f.case_id}
          onChange={(v) => setF({ ...f, case_id: v })}
          cases={ctx.cases}
        />
      </Field>
      <Field label="Responsável" required>
        <MembersSelect
          value={f.assigned_to}
          onChange={(v) => setF({ ...f, assigned_to: v })}
          members={ctx.members}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={f.is_double_term}
          onCheckedChange={(v) => setF({ ...f, is_double_term: !!v })}
          className="border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
        />
        Prazo em dobro
      </label>
      <Field label="Observações">
        <Textarea
          rows={2}
          className={inputCls}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>
    </ModalShell>
  );
}

// =================== HEARING (Audiência) ===================
export function AddHearingModal({
  open,
  onOpenChange,
  ctx,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ModalCtx;
  defaultDate?: Date;
}) {
  const [f, setF] = useState({
    title: "",
    hearing_kind: "instrucao",
    starts_at: defaultDate ? toLocalInput(defaultDate) : "",
    duration_min: "60",
    case_id: "",
    court: "",
    is_virtual: false,
    location: "",
    assigned_to: "",
    counterparty: "",
    description: "",
  });
  const m = useMutation({
    mutationFn: async () => {
      if (!ctx.companyId || !ctx.userId) throw new Error("Empresa não selecionada");
      if (!f.starts_at) throw new Error("Data e hora obrigatórias");
      if (!f.case_id) throw new Error("Processo vinculado é obrigatório");
      if (!f.court.trim()) throw new Error("Vara/Tribunal é obrigatório");
      if (!f.assigned_to) throw new Error("Advogado responsável é obrigatório");
      const start = new Date(f.starts_at);
      const end = new Date(start.getTime() + Number(f.duration_min) * 60_000);
      const titleFinal = f.title.trim() || `Audiência de ${labelHearing(f.hearing_kind)}`;
      const desc = [
        `[Tipo: ${labelHearing(f.hearing_kind)}]`,
        f.counterparty ? `Parte contrária: ${f.counterparty}` : null,
        f.description || null,
      ]
        .filter(Boolean)
        .join("\n");
      const locFinal = f.is_virtual
        ? `🔗 ${f.location || ""} (virtual)`
        : `${f.court} • ${f.location || ""}`.trim();

      const validCreatedBy = isUuid(ctx.userId) ? ctx.userId : ensureValidUuid(ctx.userId);
      const validCompanyId = isUuid(ctx.companyId) ? ctx.companyId : ensureValidUuid(ctx.companyId);
      const validAssignedTo = f.assigned_to && isUuid(f.assigned_to) ? f.assigned_to : toValidUuid(f.assigned_to);
      const validCaseId = f.case_id && isUuid(f.case_id) ? f.case_id : toValidUuid(f.case_id);

      const insertedId = crypto.randomUUID();

      // Salva na camada local imediatamente (0ms)
      saveStoredLocalEvent(
        {
          id: insertedId,
          title: titleFinal,
          description: desc || null,
          event_type: "hearing",
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          location: locFinal,
          case_id: f.case_id || null,
          assigned_to: f.assigned_to || null,
        },
        validCompanyId,
      );

      // Sincronização remota em background
      void (async () => {
        try {
          const { data: authData } = await supabase.auth.getUser();
          const supabaseAuthId = authData?.user?.id;
          const remoteCreatedBy = supabaseAuthId && isUuid(supabaseAuthId) ? supabaseAuthId : validCreatedBy;

          const { error } = await supabase.from("events").insert({
            id: insertedId,
            company_id: validCompanyId,
            created_by: remoteCreatedBy,
            title: titleFinal,
            description: desc || null,
            event_type: "hearing",
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            location: locFinal,
            case_id: validCaseId,
            assigned_to: validAssignedTo,
          });

          if (error) {
            await supabase.from("events").insert({
              id: insertedId,
              company_id: validCompanyId,
              created_by: remoteCreatedBy,
              title: titleFinal,
              description: desc || null,
              event_type: "hearing",
              starts_at: start.toISOString(),
              ends_at: end.toISOString(),
              location: locFinal,
            });
          }
        } catch {}
      })();
    },
    onSuccess: () => {
      toast.success("Audiência agendada com sucesso");
      ctx.onSaved();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar Audiência"
      onSave={() => m.mutate()}
      saving={m.isPending}
    >
      <Field label="Título (opcional)">
        <Input
          className={inputCls}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          placeholder="Deixe em branco para usar o tipo da audiência"
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo de audiência" required>
          <Select value={f.hearing_kind} onValueChange={(v) => setF({ ...f, hearing_kind: v })}>
            <SelectTrigger className={selectTrigCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={selectCntCls}>
              <SelectItem value="conciliacao">Conciliação</SelectItem>
              <SelectItem value="instrucao">Instrução</SelectItem>
              <SelectItem value="julgamento">Julgamento</SelectItem>
              <SelectItem value="una">Una</SelectItem>
              <SelectItem value="inicial">Inicial</SelectItem>
              <SelectItem value="virtual">Virtual</SelectItem>
              <SelectItem value="outra">Outra</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Duração (min)">
          <Input
            type="number"
            min={15}
            step={15}
            className={inputCls}
            value={f.duration_min}
            onChange={(e) => setF({ ...f, duration_min: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Data e hora" required>
        <DateTimePicker value={f.starts_at} onChange={(v) => setF({ ...f, starts_at: v })} />
      </Field>
      <Field label="Processo vinculado" required>
        <CaseSelect
          value={f.case_id}
          onChange={(v) => setF({ ...f, case_id: v })}
          cases={ctx.cases}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vara / Tribunal" required>
          <Input
            className={inputCls}
            value={f.court}
            onChange={(e) => setF({ ...f, court: e.target.value })}
            placeholder="Ex.: 3ª Vara Cível de SP"
          />
        </Field>
        <Field label={f.is_virtual ? "Link da sessão" : "Endereço / Sala"}>
          <Input
            className={inputCls}
            value={f.location}
            onChange={(e) => setF({ ...f, location: e.target.value })}
            placeholder={f.is_virtual ? "https://..." : "Ex.: Sala 304"}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={f.is_virtual}
          onCheckedChange={(v) => setF({ ...f, is_virtual: !!v })}
          className="border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
        />
        Audiência virtual
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Advogado responsável" required>
          <MembersSelect
            value={f.assigned_to}
            onChange={(v) => setF({ ...f, assigned_to: v })}
            members={ctx.members}
          />
        </Field>
        <Field label="Parte contrária">
          <Input
            className={inputCls}
            value={f.counterparty}
            onChange={(e) => setF({ ...f, counterparty: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Observações">
        <Textarea
          rows={2}
          className={inputCls}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>
    </ModalShell>
  );
}

function labelHearing(k: string) {
  return (
    (
      {
        conciliacao: "Conciliação",
        instrucao: "Instrução",
        julgamento: "Julgamento",
        una: "Una",
        inicial: "Inicial",
        virtual: "Virtual",
        outra: "Outra",
      } as Record<string, string>
    )[k] ?? "Audiência"
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// =================== Wrapper ===================
export function CreateModalRouter({
  kind,
  ctx,
  defaultDate,
}: {
  kind: CreateKind | null;
  ctx: ModalCtx;
  defaultDate?: Date;
}) {
  const open = !!kind;
  if (kind === "tarefa")
    return (
      <NovoAgendamentoDialog
        open={open}
        onOpenChange={(v) => !v && ctx.onClose()}
        defaultDate={defaultDate}
        onSaved={ctx.onSaved}
      />
    );
  if (kind === "evento")
    return (
      <AddEventModal
        open={open}
        onOpenChange={(v) => !v && ctx.onClose()}
        ctx={ctx}
        defaultDate={defaultDate}
      />
    );
  if (kind === "prazo")
    return (
      <AddDeadlineModal
        open={open}
        onOpenChange={(v) => !v && ctx.onClose()}
        ctx={ctx}
        defaultDate={defaultDate}
      />
    );
  if (kind === "audiencia")
    return (
      <AddHearingModal
        open={open}
        onOpenChange={(v) => !v && ctx.onClose()}
        ctx={ctx}
        defaultDate={defaultDate}
      />
    );
  return null;
}

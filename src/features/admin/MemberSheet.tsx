import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, History, Info, KeyRound, Lock, LogOut, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { qk } from "@/lib/query-keys";
import {
  fetchAuditPage,
  setUserPassword,
  toAdminError,
  updateMemberAccess,
  type AdminMember,
  type AdminOverview,
} from "./admin-api";
import { Avatar, StatusBadge } from "./AdminBadges";
import {
  canGrantPermission,
  formatDateTime,
  formatRelative,
  isOwnerRole,
  memberBlockReason,
  roleDisplayName,
  sameSet,
  type ActorContext,
} from "./admin-helpers";
import { PermissionMatrix } from "./PermissionMatrix";
import type { StatusAction } from "./StatusDialog";
import {
  AGENDA_SCOPE_LABEL,
  AUDIT_ACTION_LABEL,
  adjustmentsFor,
  closure,
  describeAuditChange,
  effectivePermissions,
  grantsSensitiveAccess,
  isSubset,
  type AgendaScope,
} from "./permissions";

const NONE = "__none__";

export function MemberSheet({
  member,
  overview,
  actor,
  onClose,
  onRequestStatus,
  onSaved,
}: {
  member: AdminMember | null;
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onRequestStatus: (action: Exclude<StatusAction, "cancel_invite">, member: AdminMember) => void;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <Sheet open={!!member} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {member && (
          <MemberEditor
            key={`${member.id}:${member.version}`}
            member={member}
            overview={overview}
            actor={actor}
            onClose={onClose}
            onRequestStatus={onRequestStatus}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function MemberEditor({
  member,
  overview,
  actor,
  onClose,
  onRequestStatus,
  onSaved,
}: {
  member: AdminMember;
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onRequestStatus: (action: Exclude<StatusAction, "cancel_invite">, member: AdminMember) => void;
  onSaved: () => Promise<void> | void;
}) {
  const rolesById = useMemo(() => new Map(overview.roles.map((r) => [r.id, r])), [overview.roles]);
  const blockReason = memberBlockReason(actor, member, rolesById);
  const readOnly = !!blockReason || member.status === "removed";

  const [roleId, setRoleId] = useState(member.roleId ?? "");
  const [desired, setDesired] = useState<string[]>(member.effective);
  const [doctorId, setDoctorId] = useState(member.doctorId ?? NONE);
  const [agendaScope, setAgendaScope] = useState<AgendaScope>(member.agendaScope);
  const [agendaIds, setAgendaIds] = useState<string[]>(member.agendaProfessionalIds);
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const role = rolesById.get(roleId);
  const ownerSelected = isOwnerRole(role);
  const basePermissions = role ? closure(role.permissions) : [];
  const adjustments = adjustmentsFor(basePermissions, desired);
  const nextEffective = role
    ? effectivePermissions(role.permissions, adjustments.extra, adjustments.revoked)
    : [];

  const roleOptions = overview.roles.map((r) => {
    const allowed =
      (!isOwnerRole(r) || actor.isOwner) &&
      (actor.isOwner || isSubset(effectivePermissions(r.permissions), actor.permissions));
    return { role: r, allowed };
  });

  const takenDoctors = new Set(
    overview.members
      .filter((m) => m.id !== member.id && m.status !== "removed" && m.doctorId)
      .map((m) => m.doctorId as string),
  );
  const professionalOptions = overview.professionals.filter(
    (p) =>
      p.id === member.doctorId ||
      (p.active &&
        (!p.linkedUserId || p.linkedUserId === member.userId) &&
        !takenDoctors.has(p.id)),
  );
  const agendaOptions = [
    ...overview.professionals
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, label: p.name, hint: p.specialty ?? "Profissional" })),
    ...overview.members
      .filter((m) => m.status === "active" && m.id !== member.id)
      .map((m) => ({ id: m.userId, label: m.fullName, hint: "Usuário" })),
  ].filter((option, index, all) => all.findIndex((o) => o.id === option.id) === index);

  const dirty =
    roleId !== (member.roleId ?? "") ||
    !sameSet(nextEffective, member.effective) ||
    (doctorId === NONE ? null : doctorId) !== member.doctorId ||
    agendaScope !== member.agendaScope ||
    (agendaScope === "selected" && !sameSet(agendaIds, member.agendaProfessionalIds));
  const agendaInvalid = agendaScope === "selected" && agendaIds.length === 0;
  const canSave = !readOnly && !!role && dirty && !agendaInvalid && member.status !== "pending";

  const history = useQuery({
    queryKey: qk.admin.memberHistory(overview.company.id, member.userId),
    enabled: actor.canViewAudit,
    queryFn: () => fetchAuditPage(overview.company.id, { targetUserId: member.userId }, null, 8),
    staleTime: 15_000,
  });

  const changeRole = (id: string) => {
    const next = rolesById.get(id);
    setRoleId(id);
    setDesired(next ? effectivePermissions(next.permissions) : []);
  };

  const save = async () => {
    if (!role) return;
    let confirmSensitive = false;
    if (grantsSensitiveAccess(role.permissions, nextEffective, member.effective)) {
      const ok = await confirmDialog({
        title: "Liberar acesso ao prontuário?",
        description:
          "O perfil desta pessoa não é clínico. O prontuário contém dados de saúde protegidos pela LGPD; a liberação ficará registrada na auditoria.",
        confirmText: "Liberar acesso",
        destructive: false,
      });
      if (!ok) return;
      confirmSensitive = true;
    }
    setSaving(true);
    try {
      await updateMemberAccess({
        memberId: member.id,
        version: member.version,
        roleId: role.id,
        extra: ownerSelected ? [] : adjustments.extra,
        revoked: ownerSelected ? [] : adjustments.revoked,
        doctorId: doctorId === NONE ? null : doctorId,
        agendaScope,
        agendaProfessionalIds: agendaIds,
        confirmSensitive,
      });
      toast.success("Acesso atualizado.");
      await onSaved();
      onClose();
    } catch (error) {
      const err = toAdminError(error);
      toast.error(err.message);
      if (err.hint === "admin.stale") await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    const ok = await confirmDialog({
      title: "Alterar senha do usuário",
      message: `Deseja definir esta nova senha para ${member.fullName}? A pessoa poderá fazer login imediatamente com a nova senha.`,
      confirmText: "Alterar senha",
      variant: "default",
    });
    if (!ok) return;

    setChangingPassword(true);
    try {
      await setUserPassword(overview.company.id, member.userId, newPassword);
      toast.success(`Senha de ${member.fullName} alterada com sucesso!`);
      setNewPassword("");
      await onSaved();
    } catch (error) {
      toast.error(toAdminError(error).message);
    } finally {
      setChangingPassword(false);
    }
  };

  const statusActions: {
    action: Exclude<StatusAction, "cancel_invite">;
    label: string;
    tone?: "danger";
  }[] = member.isSelf
    ? []
    : member.status === "pending"
      ? [
          { action: "approve", label: "Aprovar" },
          { action: "reject", label: "Recusar", tone: "danger" },
        ]
      : member.status === "active"
        ? [
            ...(actor.isOwner && !isOwnerRole(rolesById.get(member.roleId ?? ""))
              ? [{ action: "transfer" as const, label: "Transferir propriedade" }]
              : []),
            { action: "suspend", label: "Suspender", tone: "danger" },
            { action: "remove", label: "Remover", tone: "danger" },
          ]
        : member.status === "suspended"
          ? [
              { action: "reactivate", label: "Reativar" },
              { action: "remove", label: "Remover", tone: "danger" },
            ]
          : [{ action: "restore", label: "Restaurar acesso" }];

  return (
    <>
      <SheetHeader className="space-y-3 border-b border-slate-200 p-5 pr-12 text-left">
        <div className="flex items-start gap-3">
          <Avatar name={member.fullName} className="h-11 w-11 text-sm" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-base">{member.fullName}</SheetTitle>
            <SheetDescription className="truncate">{member.email ?? "Sem e-mail"}</SheetDescription>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={member.status} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                {roleDisplayName(rolesById.get(member.roleId ?? ""))}
              </span>
              {member.isSelf && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                  Você
                </span>
              )}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-[12px] text-slate-600">
          <div>
            <dt className="text-slate-400">Último acesso</dt>
            <dd>{formatRelative(member.lastSignInAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">No sistema desde</dt>
            <dd>{formatDateTime(member.createdAt)}</dd>
          </div>
        </dl>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {blockReason && (
          <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
            <Lock size={16} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
            {blockReason}
          </p>
        )}
        {member.status === "pending" && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Cadastro aguardando aprovação. Use “Aprovar” para escolher o perfil.
              {member.suggestedDoctor && (
                <> O e-mail coincide com o profissional {member.suggestedDoctor.name}.</>
              )}
              {!member.emailConfirmed && " O e-mail ainda não foi confirmado."}
            </span>
          </p>
        )}
        {member.status !== "active" && member.statusReason && (
          <p className="text-[12px] text-slate-500">Motivo registrado: {member.statusReason}</p>
        )}

        <section aria-labelledby="member-role" className="space-y-2">
          <h3 id="member-role" className="text-sm font-semibold text-slate-900">
            Perfil de acesso
          </h3>
          <Select
            value={roleId}
            onValueChange={changeRole}
            disabled={readOnly || member.status === "pending"}
          >
            <SelectTrigger aria-labelledby="member-role">
              <SelectValue placeholder="Sem perfil" />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map(({ role: r, allowed }) => (
                <SelectItem key={r.id} value={r.id} disabled={!allowed}>
                  {roleDisplayName(r)}
                  {r.isSystem ? "" : " (personalizado)"}
                  {allowed ? "" : " — acima das suas permissões"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {role?.description && <p className="text-xs text-slate-500">{role.description}</p>}
        </section>

        <section aria-labelledby="member-permissions" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="member-permissions" className="text-sm font-semibold text-slate-900">
              Permissões
            </h3>
            <p className="text-[12px] text-slate-500">
              {adjustments.extra.length + adjustments.revoked.length === 0
                ? "Igual ao perfil"
                : `${adjustments.extra.length} adicionada(s), ${adjustments.revoked.length} removida(s) em relação ao perfil`}
            </p>
          </div>
          {ownerSelected && (
            <p className="text-xs text-slate-500">Proprietários sempre têm acesso total.</p>
          )}
          <PermissionMatrix
            idPrefix={`member-${member.id}`}
            value={nextEffective}
            baseline={basePermissions}
            readOnly={readOnly || ownerSelected || !role || member.status === "pending"}
            canGrant={(key) => canGrantPermission(actor, key)}
            onChange={setDesired}
          />
        </section>

        <section aria-labelledby="member-doctor" className="space-y-2">
          <h3
            id="member-doctor"
            className="flex items-center gap-2 text-sm font-semibold text-slate-900"
          >
            <Stethoscope size={15} aria-hidden="true" />
            Profissional vinculado
          </h3>
          <Select
            value={doctorId}
            onValueChange={setDoctorId}
            disabled={readOnly || member.status === "pending"}
          >
            <SelectTrigger aria-labelledby="member-doctor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nenhum</SelectItem>
              {professionalOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.specialty ? ` · ${p.specialty}` : ""}
                  {p.active ? "" : " (inativo)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            Liga a conta ao cadastro de profissionais (agenda, comissões e autoria clínica).
          </p>
        </section>

        <section aria-labelledby="member-agenda" className="space-y-2">
          <h3 id="member-agenda" className="text-sm font-semibold text-slate-900">
            Agenda visível
          </h3>
          <RadioGroup
            value={agendaScope}
            onValueChange={(value) => setAgendaScope(value as AgendaScope)}
            disabled={readOnly || member.status === "pending"}
            aria-labelledby="member-agenda"
            className="gap-2"
          >
            {(Object.keys(AGENDA_SCOPE_LABEL) as AgendaScope[]).map((scope) => (
              <div key={scope} className="flex items-center gap-2">
                <RadioGroupItem value={scope} id={`agenda-${member.id}-${scope}`} />
                <Label htmlFor={`agenda-${member.id}-${scope}`} className="font-normal">
                  {AGENDA_SCOPE_LABEL[scope]}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {agendaScope === "selected" && (
            <fieldset className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-3">
              <legend className="sr-only">Profissionais visíveis</legend>
              {agendaOptions.length === 0 && (
                <p className="text-xs text-slate-500">Nenhum profissional cadastrado.</p>
              )}
              {agendaOptions.map((option) => {
                const id = `agenda-pick-${member.id}-${option.id}`;
                return (
                  <div key={option.id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={agendaIds.includes(option.id)}
                      disabled={readOnly}
                      onCheckedChange={(checked) =>
                        setAgendaIds((current) =>
                          checked === true
                            ? [...current, option.id]
                            : current.filter((value) => value !== option.id),
                        )
                      }
                    />
                    <label htmlFor={id} className="text-[13px] text-slate-700">
                      {option.label} <span className="text-slate-400">· {option.hint}</span>
                    </label>
                  </div>
                );
              })}
            </fieldset>
          )}
          {agendaInvalid && (
            <p className="text-xs text-rose-700">Selecione ao menos um profissional.</p>
          )}
          <p className="text-xs text-slate-500">
            Filtra a exibição da agenda. A própria agenda e os compromissos sem responsável sempre
            aparecem.
          </p>
        </section>

        {!member.isSelf && !blockReason && member.status !== "removed" && (
          <section
            aria-labelledby="member-password-change"
            className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
          >
            <div className="flex items-center gap-2">
              <KeyRound size={16} className="text-slate-600" aria-hidden="true" />
              <h3 id="member-password-change" className="text-sm font-semibold text-slate-900">
                Alterar senha de acesso
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Defina uma nova senha para que este usuário possa fazer login no MedCore imediatamente.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nova senha (mínimo 6 dígitos)"
                  minLength={6}
                  disabled={changingPassword}
                  className="bg-white pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  title={showPassword ? "Ocultar senha" : "Ver senha"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleUpdatePassword()}
                disabled={changingPassword || newPassword.length < 6}
              >
                {changingPassword ? "Salvando…" : "Salvar nova senha"}
              </Button>
            </div>
          </section>
        )}

        {actor.canViewAudit && (
          <section aria-labelledby="member-history" className="space-y-2">
            <h3
              id="member-history"
              className="flex items-center gap-2 text-sm font-semibold text-slate-900"
            >
              <History size={15} aria-hidden="true" />
              Histórico recente
            </h3>
            {history.isPending && <p className="text-xs text-slate-500">Carregando histórico…</p>}
            {history.error && (
              <p className="text-xs text-rose-700">{toAdminError(history.error).message}</p>
            )}
            {history.data && history.data.entries.length === 0 && (
              <p className="text-xs text-slate-500">Nenhuma alteração registrada.</p>
            )}
            <ol className="space-y-2">
              {history.data?.entries.map((entry) => (
                <li key={entry.id} className="rounded-lg border border-slate-200 p-2.5 text-[12px]">
                  <p className="font-medium text-slate-800">
                    {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                    <span className="font-normal text-slate-500">
                      {" "}
                      · {formatDateTime(entry.createdAt)} · {entry.actorName}
                    </span>
                  </p>
                  {describeAuditChange(entry.dataBefore, entry.dataAfter).map((line) => (
                    <p key={line} className="text-slate-600">
                      {line}
                    </p>
                  ))}
                  {entry.reason && <p className="text-slate-500">Motivo: {entry.reason}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-4">
        {member.isSelf ? (
          <Button variant="outline" onClick={() => onRequestStatus("leave", member)}>
            <LogOut aria-hidden="true" />
            Sair desta clínica
          </Button>
        ) : (
          !blockReason &&
          statusActions.map(({ action, label, tone }) => (
            <Button
              key={action}
              variant="outline"
              className={tone === "danger" ? "text-rose-700 hover:text-rose-800" : undefined}
              onClick={() => onRequestStatus(action, member)}
            >
              {label}
            </Button>
          ))
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {canSave ? "Cancelar" : "Fechar"}
          </Button>
          {!readOnly && member.status !== "pending" && (
            <Button onClick={() => void save()} disabled={!canSave || saving}>
              {saving ? "Salvando…" : "Salvar alterações"}
            </Button>
          )}
        </div>
      </footer>
    </>
  );
}

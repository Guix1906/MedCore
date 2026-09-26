import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelInvitation,
  leaveCompany,
  setMemberStatus,
  toAdminError,
  transferOwnership,
  updateMemberAccess,
  type AdminInvitation,
  type AdminMember,
  type AdminOverview,
} from "./admin-api";
import { isOwnerRole, roleDisplayName, type ActorContext } from "./admin-helpers";
import { effectivePermissions, isSubset, suggestedRoleKey } from "./permissions";

export type StatusAction =
  | "approve"
  | "reject"
  | "suspend"
  | "reactivate"
  | "remove"
  | "restore"
  | "transfer"
  | "leave"
  | "cancel_invite";

export type StatusRequest =
  | { action: Exclude<StatusAction, "cancel_invite">; member: AdminMember }
  | { action: "cancel_invite"; invitation: AdminInvitation };

const COPY: Record<
  StatusAction,
  {
    title: string;
    description: string;
    confirm: string;
    destructive: boolean;
    reason: "required" | "optional" | "none";
  }
> = {
  approve: {
    title: "Aprovar acesso",
    description: "A pessoa passa a acessar a clínica com o perfil escolhido.",
    confirm: "Aprovar",
    destructive: false,
    reason: "optional",
  },
  reject: {
    title: "Recusar cadastro",
    description: "A conta continua existindo, mas sem acesso a esta clínica.",
    confirm: "Recusar",
    destructive: true,
    reason: "required",
  },
  suspend: {
    title: "Suspender acesso",
    description:
      "O acesso é bloqueado em até um minuto, inclusive em sessões abertas. Histórico e registros são preservados.",
    confirm: "Suspender",
    destructive: true,
    reason: "required",
  },
  reactivate: {
    title: "Reativar acesso",
    description: "A pessoa volta a acessar com o mesmo perfil e ajustes de antes.",
    confirm: "Reativar",
    destructive: false,
    reason: "optional",
  },
  remove: {
    title: "Remover da clínica",
    description:
      "A pessoa perde o acesso. A conta e todo o histórico (autoria de registros e auditoria) são preservados.",
    confirm: "Remover",
    destructive: true,
    reason: "required",
  },
  restore: {
    title: "Restaurar acesso",
    description: "A pessoa volta a acessar a clínica com o perfil escolhido.",
    confirm: "Restaurar",
    destructive: false,
    reason: "optional",
  },
  transfer: {
    title: "Transferir propriedade",
    description:
      "A pessoa escolhida se torna proprietária e você passa a Administrador. Esta ação fica registrada na auditoria.",
    confirm: "Transferir",
    destructive: true,
    reason: "required",
  },
  leave: {
    title: "Sair desta clínica",
    description: "Você perderá o acesso a esta clínica. Para voltar, será preciso um novo convite.",
    confirm: "Sair da clínica",
    destructive: true,
    reason: "optional",
  },
  cancel_invite: {
    title: "Cancelar convite",
    description: "O link enviado deixa de liberar o acesso a esta clínica.",
    confirm: "Cancelar convite",
    destructive: true,
    reason: "optional",
  },
};

export function StatusDialog({
  request,
  overview,
  actor,
  onClose,
  onDone,
}: {
  request: StatusRequest | null;
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {request && (
          <StatusForm
            key={
              request.action === "cancel_invite"
                ? request.invitation.id
                : `${request.member.id}:${request.action}`
            }
            request={request}
            overview={overview}
            actor={actor}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusForm({
  request,
  overview,
  actor,
  onClose,
  onDone,
}: {
  request: StatusRequest;
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const copy = COPY[request.action];
  const member = request.action === "cancel_invite" ? null : request.member;
  const needsRole = request.action === "approve" || request.action === "restore";
  const rolesById = useMemo(() => new Map(overview.roles.map((r) => [r.id, r])), [overview.roles]);

  const grantableRoles = overview.roles.filter(
    (role) =>
      (!isOwnerRole(role) || actor.isOwner) &&
      (actor.isOwner || isSubset(effectivePermissions(role.permissions), actor.permissions)),
  );
  const suggestedRoleId = (() => {
    if (!member) return "";
    if (member.roleId && rolesById.has(member.roleId)) return member.roleId;
    const key = suggestedRoleKey(member.suggestedDoctor?.role);
    const suggested = overview.roles.find((r) => r.isSystem && r.key === key);
    if (suggested && grantableRoles.some((r) => r.id === suggested.id)) return suggested.id;
    return "";
  })();

  const [reason, setReason] = useState("");
  const [roleId, setRoleId] = useState(suggestedRoleId);
  const [linkDoctor, setLinkDoctor] = useState(!!member?.suggestedDoctor);
  const [busy, setBusy] = useState(false);

  const reasonOk = copy.reason !== "required" || reason.trim().length >= 5;
  const roleOk = !needsRole || !!roleId;
  const name =
    member?.fullName ?? (request.action === "cancel_invite" ? request.invitation.email : "");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reasonOk || !roleOk) return;
    setBusy(true);
    try {
      if (request.action === "cancel_invite") {
        await cancelInvitation(request.invitation.id, reason);
        toast.success("Convite cancelado.");
      } else if (request.action === "transfer") {
        await transferOwnership(overview.company.id, request.member.id, reason);
        toast.success(`${request.member.fullName} agora é proprietário(a) da clínica.`);
      } else if (request.action === "leave") {
        await leaveCompany(overview.company.id, reason);
        toast.success("Você saiu da clínica.");
      } else {
        const m = request.member;
        const status =
          request.action === "suspend"
            ? "suspended"
            : request.action === "remove" || request.action === "reject"
              ? "removed"
              : "active";
        const result = await setMemberStatus({
          memberId: m.id,
          version: m.version,
          status,
          reason,
          roleId: needsRole ? roleId : null,
        });
        if (request.action === "approve" && linkDoctor && m.suggestedDoctor) {
          const role = rolesById.get(roleId);
          if (role) {
            try {
              await updateMemberAccess({
                memberId: m.id,
                version: result.version,
                roleId: role.id,
                extra: [],
                revoked: [],
                doctorId: m.suggestedDoctor.id,
                agendaScope: "all",
                agendaProfessionalIds: [],
              });
            } catch (error) {
              toast.warning(
                `Acesso aprovado, mas o profissional não foi vinculado: ${toAdminError(error).message}`,
              );
            }
          }
        }
        toast.success(
          {
            approve: "Acesso aprovado.",
            reject: "Cadastro recusado.",
            suspend: "Acesso suspenso.",
            reactivate: "Acesso reativado.",
            remove: "Usuário removido da clínica.",
            restore: "Acesso restaurado.",
          }[request.action],
        );
      }
      await onDone();
      onClose();
    } catch (error) {
      const err = toAdminError(error);
      toast.error(err.message);
      if (err.hint === "admin.stale") await onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {name ? <strong className="font-semibold text-foreground">{name}. </strong> : null}
          {copy.description}
        </DialogDescription>
      </DialogHeader>

      {needsRole && (
        <div className="space-y-1.5">
          <Label htmlFor="status-role">Perfil de acesso</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="status-role">
              <SelectValue placeholder="Escolha um perfil" />
            </SelectTrigger>
            <SelectContent>
              {grantableRoles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {roleDisplayName(role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {grantableRoles.length === 0 && (
            <p className="text-xs text-destructive">
              Nenhum perfil está dentro das suas permissões.
            </p>
          )}
        </div>
      )}

      {request.action === "approve" && member?.suggestedDoctor && (
        <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
          <Checkbox
            checked={linkDoctor}
            onCheckedChange={(checked) => setLinkDoctor(checked === true)}
            className="mt-0.5"
          />
          <span>
            Vincular ao profissional <strong>{member.suggestedDoctor.name}</strong> (mesmo e-mail do
            cadastro de profissionais).
          </span>
        </label>
      )}

      {copy.reason !== "none" && (
        <div className="space-y-1.5">
          <Label htmlFor="status-reason">
            Motivo {copy.reason === "required" ? "(obrigatório)" : "(opcional)"}
          </Label>
          <Textarea
            id="status-reason"
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              copy.reason === "required" ? "Descreva o motivo (mínimo 5 caracteres)" : ""
            }
            aria-invalid={!reasonOk}
          />
          <p className="text-xs text-muted-foreground">O motivo fica registrado na auditoria.</p>
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Voltar
        </Button>
        <Button
          type="submit"
          variant={copy.destructive ? "destructive" : "default"}
          disabled={busy || !reasonOk || !roleOk}
        >
          {busy ? "Salvando…" : copy.confirm}
        </Button>
      </DialogFooter>
    </form>
  );
}

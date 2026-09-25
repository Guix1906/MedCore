import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createInvitation,
  sendInvitationEmail,
  toAdminError,
  type AdminOverview,
} from "./admin-api";
import { isOwnerRole, roleDisplayName, type ActorContext } from "./admin-helpers";
import { effectivePermissions, isSubset, isValidEmail, normalizeEmail } from "./permissions";

const NONE = "__none__";

function newRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function InviteDialog({
  open,
  onOpenChange,
  overview,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: AdminOverview;
  actor: ActorContext;
  onDone: () => Promise<void> | void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open && (
          <InviteForm
            overview={overview}
            actor={actor}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  overview,
  actor,
  onClose,
  onDone,
}: {
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const roles = useMemo(
    () =>
      overview.roles.filter(
        (role) =>
          (!isOwnerRole(role) || actor.isOwner) &&
          (actor.isOwner || isSubset(effectivePermissions(role.permissions), actor.permissions)),
      ),
    [overview.roles, actor],
  );
  const takenDoctors = useMemo(
    () =>
      new Set(
        overview.members.filter((m) => m.status !== "removed" && m.doctorId).map((m) => m.doctorId),
      ),
    [overview.members],
  );
  const freeProfessionals = overview.professionals.filter(
    (p) => p.active && !p.linkedUserId && !takenDoctors.has(p.id),
  );

  const [requestId] = useState(newRequestId);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState(
    () => roles.find((r) => r.isSystem && r.key === "reception")?.id ?? roles[0]?.id ?? "",
  );
  const [doctorId, setDoctorId] = useState(NONE);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const emailValid = isValidEmail(email);
  const selectedRole = roles.find((r) => r.id === roleId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!emailValid || !roleId) return;
    setBusy(true);
    try {
      const invitation = await createInvitation({
        companyId: overview.company.id,
        requestId,
        email: normalizeEmail(email),
        fullName: fullName.trim() || null,
        roleId,
        doctorId: doctorId === NONE ? null : doctorId,
      });
      try {
        await sendInvitationEmail(invitation.email, fullName.trim() || null);
        toast.success(`Convite enviado para ${invitation.email}.`);
      } catch (error) {
        toast.warning(
          `Convite registrado, mas o e-mail não foi enviado: ${toAdminError(error).message}`,
          { duration: 9000 },
        );
      }
      await onDone();
      onClose();
    } catch (error) {
      toast.error(toAdminError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>Convidar usuário</DialogTitle>
        <DialogDescription>
          A pessoa recebe um link de acesso por e-mail. O acesso só é liberado quando ela entra com
          esse e-mail e aceita o convite. Convites expiram em 7 dias.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="invite-email">E-mail</Label>
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="nome@clinica.com.br"
          aria-invalid={touched && !emailValid}
          aria-describedby="invite-email-error"
          required
        />
        {touched && !emailValid && (
          <p id="invite-email-error" className="text-xs text-rose-700">
            Informe um e-mail válido.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-name">Nome (opcional)</Label>
        <Input
          id="invite-name"
          value={fullName}
          maxLength={120}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Como a pessoa aparecerá no sistema"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-role">Perfil de acesso</Label>
        <Select value={roleId} onValueChange={setRoleId}>
          <SelectTrigger id="invite-role">
            <SelectValue placeholder="Escolha um perfil" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {roleDisplayName(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRole?.description && (
          <p className="text-xs text-slate-500">{selectedRole.description}</p>
        )}
        <p className="text-[11px] text-slate-500">
          Ajustes individuais podem ser feitos depois que o convite for aceito.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-doctor">Profissional vinculado (opcional)</Label>
        <Select value={doctorId} onValueChange={setDoctorId}>
          <SelectTrigger id="invite-doctor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Nenhum</SelectItem>
            {freeProfessionals.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.specialty ? ` · ${p.specialty}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy || !roleId}>
          {busy ? "Enviando…" : "Enviar convite"}
        </Button>
      </DialogFooter>
    </form>
  );
}

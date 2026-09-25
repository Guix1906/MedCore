import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Mail, Sparkles, UserPlus } from "lucide-react";
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
  createDirectUser,
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

function generateSecurePassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  let pwd = "";
  const randomValues = new Uint32Array(10);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 10; i++) {
    pwd += chars[randomValues[i] % chars.length];
  }
  return pwd;
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

  const [mode, setMode] = useState<"direct" | "invite">("direct");
  const [requestId] = useState(newRequestId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState(
    () => roles.find((r) => r.isSystem && r.key === "reception")?.id ?? roles[0]?.id ?? "",
  );
  const [doctorId, setDoctorId] = useState(NONE);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const emailValid = isValidEmail(email);
  const passwordValid = mode === "invite" || password.length >= 6;
  const passwordMatch = mode === "invite" || password === confirmPassword;
  const selectedRole = roles.find((r) => r.id === roleId);

  const handleGeneratePassword = () => {
    const generated = generateSecurePassword();
    setPassword(generated);
    setConfirmPassword(generated);
    setShowPassword(true);
    toast.info("Senha gerada automaticamente.");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!emailValid || !roleId) return;

    if (mode === "direct") {
      if (!passwordValid) {
        toast.error("A senha deve ter no mínimo 6 caracteres.");
        return;
      }
      if (!passwordMatch) {
        toast.error("As senhas não coincidem.");
        return;
      }

      setBusy(true);
      try {
        await createDirectUser({
          companyId: overview.company.id,
          email: normalizeEmail(email),
          password,
          fullName: fullName.trim() || email.split("@")[0],
          roleId,
          doctorId: doctorId === NONE ? null : doctorId,
        });

        toast.success(`Usuário ${email} cadastrado com sucesso!`);
        await onDone();
        onClose();
      } catch (error) {
        toast.error(toAdminError(error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Modo convite por e-mail
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
        <DialogTitle className="flex items-center gap-2">
          <UserPlus size={20} className="text-primary" />
          {mode === "direct" ? "Cadastrar usuário e senha" : "Convidar por e-mail"}
        </DialogTitle>
        <DialogDescription>
          {mode === "direct"
            ? "Defina o e-mail e a senha de acesso para que o usuário entre imediatamente no MedCore."
            : "A pessoa recebe um link de acesso por e-mail para cadastrar a própria senha."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("direct")}
          className={`flex-1 rounded-md py-1.5 font-medium transition ${
            mode === "direct"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <KeyRound size={13} />
            Definir e-mail e senha
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode("invite")}
          className={`flex-1 rounded-md py-1.5 font-medium transition ${
            mode === "invite"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Mail size={13} />
            Enviar convite por e-mail
          </span>
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-name">Nome completo</Label>
        <Input
          id="invite-name"
          value={fullName}
          maxLength={120}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Ex: Dra. Juliana Mendes"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-email">E-mail de acesso</Label>
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

      {mode === "direct" && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="invite-password">Senha de acesso</Label>
            <button
              type="button"
              onClick={handleGeneratePassword}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <Sparkles size={12} />
              Gerar senha forte
            </button>
          </div>
          <div className="relative">
            <Input
              id="invite-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo de 6 dígitos"
              minLength={6}
              required
              className="pr-10 bg-white"
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

          <div className="space-y-1">
            <Label htmlFor="invite-password-confirm" className="text-xs text-slate-600">
              Confirmar senha
            </Label>
            <Input
              id="invite-password-confirm"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite a mesma senha novamente"
              minLength={6}
              required
              className="bg-white"
            />
            {touched && !passwordMatch && (
              <p className="text-xs text-rose-600">As senhas não coincidem.</p>
            )}
          </div>
        </div>
      )}

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
        <p className="text-[11px] text-slate-500">
          Associa a conta a um profissional clínico para prontuário, agendamentos e comissões.
        </p>
      </div>

      <DialogFooter className="gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy || !roleId}>
          {busy
            ? "Salvando…"
            : mode === "direct"
              ? "Cadastrar usuário"
              : "Enviar convite"}
        </Button>
      </DialogFooter>
    </form>
  );
}

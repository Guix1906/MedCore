import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, Copy, Eye, Pencil, Plus, ShieldCheck } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveRole,
  saveRole,
  toAdminError,
  type AdminOverview,
  type AdminRole,
} from "./admin-api";
import {
  canGrantPermission,
  isOwnerRole,
  roleDisplayName,
  type ActorContext,
} from "./admin-helpers";
import { PermissionMatrix } from "./PermissionMatrix";
import {
  PERMISSIONS,
  closure,
  effectivePermissions,
  isSubset,
  moduleLabel,
  permissionsByModule,
} from "./permissions";

type Draft = { role: AdminRole | null; basedOn: AdminRole | null };

export function RolesTab({
  overview,
  actor,
  onRefresh,
}: {
  overview: AdminOverview;
  actor: ActorContext;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<AdminRole | null>(null);
  const [archiving, setArchiving] = useState<AdminRole | null>(null);

  const startDuplicate = (role: AdminRole) => setDraft({ role: null, basedOn: role });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Perfis do sistema são fixos. Para personalizar, duplique um perfil e ajuste as permissões.
          Alterações em um perfil valem para todos que o utilizam.
        </p>
        {actor.canManageRoles && (
          <Button onClick={() => setDraft({ role: null, basedOn: null })}>
            <Plus aria-hidden="true" />
            Novo perfil
          </Button>
        )}
      </div>

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {overview.roles.map((role) => {
          const effective = effectivePermissions(role.permissions);
          const effectiveSet = new Set<string>(effective);
          const modules = permissionsByModule()
            .filter((m) => m.items.some((item) => effectiveSet.has(item.key)))
            .map((m) => m.label);
          const canEdit =
            actor.canManageRoles &&
            !role.isSystem &&
            role.id !== actor.roleId &&
            (actor.isOwner || isSubset(effective, actor.permissions));
          return (
            <li
              key={role.id}
              className="flex flex-col rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    {isOwnerRole(role) && (
                      <ShieldCheck size={16} className="text-primary" aria-hidden="true" />
                    )}
                    <span className="truncate">{roleDisplayName(role)}</span>
                  </p>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {role.isSystem ? "Perfil do sistema" : "Personalizado"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80">
                  {role.memberCount} {role.memberCount === 1 ? "usuário" : "usuários"}
                </span>
              </div>
              {role.description && (
                <p className="mt-2 text-sm text-muted-foreground">{role.description}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {effective.length} de {PERMISSIONS.length} permissões ·{" "}
                {modules.join(", ") || "nenhum módulo"}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDraft({ role, basedOn: null })}
                  >
                    <Pencil aria-hidden="true" />
                    Editar
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setViewing(role)}>
                    <Eye aria-hidden="true" />
                    Ver permissões
                  </Button>
                )}
                {actor.canManageRoles && !isOwnerRole(role) && (
                  <Button size="sm" variant="ghost" onClick={() => startDuplicate(role)}>
                    <Copy aria-hidden="true" />
                    Duplicar
                  </Button>
                )}
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setArchiving(role)}
                  >
                    <Archive aria-hidden="true" />
                    Arquivar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <RoleComparison overview={overview} />

      <RoleEditor
        draft={draft}
        overview={overview}
        actor={actor}
        onClose={() => setDraft(null)}
        onSaved={onRefresh}
      />
      <RoleViewer role={viewing} onClose={() => setViewing(null)} />
      <ArchiveRoleDialog
        role={archiving}
        overview={overview}
        actor={actor}
        onClose={() => setArchiving(null)}
        onDone={onRefresh}
      />
    </div>
  );
}

function RoleComparison({ overview }: { overview: AdminOverview }) {
  const roles = overview.roles;
  const effectiveById = useMemo(
    () =>
      new Map(
        roles.map((role) => [role.id, new Set<string>(effectivePermissions(role.permissions))]),
      ),
    [roles],
  );
  return (
    <section aria-labelledby="roles-compare" className="rounded-2xl border border-border bg-card">
      <h3
        id="roles-compare"
        className="border-b border-border-soft px-4 py-3 text-sm font-semibold text-foreground"
      >
        Comparar perfis
      </h3>
      <div className="max-h-[70dvh] overflow-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Permissões por perfil</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th
                scope="col"
                className="sticky left-0 top-0 z-20 border-b border-border bg-card px-4 py-2 font-semibold"
              >
                Permissão
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-card/90 px-3 py-2 text-center font-semibold glass-blur"
                >
                  {roleDisplayName(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissionsByModule().map((module) => (
              <ModuleRows
                key={module.id}
                module={module}
                roles={roles}
                effectiveById={effectiveById}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModuleRows({
  module,
  roles,
  effectiveById,
}: {
  module: ReturnType<typeof permissionsByModule>[number];
  roles: AdminRole[];
  effectiveById: Map<string, Set<string>>;
}) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={roles.length + 1}
          className="border-t border-border-soft bg-card px-4 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {moduleLabel(module.id)}
        </th>
      </tr>
      {module.items.map((item) => (
        <tr key={item.key} className="border-t border-border-soft">
          <th
            scope="row"
            className="sticky left-0 bg-card px-4 py-1.5 text-left font-normal text-foreground/80"
          >
            {item.label}
          </th>
          {roles.map((role) => {
            const has = effectiveById.get(role.id)?.has(item.key) ?? false;
            return (
              <td key={role.id} className="px-3 py-1.5 text-center">
                {has ? (
                  <span className="font-semibold text-success" aria-label="Sim">
                    ✓
                  </span>
                ) : (
                  <span className="text-muted-foreground/60" aria-label="Não">
                    —
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function RoleViewer({ role, onClose }: { role: AdminRole | null; onClose: () => void }) {
  return (
    <Sheet open={!!role} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {role && (
          <>
            <SheetHeader className="border-b border-border p-5 pr-12 text-left">
              <SheetTitle>{roleDisplayName(role)}</SheetTitle>
              <SheetDescription>
                {role.isSystem
                  ? "Perfil do sistema: não pode ser alterado. Duplique para criar uma versão personalizada."
                  : "Você pode consultar este perfil, mas não alterá-lo."}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-5">
              <PermissionMatrix
                idPrefix={`view-${role.id}`}
                value={effectivePermissions(role.permissions)}
                readOnly
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RoleEditor({
  draft,
  overview,
  actor,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  return (
    <Sheet open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {draft && (
          <RoleForm
            key={
              draft.role
                ? `${draft.role.id}:${draft.role.version}`
                : `new:${draft.basedOn?.id ?? ""}`
            }
            draft={draft}
            overview={overview}
            actor={actor}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function RoleForm({
  draft,
  overview,
  actor,
  onClose,
  onSaved,
}: {
  draft: Draft;
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const source = draft.role ?? draft.basedOn;
  const initialPermissions = source
    ? effectivePermissions(source.permissions).filter((key) => canGrantPermission(actor, key))
    : [];
  const [name, setName] = useState(
    draft.role ? draft.role.name : draft.basedOn ? `${roleDisplayName(draft.basedOn)} (cópia)` : "",
  );
  const [description, setDescription] = useState(source?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(
    effectivePermissions(initialPermissions),
  );
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const nameTaken = overview.roles.some(
    (r) => r.id !== draft.role?.id && roleDisplayName(r).toLowerCase() === trimmed.toLowerCase(),
  );
  const valid = trimmed.length >= 2 && trimmed.length <= 60 && permissions.length > 0 && !nameTaken;
  const affected = draft.role ? draft.role.memberCount : 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const result = await saveRole({
        companyId: overview.company.id,
        roleId: draft.role?.id ?? null,
        version: draft.role?.version ?? null,
        name: trimmed,
        description,
        permissions: closure(permissions),
        basedOn: draft.role ? null : (draft.basedOn?.id ?? null),
      });
      toast.success(
        draft.role
          ? result.affectedMembers > 0
            ? `Perfil atualizado para ${result.affectedMembers} usuário(s).`
            : "Perfil atualizado."
          : "Perfil criado.",
      );
      await onSaved();
      onClose();
    } catch (error) {
      const err = toAdminError(error);
      toast.error(err.message);
      if (err.hint === "admin.stale") await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <SheetHeader className="border-b border-border p-5 pr-12 text-left">
        <SheetTitle>{draft.role ? "Editar perfil" : "Novo perfil"}</SheetTitle>
        <SheetDescription>
          {draft.basedOn
            ? `Baseado em ${roleDisplayName(draft.basedOn)}. Permissões que você não possui não são copiadas.`
            : "Escolha o que as pessoas com este perfil podem fazer."}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Nome</Label>
            <Input
              id="role-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={nameTaken || (trimmed.length > 0 && trimmed.length < 2)}
            />
            {nameTaken && (
              <p className="text-xs text-destructive">Já existe um perfil com este nome.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-description">Descrição (opcional)</Label>
            <Textarea
              id="role-description"
              value={description}
              maxLength={280}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        {affected > 0 && (
          <p className="rounded-xl border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
            {affected} {affected === 1 ? "usuário usa" : "usuários usam"} este perfil. As alterações
            valem para todos imediatamente.
          </p>
        )}
        <PermissionMatrix
          idPrefix={`role-${draft.role?.id ?? "new"}`}
          value={permissions}
          onChange={setPermissions}
          canGrant={(key) => canGrantPermission(actor, key)}
        />
      </div>
      <footer className="flex justify-end gap-2 border-t border-border p-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid || busy}>
          {busy ? "Salvando…" : draft.role ? "Salvar perfil" : "Criar perfil"}
        </Button>
      </footer>
    </form>
  );
}

function ArchiveRoleDialog({
  role,
  overview,
  actor,
  onClose,
  onDone,
}: {
  role: AdminRole | null;
  overview: AdminOverview;
  actor: ActorContext;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [replacement, setReplacement] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const inUse = !!role && (role.memberCount > 0 || role.invitationCount > 0);
  const options = overview.roles.filter(
    (r) =>
      r.id !== role?.id &&
      (!isOwnerRole(r) || actor.isOwner) &&
      (actor.isOwner || isSubset(effectivePermissions(r.permissions), actor.permissions)),
  );

  const close = () => {
    setReplacement("");
    setReason("");
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!role || (inUse && !replacement)) return;
    setBusy(true);
    try {
      await archiveRole({
        roleId: role.id,
        version: role.version,
        replacementRoleId: inUse ? replacement : null,
        reason,
      });
      toast.success("Perfil arquivado.");
      await onDone();
      close();
    } catch (error) {
      toast.error(toAdminError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!role} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Arquivar perfil</DialogTitle>
            <DialogDescription>
              {role ? roleDisplayName(role) : ""} deixa de aparecer para novas atribuições. O
              histórico é preservado.
            </DialogDescription>
          </DialogHeader>
          {inUse && (
            <div className="space-y-1.5">
              <Label htmlFor="archive-replacement">
                Perfil substituto para {role?.memberCount ?? 0} usuário(s) e{" "}
                {role?.invitationCount ?? 0} convite(s)
              </Label>
              <Select value={replacement} onValueChange={setReplacement}>
                <SelectTrigger id="archive-replacement">
                  <SelectValue placeholder="Escolha o novo perfil" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {roleDisplayName(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="archive-reason">Motivo (opcional)</Label>
            <Textarea
              id="archive-reason"
              value={reason}
              maxLength={500}
              rows={2}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || (inUse && !replacement)}>
              {busy ? "Arquivando…" : "Arquivar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

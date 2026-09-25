import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Clock,
  MailPlus,
  MoreHorizontal,
  Search,
  ShieldOff,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui-app";
import { cn } from "@/lib/utils";
import {
  sendInvitationEmail,
  toAdminError,
  touchInvitation,
  type AdminInvitation,
  type AdminMember,
  type AdminOverview,
} from "./admin-api";
import { Avatar, InviteBadge, StatusBadge } from "./AdminBadges";
import {
  formatDateTime,
  formatRelative,
  isOwnerRole,
  memberBlockReason,
  roleDisplayName,
  type ActorContext,
} from "./admin-helpers";
import { InviteDialog } from "./InviteDialog";
import { MemberSheet } from "./MemberSheet";
import { StatusDialog, type StatusAction, type StatusRequest } from "./StatusDialog";

type StatusFilter = "todos" | "active" | "pending" | "invited" | "suspended" | "removed";

type Row =
  | { kind: "member"; id: string; name: string; email: string; member: AdminMember }
  | { kind: "invite"; id: string; name: string; email: string; invitation: AdminInvitation };

const FILTER_LABEL: Record<StatusFilter, string> = {
  todos: "Todos (exceto removidos)",
  active: "Ativos",
  pending: "Aguardando aprovação",
  invited: "Convites pendentes",
  suspended: "Suspensos",
  removed: "Removidos",
};

export function UsersTab({
  overview,
  actor,
  onRefresh,
}: {
  overview: AdminOverview;
  actor: ActorContext;
  onRefresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [roleFilter, setRoleFilter] = useState("todos");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusRequest, setStatusRequest] = useState<StatusRequest | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const rolesById = useMemo(() => new Map(overview.roles.map((r) => [r.id, r])), [overview.roles]);
  const selected = overview.members.find((m) => m.id === selectedId) ?? null;

  const counts = useMemo(
    () => ({
      active: overview.members.filter((m) => m.status === "active").length,
      pending: overview.members.filter((m) => m.status === "pending").length,
      invited: overview.invitations.length,
      suspended: overview.members.filter((m) => m.status === "suspended").length,
    }),
    [overview],
  );

  const rows = useMemo(() => {
    const term = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const all: Row[] = [
      ...overview.members.map((member): Row => ({
        kind: "member",
        id: member.id,
        name: member.fullName,
        email: member.email ?? "",
        member,
      })),
      ...overview.invitations.map((invitation): Row => ({
        kind: "invite",
        id: invitation.id,
        name: invitation.fullName ?? invitation.email,
        email: invitation.email,
        invitation,
      })),
    ];
    return all.filter((row) => {
      if (term && !normalize(`${row.name} ${row.email}`).includes(term)) return false;
      const roleId = row.kind === "member" ? row.member.roleId : row.invitation.roleId;
      if (roleFilter !== "todos" && roleId !== roleFilter) return false;
      if (status === "invited") return row.kind === "invite";
      if (row.kind === "invite") return status === "todos";
      if (status === "todos") return row.member.status !== "removed";
      return row.member.status === status;
    });
  }, [overview, search, status, roleFilter]);

  const requestStatus = (action: Exclude<StatusAction, "cancel_invite">, member: AdminMember) => {
    setStatusRequest({ action, member });
  };

  const resend = async (invitation: AdminInvitation) => {
    setResending(invitation.id);
    try {
      const { email } = await touchInvitation(invitation.id);
      await sendInvitationEmail(email || invitation.email, invitation.fullName);
      toast.success(`Convite reenviado para ${email || invitation.email}.`);
      await onRefresh();
    } catch (error) {
      toast.error(toAdminError(error).message);
    } finally {
      setResending(null);
    }
  };

  const summary: {
    key: StatusFilter;
    label: string;
    value: number;
    icon: typeof Users;
    tone: string;
  }[] = [
    {
      key: "active",
      label: "Ativos",
      value: counts.active,
      icon: UserCheck,
      tone: "text-emerald-600 bg-emerald-50",
    },
    {
      key: "pending",
      label: "Aguardando aprovação",
      value: counts.pending,
      icon: Clock,
      tone: "text-amber-600 bg-amber-50",
    },
    {
      key: "invited",
      label: "Convites pendentes",
      value: counts.invited,
      icon: MailPlus,
      tone: "text-sky-600 bg-sky-50",
    },
    {
      key: "suspended",
      label: "Suspensos",
      value: counts.suspended,
      icon: ShieldOff,
      tone: "text-rose-600 bg-rose-50",
    },
  ];

  const memberActions = (member: AdminMember) => {
    const blocked = memberBlockReason(actor, member, rolesById);
    const items: {
      action: Exclude<StatusAction, "cancel_invite">;
      label: string;
      danger?: boolean;
    }[] = [];
    if (member.isSelf) {
      items.push({ action: "leave", label: "Sair desta clínica", danger: true });
      return items;
    }
    if (blocked) return items;
    if (member.status === "pending") {
      items.push(
        { action: "approve", label: "Aprovar acesso" },
        { action: "reject", label: "Recusar", danger: true },
      );
    } else if (member.status === "active") {
      if (actor.isOwner && !isOwnerRole(rolesById.get(member.roleId ?? ""))) {
        items.push({ action: "transfer", label: "Transferir propriedade" });
      }
      items.push(
        { action: "suspend", label: "Suspender", danger: true },
        { action: "remove", label: "Remover", danger: true },
      );
    } else if (member.status === "suspended") {
      items.push(
        { action: "reactivate", label: "Reativar" },
        { action: "remove", label: "Remover", danger: true },
      );
    } else {
      items.push({ action: "restore", label: "Restaurar acesso" });
    }
    return items;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map(({ key, label, value, icon: Icon, tone }) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus((current) => (current === key ? "todos" : key))}
            aria-pressed={status === key}
            className={cn(
              "flex items-center gap-3 rounded-2xl border bg-white p-3 text-left transition-colors hover:border-violet-300",
              status === key ? "border-violet-400 ring-2 ring-violet-100" : "border-slate-200",
            )}
          >
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone)}>
              <Icon size={18} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-lg font-semibold leading-tight text-slate-900">
                {value}
              </span>
              <span className="block text-[12px] text-slate-500">{label}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className="bg-white pl-9"
            aria-label="Buscar usuários"
          />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
          <SelectTrigger className="bg-white md:w-56" aria-label="Filtrar por situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FILTER_LABEL) as StatusFilter[]).map((key) => (
              <SelectItem key={key} value={key}>
                {FILTER_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="bg-white md:w-56" aria-label="Filtrar por perfil">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os perfis</SelectItem>
            {overview.roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {roleDisplayName(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {actor.canManageUsers && (
          <Button onClick={() => setInviteOpen(true)} className="md:ml-1">
            <UserPlus aria-hidden="true" />
            Convidar usuário
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum usuário encontrado"
          description="Ajuste a busca ou os filtros. Para incluir alguém, use “Convidar usuário”."
          className="bg-white"
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">Usuários da clínica</caption>
              <thead className="bg-slate-50 text-[12px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Usuário
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Perfil
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Situação
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Profissional
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Último acesso
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) =>
                  row.kind === "member" ? (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.member.id)}
                          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 rounded-lg"
                        >
                          <Avatar name={row.name} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">
                              {row.name}
                              {row.member.isSelf && (
                                <span className="ml-1.5 text-[11px] font-semibold text-violet-600">
                                  (você)
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-[12px] text-slate-500">
                              {row.email}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {roleDisplayName(rolesById.get(row.member.roleId ?? ""))}
                        {row.member.extra.length + row.member.revoked.length > 0 && (
                          <span className="ml-1.5 rounded bg-violet-50 px-1.5 text-[11px] font-medium text-violet-700">
                            {row.member.extra.length + row.member.revoked.length} ajuste(s)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={row.member.status} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{row.member.doctorName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {formatRelative(row.member.lastSignInAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <RowMenu
                          label={`Ações para ${row.name}`}
                          onEdit={() => setSelectedId(row.member.id)}
                          actions={memberActions(row.member)}
                          onAction={(action) => requestStatus(action, row.member)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.id} className="bg-sky-50/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.name} className="bg-sky-100 text-sky-700" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">
                              {row.name}
                            </span>
                            <span className="block truncate text-[12px] text-slate-500">
                              Convidado por {row.invitation.invitedByName} em{" "}
                              {formatDateTime(row.invitation.invitedAt)}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {roleDisplayName(rolesById.get(row.invitation.roleId))}
                      </td>
                      <td className="px-4 py-2.5">
                        <InviteBadge expired={row.invitation.expired} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">—</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {row.invitation.expired
                          ? "Expirado"
                          : `Expira em ${formatDateTime(row.invitation.expiresAt)}`}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {actor.canManageUsers && (
                          <InviteMenu
                            label={`Ações para o convite de ${row.email}`}
                            busy={resending === row.invitation.id}
                            onResend={() => void resend(row.invitation)}
                            onCancel={() =>
                              setStatusRequest({
                                action: "cancel_invite",
                                invitation: row.invitation,
                              })
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden" aria-label="Usuários da clínica">
            {rows.map((row) =>
              row.kind === "member" ? (
                <li key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.member.id)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <Avatar name={row.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">
                          {row.name}
                        </span>
                        <span className="block truncate text-[12px] text-slate-500">
                          {row.email}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={row.member.status} />
                          <span className="text-[12px] text-slate-600">
                            {roleDisplayName(rolesById.get(row.member.roleId ?? ""))}
                          </span>
                        </span>
                        <span className="mt-1 block text-[11px] text-slate-500">
                          {formatRelative(row.member.lastSignInAt)}
                        </span>
                      </span>
                    </button>
                    <RowMenu
                      label={`Ações para ${row.name}`}
                      onEdit={() => setSelectedId(row.member.id)}
                      actions={memberActions(row.member)}
                      onAction={(action) => requestStatus(action, row.member)}
                    />
                  </div>
                </li>
              ) : (
                <li key={row.id} className="rounded-2xl border border-sky-200 bg-sky-50/40 p-3">
                  <div className="flex items-start gap-3">
                    <Avatar name={row.name} className="bg-sky-100 text-sky-700" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{row.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5">
                        <InviteBadge expired={row.invitation.expired} />
                        <span className="text-[12px] text-slate-600">
                          {roleDisplayName(rolesById.get(row.invitation.roleId))}
                        </span>
                      </p>
                    </div>
                    {actor.canManageUsers && (
                      <InviteMenu
                        label={`Ações para o convite de ${row.email}`}
                        busy={resending === row.invitation.id}
                        onResend={() => void resend(row.invitation)}
                        onCancel={() =>
                          setStatusRequest({ action: "cancel_invite", invitation: row.invitation })
                        }
                      />
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>
        </>
      )}

      <MemberSheet
        member={selected}
        overview={overview}
        actor={actor}
        onClose={() => setSelectedId(null)}
        onRequestStatus={requestStatus}
        onSaved={onRefresh}
      />
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        overview={overview}
        actor={actor}
        onDone={onRefresh}
      />
      <StatusDialog
        request={statusRequest}
        overview={overview}
        actor={actor}
        onClose={() => setStatusRequest(null)}
        onDone={async () => {
          if (statusRequest && statusRequest.action !== "cancel_invite") setSelectedId(null);
          await onRefresh();
        }}
      />
    </div>
  );
}

function RowMenu({
  label,
  onEdit,
  actions,
  onAction,
}: {
  label: string;
  onEdit: () => void;
  actions: { action: Exclude<StatusAction, "cancel_invite">; label: string; danger?: boolean }[];
  onAction: (action: Exclude<StatusAction, "cancel_invite">) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onEdit}>Ver e editar acesso</DropdownMenuItem>
        {actions.length > 0 && <DropdownMenuSeparator />}
        {actions.map((item) => (
          <DropdownMenuItem
            key={item.action}
            onSelect={() => onAction(item.action)}
            className={item.danger ? "text-rose-700 focus:text-rose-800" : undefined}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InviteMenu({
  label,
  busy,
  onResend,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} disabled={busy}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onResend}>Reenviar convite</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCancel} className="text-rose-700 focus:text-rose-800">
          Cancelar convite
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

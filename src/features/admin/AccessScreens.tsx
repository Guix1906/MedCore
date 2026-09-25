import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, LogOut, MailOpen, RefreshCw, ShieldAlert, ShieldOff, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { qk } from "@/lib/query-keys";
import {
  acceptInvitation,
  declineInvitation,
  switchActiveCompany,
  toAdminError,
  type MyAccess,
  type PendingInvitation,
} from "./admin-api";

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR");
}

function useRefreshAccess() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.access.all() }),
      queryClient.invalidateQueries({ queryKey: ["active-company"] }),
      queryClient.invalidateQueries({ queryKey: ["company-members"] }),
    ]);
  };
}

function InvitationCard({ invitation }: { invitation: PendingInvitation }) {
  const refresh = useRefreshAccess();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const run = async (kind: "accept" | "decline") => {
    setBusy(kind);
    try {
      if (kind === "accept") {
        await acceptInvitation(invitation.id);
        toast.success(`Acesso liberado em ${invitation.companyName}.`);
      } else {
        await declineInvitation(invitation.id);
        toast.success("Convite recusado.");
      }
      await refresh();
    } catch (error) {
      toast.error(toAdminError(error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{invitation.companyName}</p>
        <p className="text-xs text-slate-600">
          Perfil {invitation.roleName} · convite de {invitation.invitedByName}
          {invitation.expiresAt ? ` · válido até ${formatDate(invitation.expiresAt)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("decline")}>
          Recusar
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => void run("accept")}>
          {busy === "accept" ? "Aceitando…" : "Aceitar convite"}
        </Button>
      </div>
    </li>
  );
}

export function PendingInvitationsBanner({ invitations }: { invitations: PendingInvitation[] }) {
  if (invitations.length === 0) return null;
  return (
    <section
      aria-label="Convites pendentes"
      className="mx-4 mt-4 rounded-2xl border border-violet-200 bg-white p-4 shadow-sm md:mx-6"
    >
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-violet-700">
        <MailOpen size={16} aria-hidden="true" />
        Você tem{" "}
        {invitations.length === 1
          ? "um convite pendente"
          : `${invitations.length} convites pendentes`}
      </p>
      <ul className="space-y-2">
        {invitations.map((invitation) => (
          <InvitationCard key={invitation.id} invitation={invitation} />
        ))}
      </ul>
    </section>
  );
}

const BLOCKED_COPY: Record<
  MyAccess["status"],
  { title: string; description: string; icon: typeof Clock }
> = {
  pending: {
    title: "Seu acesso aguarda aprovação",
    description:
      "Sua conta foi criada. Um administrador da clínica precisa liberar seu perfil de acesso em Administração > Usuários.",
    icon: Clock,
  },
  suspended: {
    title: "Seu acesso está suspenso",
    description: "Procure o administrador da clínica para mais informações.",
    icon: ShieldOff,
  },
  removed: {
    title: "Você não tem mais acesso a esta clínica",
    description: "Se isso for um engano, peça um novo convite ao administrador.",
    icon: UserX,
  },
  active: { title: "", description: "", icon: Clock },
  none: {
    title: "Sua conta ainda não está vinculada a uma clínica",
    description: "Peça ao administrador da clínica um convite para o seu e-mail.",
    icon: UserX,
  },
};

export function BlockedAccessScreen({
  access,
  onSignOut,
}: {
  access: MyAccess;
  onSignOut: () => void;
}) {
  const { user } = useAuth();
  const refresh = useRefreshAccess();
  const [checking, setChecking] = useState(false);
  const copy = BLOCKED_COPY[access.status];
  const Icon = copy.icon;
  const otherCompanies = access.companies.filter(
    (c) => c.status === "active" && c.id !== access.companyId,
  );

  const check = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  const openCompany = async (companyId: string) => {
    if (!user?.id) return;
    try {
      await switchActiveCompany(user.id, companyId);
      await refresh();
    } catch (error) {
      toast.error(toAdminError(error).message);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-start justify-center p-4 md:items-center md:p-8">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
          <Icon size={24} aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{copy.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{copy.description}</p>
        {access.companyName && access.status !== "none" && (
          <p className="mt-2 text-xs text-slate-500">Clínica: {access.companyName}</p>
        )}

        {access.invitations.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold text-slate-800">Convites para você</p>
            <ul className="space-y-2">
              {access.invitations.map((invitation) => (
                <InvitationCard key={invitation.id} invitation={invitation} />
              ))}
            </ul>
          </div>
        )}

        {otherCompanies.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold text-slate-800">Você também tem acesso a</p>
            <div className="flex flex-wrap gap-2">
              {otherCompanies.map((company) => (
                <Button
                  key={company.id}
                  size="sm"
                  variant="outline"
                  onClick={() => void openCompany(company.id)}
                >
                  {company.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void check()} disabled={checking}>
            <RefreshCw className={checking ? "animate-spin" : undefined} aria-hidden="true" />
            Verificar novamente
          </Button>
          <Button variant="ghost" onClick={onSignOut}>
            <LogOut aria-hidden="true" />
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NoAccessScreen({
  moduleLabel,
  fallbackPath,
}: {
  moduleLabel: string;
  fallbackPath: string | null;
}) {
  return (
    <div className="flex min-h-[calc(100vh-64px)] items-start justify-center p-4 md:items-center md:p-8">
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert size={24} aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Sem acesso a {moduleLabel}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Seu perfil não inclui este módulo. Se precisar dele, peça a liberação ao administrador da
          clínica.
        </p>
        {fallbackPath ? (
          <Button asChild className="mt-5">
            <Link to={fallbackPath}>Ir para o início</Link>
          </Button>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            Nenhum módulo está liberado para o seu perfil no momento.
          </p>
        )}
      </div>
    </div>
  );
}

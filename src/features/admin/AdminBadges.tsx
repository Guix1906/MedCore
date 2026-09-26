import { cn } from "@/lib/utils";
import { initials } from "./admin-helpers";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "./permissions";

const STATUS_TONE: Record<MemberStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/25",
  active: "bg-success/10 text-success border-success/25",
  suspended: "bg-destructive/10 text-destructive border-destructive/25",
  removed: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: MemberStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
        STATUS_TONE[status],
        className,
      )}
    >
      {MEMBER_STATUS_LABEL[status]}
    </span>
  );
}

export function InviteBadge({ expired }: { expired: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
        expired
          ? "border-border bg-muted text-muted-foreground"
          : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
      )}
    >
      {expired ? "Convite expirado" : "Convite enviado"}
    </span>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

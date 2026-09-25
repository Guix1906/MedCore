import { cn } from "@/lib/utils";
import { initials } from "./admin-helpers";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "./permissions";

const STATUS_TONE: Record<MemberStatus, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suspended: "bg-rose-50 text-rose-700 border-rose-200",
  removed: "bg-slate-100 text-slate-600 border-slate-200",
};

export function StatusBadge({ status, className }: { status: MemberStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
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
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        expired
          ? "border-slate-200 bg-slate-100 text-slate-600"
          : "border-sky-200 bg-sky-50 text-sky-700",
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
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[12px] font-bold text-violet-700",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

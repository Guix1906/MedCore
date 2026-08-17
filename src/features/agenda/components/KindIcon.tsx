import { CheckSquare, Users, AlertCircle, Gavel } from "lucide-react";
import type { ActivityKind } from "@/components/agenda/agenda-types";

export function KindIcon({ kind, className }: { kind: ActivityKind; className?: string }) {
  const Icon =
    kind === "tarefa"
      ? CheckSquare
      : kind === "evento"
        ? Users
        : kind === "prazo"
          ? AlertCircle
          : Gavel;
  return <Icon className={className} />;
}

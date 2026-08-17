import type { CreateKind } from "@/components/agenda/agenda-modals";

export function AgendaHeader(_: {
  isLoading: boolean;
  onRefresh: () => void;
  onCreate: (k: CreateKind) => void;
}) {
  return null;
}

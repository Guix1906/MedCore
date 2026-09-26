import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import type { SortState } from "@/lib/table-sort";
import { cn } from "@/utils/cn";

export type SortableHeaderProps<K extends string> = {
  label: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: "left" | "right" | "center";
  className?: string;
};

/** Cabeçalho de coluna ordenável: clique alterna crescente/decrescente e anuncia via aria-sort. */
export function SortableHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
}: SortableHeaderProps<K>) {
  const active = sort?.key === sortKey;
  const direction = active ? sort.direction : null;
  const Icon =
    direction === "asc" ? ChevronUp : direction === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className={cn(
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium transition-colors hover:text-foreground",
          active && "text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        <span>{label}</span>
        <Icon className={cn("size-3.5", !active && "opacity-40")} aria-hidden="true" />
      </button>
    </th>
  );
}

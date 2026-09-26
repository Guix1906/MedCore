export type SortDirection = "asc" | "desc";
export type SortState<K extends string> = { key: K; direction: SortDirection } | null;
type Sortable = string | number | boolean | Date | null | undefined;

/** Clique numa coluna nova ordena crescente; clicar de novo inverte (como no Finder). */
export function nextSort<K extends string>(previous: SortState<K>, key: K): SortState<K> {
  if (!previous || previous.key !== key) return { key, direction: "asc" };
  return { key, direction: previous.direction === "asc" ? "desc" : "asc" };
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function compareValues(a: Sortable, b: Sortable): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as Date).getTime() - new Date(b as Date).getTime();
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/** Ordenação estável; valores vazios ficam sempre no fim. Não altera o array original. */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  accessors: Record<K, (row: T) => Sortable>,
): T[] {
  if (!sort) return [...rows];
  const read = accessors[sort.key];
  const factor = sort.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      const emptyA = a.value === null || a.value === undefined || a.value === "";
      const emptyB = b.value === null || b.value === undefined || b.value === "";
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      return compareValues(a.value, b.value) * factor || a.index - b.index;
    })
    .map((item) => item.row);
}

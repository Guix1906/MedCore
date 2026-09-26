import type { LucideIcon } from "lucide-react";

export type SearchRow = { kind: string; id: string; label: string; extra?: string | null };
export type SearchPage = { to: string; label: string; section?: string; icon: LucideIcon };

const RECENT_PREFIX = "medcore:recent-search:";
const RECENT_LIMIT = 6;

export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function matchSearchPages(pages: SearchPage[], term: string) {
  const query = normalizeSearch(term);
  if (!query) return [];
  return pages.filter((page) => {
    const label = normalizeSearch(page.label);
    return (
      label.startsWith(query) ||
      label.split(/\s+/).some((word) => word.startsWith(query)) ||
      (query.length >= 3 && label.includes(query))
    );
  });
}

export function groupSearchRows<T extends { kind: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.kind);
    if (group) group.push(row);
    else groups.set(row.kind, [row]);
  }
  return Array.from(groups, ([kind, items]) => ({ kind, rows: items }));
}

function isSearchRow(value: unknown): value is SearchRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.kind === "string" && typeof row.id === "string" && typeof row.label === "string"
  );
}

// sessionStorage: os recentes somem ao fechar a aba e nunca se misturam entre usuários.
export function readRecentSearches(userId: string | null | undefined): SearchRow[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.sessionStorage.getItem(RECENT_PREFIX + userId) ?? "[]",
    );
    return Array.isArray(parsed) ? parsed.filter(isSearchRow).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentSearch(userId: string | null | undefined, row: SearchRow) {
  if (!userId || typeof window === "undefined") return;
  const entry: SearchRow = { kind: row.kind, id: row.id, label: row.label, extra: row.extra };
  const next = [
    entry,
    ...readRecentSearches(userId).filter((item) => item.kind !== row.kind || item.id !== row.id),
  ].slice(0, RECENT_LIMIT);
  try {
    window.sessionStorage.setItem(RECENT_PREFIX + userId, JSON.stringify(next));
  } catch {}
}

export function clearRecentSearches() {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(RECENT_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {}
}

import { EmptyState } from "@/components/ui-app";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { routeRuleFor } from "@/features/admin/permissions";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import {
  groupSearchRows,
  matchSearchPages,
  readRecentSearches,
  rememberRecentSearch,
  type SearchPage,
  type SearchRow,
} from "@/lib/global-search";
import { cn } from "@/lib/utils";
import { searchService } from "@/services/api";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  CornerDownLeft,
  FileText,
  LoaderCircle,
  Package,
  Receipt,
  Search,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const META: Record<string, { icon: typeof Search; label: string; group: string; route: string }> = {
  patient: { icon: User, label: "Paciente", group: "Pacientes", route: "/pacientes" },
  treatment: {
    icon: Activity,
    label: "Acompanhamento",
    group: "Acompanhamentos",
    route: "/acompanhamentos",
  },
  transaction: { icon: Receipt, label: "Transação", group: "Transações", route: "/financeiro" },
  medical_record: {
    icon: FileText,
    label: "Prontuário",
    group: "Prontuários",
    route: "/prontuario",
  },
  exam_order: { icon: FileText, label: "Exame", group: "Exames", route: "/prontuario" },
  task: { icon: Activity, label: "Tarefa", group: "Tarefas", route: "/agenda" },
  appointment: { icon: Activity, label: "Consulta", group: "Consultas", route: "/agenda" },
  inventory: { icon: Package, label: "Estoque", group: "Estoque", route: "/estoque" },
  doctor: { icon: User, label: "Profissional", group: "Profissionais", route: "/configuracoes" },
};

type EntryBase =
  { key: string; type: "record"; row: SearchRow } | { key: string; type: "page"; page: SearchPage };
type Entry = EntryBase & { index: number };
type Section = { id: string; label: string; entries: Entry[] };

const recordEntry = (row: SearchRow): EntryBase => ({
  key: `${row.kind}-${row.id}`,
  type: "record",
  row,
});
const pageEntry = (page: SearchPage): EntryBase => ({ key: `page-${page.to}`, type: "page", page });

export default function GlobalSearch({
  open,
  onClose,
  pages = [],
}: {
  open: boolean;
  onClose: () => void;
  pages?: SearchPage[];
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [recents, setRecents] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePermissions();
  const userId = user?.id;
  const term = query.trim();

  const isAllowed = useCallback(
    (row: SearchRow) => {
      const route = META[row.kind]?.route;
      const rule = route && routeRuleFor(route);
      return !!route && (!rule || rule.any.some(can));
    },
    [can],
  );
  const visibleRows = useMemo(() => rows.filter(isAllowed), [rows, isAllowed]);
  const visibleRecents = useMemo(() => recents.filter(isAllowed), [recents, isAllowed]);

  const { sections, entries } = useMemo(() => {
    const groups: { id: string; label: string; items: EntryBase[] }[] = [];
    if (!term) {
      if (visibleRecents.length)
        groups.push({ id: "recent", label: "Recentes", items: visibleRecents.map(recordEntry) });
      if (pages.length) groups.push({ id: "pages", label: "Ir para", items: pages.map(pageEntry) });
    } else {
      for (const group of groupSearchRows(visibleRows))
        groups.push({
          id: group.kind,
          label: META[group.kind]?.group ?? group.kind,
          items: group.rows.map(recordEntry),
        });
      const matchedPages = matchSearchPages(pages, term);
      if (matchedPages.length)
        groups.push({ id: "pages", label: "Páginas", items: matchedPages.map(pageEntry) });
    }
    let index = 0;
    const built: Section[] = groups.map((group) => ({
      id: group.id,
      label: group.label,
      entries: group.items.map((item) => ({ ...item, index: index++ })),
    }));
    return { sections: built, entries: built.flatMap((section) => section.entries) };
  }, [term, visibleRows, visibleRecents, pages]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRows([]);
      setActive(0);
      setError(false);
    }
  }, [open]);
  useEffect(() => {
    if (open) setRecents(readRecentSearches(userId));
  }, [open, userId]);
  useEffect(() => {
    if (!open) return;
    const searchTerm = query.trim();
    setRows([]);
    setActive(0);
    setError(false);
    if (!searchTerm) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        let result: SearchRow[];
        try {
          result = await searchService.search(searchTerm);
        } catch {
          const safeTerm = searchTerm.replace(/[%,()]/g, " ").trim();
          if (!safeTerm) {
            if (!cancelled) setLoading(false);
            return;
          }
          const { data, error: queryError } = await supabase
            .from("global_search_view")
            .select("kind,id,label,extra")
            .or(`label.ilike.%${safeTerm}%,extra.ilike.%${safeTerm}%`)
            .limit(30);
          if (queryError) throw queryError;
          result = (data ?? []).map((row) => {
            if (!row.kind || !row.id || !row.label)
              throw new Error("Resultado de busca sem identificação.");
            return { kind: row.kind, id: row.id, label: row.label, extra: row.extra };
          });
        }
        if (!cancelled) setRows(result);
      } catch (cause) {
        console.error("Não foi possível concluir a busca.", cause);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, open]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, entries.length - 1)));
  }, [entries.length]);
  useEffect(() => {
    if (open)
      document.getElementById(`search-result-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openEntry = (entry: Entry) => {
    if (entry.type === "page") {
      void navigate({ to: entry.page.to });
    } else {
      const row = entry.row;
      rememberRecentSearch(userId, row);
      if (row.kind === "patient")
        void navigate({ to: "/pacientes", search: { patientId: row.id } });
      else if (row.kind === "treatment")
        void navigate({ to: "/acompanhamentos/$id", params: { id: row.id } });
      else if (row.kind === "task") void navigate({ to: "/agenda", search: { taskId: row.id } });
      else void navigate({ to: META[row.kind].route });
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-(--overlay-light) overlay-blur" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed left-1/2 top-3 z-(--z-dialog) flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-hairline bg-glass-strong text-foreground shadow-(--glass-shadow-lg) glass-blur-strong outline-none duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:top-[12dvh] sm:max-h-[min(600px,76dvh)]"
        >
          <DialogPrimitive.Title className="sr-only">Buscar no MedCore</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Encontre pacientes, acompanhamentos, registros e páginas do sistema.
          </DialogPrimitive.Description>
          <div className="group flex items-center gap-3 border-b border-hairline px-4 transition-colors focus-within:border-primary/50">
            {loading ? (
              <LoaderCircle
                className="size-5 shrink-0 animate-spin text-primary"
                aria-hidden="true"
              />
            ) : (
              <Search
                className="size-5 shrink-0 text-muted-foreground group-focus-within:text-primary"
                aria-hidden="true"
              />
            )}
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label="Buscar no sistema"
              aria-autocomplete="list"
              aria-expanded={entries.length > 0}
              aria-controls={entries.length ? "global-search-results" : undefined}
              aria-activedescendant={entries[active] ? `search-result-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar no MedCore"
              // O foco é indicado pela linha e pelo ícone do cabeçalho do painel.
              style={{ outline: "none" }}
              className="h-14 min-w-0 flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground sm:text-xl [&::-webkit-search-cancel-button]:hidden"
              onKeyDown={(event) => {
                if (!entries.length) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) =>
                    Math.max(
                      0,
                      Math.min(entries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
                    ),
                  );
                } else if (event.key === "Enter" && entries[active]) {
                  event.preventDefault();
                  openEntry(entries[active]);
                }
              }}
            />
            <DialogPrimitive.Close
              aria-label="Fechar busca"
              className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <kbd className="kbd-chip hidden sm:inline-flex" aria-hidden="true">
                esc
              </kbd>
              <X className="size-4 sm:hidden" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading && (
              <p
                role="status"
                className={cn(
                  "px-5 text-sm text-muted-foreground",
                  entries.length ? "pt-3" : "py-8 text-center",
                )}
              >
                Buscando…
              </p>
            )}
            {error && (
              <p role="alert" className="px-5 py-6 text-sm text-destructive">
                Não foi possível buscar. Verifique sua conexão e tente novamente.
              </p>
            )}
            {entries.length > 0 && (
              <div
                id="global-search-results"
                role="listbox"
                aria-label="Resultados da busca"
                className="px-2 pb-2"
              >
                {sections.map((section) => (
                  <div
                    key={section.id}
                    role="group"
                    aria-labelledby={`search-section-${section.id}`}
                  >
                    <p
                      id={`search-section-${section.id}`}
                      className="px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground"
                    >
                      {section.label}
                    </p>
                    {section.entries.map((entry) => {
                      const selected = entry.index === active;
                      const Icon =
                        entry.type === "page" ? entry.page.icon : META[entry.row.kind].icon;
                      const title = entry.type === "page" ? entry.page.label : entry.row.label;
                      const detail =
                        entry.type === "page"
                          ? (entry.page.section ?? "Página")
                          : [section.id === "recent" && META[entry.row.kind].label, entry.row.extra]
                              .filter(Boolean)
                              .join(" · ");
                      return (
                        <button
                          id={`search-result-${entry.index}`}
                          key={entry.key}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(entry.index)}
                          onFocus={() => setActive(entry.index)}
                          onClick={() => openEntry(entry)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-100",
                            selected ? "bg-primary text-primary-foreground" : "text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-lg",
                              selected
                                ? "bg-card/20 text-primary-foreground"
                                : "bg-foreground/[0.05] text-muted-foreground",
                            )}
                          >
                            <Icon size={16} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{title}</span>
                            {detail && (
                              <span
                                className={cn(
                                  "block truncate text-xs",
                                  selected ? "text-primary-foreground/90" : "text-muted-foreground",
                                )}
                              >
                                {detail}
                              </span>
                            )}
                          </span>
                          {selected && (
                            <CornerDownLeft size={14} aria-hidden="true" className="shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            {!loading && !error && !entries.length && (
              <EmptyState
                title={term ? "Nenhum resultado encontrado" : "Tudo ao alcance de uma busca"}
                description={
                  term
                    ? "Tente um nome ou termo diferente."
                    : "Digite para pesquisar nos módulos disponíveis para você."
                }
                className="m-3 border-0 bg-transparent"
                illustration={<Search size={24} />}
              />
            )}
          </div>
          <div className="flex items-center gap-4 border-t border-hairline px-4 py-2.5 text-xs text-muted-foreground">
            <p className="sr-only">
              Use as setas para navegar, Enter para abrir e Esc para fechar.
            </p>
            <span aria-hidden="true" className="inline-flex items-center gap-1.5">
              <kbd className="kbd-chip">↑</kbd>
              <kbd className="kbd-chip">↓</kbd>
              navegar
            </span>
            <span aria-hidden="true" className="inline-flex items-center gap-1.5">
              <kbd className="kbd-chip">↵</kbd>
              abrir
            </span>
            <span aria-hidden="true" className="hidden items-center gap-1.5 sm:inline-flex">
              <kbd className="kbd-chip">esc</kbd>
              fechar
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

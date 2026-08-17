import type { DbRow, Json, IconType } from "@/lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  User,
  Activity,
  Receipt,
  FlaskConical,
  FileText,
  CheckSquare,
  X,
} from "lucide-react";

type Row = {
  kind: string;
  id: string;
  label: string;
  extra: string | null;
  created_at: string | null;
};

const KIND_META: Record<string, { icon: IconType; label: string; route: (id: string) => string }> =
  {
    patient: { icon: User, label: "Paciente", route: () => "/pacientes" },
    treatment: { icon: Activity, label: "Acompanhamento", route: (id) => `/acompanhamentos/${id}` },
    transaction: { icon: Receipt, label: "Transação", route: () => "/financeiro" },
    exam_order: { icon: FlaskConical, label: "Exame", route: () => "/prontuario" },
    medical_record: { icon: FileText, label: "Prontuário", route: () => "/prontuario" },
    task: { icon: CheckSquare, label: "Tarefa", route: () => "/dashboard" },
    appointment: { icon: Activity, label: "Consulta", route: () => "/agenda" },
  };

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery("");
      setRows([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setRows([]);
      return;
    }
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("global_search_view")
        .select("kind,id,label,extra,created_at")
        .or(`label.ilike.%${q}%,extra.ilike.%${q}%`)
        .limit(30);
      if (!cancel) {
        setRows((data ?? []) as Row[]);
        setActive(0);
        setLoading(false);
      }
    }, 180);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = {};
    rows.forEach((r) => {
      (g[r.kind] ||= []).push(r);
    });
    return g;
  }, [rows]);

  if (!open) return null;

  const flat = rows;
  const go = (r: Row) => {
    const meta = KIND_META[r.kind];
    if (meta) navigate({ to: meta.route(r.id) });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4 bg-black/40 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-black/[0.06]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 h-14 border-b border-black/[0.06]">
          <Search size={18} className="text-[#6B7280]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, flat.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && flat[active]) go(flat[active]);
            }}
            placeholder="Buscar pacientes, acompanhamentos, exames, tarefas…"
            className="flex-1 bg-transparent outline-none text-[14.5px] placeholder:text-[#9CA3AF] text-[#111827]"
          />
          <kbd className="hidden sm:inline text-[10.5px] font-mono text-[#9CA3AF] border border-black/[0.08] rounded px-1.5 py-0.5">
            ESC
          </kbd>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center sm:hidden"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {loading && <div className="p-8 text-center text-[13px] text-[#6B7280]">Buscando…</div>}
          {!loading && query && flat.length === 0 && (
            <div className="p-10 text-center">
              <Search size={26} className="mx-auto text-[#D1D5DB] mb-2" />
              <div className="text-[13px] text-[#6B7280]">Nenhum resultado para "{query}"</div>
            </div>
          )}
          {!loading && !query && (
            <div className="p-10 text-center text-[13px] text-[#6B7280]">
              Digite para buscar em pacientes, acompanhamentos, exames, transações, prontuários e
              tarefas.
            </div>
          )}
          {!loading && flat.length > 0 && (
            <div className="py-2">
              {Object.entries(grouped).map(([kind, list]) => {
                const meta = KIND_META[kind];
                const Icon = meta?.icon ?? Search;
                return (
                  <div key={kind} className="mb-1">
                    <div className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                      {meta?.label ?? kind}
                    </div>
                    {list.map((r) => {
                      const idx = flat.indexOf(r);
                      const isActive = idx === active;
                      return (
                        <button
                          key={`${r.kind}-${r.id}`}
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(r)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isActive ? "bg-[#F3F0FF]" : "hover:bg-[#F9FAFB]"
                          }`}
                        >
                          <span className="h-8 w-8 shrink-0 rounded-lg bg-[#F5F3FF] flex items-center justify-center">
                            <Icon size={15} className="text-[#6C4CF7]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-medium text-[#111827] truncate">
                              {r.label}
                            </span>
                            {r.extra && (
                              <span className="block text-[11.5px] text-[#6B7280] truncate">
                                {r.extra}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 h-10 border-t border-black/[0.06] flex items-center justify-between text-[11px] text-[#9CA3AF]">
          <span className="flex items-center gap-3">
            <span>↑↓ navegar</span>
            <span>↵ abrir</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono border border-black/[0.08] rounded px-1.5 py-0.5">Ctrl</kbd>
            <kbd className="font-mono border border-black/[0.08] rounded px-1.5 py-0.5">K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}

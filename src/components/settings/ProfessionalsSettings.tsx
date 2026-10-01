import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { errorMessage } from "@/features/acompanhamentos/followup-utils";

/**
 * Configurações → Profissionais: médicos e demais profissionais que aparecem como
 * "médico responsável" na agenda, prontuário, planos de tratamento e comissões.
 */

type Professional = {
  id: string;
  name: string;
  specialty: string | null;
  crm: string | null;
  phone: string | null;
  email: string;
  active: boolean;
  auth_id: string | null;
};

type Draft = {
  id?: string;
  name: string;
  specialty: string;
  crm: string;
  phone: string;
  email: string;
  active: boolean;
};

const EMPTY: Draft = { name: "", specialty: "", crm: "", phone: "", email: "", active: true };
const db = supabase as any;
const isPlaceholderEmail = (email: string) => /@medcore\.local$/i.test(email);

export default function ProfessionalsSettings() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["settings-professionals"],
    queryFn: async (): Promise<Professional[]> => {
      const { data, error } = await db
        .from("doctors")
        .select("id, name, specialty, crm, phone, email, active, auth_id")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refreshAll = () => {
    // Profissionais aparecem em várias telas (agenda, dashboard, planos): atualiza tudo
    void qc.invalidateQueries();
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (showInactive || r.active) &&
        (!q || `${r.name} ${r.specialty ?? ""} ${r.crm ?? ""}`.toLowerCase().includes(q)),
    );
  }, [rows, search, showInactive]);
  const inactiveCount = rows.filter((r) => !r.active).length;

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return toast.error("Informe o nome do profissional.");
    setSaving(true);
    const id = editing.id ?? crypto.randomUUID();
    const payload = {
      name: editing.name.trim(),
      specialty: editing.specialty.trim() || null,
      crm: editing.crm.trim() || null,
      phone: editing.phone.trim() || null,
      // E-mail é obrigatório na tabela; sem e-mail usa um identificador interno
      email: editing.email.trim() || `medico.${id.slice(0, 8)}@medcore.local`,
      active: editing.active,
    };
    const { error } = editing.id
      ? await db.from("doctors").update(payload).eq("id", editing.id)
      : await db.from("doctors").insert({ id, role: "medico", ...payload });
    setSaving(false);
    if (error) return toast.error("Não foi possível salvar", { description: errorMessage(error) });
    toast.success(editing.id ? "Profissional atualizado." : "Profissional cadastrado.");
    setEditing(null);
    refreshAll();
  };

  const setActive = async (p: Professional, active: boolean) => {
    const { error } = await db.from("doctors").update({ active }).eq("id", p.id);
    if (error) return toast.error("Não foi possível atualizar", { description: errorMessage(error) });
    toast.success(active ? "Profissional reativado." : "Profissional desativado.");
    refreshAll();
  };

  const remove = async (p: Professional) => {
    const ok = await confirmDialog({
      title: `Excluir ${p.name}?`,
      description:
        "O profissional deixa de aparecer na agenda e nos cadastros. Se ele tiver consultas, planos ou usuário vinculados, o sistema vai sugerir desativar.",
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await db.from("doctors").delete().eq("id", p.id);
    if (!error) {
      toast.success("Profissional excluído.");
      refreshAll();
      return;
    }
    // Vínculos (consultas, planos, comissões) impedem a exclusão: desativar preserva o histórico
    const deactivate = await confirmDialog({
      title: "Não foi possível excluir",
      description: `${p.name} tem registros ligados a ele (consultas, planos ou usuário). Deseja desativar? Ele some das listas de seleção, mas o histórico é mantido.`,
      confirmText: "Desativar",
    });
    if (deactivate) await setActive(p, false);
  };

  const field =
    "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10";

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, especialidade ou CRM"
            aria-label="Buscar profissional"
            className={`${field} pl-9`}
          />
        </div>
        <div className="flex items-center gap-3">
          {inactiveCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Mostrar inativos ({inactiveCount})
            </label>
          )}
          <button
            type="button"
            onClick={() => setEditing({ ...EMPTY })}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            <Plus size={16} /> Novo profissional
          </button>
        </div>
      </div>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">
              {editing.id ? "Editar profissional" : "Novo profissional"}
            </h3>
            <button type="button" onClick={() => setEditing(null)} aria-label="Fechar" className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-muted">
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-2">
              <span>Nome completo *</span>
              <input required autoFocus className={field} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Dra. Ana Souza" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              <span>Especialidade</span>
              <input className={field} value={editing.specialty} onChange={(e) => setEditing({ ...editing, specialty: e.target.value })} placeholder="Ex.: Dermatologia" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              <span>CRM / registro</span>
              <input className={field} value={editing.crm} onChange={(e) => setEditing({ ...editing, crm: e.target.value })} placeholder="Ex.: CRM-SP 123456" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              <span>Telefone</span>
              <input className={field} value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="(00) 00000-0000" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              <span>E-mail</span>
              <input type="email" className={field} value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="opcional" />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Ativo (aparece para seleção na agenda e nos cadastros)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="h-10 cursor-pointer rounded-md px-4 text-sm text-muted-foreground hover:bg-muted">
              Cancelar
            </button>
            <button disabled={saving} className="h-10 cursor-pointer rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Carregando…</p>
      ) : error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar os profissionais. {errorMessage(error)}
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <UserRound size={28} className="mx-auto text-muted-foreground/60" />
          <p className="mt-2 text-sm text-muted-foreground">
            {search ? "Nenhum profissional encontrado." : "Nenhum profissional cadastrado."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border bg-card">
          {visible.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${p.active ? "" : "opacity-60"}`}>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
                {p.name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                  {p.name}
                  {!p.active && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">Inativo</span>}
                  {p.auth_id && <span className="rounded-md bg-info/12 px-1.5 py-0.5 text-xs font-medium text-info">Tem acesso ao sistema</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[p.specialty, p.crm, p.phone, isPlaceholderEmail(p.email) ? null : p.email].filter(Boolean).join(" · ") || "Sem dados complementares"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: p.id,
                      name: p.name,
                      specialty: p.specialty ?? "",
                      crm: p.crm ?? "",
                      phone: p.phone ?? "",
                      email: isPlaceholderEmail(p.email) ? "" : p.email,
                      active: p.active,
                    })
                  }
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  <Pencil size={13} /> Editar
                </button>
                {p.active ? (
                  <button type="button" onClick={() => void setActive(p, false)} className="h-8 cursor-pointer rounded-md px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">
                    Desativar
                  </button>
                ) : (
                  <button type="button" onClick={() => void setActive(p, true)} className="h-8 cursor-pointer rounded-md px-2.5 text-xs font-semibold text-success hover:bg-success/10">
                    Reativar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remove(p)}
                  aria-label={`Excluir ${p.name}`}
                  title="Excluir"
                  className="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Para dar acesso ao sistema (login) a um profissional, use <strong>Usuários e permissões</strong>.
      </p>
    </div>
  );
}

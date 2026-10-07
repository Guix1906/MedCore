import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Printer, Send, Trash2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { currency, errorMessage } from "@/features/acompanhamentos/followup-utils";
import { whatsappNumber } from "@/features/agenda/components/WhatsAppReminderButton";
import { printClinicalDocument } from "@/lib/clinical-documents";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { todayLocal } from "@/lib/date-utils";

type QuoteStatus = "rascunho" | "enviado" | "aprovado" | "recusado";

interface QuoteItem {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
}

interface Quote {
  id: string;
  patient_id: string;
  title: string;
  items: QuoteItem[];
  discount: number;
  total: number;
  status: QuoteStatus;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
}

const STATUS: Record<QuoteStatus, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  enviado: { label: "Enviado", cls: "bg-info/12 text-info" },
  aprovado: { label: "Aprovado", cls: "bg-success/12 text-success" },
  recusado: { label: "Recusado", cls: "bg-destructive/10 text-destructive" },
};

const db = supabase as any;
const emptyItem = (): QuoteItem => ({ descricao: "", quantidade: 1, valor_unitario: 0 });
const subtotalOf = (items: QuoteItem[]) =>
  items.reduce((sum, i) => sum + (Number(i.quantidade) || 0) * (Number(i.valor_unitario) || 0), 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

function defaultValidity() {
  return todayLocal(15);
}

function quoteText(q: Pick<Quote, "title" | "items" | "discount" | "total" | "valid_until" | "notes">) {
  const lines = q.items.map(
    (i, n) =>
      `${n + 1}. ${i.descricao} — ${i.quantidade} x ${currency(i.valor_unitario)} = ${currency(i.quantidade * i.valor_unitario)}`,
  );
  return [
    q.title,
    "",
    ...lines,
    "",
    q.discount > 0 ? `Subtotal: ${currency(subtotalOf(q.items))}\nDesconto: ${currency(q.discount)}` : "",
    `TOTAL: ${currency(q.total)}`,
    q.valid_until ? `Válido até ${new Date(`${q.valid_until}T12:00:00`).toLocaleDateString("pt-BR")}` : "",
    q.notes ? `\nObservações: ${q.notes}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export default function QuotesTab({
  patientId,
  patientName,
  patientPhone,
  onCreatePlan,
}: {
  patientId?: string;
  patientName: string;
  patientPhone?: string | null;
  onCreatePlan: () => void;
}) {
  const qc = useQueryClient();
  const queryKey = ["patient-quotes", patientId];
  const [editing, setEditing] = useState<Partial<Quote> | null>(null);

  const { data: quotes = [], isLoading, error } = useQuery({
    queryKey,
    enabled: Boolean(patientId),
    queryFn: async (): Promise<Quote[]> => {
      const { data, error } = await db
        .from("patient_quotes")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (q: Partial<Quote>) => {
      const items = (q.items ?? []).filter((i) => i.descricao.trim());
      const discount = round2(Number(q.discount) || 0);
      const payload = {
        patient_id: patientId,
        title: (q.title ?? "").trim() || "Orçamento",
        items,
        discount,
        total: round2(Math.max(0, subtotalOf(items) - discount)),
        status: q.status ?? "rascunho",
        valid_until: q.valid_until || null,
        notes: q.notes?.trim() || null,
      };
      const res = q.id
        ? await db.from("patient_quotes").update(payload).eq("id", q.id)
        : await db.from("patient_quotes").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      toast.success("Orçamento salvo.");
      setEditing(null);
      void qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error("Não foi possível salvar", { description: errorMessage(e) }),
  });

  const setStatus = async (q: Quote, status: QuoteStatus) => {
    const { error } = await db.from("patient_quotes").update({ status }).eq("id", q.id);
    if (error) return toast.error("Não foi possível atualizar", { description: errorMessage(error) });
    void qc.invalidateQueries({ queryKey });
    if (status === "aprovado") {
      toast.success("Orçamento aprovado.", {
        action: { label: "Criar plano", onClick: onCreatePlan },
      });
    }
  };

  const remove = async (q: Quote) => {
    const ok = await confirmDialog({
      title: "Excluir orçamento?",
      description: `"${q.title}" será excluído.`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await db.from("patient_quotes").delete().eq("id", q.id);
    if (error) return toast.error("Não foi possível excluir", { description: errorMessage(error) });
    toast.success("Orçamento excluído.");
    void qc.invalidateQueries({ queryKey });
  };

  const phone = whatsappNumber(patientPhone);

  if (!patientId) return <p className="text-sm text-muted-foreground">Paciente sem cadastro completo.</p>;

  if (editing) {
    return (
      <QuoteEditor
        initial={editing}
        saving={save.isPending}
        onCancel={() => setEditing(null)}
        onSave={(q) => save.mutate(q)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Monte propostas para {patientName.split(" ")[0]}, imprima ou envie por WhatsApp.
        </p>
        <button
          type="button"
          onClick={() =>
            setEditing({ title: "", items: [emptyItem()], discount: 0, valid_until: defaultValidity(), status: "rascunho" })
          }
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          <Plus size={16} /> Novo orçamento
        </button>
      </div>

      {isLoading ? (
        <p className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">Carregando…</p>
      ) : error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Não foi possível carregar os orçamentos. {errorMessage(error)}
        </p>
      ) : quotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <FileText size={28} className="mx-auto text-muted-foreground/60" />
          <p className="mt-2 text-sm text-muted-foreground">Nenhum orçamento para este paciente.</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {quotes.map((q) => {
            const expired = q.valid_until && q.status !== "aprovado" && new Date(`${q.valid_until}T23:59:59`) < new Date();
            return (
              <li key={q.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-foreground">{q.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {new Date(q.created_at).toLocaleDateString("pt-BR")} · {q.items.length}{" "}
                      {q.items.length === 1 ? "item" : "itens"}
                      {q.valid_until &&
                        ` · válido até ${new Date(`${q.valid_until}T12:00:00`).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS[q.status].cls}`}>
                    {expired ? "Vencido" : STATUS[q.status].label}
                  </span>
                </div>

                <div className="text-2xl font-semibold tabular-nums text-foreground">{currency(q.total)}</div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={q.status}
                    onChange={(e) => void setStatus(q, e.target.value as QuoteStatus)}
                    aria-label="Situação do orçamento"
                    className="h-8 cursor-pointer rounded-lg border border-input bg-card px-2 text-xs font-semibold text-foreground"
                  >
                    {Object.entries(STATUS).map(([key, s]) => (
                      <option key={key} value={key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {q.status === "aprovado" && (
                    <button
                      type="button"
                      onClick={onCreatePlan}
                      className="h-8 cursor-pointer rounded-lg bg-success/12 px-2.5 text-xs font-semibold text-success hover:bg-success/20"
                    >
                      Criar plano de tratamento
                    </button>
                  )}
                  <span className="ml-auto flex items-center">
                    <IconBtn label="Editar" onClick={() => setEditing(q)}>
                      <Pencil size={14} />
                    </IconBtn>
                    <IconBtn
                      label="Imprimir"
                      onClick={() => {
                        if (!printClinicalDocument({ title: "Orçamento", patientName, body: quoteText(q) }))
                          toast.error("Libere pop-ups para imprimir.");
                      }}
                    >
                      <Printer size={14} />
                    </IconBtn>
                    <IconBtn
                      label="Enviar por WhatsApp"
                      onClick={() => {
                        if (!phone) return toast.error("Paciente sem celular cadastrado.");
                        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(quoteText(q))}`, "_blank", "noopener");
                        if (q.status === "rascunho") void setStatus(q, "enviado");
                      }}
                    >
                      <Send size={14} />
                    </IconBtn>
                    <IconBtn label="Excluir" onClick={() => void remove(q)} danger>
                      <Trash2 size={14} />
                    </IconBtn>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-muted ${danger ? "hover:text-destructive" : "hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function QuoteEditor({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: Partial<Quote>;
  saving: boolean;
  onCancel: () => void;
  onSave: (q: Partial<Quote>) => void;
}) {
  const [q, setQ] = useState<Partial<Quote>>({
    ...initial,
    items: initial.items?.length ? initial.items.map((i) => ({ ...i })) : [emptyItem()],
  });
  const items = q.items ?? [];
  const subtotal = useMemo(() => subtotalOf(items), [items]);
  const discount = Number(q.discount) || 0;
  const total = Math.max(0, subtotal - discount);

  const setItem = (index: number, patch: Partial<QuoteItem>) =>
    setQ((prev) => ({ ...prev, items: (prev.items ?? []).map((it, i) => (i === index ? { ...it, ...patch } : it)) }));

  const field = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10";

  return (
    <form
      className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!items.some((i) => i.descricao.trim())) return toast.error("Adicione ao menos um item.");
        if (discount > subtotal) return toast.error("O desconto é maior que o subtotal.");
        onSave(q);
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">{q.id ? "Editar orçamento" : "Novo orçamento"}</h3>
        <button type="button" onClick={onCancel} aria-label="Fechar" className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-muted">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-foreground">Título</span>
          <input
            className={field}
            value={q.title ?? ""}
            onChange={(e) => setQ({ ...q, title: e.target.value })}
            placeholder="Ex.: Harmonização facial — 3 sessões"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-foreground">Válido até</span>
          <input type="date" className={field} value={q.valid_until ?? ""} onChange={(e) => setQ({ ...q, valid_until: e.target.value })} />
        </label>
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-[1fr_80px_120px_110px_32px] gap-2 text-xs font-semibold text-muted-foreground sm:grid">
          <span>Procedimento / item</span>
          <span>Qtd.</span>
          <span>Valor unit.</span>
          <span className="text-right">Total</span>
          <span />
        </div>
        {items.map((item, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px] gap-2 sm:grid-cols-[1fr_80px_120px_110px_32px] sm:items-center">
            <input
              className={`${field} col-span-2 sm:col-span-1`}
              value={item.descricao}
              onChange={(e) => setItem(i, { descricao: e.target.value })}
              placeholder="Descrição"
              aria-label={`Item ${i + 1}`}
            />
            <input
              type="number"
              min={1}
              step={1}
              className={field}
              value={item.quantidade}
              onChange={(e) => setItem(i, { quantidade: Math.max(1, Number(e.target.value) || 1) })}
              aria-label="Quantidade"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              className={field}
              value={item.valor_unitario}
              onChange={(e) => setItem(i, { valor_unitario: Math.max(0, Number(e.target.value) || 0) })}
              aria-label="Valor unitário"
            />
            <span className="self-center text-right text-sm tabular-nums text-foreground">
              {currency(item.quantidade * item.valor_unitario)}
            </span>
            <button
              type="button"
              onClick={() => setQ({ ...q, items: items.filter((_, idx) => idx !== i) })}
              disabled={items.length === 1}
              aria-label="Remover item"
              className="cursor-pointer justify-self-end rounded-md p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-30"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setQ({ ...q, items: [...items, emptyItem()] })}
          className="cursor-pointer text-sm font-semibold text-primary hover:underline"
        >
          + Adicionar item
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_260px]">
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-foreground">Observações</span>
          <textarea
            rows={3}
            className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground outline-none focus:border-primary"
            value={q.notes ?? ""}
            onChange={(e) => setQ({ ...q, notes: e.target.value })}
            placeholder="Formas de pagamento, condições, o que está incluso..."
          />
        </label>
        <div className="space-y-2 rounded-xl bg-surface p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{currency(subtotal)}</span>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Desconto (R$)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="h-8 w-28 rounded-lg border border-input bg-card px-2 text-right text-sm tabular-nums"
              value={q.discount ?? 0}
              onChange={(e) => setQ({ ...q, discount: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{currency(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-10 cursor-pointer rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-10 cursor-pointer rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar orçamento"}
        </button>
      </div>
    </form>
  );
}

import { PageHeader } from "@/components/ui-app/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  X,
  Search,
  Package,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { inventoryService } from "@/services/api";
import { KPICard } from "@/components/ds/Card";
import { SortableHeader } from "@/components/ui-app/SortableHeader";
import { StatusBadge } from "@/components/ui-app/StatusBadge";
import { nextSort, sortRows, type SortState } from "@/lib/table-sort";

type StockSortKey = "name" | "category" | "supplier" | "expiry" | "quantity" | "cost" | "status";

export const Route = createFileRoute("/_authenticated/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque • MedCore" },
      { name: "description", content: "Controle de estoque de insumos e medicamentos da clínica." },
    ],
  }),
  component: EstoquePage,
});

type Item = {
  id: string;
  name: string;
  code: string | null;
  category: string | null;
  quantity: number;
  unit: string | null;
  min_quantity: number;
  expiry_date: string | null;
  supplier: string | null;
  unit_cost: number | null;
  location: string | null;
  active: boolean;
};

const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function EstoquePage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [edit, setEdit] = useState<Item | null>(null);
  const [move, setMove] = useState<{ item: Item; type: "in" | "out" } | null>(null);

  const {
    data: legacyRows = [],
    isLoading: loading,
    error: inventoryError,
  } = useQuery({
    queryKey: ["inventory-items-list"],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      try {
        const phpItems = await inventoryService.getItems();
        if (phpItems && Array.isArray(phpItems) && phpItems.length > 0) {
          return phpItems.map((it) => ({
            id: it.id,
            name: it.name,
            code: (it as any).code || null,
            category: it.category || null,
            quantity: it.quantity || 0,
            unit: it.unit || "un",
            min_quantity: it.min_quantity || 5,
            expiry_date: it.expiration_date || null,
            supplier: it.supplier || null,
            unit_cost: it.unit_cost || null,
            location: (it as any).location || null,
            active: it.active ?? true,
          })) as Item[];
        }
      } catch {}

      const { data, error } = await supabase
        .from("inventory_items")
        .select(
          "id,name,code,category,quantity,unit,min_quantity,expiry_date,supplier,unit_cost,location,active",
        )
        .order("name")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const clinicalStock = useQuery({
    queryKey: ["inventory-clinical-stock"],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(
          "id,name,code,category,quantity,unit,min_quantity,expiry_date,supplier,unit_cost,location,active",
        )
        .order("name")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  const rows = useMemo(
    () => [
      ...new Map(
        [...legacyRows, ...(clinicalStock.data || [])].map((item) => [item.id, item]),
      ).values(),
    ],
    [legacyRows, clinicalStock.data],
  );

  const load = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory-clinical-stock"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-items-list"] });
    queryClient.invalidateQueries({ queryKey: ["treatment-medication-uses"] });
  };

  const deleteItem = async (item: Item) => {
    const ok = await confirmDialog({
      title: "Excluir item",
      description: `Deseja excluir "${item.name}"? Esta ação não pode ser desfeita.`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await inventoryService.deleteItem(item.id);
      toast.success("Item excluído com sucesso");
      load();
      return;
    } catch {}

    const { error } = await supabase.from("inventory_items").delete().eq("id", item.id);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Item excluído");
    load();
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        r.code?.toLowerCase().includes(s) ||
        r.category?.toLowerCase().includes(s) ||
        r.supplier?.toLowerCase().includes(s),
    );
  }, [rows, q]);

  const stats = useMemo(() => {
    const total = rows.length;
    const low = rows.filter((r) => r.quantity <= r.min_quantity).length;
    const value = rows.reduce((acc, r) => acc + r.quantity * (Number(r.unit_cost) || 0), 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in30 = new Date(today);
    in30.setDate(in30.getDate() + 30);
    const expiring = rows.filter((r) => r.expiry_date && new Date(r.expiry_date) <= in30).length;
    return { total, low, value, expiring };
  }, [rows]);

  const [sort, setSort] = useState<SortState<StockSortKey>>({ key: "name", direction: "asc" });
  const toggleSort = (key: StockSortKey) => setSort((previous) => nextSort(previous, key));
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        name: (r) => r.name,
        category: (r) => r.category,
        supplier: (r) => r.supplier,
        expiry: (r) => (r.expiry_date ? new Date(r.expiry_date) : null),
        quantity: (r) => r.quantity,
        cost: (r) => (r.unit_cost ? Number(r.unit_cost) : null),
        status: (r) => r.quantity <= r.min_quantity,
      }),
    [filtered, sort],
  );

  return (
    <AppShell title="Estoque">
      {clinicalStock.error && (
        <p role="alert" className="p-4 text-destructive">
          O saldo clínico não pôde ser atualizado: {clinicalStock.error.message}
        </p>
      )}
      {inventoryError && (
        <p role="alert" className="p-4 text-destructive">
          Erro ao carregar estoque: {inventoryError.message}
        </p>
      )}
      <div className="page-container space-y-5">
        <PageHeader
          title="Estoque"
          icon={Package}
          description="Controle itens, quantidades e validades com clareza."
          actions={
            <Button onClick={() => setOpenNew(true)}>
              <Plus />
              Novo item
            </Button>
          }
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KPICard
            label="Itens cadastrados"
            value={String(stats.total)}
            icon={<Package className="size-4" />}
          />
          <KPICard
            label="Estoque baixo"
            value={String(stats.low)}
            icon={<AlertTriangle className="size-4" />}
            accent="danger"
          />
          <KPICard
            label="Vencendo (30d)"
            value={String(stats.expiring)}
            icon={<AlertTriangle className="size-4" />}
            accent="warning"
          />
          <KPICard
            label="Valor em estoque"
            value={BRL(stats.value)}
            icon={<Package className="size-4" />}
            accent="success"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome, código, categoria ou fornecedor…"
              aria-label="Buscar itens do estoque"
              className="h-10 w-full rounded-full border border-input bg-card pl-9 pr-3 text-sm shadow-xs focus:border-primary focus:outline-none"
            />
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {filtered.length} item(ns)
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="max-h-[70dvh] overflow-auto">
            <table className="mc-table min-w-[860px]">
              <thead>
                <tr>
                  <SortableHeader label="Item" sortKey="name" sort={sort} onSort={toggleSort} />
                  <SortableHeader
                    label="Categoria"
                    sortKey="category"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Fornecedor"
                    sortKey="supplier"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Validade"
                    sortKey="expiry"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Qtd."
                    sortKey="quantity"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                    className="num"
                  />
                  <SortableHeader
                    label="Custo un."
                    sortKey="cost"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                    className="num"
                  />
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  <th scope="col" className="num">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const low = r.quantity <= r.min_quantity;
                  const exp = r.expiry_date ? new Date(r.expiry_date) : null;
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const in30 = new Date(today);
                  in30.setDate(in30.getDate() + 30);
                  const expiring = exp && exp <= in30;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium text-foreground">{r.name}</div>
                        {r.code && <div className="text-xs text-muted-foreground">{r.code}</div>}
                      </td>
                      <td className="text-foreground/80">{r.category ?? "—"}</td>
                      <td className="text-foreground/80">{r.supplier ?? "—"}</td>
                      <td className={expiring ? "font-medium text-warning" : "text-foreground/80"}>
                        {r.expiry_date ? new Date(r.expiry_date).toLocaleDateString("pt-BR") : "—"}
                      </td>
                      <td className="num font-semibold text-foreground">
                        {r.quantity} {r.unit ?? ""}
                      </td>
                      <td className="num text-foreground/80">
                        {r.unit_cost ? BRL(Number(r.unit_cost)) : "—"}
                      </td>
                      <td>
                        {low ? (
                          <StatusBadge tone="danger" icon={AlertTriangle}>
                            Estoque baixo
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="success">OK</StatusBadge>
                        )}
                      </td>
                      <td className="num">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => setMove({ item: r, type: "in" })}
                            className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-medium text-success hover:bg-success/10"
                            title="Entrada"
                          >
                            <ArrowUp size={13} /> Entrada
                          </button>
                          <button
                            onClick={() => setMove({ item: r, type: "out" })}
                            className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                            title="Saída"
                          >
                            <ArrowDown size={13} /> Saída
                          </button>
                          <button
                            onClick={() => setEdit(r)}
                            aria-label={`Editar ${r.name}`}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-border text-foreground/80 hover:bg-muted"
                            title="Editar"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => deleteItem(r)}
                            aria-label={`Excluir ${r.name}`}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-border text-destructive hover:bg-destructive/10"
                            title="Excluir"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      Nenhum item encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {openNew && <NewItemModal onClose={() => setOpenNew(false)} onSaved={load} />}
      {edit && <NewItemModal item={edit} onClose={() => setEdit(null)} onSaved={load} />}
      {move && (
        <MovementModal
          item={move.item}
          type={move.type}
          onClose={() => setMove(null)}
          onSaved={load}
        />
      )}
    </AppShell>
  );
}

function NewItemModal({
  item,
  onClose,
  onSaved,
}: {
  item?: Item;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: item?.name ?? "",
    code: item?.code ?? "",
    category: item?.category ?? "",
    quantity: String(item?.quantity ?? 0),
    unit: item?.unit ?? "un",
    min_quantity: String(item?.min_quantity ?? 0),
    expiry_date: item?.expiry_date ?? "",
    supplier: item?.supplier ?? "",
    unit_cost: item?.unit_cost != null ? String(item.unit_cost) : "",
    location: item?.location ?? "",
  });
  const [saving, setSaving] = useState(false);
  const inp =
    "w-full h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:border-primary";

  const save = async () => {
    if (
      !f.name.trim() ||
      (!item && (!Number.isInteger(Number(f.quantity)) || Number(f.quantity) < 0))
    ) {
      toast.error("Informe nome e quantidade inteira não negativa.");
      return;
    }
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      code: f.code || null,
      category: f.category || null,
      ...(item ? {} : { quantity: Number(f.quantity) }),
      unit: f.unit || null,
      min_quantity: parseInt(f.min_quantity) || 0,
      expiry_date: f.expiry_date || null,
      supplier: f.supplier || null,
      unit_cost: f.unit_cost ? parseFloat(f.unit_cost.replace(",", ".")) : null,
      location: f.location || null,
    };
    const { error } = item
      ? await supabase.from("inventory_items").update(payload).eq("id", item.id)
      : await supabase.from("inventory_items").insert({ ...payload, active: true });
    setSaving(false);
    if (!error) {
      toast.success(item ? "Item atualizado" : "Item cadastrado");
      onSaved();
      onClose();
    } else toast.error("Erro: " + error.message);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-w-[560px]">
        <DialogTitle className="sr-only">Cadastro do item</DialogTitle>
        <DialogDescription className="sr-only">
          Confira os dados antes de confirmar.
        </DialogDescription>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">
            {item ? "Editar item" : "Novo item de estoque"}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground">Nome *</label>
            <input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              className={inp}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Código</label>
            <input
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Categoria</label>
            <input
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
              className={inp}
              placeholder="Medicamento, Insumo…"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Quantidade</label>
            <input
              type="number"
              disabled={!!item}
              title={item ? "Use entrada/saída para alterar o saldo com segurança." : undefined}
              value={f.quantity}
              onChange={(e) => setF({ ...f, quantity: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Unidade</label>
            <input
              value={f.unit}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
              className={inp}
              placeholder="un, cx, ml…"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Estoque mínimo</label>
            <input
              type="number"
              value={f.min_quantity}
              onChange={(e) => setF({ ...f, min_quantity: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Validade</label>
            <input
              type="date"
              value={f.expiry_date}
              onChange={(e) => setF({ ...f, expiry_date: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Fornecedor</label>
            <input
              value={f.supplier}
              onChange={(e) => setF({ ...f, supplier: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Custo unitário (R$)</label>
            <input
              value={f.unit_cost}
              onChange={(e) => setF({ ...f, unit_cost: e.target.value })}
              className={inp}
              placeholder="0,00"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground">Localização</label>
            <input
              value={f.location}
              onChange={(e) => setF({ ...f, location: e.target.value })}
              className={inp}
              placeholder="Armário A, prateleira 2…"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-full border border-border text-sm font-semibold text-foreground/80"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !f.name.trim()}
            className="h-10 px-4 rounded-full bg-primary text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MovementModal({
  item,
  type,
  onClose,
  onSaved,
}: {
  item: Item;
  type: "in" | "out";
  onClose: () => void;
  onSaved: () => void;
}) {
  const requestId = useRef(crypto.randomUUID());
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const inp =
    "w-full h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:border-primary";

  const save = async () => {
    const q = Number(qty);
    if (!Number.isInteger(q) || q <= 0) {
      toast.error("Informe uma quantidade válida");
      return;
    }
    if (type === "out" && q > item.quantity) {
      toast.error("Quantidade indisponível em estoque.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("move_inventory_item", {
        p_id: requestId.current,
        p_item_id: item.id,
        p_type: type === "in" ? "entrada" : "saida",
        p_quantity: q,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
      toast.success(type === "in" ? "Entrada registrada" : "Saída registrada");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "Falha ao movimentar estoque.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-w-[420px]">
        <DialogTitle className="sr-only">Movimentação de estoque</DialogTitle>
        <DialogDescription className="sr-only">
          Confira os dados antes de confirmar.
        </DialogDescription>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">
            {type === "in" ? "Entrada" : "Saída"} — {item.name}
          </h2>
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          Estoque atual:{" "}
          <span className="font-semibold text-foreground">
            {item.quantity} {item.unit ?? ""}
          </span>
        </div>
        <div role="status" className="mb-4 rounded-lg border border-border bg-surface p-3 text-sm">
          Saldo após a movimentação:{" "}
          <strong className="tabular-nums">
            {Number.isInteger(Number(qty)) && Number(qty) > 0
              ? `${item.quantity + (type === "in" ? Number(qty) : -Number(qty))} ${item.unit ?? ""}`
              : "Informe uma quantidade válida"}
          </strong>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Quantidade *</label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={inp}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Motivo</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inp}
              placeholder={type === "in" ? "Compra, doação…" : "Uso em consulta, perda…"}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-full border border-border text-sm font-semibold text-foreground/80"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className={`h-10 px-4 rounded-full text-white text-sm font-semibold disabled:opacity-60 ${type === "in" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"}`}
          >
            {saving ? "Salvando…" : "Confirmar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

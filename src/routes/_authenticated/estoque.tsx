import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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

export const Route = createFileRoute("/_authenticated/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque • ClinicMed" },
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

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["inventory-items-list"],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_items")
        .select(
          "id,name,code,category,quantity,unit,min_quantity,expiry_date,supplier,unit_cost,location,active",
        )
        .order("name")
        .limit(500);
      return (data ?? []) as Item[];
    },
  });

  const load = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory-items-list"] });
  };

  const deleteItem = async (item: Item) => {
    const ok = await confirmDialog({
      title: "Excluir item",
      description: `Deseja excluir "${item.name}"? Esta ação não pode ser desfeita.`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;
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

  return (
    <AppShell title="Estoque">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            label="Itens cadastrados"
            value={String(stats.total)}
            icon={<Package size={16} />}
            tint="#EDE4FF"
            fg="#6B2FE0"
          />
          <StatCard
            label="Estoque baixo"
            value={String(stats.low)}
            icon={<AlertTriangle size={16} />}
            tint="#FEE2E2"
            fg="#991B1B"
          />
          <StatCard
            label="Vencendo (30d)"
            value={String(stats.expiring)}
            icon={<AlertTriangle size={16} />}
            tint="#FEF3C7"
            fg="#92400E"
          />
          <StatCard
            label="Valor em estoque"
            value={BRL(stats.value)}
            icon={<Package size={16} />}
            tint="#DCFCE7"
            fg="#166534"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome, código, categoria ou fornecedor…"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] focus:outline-none focus:border-[#8B47FF]"
            />
          </div>
          <button
            onClick={() => setOpenNew(true)}
            className="ml-auto inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold hover:bg-[#7A3AE6]"
          >
            <Plus size={16} /> Novo item
          </button>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F9FAFB] text-[#6B7280] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 font-medium">Fornecedor</th>
                <th className="px-4 py-3 font-medium">Validade</th>
                <th className="px-4 py-3 font-medium text-right">Qtd.</th>
                <th className="px-4 py-3 font-medium text-right">Custo un.</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const low = r.quantity <= r.min_quantity;
                const exp = r.expiry_date ? new Date(r.expiry_date) : null;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const in30 = new Date(today);
                in30.setDate(in30.getDate() + 30);
                const expiring = exp && exp <= in30;
                return (
                  <tr key={r.id} className="border-t border-[#F3F4F6] hover:bg-[#FAF7FF]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#111827]">{r.name}</div>
                      {r.code && <div className="text-[11px] text-[#6B7280]">{r.code}</div>}
                    </td>
                    <td className="px-4 py-3 text-[#374151]">{r.category ?? "—"}</td>
                    <td className="px-4 py-3 text-[#374151]">{r.supplier ?? "—"}</td>
                    <td
                      className={`px-4 py-3 ${expiring ? "text-[#92400E] font-medium" : "text-[#374151]"}`}
                    >
                      {r.expiry_date ? new Date(r.expiry_date).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[#111827]">
                      {r.quantity} {r.unit ?? ""}
                    </td>
                    <td className="px-4 py-3 text-right text-[#374151]">
                      {r.unit_cost ? BRL(Number(r.unit_cost)) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {low ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FEE2E2] text-[#991B1B]">
                          Estoque baixo
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#DCFCE7] text-[#166534]">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => setMove({ item: r, type: "in" })}
                          className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[#E5E7EB] text-[12px] font-medium text-[#166534] hover:bg-[#F0FDF4]"
                          title="Entrada"
                        >
                          <ArrowUp size={13} /> Entrada
                        </button>
                        <button
                          onClick={() => setMove({ item: r, type: "out" })}
                          className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[#E5E7EB] text-[12px] font-medium text-[#991B1B] hover:bg-[#FEF2F2]"
                          title="Saída"
                        >
                          <ArrowDown size={13} /> Saída
                        </button>
                        <button
                          onClick={() => setEdit(r)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]"
                          title="Editar"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteItem(r)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#E5E7EB] text-[#991B1B] hover:bg-[#FEF2F2]"
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
                  <td colSpan={8} className="px-4 py-10 text-center text-[#6B7280]">
                    Nenhum item encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

function StatCard({
  label,
  value,
  icon,
  tint,
  fg,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tint: string;
  fg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-[#6B7280]">{label}</div>
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center"
          style={{ background: tint, color: fg }}
        >
          {icon}
        </div>
      </div>
      <div className="mt-2 text-[20px] font-bold text-[#111827]">{value}</div>
    </div>
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
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]";

  const save = async () => {
    if (!f.name.trim()) return;
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      code: f.code || null,
      category: f.category || null,
      quantity: parseInt(f.quantity) || 0,
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
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[560px] bg-white rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-[#111827]">
            {item ? "Editar item" : "Novo item de estoque"}
          </h2>
          <button onClick={onClose} className="text-[#9CA3AF]">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280]">Nome *</label>
            <input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              className={inp}
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Código</label>
            <input
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Categoria</label>
            <input
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
              className={inp}
              placeholder="Medicamento, Insumo…"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Quantidade</label>
            <input
              type="number"
              value={f.quantity}
              onChange={(e) => setF({ ...f, quantity: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Unidade</label>
            <input
              value={f.unit}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
              className={inp}
              placeholder="un, cx, ml…"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Estoque mínimo</label>
            <input
              type="number"
              value={f.min_quantity}
              onChange={(e) => setF({ ...f, min_quantity: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Validade</label>
            <input
              type="date"
              value={f.expiry_date}
              onChange={(e) => setF({ ...f, expiry_date: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Fornecedor</label>
            <input
              value={f.supplier}
              onChange={(e) => setF({ ...f, supplier: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Custo unitário (R$)</label>
            <input
              value={f.unit_cost}
              onChange={(e) => setF({ ...f, unit_cost: e.target.value })}
              className={inp}
              placeholder="0,00"
            />
          </div>
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280]">Localização</label>
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
            className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#374151]"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !f.name.trim()}
            className="h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
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
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const inp =
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]";

  const save = async () => {
    const q = parseInt(qty);
    if (!q || q <= 0) {
      toast.error("Informe uma quantidade válida");
      return;
    }
    if (type === "out" && q > item.quantity) {
      toast.error("Quantidade indisponível em estoque.");
      return;
    }
    setSaving(true);
    const newQty = type === "in" ? item.quantity + q : item.quantity - q;
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("inventory_movements").insert({
        item_id: item.id,
        type,
        quantity: q,
        reason: reason || null,
      }),
      supabase.from("inventory_items").update({ quantity: newQty }).eq("id", item.id),
    ]);
    setSaving(false);
    if (!e1 && !e2) {
      toast.success(type === "in" ? "Entrada registrada" : "Saída registrada");
      onSaved();
      onClose();
    } else toast.error("Erro: " + (e1?.message || e2?.message));
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[420px] bg-white rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-[#111827]">
            {type === "in" ? "Entrada" : "Saída"} — {item.name}
          </h2>
          <button onClick={onClose} className="text-[#9CA3AF]">
            <X size={18} />
          </button>
        </div>
        <div className="text-[12px] text-[#6B7280] mb-3">
          Estoque atual:{" "}
          <span className="font-semibold text-[#111827]">
            {item.quantity} {item.unit ?? ""}
          </span>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-[#6B7280]">Quantidade *</label>
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
            <label className="text-[12px] text-[#6B7280]">Motivo</label>
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
            className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#374151]"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className={`h-10 px-4 rounded-lg text-white text-[13px] font-semibold disabled:opacity-60 ${type === "in" ? "bg-[#166534] hover:bg-[#14532D]" : "bg-[#991B1B] hover:bg-[#7F1D1D]"}`}
          >
            {saving ? "Salvando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

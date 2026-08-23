import type { DbRow, Json, IconType } from "@/lib/types";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Trash2, Pencil, Save, MapPin } from "lucide-react";
import { useClinicCities } from "@/hooks/use-clinic-cities";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { companyService, financeService } from "@/services/api";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações • ClinicMed" },
      { name: "description", content: "Configurações gerais da clínica, serviços e categorias." },
    ],
  }),
  component: ConfiguracoesPage,
});

type Tab = "clinica" | "servicos" | "categorias" | "cidades";

function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("clinica");
  return (
    <AppShell title="Configurações">
      <div className="p-6 space-y-4">
        <div className="flex gap-1 border-b border-[#E5E7EB]">
          {(
            [
              ["clinica", "Dados da clínica"],
              ["servicos", "Serviços & preços"],
              ["categorias", "Categorias financeiras"],
              ["cidades", "Cidades de atendimento"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k as Tab)}
              className={`px-4 h-10 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                tab === k
                  ? "border-[#8B47FF] text-[#8B47FF]"
                  : "border-transparent text-[#6B7280] hover:text-[#111827]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "clinica" && <ClinicSettings />}
        {tab === "servicos" && <ServiceTypes />}
        {tab === "categorias" && <FinanceCategories />}
        {tab === "cidades" && <CitySettings />}
      </div>
    </AppShell>
  );
}

function ClinicSettings() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const { data: initialSettings } = useQuery({
    queryKey: ["clinic-settings"],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      try {
        const phpData = await companyService.getClinicSettings();
        if (phpData) return phpData;
      } catch {}
      const { data } = await (supabase as DbRow)
        .from("clinic_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const [f, setF] = useState({
    id: null as string | null,
    clinic_name: "ClinicMed Health Hub",
    cnpj: "",
    phone: "",
    email: "",
    address: "",
    opening_hours: "Seg-Sex 08:00-18:00",
    primary_color: "#8B47FF",
  });

  useEffect(() => {
    if (initialSettings) {
      setF({
        id: initialSettings.id ?? null,
        clinic_name: initialSettings.clinic_name ?? "",
        cnpj: initialSettings.cnpj ?? "",
        phone: initialSettings.phone ?? "",
        email: initialSettings.email ?? "",
        address: initialSettings.address ?? "",
        opening_hours: (initialSettings as any).opening_hours ?? "Seg-Sex 08:00-18:00",
        primary_color: (initialSettings as any).primary_color ?? "#8B47FF",
      });
    }
  }, [initialSettings]);

  const inp =
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]";

  const save = async () => {
    setSaving(true);
    const payload = {
      clinic_name: f.clinic_name || null,
      cnpj: f.cnpj || null,
      phone: f.phone || null,
      email: f.email || null,
      address: f.address || null,
      opening_hours: f.opening_hours || null,
      primary_color: f.primary_color || null,
    };

    try {
      await companyService.updateClinicSettings(payload as any);
      queryClient.invalidateQueries({ queryKey: ["clinic-settings"] });
    } catch {
      const { error, data } = f.id
        ? await (supabase as DbRow)
            .from("clinic_settings")
            .update(payload)
            .eq("id", f.id)
            .select()
            .maybeSingle()
        : await (supabase as DbRow).from("clinic_settings").insert(payload).select().maybeSingle();
      if (error) {
        toast.error("Erro: " + error.message);
        setSaving(false);
        return;
      }
      if (data) setF((p) => ({ ...p, id: data.id }));
    }

    setSaving(false);
    toast.success("Configurações salvas");
    setMsg("Salvo com sucesso");
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 max-w-3xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-[12px] text-[#6B7280]">Nome da clínica</label>
          <input
            value={f.clinic_name}
            onChange={(e) => setF({ ...f, clinic_name: e.target.value })}
            className={inp}
          />
        </div>
        <div>
          <label className="text-[12px] text-[#6B7280]">CNPJ</label>
          <input
            value={f.cnpj}
            onChange={(e) => setF({ ...f, cnpj: e.target.value })}
            className={inp}
          />
        </div>
        <div>
          <label className="text-[12px] text-[#6B7280]">Telefone</label>
          <input
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            className={inp}
          />
        </div>
        <div className="col-span-2">
          <label className="text-[12px] text-[#6B7280]">E-mail</label>
          <input
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            className={inp}
          />
        </div>
        <div className="col-span-2">
          <label className="text-[12px] text-[#6B7280]">Endereço</label>
          <input
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            className={inp}
          />
        </div>
        <div>
          <label className="text-[12px] text-[#6B7280]">Horário de funcionamento</label>
          <input
            value={f.opening_hours}
            onChange={(e) => setF({ ...f, opening_hours: e.target.value })}
            className={inp}
            placeholder="Seg-Sex 08:00-18:00"
          />
        </div>
        <div>
          <label className="text-[12px] text-[#6B7280]">Cor primária</label>
          <input
            type="color"
            value={f.primary_color}
            onChange={(e) => setF({ ...f, primary_color: e.target.value })}
            className="w-full h-10 rounded-lg border border-[#E5E7EB]"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold disabled:opacity-60"
        >
          <Save size={15} /> {saving ? "Salvando…" : "Salvar"}
        </button>
        {msg && <span className="text-[12px] text-[#166534] font-medium">{msg}</span>}
      </div>
    </div>
  );
}

type Service = {
  id: string;
  name: string;
  price: number | null;
  duration_minutes: number | null;
  commission_percent?: number | null;
  active: boolean;
};

function ServiceTypes() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Service | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["service-types-list"],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      try {
        const phpData = await companyService.getServiceTypes();
        if (phpData && Array.isArray(phpData) && phpData.length > 0) {
          return phpData as Service[];
        }
      } catch {}
      const { data } = await (supabase as DbRow).from("service_types").select("*").order("name");
      return (data ?? []) as Service[];
    },
  });

  const load = () => {
    queryClient.invalidateQueries({ queryKey: ["service-types-list"] });
  };

  const deleteService = async (s: Service) => {
    const ok = await confirmDialog({
      title: "Excluir serviço",
      description: `Excluir o serviço "${s.name}"?`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await (supabase as DbRow)
      .from("service_types")
      .delete()
      .eq("id", s.id);
    if (error) toast.error("Erro: " + error.message);
    else {
      toast.success("Serviço excluído");
      load();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => setOpenNew(true)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold"
        >
          <Plus size={15} /> Novo serviço
        </button>
      </div>
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-[#F9FAFB] text-[#6B7280] text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Serviço</th>
              <th className="px-4 py-3 font-medium text-right">Preço</th>
              <th className="px-4 py-3 font-medium text-right">Duração</th>
              <th className="px-4 py-3 font-medium text-right">Comissão</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#F3F4F6]">
                <td className="px-4 py-3 font-medium text-[#111827]">{r.name}</td>
                <td className="px-4 py-3 text-right">
                  {r.price ? `R$ ${Number(r.price).toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.duration_minutes ? `${r.duration_minutes} min` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.commission_percent ? `${r.commission_percent}%` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => setEditing(r)}
                      className="h-8 w-8 rounded-md border border-[#E5E7EB] inline-flex items-center justify-center text-[#374151] hover:bg-[#F9FAFB]"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => deleteService(r)}
                      className="h-8 w-8 rounded-md border border-[#E5E7EB] inline-flex items-center justify-center text-[#991B1B] hover:bg-[#FEF2F2]"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[#6B7280]">
                  Nenhum serviço cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(openNew || editing) && (
        <ServiceModal
          service={editing}
          onClose={() => {
            setOpenNew(false);
            setEditing(null);
          }}
          onSaved={load}
        />
      )}
    </div>
  );
}

function ServiceModal({
  service,
  onClose,
  onSaved,
}: {
  service: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: service?.name ?? "",
    price: service?.price?.toString() ?? "",
    duration_minutes: service?.duration_minutes?.toString() ?? "",
    commission_percent: service?.commission_percent?.toString() ?? "",
  });
  const [saving, setSaving] = useState(false);
  const inp =
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]";

  const save = async () => {
    if (!f.name.trim()) return;
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      price: f.price ? parseFloat(f.price.replace(",", ".")) : null,
      duration_minutes: f.duration_minutes ? parseInt(f.duration_minutes) : null,
      commission_percent: f.commission_percent
        ? parseFloat(f.commission_percent.replace(",", "."))
        : null,
      active: true,
    };
    const { error } = service
      ? await (supabase as DbRow).from("service_types").update(payload).eq("id", service.id)
      : await (supabase as DbRow).from("service_types").insert(payload);
    setSaving(false);
    if (!error) {
      toast.success(service ? "Serviço atualizado" : "Serviço criado");
      onSaved();
      onClose();
    } else toast.error("Erro: " + error.message);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[460px] bg-white rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-[#111827]">
            {service ? "Editar serviço" : "Novo serviço"}
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
            <label className="text-[12px] text-[#6B7280]">Preço (R$)</label>
            <input
              value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280]">Duração (min)</label>
            <input
              type="number"
              value={f.duration_minutes}
              onChange={(e) => setF({ ...f, duration_minutes: e.target.value })}
              className={inp}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280]">Comissão (%)</label>
            <input
              value={f.commission_percent}
              onChange={(e) => setF({ ...f, commission_percent: e.target.value })}
              className={inp}
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

type Cat = { id: string; name: string; type: "income" | "expense"; color?: string | null };

function FinanceCategories() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"income" | "expense">("income");

  const { data: rows = [] } = useQuery({
    queryKey: ["finance-categories-list"],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      try {
        const phpData = await financeService.getCategories();
        if (phpData && Array.isArray(phpData) && phpData.length > 0) {
          return phpData as Cat[];
        }
      } catch {}
      const { data } = await (supabase as DbRow)
        .from("finance_categories")
        .select("*")
        .order("type")
        .order("name");
      return (data ?? []) as Cat[];
    },
  });

  const load = () => {
    queryClient.invalidateQueries({ queryKey: ["finance-categories-list"] });
  };

  const add = async () => {
    if (!newName.trim()) return;
    const { error } = await (supabase as DbRow)
      .from("finance_categories")
      .insert({ name: newName.trim(), type: newType });
    if (error) toast.error("Erro: " + error.message);
    else toast.success("Categoria adicionada");
    setNewName("");
    load();
  };

  const del = async (id: string) => {
    const { error } = await (supabase as DbRow).from("finance_categories").delete().eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else toast.success("Categoria excluída");
    load();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {(["income", "expense"] as const).map((t) => (
        <div key={t} className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <div className="text-[13px] font-bold text-[#111827] mb-3">
            {t === "income" ? "Receitas" : "Despesas"}
          </div>
          <div className="space-y-1 mb-3">
            {rows
              .filter((r) => r.type === t)
              .map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-[#F9FAFB]"
                >
                  <span className="text-[13px] text-[#374151]">{r.name}</span>
                  <button
                    onClick={() => del(r.id)}
                    className="text-[#991B1B] hover:bg-[#FEF2F2] p-1 rounded"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            {rows.filter((r) => r.type === t).length === 0 && (
              <div className="text-[12px] text-[#6B7280] py-2 text-center">Sem categorias.</div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={newType === t ? newName : ""}
              onChange={(e) => {
                setNewType(t);
                setNewName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newType === t) add();
              }}
              placeholder="Nova categoria…"
              className="flex-1 h-9 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]"
            />
            <button
              onClick={() => {
                setNewType(t);
                if (newType === t) add();
              }}
              className="h-9 px-3 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CitySettings() {
  const { cities, addCity, removeCity } = useClinicCities();
  const [newCity, setNewCity] = useState("");

  const handleAdd = () => {
    if (!newCity.trim()) {
      toast.error("Digite o nome da cidade.");
      return;
    }
    const added = addCity(newCity.trim());
    if (added) {
      toast.success(`Cidade "${newCity.trim()}" adicionada com sucesso!`);
      setNewCity("");
    }
  };

  const handleRemove = async (cityName: string) => {
    const ok = await confirmDialog({
      title: "Excluir Cidade",
      description: `Deseja remover "${cityName}" das cidades de atendimento?`,
      confirmText: "Remover",
      destructive: true,
    });
    if (ok) {
      removeCity(cityName);
      toast.success(`Cidade "${cityName}" removida.`);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 max-w-2xl space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[#111827] flex items-center gap-2">
          <MapPin className="text-[#8B47FF]" size={18} /> Cidades de Atendimento
        </h2>
        <p className="text-[12.5px] text-[#6B7280] mt-1">
          Cadastre as cidades onde a clínica e o médico realizam atendimentos. Elas ficarão disponíveis no agendamento e no filtro da agenda.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={newCity}
          onChange={(e) => setNewCity(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="Digite o nome da nova cidade (Ex: Campinas, Santos…)"
          className="flex-1 h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold hover:opacity-90 transition"
        >
          <Plus size={16} /> Adicionar Cidade
        </button>
      </div>

      <div className="border border-[#E5E7EB] rounded-xl overflow-hidden divide-y divide-[#E5E7EB]">
        {cities.length === 0 ? (
          <div className="p-4 text-center text-[13px] text-[#6B7280]">
            Nenhuma cidade cadastrada.
          </div>
        ) : (
          cities.map((city) => (
            <div key={city} className="flex items-center justify-between p-3 bg-white hover:bg-[#F9FAFB] transition">
              <span className="text-[13.5px] font-medium text-[#111827] flex items-center gap-2">
                <MapPin size={14} className="text-[#8B47FF]" /> {city}
              </span>
              <button
                onClick={() => handleRemove(city)}
                className="text-[#991B1B] hover:bg-[#FEF2F2] p-1.5 rounded-lg transition"
                title="Remover Cidade"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

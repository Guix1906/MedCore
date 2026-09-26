import { PageHeader } from "@/components/ui-app/PageHeader";
import { SegmentedControl } from "@/components/ui-app/SegmentedControl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DbRow, Json, IconType } from "@/lib/types";
import { normalizeSearch } from "@/lib/global-search";
import { cn } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ClipboardList,
  Landmark,
  MapPin,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
} from "lucide-react";
import { useClinicCities } from "@/hooks/use-clinic-cities";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { companyService, financeService } from "@/services/api";
import FinanceOperations from "@/features/finance/FinanceOperations";
import { getFinancialSnapshot } from "@/features/finance/finance-api";
import { errorMessage } from "@/features/acompanhamentos/followup-utils";
import { usePermissions } from "@/hooks/use-permissions";
import type { PermissionKey } from "@/features/admin/permissions";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações • MedCore" },
      { name: "description", content: "Configurações gerais da clínica, serviços e categorias." },
    ],
  }),
  component: ConfiguracoesPage,
});

type Tab = "clinica" | "servicos" | "categorias" | "cidades" | "contas";

const TAB_PERMISSIONS: Record<Tab, PermissionKey[]> = {
  clinica: ["settings.manage"],
  servicos: ["settings.manage"],
  categorias: ["settings.manage", "finance.accounts"],
  contas: ["finance.accounts"],
  cidades: ["settings.manage"],
};

const SETTINGS_TAB_KEY = "medcore:settings-tab";

const SECTIONS: {
  key: Tab;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tint: string;
}[] = [
  {
    key: "clinica",
    label: "Dados da clínica",
    description: "Nome, contato, endereço e horário de funcionamento.",
    icon: Building2,
    tint: "bg-primary",
  },
  {
    key: "servicos",
    label: "Serviços e preços",
    description: "Tabela de serviços com preço, duração e comissão.",
    icon: ClipboardList,
    tint: "bg-info",
  },
  {
    key: "categorias",
    label: "Categorias financeiras",
    description: "Categorias usadas para classificar receitas e despesas.",
    icon: Tags,
    tint: "bg-warning",
  },
  {
    key: "contas",
    label: "Contas financeiras",
    description: "Contas bancárias, caixas e meios de recebimento.",
    icon: Landmark,
    tint: "bg-success",
  },
  {
    key: "cidades",
    label: "Cidades de atendimento",
    description:
      "Cidades onde a clínica e o médico atendem. Ficam disponíveis no agendamento e no filtro da agenda.",
    icon: MapPin,
    tint: "bg-destructive",
  },
];

function ConfiguracoesPage() {
  const { canAny } = usePermissions();
  const [selectedTab, setTab] = useState<Tab>("clinica");
  const [financeLocked, setFinanceLocked] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SETTINGS_TAB_KEY);
      if (saved && saved in TAB_PERMISSIONS) setTab(saved as Tab);
    } catch {}
  }, []);
  const selectTab = (next: Tab) => {
    setTab(next);
    try {
      window.localStorage.setItem(SETTINGS_TAB_KEY, next);
    } catch {}
  };
  const allowedTabs = (Object.keys(TAB_PERMISSIONS) as Tab[]).filter((key) =>
    canAny(TAB_PERMISSIONS[key]),
  );
  const tab = allowedTabs.includes(selectedTab) ? selectedTab : (allowedTabs[0] ?? "clinica");
  const showAdminLink = canAny(["users.view", "roles.manage", "audit.view"]);
  const sections = SECTIONS.filter((section) => allowedTabs.includes(section.key));
  const term = normalizeSearch(search);
  const visibleSections = term
    ? sections.filter((section) =>
        normalizeSearch(`${section.label} ${section.description}`).includes(term),
      )
    : sections;
  const current = sections.find((section) => section.key === tab);
  return (
    <AppShell title="Configurações">
      <div className="page-container">
        <PageHeader
          title="Configurações"
          description="Organize os dados da clínica, serviços e preferências de operação."
        />
        <div className="grid gap-5 lg:grid-cols-[256px_minmax(0,1fr)] lg:items-start">
          <aside className="min-w-0 lg:sticky lg:top-[88px]">
            <div className="hidden rounded-2xl border border-border bg-card p-2 shadow-xs lg:block">
              <label className="relative mb-2 block">
                <span className="sr-only">Buscar nas configurações</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar"
                  className="h-9 w-full rounded-lg border border-transparent bg-muted pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none"
                />
              </label>
              <nav aria-label="Seções das configurações" className="space-y-0.5">
                {visibleSections.map((section) => {
                  const Icon = section.icon;
                  const active = tab === section.key;
                  return (
                    <button
                      key={section.key}
                      type="button"
                      disabled={financeLocked}
                      aria-current={active ? "page" : undefined}
                      onClick={() => selectTab(section.key)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-md text-white",
                          active ? "bg-white/20" : section.tint,
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="truncate">{section.label}</span>
                    </button>
                  );
                })}
                {visibleSections.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Nenhuma seção encontrada.
                  </p>
                )}
              </nav>
              {showAdminLink && (
                <Link
                  to="/admin"
                  className="mt-2 flex items-center gap-3 rounded-lg border-t border-border-soft px-2.5 pb-2 pt-3 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-md bg-muted-foreground/70 text-white"
                    aria-hidden="true"
                  >
                    <ShieldCheck className="size-4" />
                  </span>
                  Usuários e permissões
                </Link>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:hidden">
              <SegmentedControl
                aria-label="Seções das configurações"
                semantics="navigation"
                value={tab}
                onChange={(next) => {
                  if (!financeLocked) selectTab(next);
                }}
                options={sections.map((section) => ({
                  value: section.key,
                  label: section.label,
                  disabled: financeLocked && section.key !== tab,
                }))}
              />
              {showAdminLink && (
                <Link
                  to="/admin"
                  className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  Usuários e permissões →
                </Link>
              )}
            </div>
          </aside>
          <section aria-labelledby="settings-section-title" className="min-w-0 space-y-4">
            {current && (
              <div>
                <h2 id="settings-section-title" className="text-xl font-semibold text-foreground">
                  {current.label}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{current.description}</p>
              </div>
            )}
            {tab === "clinica" && <ClinicSettings />}
            {tab === "servicos" && <ServiceTypes />}
            {tab === "categorias" && <FinanceCategories />}
            {tab === "contas" && <FinancialAccountSettings onLockChange={setFinanceLocked} />}
            {tab === "cidades" && <CitySettings />}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border-soft overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 px-4 py-3 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const settingsInput =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none";

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
    clinic_name: "",
    cnpj: "",
    phone: "",
    email: "",
    address: "",
    opening_hours: "Seg-Sex 08:00-18:00",
    primary_color: "#6d3ff5",
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
        primary_color: (initialSettings as any).primary_color ?? "#6d3ff5",
      });
    }
  }, [initialSettings]);

  const inp = settingsInput;

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
    <div className="max-w-3xl space-y-5">
      <SettingsGroup title="Identificação">
        <SettingsRow label="Nome da clínica" htmlFor="clinic-name">
          <input
            id="clinic-name"
            value={f.clinic_name}
            onChange={(e) => setF({ ...f, clinic_name: e.target.value })}
            className={inp}
          />
        </SettingsRow>
        <SettingsRow label="CNPJ" htmlFor="clinic-cnpj">
          <input
            id="clinic-cnpj"
            value={f.cnpj}
            onChange={(e) => setF({ ...f, cnpj: e.target.value })}
            className={inp}
          />
        </SettingsRow>
        <SettingsRow label="Cor de identificação" htmlFor="clinic-color">
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="clinic-color"
              type="color"
              aria-describedby="clinic-color-hint"
              value={f.primary_color}
              onChange={(e) => setF({ ...f, primary_color: e.target.value })}
              className="h-9 w-16 cursor-pointer rounded-lg border border-input bg-card p-1"
            />
            <p id="clinic-color-hint" className="min-w-0 flex-1 text-xs text-muted-foreground">
              Cor registrada no cadastro. A interface utiliza o tema MedCore.
            </p>
          </div>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Contato">
        <SettingsRow label="Telefone" htmlFor="clinic-phone">
          <input
            id="clinic-phone"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            className={inp}
          />
        </SettingsRow>
        <SettingsRow label="E-mail" htmlFor="clinic-email">
          <input
            id="clinic-email"
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            className={inp}
          />
        </SettingsRow>
        <SettingsRow label="Endereço" htmlFor="clinic-address">
          <input
            id="clinic-address"
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            className={inp}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Funcionamento">
        <SettingsRow label="Horário de funcionamento" htmlFor="clinic-hours">
          <input
            id="clinic-hours"
            value={f.opening_hours}
            onChange={(e) => setF({ ...f, opening_hours: e.target.value })}
            className={inp}
            placeholder="Seg-Sex 08:00-18:00"
          />
        </SettingsRow>
      </SettingsGroup>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg && (
          <span role="status" className="text-xs font-medium text-success">
            {msg}
          </span>
        )}
        <Button onClick={save} disabled={saving}>
          <Save /> {saving ? "Salvando…" : "Salvar"}
        </Button>
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
    const { error } = await (supabase as DbRow).from("service_types").delete().eq("id", s.id);
    if (error) toast.error("Erro: " + error.message);
    else {
      toast.success("Serviço excluído");
      load();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpenNew(true)}>
          <Plus /> Novo serviço
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
        <table className="mc-table">
          <thead>
            <tr>
              <th scope="col">Serviço</th>
              <th scope="col" className="num">
                Preço
              </th>
              <th scope="col" className="num">
                Duração
              </th>
              <th scope="col" className="num">
                Comissão
              </th>
              <th scope="col" className="num">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-foreground">{r.name}</td>
                <td className="num">{r.price ? `R$ ${Number(r.price).toFixed(2)}` : "—"}</td>
                <td className="num">{r.duration_minutes ? `${r.duration_minutes} min` : "—"}</td>
                <td className="num">{r.commission_percent ? `${r.commission_percent}%` : "—"}</td>
                <td className="num">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      aria-label={`Editar ${r.name}`}
                      title="Editar"
                      className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteService(r)}
                      aria-label={`Excluir ${r.name}`}
                      title="Excluir"
                      className="inline-flex size-8 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-muted-foreground">
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
  const inp = cn(settingsInput, "mt-1 h-10");

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{service ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>Preço, duração e comissão usados nos agendamentos.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="service-name" className="text-xs text-muted-foreground">
              Nome *
            </label>
            <input
              id="service-name"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              className={inp}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="service-price" className="text-xs text-muted-foreground">
              Preço (R$)
            </label>
            <input
              id="service-price"
              value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value })}
              className={inp}
            />
          </div>
          <div>
            <label htmlFor="service-duration" className="text-xs text-muted-foreground">
              Duração (min)
            </label>
            <input
              id="service-duration"
              type="number"
              value={f.duration_minutes}
              onChange={(e) => setF({ ...f, duration_minutes: e.target.value })}
              className={inp}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="service-commission" className="text-xs text-muted-foreground">
              Comissão (%)
            </label>
            <input
              id="service-commission"
              value={f.commission_percent}
              onChange={(e) => setF({ ...f, commission_percent: e.target.value })}
              className={inp}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !f.name.trim()}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {(["income", "expense"] as const).map((t) => {
        const items = rows.filter((r) => r.type === t);
        const title = t === "income" ? "Receitas" : "Despesas";
        return (
          <SettingsGroup key={t} title={title}>
            {items.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm text-foreground">{r.name}</span>
                <button
                  type="button"
                  onClick={() => del(r.id)}
                  aria-label={`Excluir categoria ${r.name}`}
                  title="Excluir"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                Sem categorias.
              </div>
            )}
            <div className="flex gap-2 bg-muted/40 px-3 py-2.5">
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
                aria-label={`Nova categoria de ${title.toLowerCase()}`}
                className={cn(settingsInput, "flex-1")}
              />
              <Button
                size="icon"
                className="size-9"
                aria-label={`Adicionar categoria de ${title.toLowerCase()}`}
                onClick={() => {
                  setNewType(t);
                  if (newType === t) add();
                }}
              >
                <Plus />
              </Button>
            </div>
          </SettingsGroup>
        );
      })}
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
    <div className="max-w-2xl space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={newCity}
          onChange={(e) => setNewCity(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="Digite o nome da nova cidade (Ex: Campinas, Santos…)"
          aria-label="Nome da nova cidade"
          className={cn(settingsInput, "h-10 flex-1")}
        />
        <Button type="button" onClick={handleAdd}>
          <Plus /> Adicionar cidade
        </Button>
      </div>

      <SettingsGroup title="Cidades cadastradas">
        {cities.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Nenhuma cidade cadastrada.
          </div>
        ) : (
          cities.map((city) => (
            <div key={city} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                <MapPin size={14} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{city}</span>
              </span>
              <button
                type="button"
                onClick={() => handleRemove(city)}
                aria-label={`Remover ${city}`}
                title="Remover cidade"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </SettingsGroup>
    </div>
  );
}

function FinancialAccountSettings({ onLockChange }: { onLockChange: (locked: boolean) => void }) {
  const query = useQuery({ queryKey: ["financial-snapshot"], queryFn: getFinancialSnapshot });
  return (
    <>
      {query.isPending && <p>Carregando contas...</p>}
      {query.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}{" "}
          <button className="underline" onClick={() => query.refetch()}>
            Tentar novamente
          </button>
        </p>
      )}
      {query.data && !query.error && (
        <FinanceOperations finance={query.data} mode="contas" onLockChange={onLockChange} />
      )}
    </>
  );
}

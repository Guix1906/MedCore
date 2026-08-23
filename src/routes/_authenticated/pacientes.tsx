import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  X,
  Phone,
  Mail,
  Calendar as CalIcon,
  Pencil,
  Trash2,
  FileText,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { TableVirtuoso } from "react-virtuoso";
import AppShell from "@/components/AppShell";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { patientsService } from "@/services/api";
import { useAutoAnimate } from "@/hooks/use-auto-animate";
import { PatientFullProfileView } from "@/components/pacientes/PatientFullProfileView";

export const Route = createFileRoute("/_authenticated/pacientes")({
  head: () => ({
    meta: [
      { title: "Pacientes • ClinicMed" },
      { name: "description", content: "Cadastro e gestão de pacientes ClinicMed." },
    ],
  }),
  component: PacientesPage,
});

type DbRow = Record<string, any>;

type Patient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpf: string | null;
  birth_date: string | null;
  gender: string | null;
  insurance: string | null;
  address?: string | null;
  city: string | null;
  state: string | null;
  zip_code?: string | null;
  notes?: string | null;
  active: boolean;
  created_at: string;
};

function ageFrom(bd: string | null) {
  if (!bd) return null;
  const d = new Date(bd);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

const VIRTUALIZE_THRESHOLD = 100;

function PacientesPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Patient | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["patients-list"],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const phpData = await patientsService.getPatients({ limit: 2000 });
        if (phpData && Array.isArray(phpData)) {
          return phpData as Patient[];
        }
      } catch {}
      const { data } = await supabase
        .from("patients")
        .select("id,name,email,phone,cpf,birth_date,gender,insurance,city,state,address,zip_code,notes,active,created_at")
        .order("name")
        .limit(2000);
      return (data ?? []) as Patient[];
    },
  });

  const refreshPatients = () => {
    queryClient.invalidateQueries({ queryKey: ["patients-list"] });
  };

  const deletePatient = async (p: Patient) => {
    const ok = await confirmDialog({
      title: "Excluir paciente",
      description: `Tem certeza que deseja excluir "${p.name}"? Todos os dados relacionados podem ser afetados.`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await patientsService.deletePatient(p.id);
      toast.success("Paciente excluído");
      refreshPatients();
      return;
    } catch {}
    const { error } = await supabase.from("patients").delete().eq("id", p.id);
    if (error) toast.error("Erro: " + error.message);
    else {
      toast.success("Paciente excluído");
      refreshPatients();
    }
  };

  const columnHelper = createColumnHelper<Patient>();
  const columns = useMemo(
    () => [
      columnHelper.accessor("name", { header: "Nome" }),
      columnHelper.accessor((r) => r.phone ?? r.email ?? "", {
        id: "contato",
        header: "Contato",
        enableSorting: false,
      }),
      columnHelper.accessor("cpf", { header: "CPF" }),
      columnHelper.accessor((r) => ageFrom(r.birth_date) ?? -1, { id: "idade", header: "Idade" }),
      columnHelper.accessor((r) => r.insurance ?? "Particular", {
        id: "insurance",
        header: "Convênio",
      }),
      columnHelper.accessor("active", { header: "Status" }),
      columnHelper.display({ id: "actions", header: "Ações" }),
    ],
    [columnHelper],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: q },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQ,
    globalFilterFn: (row, _colId, filter) => {
      const s = String(filter).trim().toLowerCase();
      if (!s) return true;
      const r = row.original;
      return (
        r.name.toLowerCase().includes(s) ||
        (r.email?.toLowerCase().includes(s) ?? false) ||
        (r.phone?.toLowerCase().includes(s) ?? false) ||
        (r.cpf?.toLowerCase().includes(s) ?? false)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const sortedRows = table.getRowModel().rows;
  const shouldVirtualize = sortedRows.length > VIRTUALIZE_THRESHOLD;

  const tbodyRef = useAutoAnimate<HTMLTableSectionElement>();

  const headerCell = (colId: string, label: string, sortable = true) => {
    const col = table.getColumn(colId);
    const sorted = col?.getIsSorted();
    return (
      <th
        className={`px-4 py-3 font-medium ${sortable ? "cursor-pointer select-none hover:text-[#111827]" : ""} ${colId === "actions" ? "text-right" : "text-left"}`}
        onClick={sortable ? col?.getToggleSortingHandler() : undefined}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortable &&
            (sorted === "asc" ? (
              <ArrowUp size={12} />
            ) : sorted === "desc" ? (
              <ArrowDown size={12} />
            ) : (
              <ArrowUpDown size={12} className="opacity-40" />
            ))}
        </span>
      </th>
    );
  };

  const renderRow = (p: Patient) => (
    <>
      <td className="px-4 py-3 font-medium text-[#111827]">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[#EDE4FF] text-[#8B47FF] flex items-center justify-center text-[12px] font-bold shrink-0">
            {p.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <span className="hover:text-[#8B47FF] hover:underline transition-colors font-semibold">
            {p.name}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-[#374151]">
        <div className="flex flex-col">
          {p.phone && <span className="text-[12px]">{p.phone}</span>}
          {p.email && <span className="text-[11px] text-[#6B7280]">{p.email}</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-[#374151]">{p.cpf ?? "—"}</td>
      <td className="px-4 py-3 text-[#374151]">{ageFrom(p.birth_date) ?? "—"}</td>
      <td className="px-4 py-3 text-[#374151]">{p.insurance ?? "Particular"}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
            p.active ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#F3F4F6] text-[#6B7280]"
          }`}
        >
          {p.active ? "Ativo" : "Inativo"}
        </span>
      </td>
      <td
        className="px-4 py-3 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex gap-1">
          <Link
            to="/prontuario"
            search={{ patientName: p.name, patientId: p.id } as never}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[#E5E7EB] text-[12px] font-medium text-[#8B47FF] hover:bg-[#FAF7FF] transition-colors"
            title="Abrir prontuário"
          >
            <FileText size={13} />
          </Link>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(p);
            }}
            className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[#E5E7EB] text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB] transition-colors cursor-pointer"
            title="Editar"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deletePatient(p);
            }}
            className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[#E5E7EB] text-[12px] font-medium text-[#991B1B] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
            title="Excluir"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </>
  );

  const HeaderRow = () => (
    <tr>
      {headerCell("name", "Nome")}
      {headerCell("contato", "Contato", false)}
      {headerCell("cpf", "CPF")}
      {headerCell("idade", "Idade")}
      {headerCell("insurance", "Convênio")}
      {headerCell("active", "Status")}
      {headerCell("actions", "Ações", false)}
    </tr>
  );

  if (selected) {
    return (
      <AppShell title={selected.name}>
        <PatientFullProfileView
          patient={{
            id: selected.id,
            name: selected.name,
            email: selected.email,
            phone: selected.phone,
            cpf: selected.cpf,
            gender: selected.gender,
            insurance: selected.insurance,
            birth_date: selected.birth_date
              ? `${new Date(selected.birth_date).toLocaleDateString("pt-BR")}`
              : null,
            age: selected.birth_date ? `${ageFrom(selected.birth_date)} anos` : null,
            address: selected.address,
            city: selected.city,
            state: selected.state,
            cep: selected.zip_code,
            notes: selected.notes,
            active: selected.active,
            created_at: new Date(selected.created_at).toLocaleString("pt-BR"),
          }}
          onBack={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
          }}
        />
        {editing && (
          <PatientModal
            patient={editing}
            onClose={() => setEditing(null)}
            onSaved={(updated) => {
              refreshPatients();
              if (updated) {
                setSelected((prev) => (prev ? { ...prev, ...updated } : updated));
              }
              setEditing(null);
            }}
          />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell title="Pacientes">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome, CPF, telefone ou e-mail…"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] focus:outline-none focus:border-[#8B47FF]"
            />
          </div>
          <div className="text-[12px] text-[#6B7280]">
            {loading
              ? "Carregando…"
              : `${sortedRows.length} paciente${sortedRows.length === 1 ? "" : "s"}`}
            {shouldVirtualize && <span className="ml-2 text-[#8B47FF]">• virtualizado</span>}
          </div>
          <button
            onClick={() => setOpenNew(true)}
            className="ml-auto inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold hover:bg-[#7A3AE6] transition-colors cursor-pointer"
          >
            <Plus size={16} /> Novo paciente
          </button>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden shadow-sm">
          {shouldVirtualize ? (
            <TableVirtuoso
              style={{ height: 600 }}
              data={sortedRows.map((r) => r.original)}
              components={{
                Table: (props) => <table {...props} className="w-full text-[13px]" />,
                TableHead: (props) => (
                  <thead {...props} className="bg-[#F9FAFB] text-[#6B7280] text-left" />
                ),
                TableRow: (props: any) => {
                  const patient = props.item;
                  return (
                    <tr
                      {...props}
                      onClick={() => patient && setSelected(patient)}
                      className="border-t border-[#F3F4F6] hover:bg-[#FAF7FF] cursor-pointer transition-colors"
                    />
                  );
                },
              }}
              fixedHeaderContent={() => <HeaderRow />}
              itemContent={(_i, p) => renderRow(p)}
            />
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-[#F9FAFB] text-[#6B7280] text-left">
                <HeaderRow />
              </thead>
              <tbody ref={tbodyRef}>
                {sortedRows.map((r) => (
                  <tr
                    key={r.original.id}
                    onClick={() => setSelected(r.original)}
                    className="border-t border-[#F3F4F6] hover:bg-[#FAF7FF] cursor-pointer transition-colors"
                  >
                    {renderRow(r.original)}
                  </tr>
                ))}
                {!loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[#6B7280]">
                      Nenhum paciente encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {(openNew || editing) && (
        <PatientModal
          patient={editing}
          onClose={() => {
            setOpenNew(false);
            setEditing(null);
          }}
          onSaved={refreshPatients}
        />
      )}
    </AppShell>
  );
}

type TabKey = "dados" | "consultas" | "prontuario" | "financeiro" | "tratamentos" | "anexos";

function PatientDrawer({
  patient,
  onClose,
  onEdit,
  onChanged,
}: {
  patient: Patient;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("dados");
  const [appts, setAppts] = useState<DbRow[]>([]);
  const [txs, setTxs] = useState<DbRow[]>([]);
  const [treatments, setTreatments] = useState<DbRow[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  const toggleActive = async () => {
    await supabase.from("patients").update({ active: !patient.active }).eq("id", patient.id);
    onChanged();
    onClose();
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoadingTab(true);
      if (tab === "consultas" && appts.length === 0) {
        const { data } = await supabase
          .from("appointments")
          .select("id,date,start_time,end_time,status,type,notes,doctors(name)")
          .eq("patient_id", patient.id)
          .order("date", { ascending: false })
          .order("start_time", { ascending: false })
          .limit(50);
        if (!cancelled) setAppts(data ?? []);
      } else if (tab === "financeiro" && txs.length === 0) {
        const { data } = await supabase
          .from("transactions")
          .select("id,description,amount,type,status,due_date,paid_at")
          .eq("patient_id", patient.id)
          .order("due_date", { ascending: false })
          .limit(50);
        if (!cancelled) setTxs(data ?? []);
      } else if (tab === "tratamentos" && treatments.length === 0) {
        const { data } = await supabase
          .from("treatments")
          .select("id,title,status,start_date,end_date,total_value")
          .eq("patient_id", patient.id)
          .order("start_date", { ascending: false })
          .limit(50);
        if (!cancelled) setTreatments(data ?? []);
      }
      if (!cancelled) setLoadingTab(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [tab, patient.id]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "dados", label: "Dados" },
    { key: "consultas", label: "Consultas" },
    { key: "prontuario", label: "Prontuário" },
    { key: "tratamentos", label: "Tratamentos" },
    { key: "financeiro", label: "Financeiro" },
    { key: "anexos", label: "Anexos" },
  ];

  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
  const fmtDateTime = (d: string | null) =>
    d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex justify-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[560px] bg-white h-full overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-[#EDE4FF] text-[#8B47FF] flex items-center justify-center text-[14px] font-bold">
              {patient.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#111827]">{patient.name}</h2>
              <div className="text-[11px] text-[#6B7280]">
                {patient.cpf ?? "CPF não informado"}
                {patient.birth_date && ` • ${ageFrom(patient.birth_date)} anos`}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#111827]">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-4 border-b border-[#E5E7EB] bg-[#FAFAFB] overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative px-3 py-3 text-[12px] font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? "text-[#8B47FF]" : "text-[#6B7280] hover:text-[#111827]"
              }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t bg-[#8B47FF]" />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6">
          {tab === "dados" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2 text-[13px]">
                {patient.phone && (
                  <div className="flex items-center gap-2 text-[#374151]">
                    <Phone size={14} /> {patient.phone}
                  </div>
                )}
                {patient.email && (
                  <div className="flex items-center gap-2 text-[#374151]">
                    <Mail size={14} /> {patient.email}
                  </div>
                )}
                {patient.birth_date && (
                  <div className="flex items-center gap-2 text-[#374151]">
                    <CalIcon size={14} /> {new Date(patient.birth_date).toLocaleDateString("pt-BR")}
                  </div>
                )}
              </div>
              <dl className="text-[13px] divide-y divide-[#F3F4F6] border-t border-b border-[#F3F4F6]">
                {[
                  ["Gênero", patient.gender ?? "—"],
                  ["Convênio", patient.insurance ?? "Particular"],
                  [
                    "Cidade",
                    patient.city
                      ? `${patient.city}${patient.state ? "/" + patient.state : ""}`
                      : "—",
                  ],
                  ["Status", patient.active ? "Ativo" : "Inativo"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2">
                    <dt className="text-[#6B7280]">{k}</dt>
                    <dd className="text-[#111827] font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {tab === "consultas" && (
            <TabList
              loading={loadingTab}
              empty="Nenhuma consulta registrada."
              items={appts}
              render={(a) => (
                <div
                  key={a.id}
                  className="p-3 rounded-lg border border-[#E5E7EB] hover:border-[#8B47FF] transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[13px] font-medium text-[#111827]">
                        {a.type ?? "Consulta"}
                      </div>
                      <div className="text-[11px] text-[#6B7280]">
                        {fmtDate(a.date)} {String(a.start_time ?? "").slice(0, 5)}
                      </div>
                      {a.doctors?.name && (
                        <div className="text-[11px] text-[#6B7280]">Dr(a). {a.doctors.name}</div>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#374151] uppercase font-medium">
                      {a.status}
                    </span>
                  </div>
                </div>
              )}
            />
          )}

          {tab === "prontuario" && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
              <FileText size={40} className="text-[#8B47FF] opacity-60" />
              <div className="text-[13px] text-[#6B7280]">
                Abra o prontuário completo do paciente em uma nova tela.
              </div>
              <Link
                to="/prontuario"
                search={{ patientName: patient.name, patientId: patient.id } as never}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold hover:bg-[#7A3AE6]"
              >
                <FileText size={14} /> Abrir prontuário
              </Link>
            </div>
          )}

          {tab === "tratamentos" && (
            <TabList
              loading={loadingTab}
              empty="Nenhum tratamento em andamento."
              items={treatments}
              render={(t) => (
                <div key={t.id} className="p-3 rounded-lg border border-[#E5E7EB]">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[13px] font-medium text-[#111827]">{t.title}</div>
                      <div className="text-[11px] text-[#6B7280]">
                        {fmtDate(t.start_date)} → {fmtDate(t.end_date)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-bold text-[#8B47FF]">
                        {brl(Number(t.total_value ?? 0))}
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#374151] uppercase">
                        {t.status}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            />
          )}

          {tab === "financeiro" && (
            <TabList
              loading={loadingTab}
              empty="Nenhuma movimentação financeira."
              items={txs}
              render={(t) => (
                <div
                  key={t.id}
                  className="p-3 rounded-lg border border-[#E5E7EB] flex justify-between items-center"
                >
                  <div>
                    <div className="text-[13px] font-medium text-[#111827]">
                      {t.description ?? "—"}
                    </div>
                    <div className="text-[11px] text-[#6B7280]">
                      Venc. {fmtDate(t.due_date)}
                      {t.paid_at && ` • Pago ${fmtDate(t.paid_at)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-[13px] font-bold ${t.type === "receita" || t.type === "income" ? "text-[#16A34A]" : "text-[#DC2626]"}`}
                    >
                      {brl(Number(t.amount ?? 0))}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#374151] uppercase">
                      {t.status}
                    </span>
                  </div>
                </div>
              )}
            />
          )}

          {tab === "anexos" && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="h-14 w-14 rounded-full bg-[#F3F4F6] flex items-center justify-center">
                <FileText size={22} className="text-[#9CA3AF]" />
              </div>
              <div className="text-[13px] text-[#6B7280]">Nenhum anexo enviado.</div>
              <div className="text-[11px] text-[#9CA3AF]">
                Em breve: upload de exames e documentos.
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#E5E7EB] p-4 flex gap-2">
          <button
            onClick={onEdit}
            className="flex-1 h-10 rounded-lg bg-[#8B47FF] text-white text-[13px] font-semibold hover:bg-[#7A3AE6]"
          >
            Editar
          </button>
          <button
            onClick={toggleActive}
            className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            {patient.active ? "Desativar" : "Ativar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabList<T>({
  loading,
  empty,
  items,
  render,
}: {
  loading: boolean;
  empty: string;
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  if (loading)
    return <div className="py-8 text-center text-[12px] text-[#6B7280]">Carregando…</div>;
  if (items.length === 0)
    return <div className="py-12 text-center text-[13px] text-[#6B7280]">{empty}</div>;
  return <div className="space-y-2">{items.map(render)}</div>;
}

function PatientModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: Patient | null;
  onClose: () => void;
  onSaved: (updated?: Patient) => void;
}) {
  const [f, setF] = useState({
    name: patient?.name ?? "",
    phone: patient?.phone ?? "",
    email: patient?.email ?? "",
    cpf: patient?.cpf ?? "",
    birth_date: patient?.birth_date ?? "",
    gender: patient?.gender ?? "",
    insurance: patient?.insurance ?? "",
    address: patient?.address ?? "",
    city: patient?.city ?? "",
    state: patient?.state ?? "",
    zip_code: patient?.zip_code ?? "",
    notes: patient?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!f.name.trim()) return;
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      phone: f.phone || null,
      email: f.email || null,
      cpf: f.cpf || null,
      gender: f.gender || null,
      insurance: f.insurance || null,
      birth_date: f.birth_date || null,
      address: f.address || null,
      city: f.city || null,
      state: f.state || null,
      zip_code: f.zip_code || null,
      notes: f.notes || null,
    };
    const { data: savedData, error } = patient
      ? await supabase.from("patients").update(payload).eq("id", patient.id).select().maybeSingle()
      : await supabase.from("patients").insert({ ...payload, active: true }).select().maybeSingle();
    setSaving(false);
    if (!error) {
      toast.success(patient ? "Paciente atualizado" : "Paciente cadastrado");
      onSaved((savedData as Patient) || ({ ...patient, ...payload, id: patient?.id ?? "" } as Patient));
      onClose();
    } else {
      toast.error("Erro: " + error.message);
    }
  };

  const inp =
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]";

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[560px] bg-white rounded-2xl p-6 shadow-2xl my-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-[#111827]">
            {patient ? "Editar paciente" : "Novo paciente"}
          </h2>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">Nome completo *</label>
            <input value={f.name} onChange={set("name")} className={inp} autoFocus />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Telefone / WhatsApp</label>
            <input value={f.phone} onChange={set("phone")} className={inp} placeholder="(00) 00000-0000" />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">CPF</label>
            <input value={f.cpf} onChange={set("cpf")} className={inp} placeholder="000.000.000-00" />
          </div>
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">E-mail</label>
            <input type="email" value={f.email} onChange={set("email")} className={inp} placeholder="email@exemplo.com" />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Data de nascimento</label>
            <input type="date" value={f.birth_date} onChange={set("birth_date")} className={inp} />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Sexo / Gênero</label>
            <select value={f.gender} onChange={set("gender")} className={inp}>
              <option value="">— Selecione —</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
              <option value="O">Outro</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">Convênio</label>
            <input
              value={f.insurance}
              onChange={set("insurance")}
              className={inp}
              placeholder="Ex: Unimed, Particular..."
            />
          </div>

          <div className="col-span-2 pt-1 border-t border-slate-100">
            <label className="text-[12px] text-[#6B7280] font-medium">Endereço (Rua e número)</label>
            <input value={f.address} onChange={set("address")} className={inp} placeholder="Ex: Av. Paulista, 1000 - Apto 42" />
          </div>
          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Cidade</label>
            <input value={f.city} onChange={set("city")} className={inp} placeholder="Ex: São Paulo" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[12px] text-[#6B7280] font-medium">UF</label>
              <input value={f.state} onChange={set("state")} className={inp} maxLength={2} placeholder="SP" />
            </div>
            <div>
              <label className="text-[12px] text-[#6B7280] font-medium">CEP</label>
              <input value={f.zip_code} onChange={set("zip_code")} className={inp} placeholder="00000-000" />
            </div>
          </div>

          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">Observações</label>
            <textarea
              value={f.notes}
              onChange={set("notes")}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF] resize-none"
              placeholder="Anotações gerais sobre o paciente..."
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#374151] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !f.name.trim()}
            className="h-10 px-5 rounded-lg bg-[#8B47FF] hover:bg-[#7836ea] text-white text-[13px] font-semibold disabled:opacity-60 transition-colors cursor-pointer"
          >
            {saving ? "Salvando…" : "Salvar informações"}
          </button>
        </div>
      </div>
    </div>
  );
}

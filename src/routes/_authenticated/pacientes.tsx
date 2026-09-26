import AppShell from "@/components/AppShell";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { PatientFullProfileView } from "@/components/pacientes/PatientFullProfileView";
import { PatientModal } from "@/components/pacientes/PatientModal";
import {
  BrandLoader,
  EmptyState,
  PageHeader,
  SegmentedControl,
  SkeletonTable,
} from "@/components/ui-app";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePatient } from "@/hooks/use-patient";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { deleteStoredLocalPatient, mergeWithLocalPatients } from "@/lib/local-patients";
import { patientAge, patientProfileData } from "@/lib/patient-display";
import { patientsService, type Patient } from "@/services/api/patients.service";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { TableVirtuoso, Virtuoso } from "react-virtuoso";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pacientes")({
  head: () => ({
    meta: [
      { title: "Pacientes • MedCore" },
      {
        name: "description",
        content: "Cadastro, histórico e acompanhamento dos pacientes da clínica.",
      },
    ],
  }),
  validateSearch: (search: SearchSchemaInput & { patientId?: unknown; novo?: unknown }) => ({
    patientId:
      typeof search.patientId === "string" && search.patientId.trim()
        ? search.patientId
        : undefined,
    novo: search.novo === true || search.novo === "true" ? true : undefined,
  }),
  component: PacientesPage,
});

const columnHelper = createColumnHelper<Patient>();
const columns = [
  columnHelper.accessor("name", { header: "Paciente" }),
  columnHelper.accessor((patient) => patient.phone ?? patient.email ?? "", {
    id: "contato",
    header: "Contato",
    enableSorting: false,
  }),
  columnHelper.accessor("cpf", { header: "CPF" }),
  columnHelper.accessor((patient) => patientAge(patient.birth_date) ?? -1, {
    id: "idade",
    header: "Idade",
  }),
  columnHelper.accessor((patient) => patient.insurance ?? "Particular", {
    id: "insurance",
    header: "Convênio",
  }),
  columnHelper.accessor("active", { header: "Status" }),
  columnHelper.display({ id: "actions", header: "Ações" }),
];

function PatientStatus({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${active ? "border-success/20 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}

function PacientesPage() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isMobile = useIsMobile();
  const { can } = usePermissions();
  const canManage = can("patients.manage");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("todos");
  const [editing, setEditing] = useState<Patient | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const patients = useQuery({
    queryKey: ["patients-list"],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Patient[]> => {
      let remote: Patient[] | undefined;
      try {
        remote = await patientsService.getPatients({ limit: 2000 });
      } catch (error) {
        console.warn("Buscando pacientes na fonte alternativa.", error);
      }
      if (remote?.length) return mergeWithLocalPatients(remote);
      const { data, error } = await supabase.from("patients").select("*").order("name").limit(2000);
      if (error) {
        if (!remote) throw error;
        console.warn("A fonte alternativa de pacientes não está disponível.", error);
      }
      return mergeWithLocalPatients(data ?? remote ?? []);
    },
  });
  const patientQuery = usePatient(search.patientId);
  const selected = patientQuery.data;
  const rows = patients.data ?? [];
  const filteredByStatus = useMemo(
    () =>
      (patients.data ?? []).filter(
        (patient) => status === "todos" || patient.active === (status === "ativos"),
      ),
    [patients.data, status],
  );
  const refreshPatients = () => {
    void queryClient.invalidateQueries({ queryKey: ["patients-list"] });
    void queryClient.invalidateQueries({ queryKey: ["patient-profile"] });
  };
  const openPatient = (patient: Patient) => void navigate({ search: { patientId: patient.id } });
  const closeForm = () => {
    setEditing(null);
    if (search.novo) void navigate({ search: { ...search, novo: undefined }, replace: true });
  };
  const deletePatient = async (patient: Patient) => {
    if (
      !(await confirmDialog({
        title: "Excluir paciente",
        description: `Tem certeza que deseja excluir "${patient.name}"? Os dados relacionados podem ser afetados.`,
        confirmText: "Excluir",
        destructive: true,
      }))
    )
      return;
    try {
      try {
        await patientsService.deletePatient(patient.id);
      } catch {
        const { error } = await supabase.from("patients").delete().eq("id", patient.id);
        if (error) throw error;
      }
      deleteStoredLocalPatient(patient.id);
      refreshPatients();
      toast.success("Paciente excluído");
    } catch (error) {
      console.error("Erro ao excluir paciente.", error);
      toast.error("Não foi possível excluir o paciente. Tente novamente.");
    }
  };

  const table = useReactTable({
    data: filteredByStatus,
    columns,
    state: { sorting, globalFilter: q },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQ,
    globalFilterFn: (row, _column, value) => {
      const term = String(value).trim().toLocaleLowerCase("pt-BR");
      const patient = row.original;
      return [patient.name, patient.email, patient.phone, patient.cpf].some((field) =>
        field?.toLocaleLowerCase("pt-BR").includes(term),
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const sortedRows = table.getRowModel().rows.map((row) => row.original);

  const actions = (patient: Patient) => (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {can("records.view") && (
        <Button asChild variant="ghost" size="icon" className="size-9 text-primary">
          <Link
            to="/prontuario"
            search={{ patientId: patient.id, patientName: patient.name }}
            aria-label={`Abrir prontuário de ${patient.name}`}
            title="Abrir prontuário"
          >
            <FileText />
          </Link>
        </Button>
      )}
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label={`Ações de ${patient.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(patient)}>
              <Pencil />
              Editar cadastro
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void deletePatient(patient)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 />
              Excluir paciente
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  const patientName = (patient: Patient) => (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary"
        aria-hidden="true"
      >
        {patient.name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase()}
      </span>
      <button
        type="button"
        onClick={() => openPatient(patient)}
        className="min-w-0 rounded text-left text-sm font-semibold text-foreground hover:text-primary hover:underline"
      >
        {patient.name}
      </button>
    </div>
  );
  const rowCells = (patient: Patient) => (
    <>
      <td className="px-4 py-4">{patientName(patient)}</td>
      <td className="px-4 py-4">
        <p className="text-sm">{patient.phone || "Não informado"}</p>
        {patient.email && <p className="mt-0.5 text-xs text-muted-foreground">{patient.email}</p>}
      </td>
      <td className="px-4 py-4 text-sm tabular-nums text-muted-foreground">
        {patient.cpf || "Não informado"}
      </td>
      <td className="px-4 py-4 text-sm tabular-nums">{patientAge(patient.birth_date) ?? "—"}</td>
      <td className="px-4 py-4 text-sm">{patient.insurance || "Particular"}</td>
      <td className="px-4 py-4">
        <PatientStatus active={patient.active} />
      </td>
      <td className="px-3 py-4">{actions(patient)}</td>
    </>
  );
  const header = () => (
    <tr>
      {columns.map((definition) => {
        const id =
          "id" in definition && definition.id
            ? definition.id
            : "accessorKey" in definition
              ? String(definition.accessorKey)
              : "";
        const column = table.getColumn(id);
        const sortable = column?.getCanSort();
        const direction = column?.getIsSorted();
        const label = String(definition.header);
        return (
          <th
            key={id}
            scope="col"
            aria-sort={
              sortable
                ? direction === "asc"
                  ? "ascending"
                  : direction === "desc"
                    ? "descending"
                    : "none"
                : undefined
            }
            className={`px-4 py-3 text-xs font-medium text-muted-foreground ${id === "actions" ? "text-right" : "text-left"}`}
          >
            {sortable ? (
              <button
                type="button"
                onClick={column?.getToggleSortingHandler()}
                className="inline-flex items-center gap-1.5 rounded hover:text-foreground"
              >
                {label}
                {direction === "asc" ? (
                  <ArrowUp size={14} />
                ) : direction === "desc" ? (
                  <ArrowDown size={14} />
                ) : (
                  <ArrowUpDown size={14} className="opacity-60" />
                )}
              </button>
            ) : (
              label
            )}
          </th>
        );
      })}
    </tr>
  );
  const mobileCard = (patient: Patient) => (
    <article className="mb-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        {patientName(patient)}
        {actions(patient)}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-soft pt-3">
        <div className="min-w-0 text-sm">
          <p>{patient.phone || "Telefone não informado"}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {patient.insurance || "Particular"}
            {patientAge(patient.birth_date) !== null
              ? ` · ${patientAge(patient.birth_date)} anos`
              : ""}
          </p>
        </div>
        <PatientStatus active={patient.active} />
      </div>
    </article>
  );

  const form =
    (search.novo || editing) && canManage ? (
      <PatientModal
        key={editing?.id ?? "new"}
        patient={editing}
        onClose={closeForm}
        onSaved={refreshPatients}
      />
    ) : null;

  if (search.patientId) {
    return (
      <AppShell title="Pacientes">
        {patientQuery.isPending ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <BrandLoader label="Carregando paciente…" />
          </div>
        ) : patientQuery.error ? (
          <div className="page-container">
            <EmptyState
              title="Não foi possível abrir a ficha"
              description="Verifique sua conexão e tente novamente."
              action={
                <Button variant="outline" onClick={() => void patientQuery.refetch()}>
                  Tentar novamente
                </Button>
              }
            />
          </div>
        ) : selected ? (
          <PatientFullProfileView
            key={selected.id}
            patient={patientProfileData(selected)}
            onBack={() => void navigate({ search: {} })}
            onEdit={canManage ? () => setEditing(selected) : undefined}
          />
        ) : (
          <div className="page-container">
            <EmptyState
              title="Paciente não encontrado"
              description="Este cadastro não está disponível para o seu acesso."
              action={
                <Button variant="outline" onClick={() => void navigate({ search: {} })}>
                  Voltar para pacientes
                </Button>
              }
            />
          </div>
        )}
        {form}
      </AppShell>
    );
  }

  return (
    <AppShell title="Pacientes">
      <div className="page-container space-y-5">
        <PageHeader
          title="Pacientes"
          icon={Users}
          description="Cadastros, contatos e histórico de quem você cuida."
          actions={
            canManage && (
              <Button onClick={() => void navigate({ search: { novo: true } })}>
                <Plus />
                Novo paciente
              </Button>
            )
          }
        />
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-xs md:p-4">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            />
            <Input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              aria-label="Buscar pacientes"
              placeholder="Nome, CPF, telefone ou e-mail"
              className="rounded-full pl-9"
            />
          </div>
          <SegmentedControl
            aria-label="Filtrar por status"
            value={status as "todos" | "ativos" | "inativos"}
            onChange={setStatus}
            options={[
              { value: "todos", label: "Todos" },
              { value: "ativos", label: "Ativos" },
              { value: "inativos", label: "Inativos" },
            ]}
          />
          {isMobile && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Ordem</span>
              <select
                value={sorting[0]?.desc ? "desc" : "asc"}
                onChange={(event) =>
                  setSorting([{ id: "name", desc: event.target.value === "desc" }])
                }
                className="h-10 rounded-lg border border-input bg-card px-3"
              >
                <option value="asc">Nome A–Z</option>
                <option value="desc">Nome Z–A</option>
              </select>
            </label>
          )}
          {!patients.isPending && !patients.error && (
            <p role="status" className="text-sm text-muted-foreground">
              {sortedRows.length} de {rows.length} pacientes
            </p>
          )}
        </div>
        {patients.isPending ? (
          <SkeletonTable rows={6} columns={isMobile ? 2 : 7} />
        ) : patients.error ? (
          <div role="alert">
            <EmptyState
              title="Não foi possível carregar os pacientes"
              description="Os cadastros não foram alterados. Tente carregar a lista novamente."
              action={
                <Button variant="outline" onClick={() => void patients.refetch()}>
                  Tentar novamente
                </Button>
              }
            />
          </div>
        ) : !sortedRows.length ? (
          <EmptyState
            title={
              q || status !== "todos"
                ? "Nenhum paciente encontrado"
                : "Sua lista de pacientes começa aqui"
            }
            description={
              q || status !== "todos"
                ? "Tente outro termo ou remova os filtros."
                : "Cadastre o primeiro paciente para organizar seu histórico e seus atendimentos."
            }
            illustration={<Users size={24} />}
            action={
              q || status !== "todos" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setStatus("todos");
                  }}
                >
                  Limpar filtros
                </Button>
              ) : (
                canManage && (
                  <Button onClick={() => void navigate({ search: { novo: true } })}>
                    <Plus />
                    Cadastrar paciente
                  </Button>
                )
              )
            }
          />
        ) : isMobile ? (
          sortedRows.length > 100 ? (
            <Virtuoso
              style={{ height: "65dvh" }}
              data={sortedRows}
              computeItemKey={(_, patient) => patient.id}
              itemContent={(_, patient) => mobileCard(patient)}
            />
          ) : (
            <div>
              {sortedRows.map((patient) => (
                <div key={patient.id}>{mobileCard(patient)}</div>
              ))}
            </div>
          )
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {sortedRows.length > 100 ? (
              <TableVirtuoso<Patient>
                style={{ height: "65dvh", minWidth: 860 }}
                data={sortedRows}
                computeItemKey={(_, patient) => patient.id}
                components={{
                  Table: (props) => (
                    <table {...props} className="w-full border-collapse text-left" />
                  ),
                  TableHead: (props) => (
                    <thead
                      {...props}
                      className="border-b border-border bg-card/85 glass-blur [&_th]:border-b [&_th]:border-border"
                    />
                  ),
                  TableRow: ({ item, ...props }) => (
                    <tr
                      {...props}
                      onClick={() => openPatient(item)}
                      className={`cursor-pointer border-t border-border-soft transition-colors hover:bg-primary/[0.05] ${
                        Number(props["data-index"]) % 2 === 1 ? "bg-muted/35" : ""
                      }`}
                    />
                  ),
                }}
                fixedHeaderContent={header}
                itemContent={(_, patient) => rowCells(patient)}
              />
            ) : (
              <div className="max-h-[70dvh] overflow-auto">
                <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left">
                  <thead className="sticky top-0 z-10 bg-card/85 glass-blur [&_th]:border-b [&_th]:border-border">
                    {header()}
                  </thead>
                  <tbody>
                    {sortedRows.map((patient) => (
                      <tr
                        key={patient.id}
                        onClick={() => openPatient(patient)}
                        className="cursor-pointer transition-colors even:bg-muted/35 hover:bg-primary/[0.05] [&>td]:border-b [&>td]:border-border-soft"
                      >
                        {rowCells(patient)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      {form}
    </AppShell>
  );
}

import { PatientFinanceTab } from "@/components/pacientes/PatientFinanceTab";
import { PatientPackagesTab } from "@/components/pacientes/PatientPackagesTab";
import {
  AiRecordAssistantModal,
  type AiSectionContext,
} from "@/components/prontuario/AiRecordAssistantModal";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PermissionKey } from "@/features/admin/permissions";
import { usePermissions } from "@/hooks/use-permissions";
import {
  usePatientClinicalHistory,
  type ClinicalHistoryItem,
} from "@/hooks/usePatientClinicalHistory";
import { supabase } from "@/integrations/supabase/client";
import type { StructuredConsultationResult } from "@/lib/gemini";
import { prontuarioService } from "@/services/api";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export type PatientProfileData = {
  id?: string;
  name: string;
  birth_date?: string | null;
  age?: string | null;
  gender?: string | null;
  email?: string | null;
  phone?: string | null;
  insurance?: string | null;
  notifications?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
  country?: string | null;
  cpf?: string | null;
  notes?: string | null;
  created_at?: string | null;
  active?: boolean;
  photoUrl?: string | null;
};

// Abas que dependem de outro módulo seguem a permissão correspondente.
const TAB_PERMISSION: Record<string, PermissionKey> = {
  timeline: "records.view",
  prontuario: "records.view",
  carteira: "finance.view",
  financeiro: "finance.view",
  orcamentos: "finance.view",
  pacotes: "followups.view",
};

const TABS = [
  { id: "informacoes", label: "Informações" },
  { id: "timeline", label: "Linha do tempo" },
  { id: "prontuario", label: "Prontuário" },
  { id: "pacotes", label: "Planos e pacotes" },
  { id: "financeiro", label: "Financeiro" },
];

export function PatientFullProfileView({
  patient,
  onBack,
  onEdit,
}: {
  patient?: Partial<PatientProfileData> | null;
  onBack: () => void;
  onEdit?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedTab, setActiveTab] = useState<string>("informacoes");
  const { can } = usePermissions();
  const visibleTabs = TABS.filter((tab) => !TAB_PERMISSION[tab.id] || can(TAB_PERMISSION[tab.id]));
  const activeTab = visibleTabs.some((tab) => tab.id === selectedTab) ? selectedTab : "informacoes";

  // Estado do Prontuário Clínico & Anamnese Unificada
  const [anamnese, setAnamnese] = useState("");
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<
    "todos" | "prontuario" | "consulta" | "evolucao"
  >("todos");

  // Estado do Assistente IA
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiSection, setAiSection] = useState<AiSectionContext | null>(null);

  // Estado para Edição de Prontuário
  const [editingItem, setEditingItem] = useState<ClinicalHistoryItem | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editComplaint, setEditComplaint] = useState("");
  const [editConduct, setEditConduct] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Estado para Exclusão de Prontuário
  const [deletingItem, setDeletingItem] = useState<ClinicalHistoryItem | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isExample = !patient?.id;

  const data = useMemo(() => {
    return {
      id: patient?.id,
      name: patient?.name || "Paciente sem nome",
      birth_date: patient?.birth_date || null,
      age: patient?.age || null,
      gender: patient?.gender || null,
      email: patient?.email || null,
      phone: patient?.phone || null,
      insurance: patient?.insurance || null,
      notifications: patient?.notifications || null,
      address: patient?.address || null,
      neighborhood: patient?.neighborhood || null,
      city: patient?.city || null,
      state: patient?.state || null,
      cep: patient?.cep || null,
      country: patient?.country || "Brasil",
      cpf: patient?.cpf || null,
      notes: patient?.notes || null,
      created_at: patient?.created_at || null,
      active: patient?.active !== false,
      photoUrl: patient?.photoUrl || null,
    };
  }, [patient]);

  // Carrega histórico completo de atendimentos, prontuários e consultas deste paciente específico
  const {
    data: clinicalHistory = [],
    isLoading: loadingHistory,
    refetch: refreshHistory,
  } = usePatientClinicalHistory(data.id, data.name);

  const prontuariosCount = useMemo(
    () => clinicalHistory.filter((i) => i.kind === "prontuario").length,
    [clinicalHistory],
  );
  const consultasCount = useMemo(
    () => clinicalHistory.filter((i) => i.kind === "consulta").length,
    [clinicalHistory],
  );
  const evolucoesCount = useMemo(
    () => clinicalHistory.filter((i) => i.kind === "evolucao").length,
    [clinicalHistory],
  );

  const filteredHistory = useMemo(() => {
    return clinicalHistory.filter((item) => {
      if (historyFilter !== "todos" && item.kind !== historyFilter) return false;
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchDoc = (item.doctorName || "").toLowerCase().includes(q);
        const matchComplaint = (item.complaint || "").toLowerCase().includes(q);
        const matchConduct = (item.conduct || "").toLowerCase().includes(q);
        const matchDiag = (item.diagnosis || "").toLowerCase().includes(q);
        const matchStatus = (item.status || "").toLowerCase().includes(q);
        return matchTitle || matchDoc || matchComplaint || matchConduct || matchDiag || matchStatus;
      }
      return true;
    });
  }, [clinicalHistory, historyFilter, historySearch]);

  const lastClinicalRecord = useMemo(() => {
    return clinicalHistory.find((i) => i.kind === "prontuario" && Boolean(i.complaint));
  }, [clinicalHistory]);

  const handleSaveProntuario = async () => {
    if (!data.id || !anamnese.trim()) {
      toast.error("Selecione um paciente e preencha as anotações antes de salvar.");
      return;
    }
    setIsSavingRecord(true);
    const payload = {
      patient_id: data.id,
      complaint: anamnese.trim(),
      finished_at: new Date().toISOString(),
    };
    try {
      try {
        await prontuarioService.createRecord(payload);
      } catch {
        const { error } = await supabase.from("medical_records").insert(payload);
        if (error) throw error;
      }
      toast.success("Atendimento salvo no histórico do paciente.");
      setAnamnese("");
      void refreshHistory();
      void queryClient.invalidateQueries({ queryKey: ["patient-clinical-history"] });
      void queryClient.invalidateQueries({ queryKey: ["patient-medical-records"] });
    } catch (error) {
      console.error("Não foi possível salvar o atendimento.", error);
      toast.error(
        "Não foi possível salvar no servidor. Suas anotações foram mantidas para tentar novamente.",
      );
    } finally {
      setIsSavingRecord(false);
    }
  };

  const handleOpenEdit = (item: ClinicalHistoryItem) => {
    setEditingItem(item);
    setEditComplaint(item.complaint || item.evolution || "");
    setEditConduct(item.conduct || "");
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    if (!editComplaint.trim()) {
      toast.error("O prontuário não pode ficar com texto vazio.");
      return;
    }
    setIsUpdating(true);
    try {
      // 1. Atualiza no Supabase se id válido
      if (data.id && !isExample && editingItem.kind === "prontuario") {
        try {
          await supabase
            .from("medical_records")
            .update({
              complaint: editComplaint.trim(),
              conduct: editConduct.trim() || null,
            })
            .eq("id", editingItem.id);
        } catch (e) {
          console.warn("Supabase medical_records update fallback:", e);
        }
      }

      // 2. Atualiza via API PHP
      if (editingItem.kind === "prontuario") {
        try {
          await prontuarioService.updateRecord(editingItem.id, {
            complaint: editComplaint.trim(),
            conduct: editConduct.trim() || null,
          });
        } catch {}
      }

      // 3. Atualiza no LocalStorage
      const updateLocal = (key: string) => {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const next = parsed.map((r: any) =>
                r.id === editingItem.id
                  ? { ...r, complaint: editComplaint.trim(), conduct: editConduct.trim() || null }
                  : r,
              );
              localStorage.setItem(key, JSON.stringify(next));
            } else if (parsed && parsed.id === editingItem.id) {
              localStorage.setItem(
                key,
                JSON.stringify({
                  ...parsed,
                  complaint: editComplaint.trim(),
                  conduct: editConduct.trim() || null,
                }),
              );
            }
          }
        } catch {}
      };

      if (data.id) {
        updateLocal("medcore_prontuario_history_" + data.id);
        updateLocal("medcore_prontuario_" + data.id);
      }
      if (data.name) {
        updateLocal("medcore_prontuario_history_" + data.name);
        updateLocal("medcore_prontuario_" + data.name);
      }

      toast.success("Prontuário atualizado com sucesso!");
      setEditModalOpen(false);
      setEditingItem(null);
      refreshHistory();
      queryClient.invalidateQueries({ queryKey: ["patient-clinical-history"] });
      queryClient.invalidateQueries({ queryKey: ["patient-medical-records"] });
    } catch (err: any) {
      toast.error("Erro ao atualizar prontuário: " + (err?.message || "Tente novamente"));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleOpenDelete = (item: ClinicalHistoryItem) => {
    setDeletingItem(item);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    setIsDeleting(true);
    try {
      // 1. Exclui no Supabase
      if (data.id && !isExample) {
        if (deletingItem.kind === "prontuario") {
          try {
            await supabase.from("medical_records").delete().eq("id", deletingItem.id);
          } catch (e) {
            console.warn("Supabase medical_records delete fallback:", e);
          }
        } else if (deletingItem.kind === "consulta") {
          try {
            await supabase.from("appointments").delete().eq("id", deletingItem.id);
          } catch (e) {
            console.warn("Supabase appointments delete fallback:", e);
          }
        }
      }

      // 2. Exclui via API PHP
      if (deletingItem.kind === "prontuario") {
        try {
          await prontuarioService.deleteRecord(deletingItem.id);
        } catch {}
      }

      // 3. Remove do LocalStorage
      const deleteLocal = (key: string) => {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const next = parsed.filter((r: any) => r.id !== deletingItem.id);
              localStorage.setItem(key, JSON.stringify(next));
            } else if (parsed && parsed.id === deletingItem.id) {
              localStorage.removeItem(key);
            }
          }
        } catch {}
      };

      if (data.id) {
        deleteLocal("medcore_prontuario_history_" + data.id);
        deleteLocal("medcore_prontuario_" + data.id);
      }
      if (data.name) {
        deleteLocal("medcore_prontuario_history_" + data.name);
        deleteLocal("medcore_prontuario_" + data.name);
      }

      toast.success("Prontuário excluído com sucesso!");
      setDeleteModalOpen(false);
      setDeletingItem(null);
      refreshHistory();
      queryClient.invalidateQueries({ queryKey: ["patient-clinical-history"] });
      queryClient.invalidateQueries({ queryKey: ["patient-medical-records"] });
    } catch (err: any) {
      toast.error("Erro ao excluir prontuário: " + (err?.message || "Tente novamente"));
    } finally {
      setIsDeleting(false);
    }
  };

  const openAiForSection = (sec: { key: string; title: string; placeholder?: string }) => {
    setAiSection(sec);
    setAiModalOpen(true);
  };

  const handleAiInsert = (content: string | StructuredConsultationResult) => {
    if (typeof content === "string") {
      setAnamnese(content);
    } else {
      const isValid = (t?: string) =>
        Boolean(t && t.trim().length > 0 && t !== "Não informado na consulta.");

      const parts: string[] = [];
      if (isValid(content.queixaPrincipal)) {
        parts.push(`QUEIXA PRINCIPAL / MOTIVO:\n${content.queixaPrincipal}`);
      }
      if (isValid(content.historicoFamiliar)) {
        parts.push(`HISTÓRICO FAMILIAR:\n${content.historicoFamiliar}`);
      }
      if (isValid(content.historicoPessoal)) {
        parts.push(`HISTÓRICO MÉDICO PESSOAL:\n${content.historicoPessoal}`);
      }
      if (content.condicoesDetectadas && content.condicoesDetectadas.length > 0) {
        parts.push(`CONDIÇÕES IDENTIFICADAS:\n${content.condicoesDetectadas.join(", ")}`);
      }
      if (isValid(content.medicacoesEmUso)) {
        parts.push(`MEDICAÇÕES EM USO:\n${content.medicacoesEmUso}`);
      }
      if (isValid(content.alergias)) {
        parts.push(`ALERGIAS:\n${content.alergias}`);
      }
      if (isValid(content.tratamentosAnteriores)) {
        parts.push(`TRATAMENTOS ANTERIORES:\n${content.tratamentosAnteriores}`);
      }
      if (isValid(content.condutaPlano)) {
        parts.push(`CONDUTA / PLANO TERAPÊUTICO:\n${content.condutaPlano}`);
      }

      const formatted = parts.join("\n\n");
      setAnamnese((prev) => (prev ? `${prev}\n\n${formatted}` : formatted));
    }
  };

  const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label || "Informações";

  return (
    <div className="min-h-0 bg-surface text-foreground">
      <header className="border-b border-border bg-card px-4 py-5 md:px-6">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-2 rounded text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft size={16} />
          Voltar
        </button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-xl font-semibold text-primary">
              {data.photoUrl ? (
                <img src={data.photoUrl} alt="" className="size-full object-cover" />
              ) : (
                data.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
              )}
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Ficha do paciente</p>
              <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  data.gender === "F"
                    ? "Feminino"
                    : data.gender === "M"
                      ? "Masculino"
                      : data.gender,
                  data.age,
                  data.insurance,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Dados complementares não informados"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.phone && (
              <Button
                variant="outline"
                onClick={() => {
                  const number = (data.phone ?? "").replace(/\D/g, "");
                  if (!number) {
                    toast.error("O telefone cadastrado é inválido.");
                    return;
                  }
                  window.open(
                    "https://wa.me/" + (number.length <= 11 ? "55" + number : number),
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                <Send />
                WhatsApp
              </Button>
            )}
            {onEdit && (
              <Button variant="outline" onClick={onEdit}>
                <Pencil />
                Editar cadastro
              </Button>
            )}
            {data.id && can("records.view") && (
              <Button
                onClick={() =>
                  navigate({
                    to: "/prontuario",
                    search: { patientId: data.id, patientName: data.name },
                  })
                }
              >
                <Stethoscope />
                Abrir prontuário
              </Button>
            )}
          </div>
        </div>
      </header>
      <div className="page-container space-y-5">
        <nav
          aria-label="Seções do paciente"
          className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5"
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-current={activeTab === tab.id ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={
                "min-h-10 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors " +
                (activeTab === tab.id
                  ? "bg-primary-soft text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <main className="min-w-0 rounded-xl border border-border bg-card p-4 md:p-6">
          {/* ============================================================ */}
          {/* ABA: INFORMAÇÕES (Fiel ao design do screenshot) */}
          {/* ============================================================ */}
          {activeTab === "informacoes" && (
            <section>
              <h2 className="mb-5 text-lg font-semibold">Informações cadastrais</h2>
              <dl className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  ["Nome completo", data.name],
                  ["Data de nascimento", data.birth_date],
                  [
                    "Sexo / gênero",
                    data.gender === "F"
                      ? "Feminino"
                      : data.gender === "M"
                        ? "Masculino"
                        : data.gender,
                  ],
                  ["Telefone", data.phone],
                  ["E-mail", data.email],
                  ["CPF", data.cpf],
                  ["Convênio", data.insurance],
                  [
                    "Endereço",
                    [data.address, data.neighborhood, data.city, data.state, data.cep]
                      .filter(Boolean)
                      .join(", "),
                  ],
                  ["Cadastrado em", data.created_at],
                  ["Status", data.active ? "Ativo" : "Inativo"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words text-sm text-foreground">
                      {value || "Não informado"}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 border-t border-border pt-5">
                <h3 className="text-sm font-medium">Observações</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {data.notes || "Nenhuma observação registrada."}
                </p>
              </div>
            </section>
          )}

          {/* ============================================================ */}
          {/* ABA: PRONTUÁRIO & ANAMNESE COMPLETA */}
          {/* ============================================================ */}
          {(activeTab === "prontuario" || activeTab === "timeline") && (
            <div className="space-y-6 max-w-4xl">
              <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-border-soft">
                <div>
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    {activeTab === "timeline"
                      ? "Linha do Tempo de Atendimentos"
                      : "Prontuário Clínico & Atendimentos"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Histórico unificado de atendimentos, consultas e evoluções de{" "}
                    <strong className="text-foreground/80">{data.name}</strong>.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      navigate({
                        to: "/prontuario",
                        search: {
                          patientId: data.id,
                          patientName: data.name,
                        } as any,
                      });
                    }}
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-primary/25 bg-primary-soft/70 text-primary hover:bg-primary-soft text-sm font-semibold transition-all cursor-pointer shadow-2xs"
                    title="Abrir tela cheia de atendimento para este paciente"
                  >
                    <ExternalLink size={14} />
                    <span>Abrir Prontuário Completo</span>
                  </button>

                  {activeTab === "prontuario" && (
                    <button
                      type="button"
                      onClick={handleSaveProntuario}
                      disabled={isSavingRecord || !anamnese.trim()}
                      className="inline-flex items-center gap-1.5 h-10 px-4.5 rounded-full bg-primary text-white hover:bg-primary-hover disabled:opacity-50 text-sm font-semibold shadow-sm transition-all cursor-pointer"
                    >
                      <Save size={15} />
                      <span>{isSavingRecord ? "Salvando..." : "Salvar Atendimento"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Editor de Novo Atendimento (inicia limpo sem duplicar a ficha ou texto anterior) */}
              {activeTab === "prontuario" && (
                <div className="rounded-2xl border border-primary/15 bg-card p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border-soft">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-primary-soft text-primary flex items-center justify-center">
                        <ClipboardList size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          Novo Atendimento / Evolução Clínica
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Registre queixa, sintomas, exame clínico e conduta terapêutica desta
                          consulta.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {lastClinicalRecord?.complaint && !anamnese && (
                        <button
                          type="button"
                          onClick={() => {
                            setAnamnese(lastClinicalRecord.complaint || "");
                            toast.info("Anotação da consulta anterior carregada no editor.");
                          }}
                          className="text-xs font-semibold text-primary hover:text-primary-hover bg-primary-soft hover:bg-primary-soft border border-primary/25 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                          title="Importar texto da consulta anterior"
                        >
                          📋 Importar última consulta
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          openAiForSection({
                            key: "anamnese_geral",
                            title: "Anamnese & Evolução Clínica",
                            placeholder: "Descreva a consulta do paciente...",
                          })
                        }
                        className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                      >
                        <Sparkles size={12} />
                        <span>Preencher com IA</span>
                      </button>

                      {anamnese && (
                        <button
                          type="button"
                          onClick={() => setAnamnese("")}
                          className="text-xs text-muted-foreground hover:text-destructive font-medium px-1 cursor-pointer"
                          title="Limpar editor"
                        >
                          Limpar
                        </button>
                      )}

                      <span className="text-xs text-muted-foreground font-medium ml-1">
                        {anamnese.length} caracteres
                      </span>
                    </div>
                  </div>

                  <textarea
                    rows={6}
                    value={anamnese}
                    onChange={(e) => setAnamnese(e.target.value)}
                    placeholder="Descreva a anamnese ou evolução da consulta atual (motivo da consulta, sintomas, hipóteses diagnósticas e conduta médica)..."
                    className="w-full rounded-xl border border-border p-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all resize-y min-h-[160px] font-sans leading-relaxed"
                  />
                </div>
              )}

              {/* Histórico Completo de Atendimentos e Consultas do Paciente */}
              <div className="rounded-2xl border border-border bg-muted/30 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                    <History className="h-4.5 w-4.5 text-primary" />
                    <span>Histórico Completo de Atendimentos ({clinicalHistory.length})</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => refreshHistory()}
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 font-medium transition-colors cursor-pointer"
                    title="Atualizar lista de atendimentos"
                  >
                    <RefreshCw size={12} className={loadingHistory ? "animate-spin" : ""} />
                    <span>Atualizar</span>
                  </button>
                </div>

                {/* Filtros e Busca Rápida no Histórico */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                  {/* Pílulas de filtro por tipo */}
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("todos")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "todos"
                          ? "bg-primary text-white shadow-2xs"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted"
                      }`}
                    >
                      Todos ({clinicalHistory.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("prontuario")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "prontuario"
                          ? "bg-primary text-white shadow-2xs"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted"
                      }`}
                    >
                      🩺 Prontuários ({prontuariosCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("consulta")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "consulta"
                          ? "bg-primary text-white shadow-2xs"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted"
                      }`}
                    >
                      📅 Consultas ({consultasCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("evolucao")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "evolucao"
                          ? "bg-primary text-white shadow-2xs"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted"
                      }`}
                    >
                      📈 Evoluções ({evolucoesCount})
                    </button>
                  </div>

                  {/* Campo de Busca Rápida */}
                  <div className="relative min-w-[220px]">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Filtrar histórico..."
                      className="w-full h-8.5 pl-8.5 pr-3 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Lista de Atendimentos */}
                {filteredHistory.length > 0 ? (
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {filteredHistory.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl bg-card border border-border shadow-2xs space-y-2.5 transition-all hover:border-primary/25"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border-soft">
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.kind === "prontuario" && (
                              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-primary-soft text-primary">
                                🩺 Prontuário Clínico
                              </span>
                            )}
                            {item.kind === "consulta" && (
                              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-info/15 text-info">
                                📅 {item.type || "Consulta"}
                              </span>
                            )}
                            {item.kind === "evolucao" && (
                              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-success/15 text-success">
                                📈 Evolução
                              </span>
                            )}

                            <span className="font-semibold text-foreground text-sm">
                              {item.formattedDate} {item.time ? `às ${item.time}` : ""}
                            </span>

                            {item.doctorName && (
                              <span className="text-xs text-muted-foreground font-medium">
                                • {item.doctorName}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {item.status && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                                {item.status}
                              </span>
                            )}

                            {item.durationSeconds ? (
                              <span className="text-xs text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded-md">
                                ⏱️ {Math.round(item.durationSeconds / 60)} min
                              </span>
                            ) : null}

                            {activeTab === "prontuario" && item.complaint && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAnamnese(item.complaint || "");
                                  toast.success("Conteúdo carregado no editor de atendimento.");
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                className="text-xs font-semibold text-primary hover:text-primary-hover hover:underline cursor-pointer"
                                title="Carregar este atendimento no editor acima"
                              >
                                Carregar no editor
                              </button>
                            )}

                            {item.complaint && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(item.complaint || "");
                                  toast.success("Texto do atendimento copiado.");
                                }}
                                className="text-muted-foreground hover:text-muted-foreground p-1 rounded hover:bg-muted cursor-pointer"
                                title="Copiar texto"
                              >
                                <Copy size={13} />
                              </button>
                            )}

                            {/* Botão Editar */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(item)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary bg-muted hover:bg-primary-soft px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                              title="Editar anotações deste atendimento"
                            >
                              <Pencil size={12} />
                              <span>Editar</span>
                            </button>

                            {/* Botão Excluir */}
                            <button
                              type="button"
                              onClick={() => handleOpenDelete(item)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-destructive bg-muted hover:bg-destructive/10 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                              title="Excluir este prontuário"
                            >
                              <Trash2 size={12} />
                              <span>Excluir</span>
                            </button>
                          </div>
                        </div>

                        {/* Conteúdo Clínico */}
                        {item.complaint ? (
                          <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed bg-muted/42 p-3 rounded-lg border border-border-soft">
                            {item.complaint}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">
                            Consulta registrada sem anotações adicionais.
                          </p>
                        )}

                        {/* Conduta se cadastrada separadamente */}
                        {item.conduct && (
                          <div className="text-xs text-primary-hover bg-primary-soft/60 p-2.5 rounded-lg border border-primary/15">
                            <strong>Conduta terapêutica:</strong> {item.conduct}
                          </div>
                        )}

                        {/* Diagnóstico se cadastrado */}
                        {item.diagnosis && (
                          <div className="text-xs text-muted-foreground">
                            <strong>Diagnóstico:</strong> {item.diagnosis}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center space-y-2">
                    <FileText className="h-8 w-8 text-muted-foreground/60 mx-auto" />
                    <p className="text-sm font-medium text-muted-foreground">
                      {historySearch
                        ? `Nenhum registro encontrado para "${historySearch}".`
                        : `Nenhum atendimento registrado ainda para ${data.name}.`}
                    </p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      {activeTab === "prontuario"
                        ? 'Você pode registrar o primeiro atendimento deste paciente utilizando o campo de Anamnese acima ou clicando em "Abrir Prontuário Completo".'
                        : "Os atendimentos e consultas aparecerão aqui conforme forem realizados."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ABA FINANCEIRO */}
          {activeTab === "financeiro" && (
            <PatientFinanceTab patientId={data.id || ""} patientName={data.name} />
          )}

          {/* ABA PACOTES */}
          {activeTab === "pacotes" && (
            <PatientPackagesTab patientId={data.id || ""} patientName={data.name} />
          )}

          {/* OUTRAS ABAS */}
          {activeTab !== "informacoes" &&
            activeTab !== "prontuario" &&
            activeTab !== "timeline" &&
            activeTab !== "financeiro" &&
            activeTab !== "pacotes" && (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                <div className="h-14 w-14 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                  <FolderOpen className="h-7 w-7" />
                </div>
                <h3 className="text-base font-semibold text-foreground">{activeTabLabel}</h3>
                <p className="text-sm text-muted-foreground">
                  Nenhum registro encontrado para este paciente nesta seção no momento.
                </p>
              </div>
            )}
        </main>
      </div>

      {/* Modal do Assistente de Consulta IA */}
      <AiRecordAssistantModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        section={aiSection}
        onInsert={handleAiInsert}
      />

      {/* Modal de Edição de Prontuário Clínico */}
      <Dialog
        open={editModalOpen && !!editingItem}
        onOpenChange={(open) => {
          if (open || isUpdating) return;
          setEditModalOpen(false);
          setEditingItem(null);
        }}
      >
        <DialogContent className="max-w-2xl" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader className="flex-row items-center gap-2.5 space-y-0 border-b border-border-soft pb-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <Pencil size={16} />
            </div>
            <div>
              <DialogTitle className="text-base">Editar Prontuário Clínico</DialogTitle>
              <DialogDescription className="text-xs">
                Atendimento de {editingItem?.formattedDate} • {data.name}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <label
                htmlFor="edit-record-complaint"
                className="text-sm font-semibold text-foreground/80"
              >
                Anamnese, Queixa & Evolução Clínica
              </label>
              <textarea
                id="edit-record-complaint"
                rows={8}
                value={editComplaint}
                onChange={(e) => setEditComplaint(e.target.value)}
                placeholder="Anotações clínicas do atendimento..."
                className="prose-clinical w-full min-h-[180px] max-w-none resize-y rounded-xl border border-input bg-card p-3.5 text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="edit-record-conduct"
                className="text-sm font-semibold text-foreground/80"
              >
                Conduta Terapêutica (opcional)
              </label>
              <textarea
                id="edit-record-conduct"
                rows={3}
                value={editConduct}
                onChange={(e) => setEditConduct(e.target.value)}
                placeholder="Orientações, prescrições e condutas tomadas..."
                className="w-full resize-y rounded-xl border border-input bg-card p-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border-soft pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditModalOpen(false);
                setEditingItem(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSaveEdit}
              disabled={isUpdating || !editComplaint.trim()}
            >
              <Save size={14} />
              <span>{isUpdating ? "Salvando..." : "Salvar Alterações"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Exclusão de Prontuário */}
      <AlertDialog
        open={deleteModalOpen && !!deletingItem}
        onOpenChange={(open) => {
          if (open || isDeleting) return;
          setDeleteModalOpen(false);
          setDeletingItem(null);
        }}
      >
        <AlertDialogContent>
          <div className="flex items-start gap-3.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive"
              aria-hidden="true"
            >
              <AlertTriangle size={20} />
            </div>
            <AlertDialogHeader className="space-y-1">
              <AlertDialogTitle className="text-base">Excluir este prontuário?</AlertDialogTitle>
              <AlertDialogDescription className="leading-relaxed">
                Tem certeza de que deseja excluir o atendimento de{" "}
                <strong className="text-foreground">{deletingItem?.formattedDate}</strong> de{" "}
                <strong className="text-foreground">{data.name}</strong>? Esta ação removerá o
                registro do histórico do paciente.
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>

          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteModalOpen(false);
                setDeletingItem(null);
              }}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              <Trash2 size={14} />
              <span>{isDeleting ? "Excluindo..." : "Sim, excluir"}</span>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

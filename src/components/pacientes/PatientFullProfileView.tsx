import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  User,
  Calendar as CalIcon,
  Mail,
  Phone,
  Bell,
  MapPin,
  FileText,
  Clock,
  Sparkles,
  Pencil,
  MoreVertical,
  Camera,
  AlertTriangle,
  Send,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  ClipboardList,
  ArrowLeft,
  Save,
  Check,
  Stethoscope,
  Pill,
  ShieldAlert,
  Activity,
  UserCheck,
  Layers,
  ChevronDown,
  ExternalLink,
  History,
  Copy,
  Search,
  Filter,
  RefreshCw,
  PlusCircle,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { prontuarioService } from "@/services/api";
import {
  AiRecordAssistantModal,
  type AiSectionContext,
} from "@/components/prontuario/AiRecordAssistantModal";
import type { StructuredConsultationResult } from "@/lib/gemini";
import {
  usePatientClinicalHistory,
  type ClinicalHistoryItem,
} from "@/hooks/usePatientClinicalHistory";
import { PatientFinanceTab } from "@/components/pacientes/PatientFinanceTab";
import { PatientPackagesTab } from "@/components/pacientes/PatientPackagesTab";

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

const DEFAULT_PATIENT: PatientProfileData = {
  name: "Clara Ribeiro (Paciente de exemplo)",
  birth_date: "26/01/1992 (34 anos)",
  gender: "Feminino",
  email: "clara.ribeiro@exemplo.com",
  phone: "+55 (11) 99999-9999",
  notifications: "Não recebe notificações",
  address: "Av. Pedro Álvares Cabral, SN",
  neighborhood: "Vila Mariana",
  city: "São Paulo",
  state: "SP",
  cep: "04094-050",
  country: "Brasil",
  cpf: "315.772.070-84",
  notes: "Esse paciente é um paciente de exemplo.",
  created_at: "15/08/2026 09:49:12",
  active: true,
  photoUrl:
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&auto=format&fit=crop&q=80",
};

const TABS = [
  { id: "informacoes", label: "Informações" },
  { id: "timeline", label: "Linha do tempo" },
  { id: "carteira", label: "Carteira" },
  { id: "pacotes", label: "Pacotes" },
  { id: "financeiro", label: "Financeiro" },
  { id: "orcamentos", label: "Orçamentos" },
  { id: "prontuario", label: "Prontuário" },
  { id: "documentos", label: "Documentos" },
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
  const [activeTab, setActiveTab] = useState<string>("informacoes");

  // Estado do Prontuário Clínico & Anamnese Unificada
  const [anamnese, setAnamnese] = useState("");
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"todos" | "prontuario" | "consulta" | "evolucao">("todos");

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

  const isExample =
    !patient || !patient.id || Boolean(patient.name?.toLowerCase().includes("exemplo"));

  const data = useMemo(() => {
    if (isExample && (!patient || !patient.id)) {
      return DEFAULT_PATIENT;
    }
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
  }, [patient, isExample]);

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
    if (!anamnese.trim()) {
      toast.error("Por favor, preencha as anotações do atendimento antes de salvar.");
      return;
    }

    setIsSavingRecord(true);
    const newRecord = {
      id: crypto.randomUUID(),
      patient_id: data.id || null,
      patient_name: data.name,
      complaint: anamnese.trim(),
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };

    // 1. Salva no LocalStorage garantindo persistência imediata
    try {
      if (data.id) localStorage.setItem("medcore_prontuario_" + data.id, JSON.stringify(newRecord));
      if (data.name)
        localStorage.setItem("medcore_prontuario_" + data.name, JSON.stringify(newRecord));

      const prevHistKey = data.id
        ? "medcore_prontuario_history_" + data.id
        : "medcore_prontuario_history_" + data.name;
      const prevHist = JSON.parse(localStorage.getItem(prevHistKey) || "[]");
      const nextHist = [newRecord, ...prevHist.filter((h: any) => h.id !== newRecord.id)];
      if (data.id)
        localStorage.setItem("medcore_prontuario_history_" + data.id, JSON.stringify(nextHist));
      if (data.name)
        localStorage.setItem("medcore_prontuario_history_" + data.name, JSON.stringify(nextHist));
    } catch (e) {
      console.warn("Aviso ao salvar localmente:", e);
    }

    // 2. Salva no Supabase se id válido
    if (data.id && !isExample) {
      try {
        await supabase.from("medical_records").insert({
          patient_id: data.id,
          complaint: anamnese.trim(),
          finished_at: new Date().toISOString(),
        });
      } catch (err: any) {
        console.warn("Supabase medical_records insert fallback:", err);
      }
    }

    // 3. Sincronização em background com a API PHP
    if (data.id) {
      prontuarioService
        .createRecord({
          patient_id: data.id,
          complaint: anamnese.trim(),
          finished_at: new Date().toISOString(),
        })
        .catch(() => {});
    }

    toast.success("Atendimento salvo com sucesso!", {
      description: `Prontuário clínico gravado no histórico de ${data.name}.`,
    });
    setAnamnese(""); // Reseta o editor para a próxima consulta começar limpa!
    refreshHistory();
    queryClient.invalidateQueries({ queryKey: ["patient-clinical-history"] });
    queryClient.invalidateQueries({ queryKey: ["patient-medical-records"] });
    setIsSavingRecord(false);
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
    <div className="flex flex-col min-h-screen bg-white text-slate-800">
      {/* ============================================================ */}
      {/* 1. TOP BREADCRUMB BAR (Exato como no print) */}
      {/* ============================================================ */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#EFEFEF] bg-white text-[13px] text-slate-500 font-medium">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={onBack}
            className="text-purple-600 hover:text-purple-800 font-medium cursor-pointer hover:underline"
          >
            Contatos
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={onBack}
            className="text-purple-600 hover:text-purple-800 font-medium cursor-pointer hover:underline"
          >
            Listagem
          </button>
          <span>/</span>
          <span className="text-purple-600 font-semibold">Paciente</span>
          <span>/</span>
          <span className="text-slate-400 font-medium">{activeTabLabel}</span>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600 hover:text-purple-700 transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
          <span>Voltar para lista</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* 2. CORPO PRINCIPAL COM SIDEBAR ESQUERDA + CONTEÚDO DIREITA */}
      {/* ============================================================ */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* SIDEBAR ESQUERDA (PERFIL DO PACIENTE) */}
        <aside className="w-full md:w-[260px] lg:w-[280px] shrink-0 border-b md:border-b-0 md:border-r border-[#EFEFEF] bg-white p-6 flex flex-col items-center">
          {/* Avatar com overlays */}
          <div className="relative mb-3.5">
            <div className="relative h-24 w-24 rounded-full overflow-hidden border-2 border-white shadow-md bg-purple-100 flex items-center justify-center">
              {data.photoUrl ? (
                <img src={data.photoUrl} alt={data.name} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-[#7B3AF5] text-white font-bold text-2xl flex items-center justify-center">
                  {data.name
                    .split(" ")
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </div>
              )}

              {/* Faixa diagonal EXEMPLO apenas se for paciente de demonstração */}
              {isExample && (
                <div className="absolute bottom-1.5 left-0 right-0 bg-[#7B3AF5] text-white text-[8px] font-extrabold uppercase tracking-widest text-center py-0.5 transform -rotate-12 shadow-sm">
                  EXEMPLO
                </div>
              )}
            </div>

            {/* Ícone de câmera */}
            <button
              type="button"
              className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-[#7B3AF5] text-white flex items-center justify-center shadow hover:scale-105 transition-transform cursor-pointer"
              title="Alterar foto"
              onClick={() => toast.info("Upload de foto")}
            >
              <Camera className="h-3 w-3" />
            </button>

            {/* Ícone de aviso */}
            <div
              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-amber-50 border-2 border-white text-amber-500 flex items-center justify-center shadow"
              title="Atenção"
            >
              <AlertTriangle className="h-3 w-3" />
            </div>
          </div>

          {/* Nome do Paciente */}
          <h1 className="text-[17px] font-bold text-[#0F172A] text-center leading-tight">
            {data.name}
          </h1>

          {/* Sub-informações */}
          <div className="mt-2 text-center space-y-0.5">
            <p className="text-[12px] font-medium text-[#64748B]">
              {data.gender || "Feminino"} • {data.age || "34 anos"}
            </p>
            <p className="text-[12px] font-medium text-[#64748B]">{data.phone}</p>
            <p className="text-[12px] font-medium text-[#64748B]">{data.cpf}</p>
          </div>

          {/* Tag Paciente */}
          <div className="mt-2.5">
            <span className="px-3 py-0.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] text-[11px] font-semibold tracking-wide">
              Paciente
            </span>
          </div>

          {/* Botão Enviar Mensagem (WhatsApp) */}
          <div className="mt-4 w-full flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const num = (data.phone || "").replace(/\D/g, "");
                if (num) {
                  window.open(`https://wa.me/${num}`, "_blank");
                } else {
                  toast.success("Mensagem aberta no WhatsApp");
                }
              }}
              className="flex-1 h-10 px-3 rounded-xl bg-[#E8F8F0] hover:bg-[#D8F3E5] text-[#10B981] font-semibold text-[12.5px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Enviar mensagem</span>
            </button>

            <button
              type="button"
              className="h-10 w-10 rounded-xl border border-[#E2E8F0] hover:bg-[#F1F5F9] text-[#64748B] flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Mais opções"
              onClick={() => toast.message("Opções do paciente")}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>

          {/* Lista de Navegação das Abas */}
          <nav className="mt-5 w-full space-y-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full h-9.5 px-4 rounded-xl text-[13px] font-medium transition-all text-left flex items-center justify-between cursor-pointer ${
                    isActive
                      ? "bg-[#7B3AF5] text-white font-semibold shadow-sm"
                      : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                  }`}
                >
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* CONTEÚDO PRINCIPAL DIREITO */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto bg-white">
          {/* ============================================================ */}
          {/* ABA: INFORMAÇÕES (Fiel ao design do screenshot) */}
          {/* ============================================================ */}
          {activeTab === "informacoes" && (
            <div className="space-y-6 max-w-4xl">
              <h2 className="text-[18px] font-bold text-[#0F172A]">Informações</h2>

              <div className="space-y-4.5">
                {/* 1. Nome completo */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Nome completo</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">{data.name}</p>
                  </div>
                </div>

                {/* 2. Data de nascimento */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <CalIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Data de nascimento</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.birth_date
                        ? `${data.birth_date}${data.age ? ` (${data.age})` : ""}`
                        : "Não informada"}
                    </p>
                  </div>
                </div>

                {/* 3. Sexo */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Sexo</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.gender === "F"
                        ? "Feminino"
                        : data.gender === "M"
                          ? "Masculino"
                          : data.gender === "O"
                            ? "Outro"
                            : data.gender || "Não informado"}
                    </p>
                  </div>
                </div>

                {/* 4. Email */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Email</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.email || "Não informado"}
                    </p>
                  </div>
                </div>

                {/* 5. Telefone */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Telefone</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5 flex items-center gap-1.5">
                      <span>{data.phone || "Não informado"}</span>
                      {data.phone && <span className="inline-block text-[#10B981]">💬</span>}
                    </p>
                  </div>
                </div>

                {/* 6. Notificações */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Notificações</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.notifications ||
                        (data.phone ? "WhatsApp / SMS ativo" : "Não recebe notificações")}
                    </p>
                  </div>
                </div>

                {/* 7. Endereço */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Endereço</p>
                    {data.address || data.neighborhood || data.city || data.state || data.cep ? (
                      <div className="text-[13.5px] text-[#7B3AF5] font-medium mt-0.5 leading-snug">
                        {data.address && <p>{data.address}</p>}
                        {(data.neighborhood || data.city || data.state) && (
                          <p>
                            {[
                              data.neighborhood,
                              [data.city, data.state].filter(Boolean).join(" - "),
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {data.cep && <p>CEP: {data.cep}</p>}
                        <p>{data.country || "Brasil"}</p>
                      </div>
                    ) : (
                      <p className="text-[13.5px] text-slate-400 font-medium mt-0.5">
                        Endereço não informado
                      </p>
                    )}
                  </div>
                </div>

                {/* 8. CPF */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">CPF</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.cpf || "Não informado"}
                    </p>
                  </div>
                </div>

                {/* 9. Observações */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <ClipboardList className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Observações</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.notes || "Nenhuma observação registrada."}
                    </p>
                  </div>
                </div>

                {/* 10. Cadastrado em */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Cadastrado em</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.created_at || "—"}
                    </p>
                  </div>
                </div>

                {/* 11. Status */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Status</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">
                      {data.active ? "Ativo" : "Inativo"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Link Editar informações */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (onEdit) onEdit();
                    else toast.info("Editar informações do paciente");
                  }}
                  className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-[#7B3AF5] hover:underline cursor-pointer transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Editar informações</span>
                </button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ABA: PRONTUÁRIO & ANAMNESE COMPLETA */}
          {/* ============================================================ */}
          {(activeTab === "prontuario" || activeTab === "timeline") && (
            <div className="space-y-6 max-w-4xl">
              <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-[18px] font-bold text-[#0F172A] flex items-center gap-2">
                    <FileText className="h-5 w-5 text-purple-600" />
                    {activeTab === "timeline"
                      ? "Linha do Tempo de Atendimentos"
                      : "Prontuário Clínico & Atendimentos"}
                  </h2>
                  <p className="text-[12.5px] text-slate-500 mt-0.5">
                    Histórico unificado de atendimentos, consultas e evoluções de{" "}
                    <strong className="text-slate-700">{data.name}</strong>.
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
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-purple-200 bg-purple-50/70 text-purple-700 hover:bg-purple-100 text-[13px] font-bold transition-all cursor-pointer shadow-2xs"
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
                      className="inline-flex items-center gap-1.5 h-10 px-4.5 rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 text-[13px] font-bold shadow-sm transition-all cursor-pointer"
                    >
                      <Save size={15} />
                      <span>{isSavingRecord ? "Salvando..." : "Salvar Atendimento"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Editor de Novo Atendimento (inicia limpo sem duplicar a ficha ou texto anterior) */}
              {activeTab === "prontuario" && (
                <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                        <ClipboardList size={16} />
                      </div>
                      <div>
                        <h3 className="text-[14.5px] font-bold text-slate-800">
                          Novo Atendimento / Evolução Clínica
                        </h3>
                        <p className="text-[11.5px] text-slate-400">
                          Registre queixa, sintomas, exame clínico e conduta terapêutica desta consulta.
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
                          className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
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
                        className="text-[11.5px] font-semibold text-white bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 px-3 py-1 rounded-lg flex items-center gap-1.5 shadow-2xs hover:brightness-105 cursor-pointer"
                      >
                        <Sparkles size={12} />
                        <span>Preencher com IA</span>
                      </button>

                      {anamnese && (
                        <button
                          type="button"
                          onClick={() => setAnamnese("")}
                          className="text-[11px] text-slate-400 hover:text-rose-600 font-medium px-1 cursor-pointer"
                          title="Limpar editor"
                        >
                          Limpar
                        </button>
                      )}

                      <span className="text-[11px] text-slate-400 font-medium ml-1">
                        {anamnese.length} caracteres
                      </span>
                    </div>
                  </div>

                  <textarea
                    rows={6}
                    value={anamnese}
                    onChange={(e) => setAnamnese(e.target.value)}
                    placeholder="Descreva a anamnese ou evolução da consulta atual (motivo da consulta, sintomas, hipóteses diagnósticas e conduta médica)..."
                    className="w-full rounded-xl border border-slate-200 p-4 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all resize-y min-h-[160px] font-sans leading-relaxed"
                  />
                </div>
              )}

              {/* Histórico Completo de Atendimentos e Consultas do Paciente */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                    <History className="h-4.5 w-4.5 text-purple-600" />
                    <span>
                      Histórico Completo de Atendimentos ({clinicalHistory.length})
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => refreshHistory()}
                    className="text-xs text-slate-500 hover:text-purple-600 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                    title="Atualizar lista de atendimentos"
                  >
                    <RefreshCw size={12} className={loadingHistory ? "animate-spin" : ""} />
                    <span>Atualizar</span>
                  </button>
                </div>

                {/* Filtros e Busca Rápida no Histórico */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                  {/* Pílulas de filtro por tipo */}
                  <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("todos")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "todos"
                          ? "bg-purple-600 text-white shadow-2xs"
                          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      Todos ({clinicalHistory.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("prontuario")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "prontuario"
                          ? "bg-purple-600 text-white shadow-2xs"
                          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      🩺 Prontuários ({prontuariosCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("consulta")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "consulta"
                          ? "bg-purple-600 text-white shadow-2xs"
                          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      📅 Consultas ({consultasCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("evolucao")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                        historyFilter === "evolucao"
                          ? "bg-purple-600 text-white shadow-2xs"
                          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      📈 Evoluções ({evolucoesCount})
                    </button>
                  </div>

                  {/* Campo de Busca Rápida */}
                  <div className="relative min-w-[220px]">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                    />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Filtrar histórico..."
                      className="w-full h-8.5 pl-8.5 pr-3 rounded-lg border border-slate-200 bg-white text-[12.5px] placeholder:text-slate-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Lista de Atendimentos */}
                {filteredHistory.length > 0 ? (
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {filteredHistory.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2.5 transition-all hover:border-purple-200"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.kind === "prontuario" && (
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-purple-100 text-purple-700">
                                🩺 Prontuário Clínico
                              </span>
                            )}
                            {item.kind === "consulta" && (
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-blue-100 text-blue-700">
                                📅 {item.type || "Consulta"}
                              </span>
                            )}
                            {item.kind === "evolucao" && (
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700">
                                📈 Evolução
                              </span>
                            )}

                            <span className="font-bold text-slate-800 text-[13px]">
                              {item.formattedDate} {item.time ? `às ${item.time}` : ""}
                            </span>

                            {item.doctorName && (
                              <span className="text-[11.5px] text-slate-500 font-medium">
                                • {item.doctorName}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {item.status && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                                {item.status}
                              </span>
                            )}

                            {item.durationSeconds ? (
                              <span className="text-[11.5px] text-slate-600 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
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
                                className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 hover:underline cursor-pointer"
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
                                className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                title="Copiar texto"
                              >
                                <Copy size={13} />
                              </button>
                            )}

                            {/* Botão Editar */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(item)}
                              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 hover:text-purple-600 bg-slate-100 hover:bg-purple-50 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                              title="Editar anotações deste atendimento"
                            >
                              <Pencil size={12} />
                              <span>Editar</span>
                            </button>

                            {/* Botão Excluir */}
                            <button
                              type="button"
                              onClick={() => handleOpenDelete(item)}
                              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                              title="Excluir este prontuário"
                            >
                              <Trash2 size={12} />
                              <span>Excluir</span>
                            </button>
                          </div>
                        </div>

                        {/* Conteúdo Clínico */}
                        {item.complaint ? (
                          <div className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50/70 p-3 rounded-lg border border-slate-100">
                            {item.complaint}
                          </div>
                        ) : (
                          <p className="text-[12px] text-slate-400 italic">
                            Consulta registrada sem anotações adicionais.
                          </p>
                        )}

                        {/* Conduta se cadastrada separadamente */}
                        {item.conduct && (
                          <div className="text-[12px] text-purple-900 bg-purple-50/60 p-2.5 rounded-lg border border-purple-100">
                            <strong>Conduta terapêutica:</strong> {item.conduct}
                          </div>
                        )}

                        {/* Diagnóstico se cadastrado */}
                        {item.diagnosis && (
                          <div className="text-[12px] text-slate-600">
                            <strong>Diagnóstico:</strong> {item.diagnosis}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center space-y-2">
                    <FileText className="h-8 w-8 text-slate-300 mx-auto" />
                    <p className="text-[13px] font-medium text-slate-600">
                      {historySearch
                        ? `Nenhum registro encontrado para "${historySearch}".`
                        : `Nenhum atendimento registrado ainda para ${data.name}.`}
                    </p>
                    <p className="text-[12px] text-slate-400 max-w-sm mx-auto">
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
            <PatientFinanceTab
              patientId={data.id || ""}
              patientName={data.name}
            />
          )}

          {/* ABA PACOTES */}
          {activeTab === "pacotes" && (
            <PatientPackagesTab
              patientId={data.id || ""}
              patientName={data.name}
            />
          )}

          {/* OUTRAS ABAS */}
          {activeTab !== "informacoes" &&
            activeTab !== "prontuario" &&
            activeTab !== "timeline" &&
            activeTab !== "financeiro" &&
            activeTab !== "pacotes" && (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                <div className="h-14 w-14 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                  <FolderOpen className="h-7 w-7" />
                </div>
                <h3 className="text-[16px] font-bold text-[#0F172A]">{activeTabLabel}</h3>
                <p className="text-[13px] text-[#64748B]">
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
      {editModalOpen && editingItem && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <Pencil size={16} />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-900">
                    Editar Prontuário Clínico
                  </h3>
                  <p className="text-[12px] text-slate-500">
                    Atendimento de {editingItem.formattedDate} • {data.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditModalOpen(false);
                  setEditingItem(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[13px] font-bold text-slate-700">
                  Anamnese, Queixa & Evolução Clínica
                </label>
                <textarea
                  rows={8}
                  value={editComplaint}
                  onChange={(e) => setEditComplaint(e.target.value)}
                  placeholder="Anotações clínicas do atendimento..."
                  className="w-full rounded-xl border border-slate-200 p-3.5 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all resize-y min-h-[180px] leading-relaxed"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-bold text-slate-700">
                  Conduta Terapêutica (opcional)
                </label>
                <textarea
                  rows={3}
                  value={editConduct}
                  onChange={(e) => setEditConduct(e.target.value)}
                  placeholder="Orientações, prescrições e condutas tomadas..."
                  className="w-full rounded-xl border border-slate-200 p-3 text-[13px] text-slate-800 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all resize-y"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setEditModalOpen(false);
                  setEditingItem(null);
                }}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isUpdating || !editComplaint.trim()}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[13px] font-bold shadow-sm transition-all cursor-pointer"
              >
                <Save size={14} />
                <span>{isUpdating ? "Salvando..." : "Salvar Alterações"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão de Prontuário */}
      {deleteModalOpen && deletingItem && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-[16px] font-bold text-slate-900">
                  Excluir este prontuário?
                </h3>
                <p className="text-[13px] text-slate-500 leading-relaxed">
                  Tem certeza de que deseja excluir o atendimento de{" "}
                  <strong className="text-slate-800">{deletingItem.formattedDate}</strong> de{" "}
                  <strong className="text-slate-800">{data.name}</strong>? Esta ação removerá o
                  registro do histórico do paciente.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setDeletingItem(null);
                }}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[13px] font-bold shadow-sm transition-all cursor-pointer"
              >
                <Trash2 size={14} />
                <span>{isDeleting ? "Excluindo..." : "Sim, excluir"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

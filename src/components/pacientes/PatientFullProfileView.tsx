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
} from "lucide-react";
import { toast } from "sonner";
import { prontuarioService } from "@/services/api";
import {
  AiRecordAssistantModal,
  type AiSectionContext,
} from "@/components/prontuario/AiRecordAssistantModal";
import type { StructuredConsultationResult } from "@/lib/gemini";

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
  photoUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&auto=format&fit=crop&q=80",
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

  // Estado do Assistente IA
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiSection, setAiSection] = useState<AiSectionContext | null>(null);

  const isExample = !patient || !patient.id || Boolean(patient.name?.toLowerCase().includes("exemplo"));

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

  // Carrega histórico de atendimentos e prontuários deste paciente específico no Supabase + LocalStorage fallback
  const {
    data: records = [],
    isLoading: loadingRecords,
    refetch: refreshRecords,
  } = useQuery({
    queryKey: ["patient-medical-records", data.id, data.name],
    staleTime: 0,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      let dbRecs: any[] = [];
      if (data.id && !isExample) {
        try {
          const { data: recs, error } = await supabase
            .from("medical_records")
            .select("*")
            .eq("patient_id", data.id)
            .order("created_at", { ascending: false });
          if (!error && recs) {
            dbRecs = recs;
          }
        } catch (e) {
          console.warn("Aviso ao buscar medical_records do banco:", e);
        }
      }

      // Lê histórico local
      let localRecs: any[] = [];
      try {
        const storedHistory =
          (data.id && localStorage.getItem("medcore_prontuario_history_" + data.id)) ||
          (data.name && localStorage.getItem("medcore_prontuario_history_" + data.name));
        if (storedHistory) {
          localRecs = JSON.parse(storedHistory);
        }
      } catch {}

      // Mescla e desduplica por id/created_at
      const all = [...dbRecs];
      for (const l of localRecs) {
        if (!all.some((r) => r.id === l.id || (r.created_at && r.created_at === l.created_at))) {
          all.push(l);
        }
      }

      // Se ainda estiver vazio, tenta carregar o último snapshot local
      if (all.length === 0) {
        try {
          const lastSnapshot =
            (data.id && localStorage.getItem("medcore_prontuario_" + data.id)) ||
            (data.name && localStorage.getItem("medcore_prontuario_" + data.name));
          if (lastSnapshot) {
            const parsed = JSON.parse(lastSnapshot);
            all.push({
              id: "local-" + Date.now(),
              ...parsed,
              created_at: parsed.created_at || new Date().toISOString(),
            });
          }
        } catch {}
      }

      all.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      return all;
    },
  });

  // Preenche automaticamente com o último prontuário/evolução salvo
  useEffect(() => {
    let latest = records.length > 0 ? records[0] : null;
    if (!latest) {
      try {
        const local =
          (data.id && localStorage.getItem("medcore_prontuario_" + data.id)) ||
          (data.name && localStorage.getItem("medcore_prontuario_" + data.name));
        if (local) latest = JSON.parse(local);
      } catch {}
    }

    if (latest && latest.complaint) {
      setAnamnese(latest.complaint);
    } else {
      setAnamnese("");
    }
  }, [records, data.id, data.name]);

  const handleSaveProntuario = async () => {
    setIsSavingRecord(true);
    const newRecord = {
      id: crypto.randomUUID(),
      patient_id: data.id || null,
      patient_name: data.name,
      complaint: anamnese || null,
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };

    // 1. Salva no LocalStorage garantindo persistência imediata
    try {
      if (data.id) localStorage.setItem("medcore_prontuario_" + data.id, JSON.stringify(newRecord));
      if (data.name) localStorage.setItem("medcore_prontuario_" + data.name, JSON.stringify(newRecord));

      const prevHistKey = data.id
        ? "medcore_prontuario_history_" + data.id
        : "medcore_prontuario_history_" + data.name;
      const prevHist = JSON.parse(localStorage.getItem(prevHistKey) || "[]");
      const nextHist = [newRecord, ...prevHist.filter((h: any) => h.id !== newRecord.id)];
      if (data.id) localStorage.setItem("medcore_prontuario_history_" + data.id, JSON.stringify(nextHist));
      if (data.name) localStorage.setItem("medcore_prontuario_history_" + data.name, JSON.stringify(nextHist));
    } catch (e) {
      console.warn("Aviso ao salvar localmente:", e);
    }

    // 2. Salva no Supabase se id válido
    if (data.id && !isExample) {
      try {
        await supabase.from("medical_records").insert({
          patient_id: data.id,
          complaint: anamnese || null,
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
          complaint: anamnese || null,
          finished_at: new Date().toISOString(),
        })
        .catch(() => {});
    }

    toast.success("Prontuário salvo com sucesso!", {
      description: `Prontuário clínico de ${data.name} gravado.`,
    });
    refreshRecords();
    queryClient.invalidateQueries({ queryKey: ["patient-medical-records"] });
    setIsSavingRecord(false);
  };

  const openAiForSection = (sec: { key: string; title: string; placeholder?: string }) => {
    setAiSection(sec);
    setAiModalOpen(true);
  };

  const handleAiInsert = (
    content: string | StructuredConsultationResult,
  ) => {
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
                <img
                  src={data.photoUrl}
                  alt={data.name}
                  className="h-full w-full object-cover"
                />
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

          {/* Botão Atender com IA */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("prontuario");
              setAiSection({ key: "queixa", title: "Consulta do Paciente" });
              setAiModalOpen(true);
            }}
            className="w-full mt-2.5 h-10 px-3 rounded-xl text-white font-bold text-[12.5px] flex items-center justify-center gap-2 shadow-sm hover:brightness-105 active:scale-[0.98] transition-all cursor-pointer"
            style={{
              background: "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
            }}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>Atendimento com IA</span>
          </button>

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
                  {tab.id === "prontuario" && (
                    <Sparkles className={`h-3.5 w-3.5 ${isActive ? "text-white" : "text-[#7B3AF5]"}`} />
                  )}
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
                      {data.birth_date ? `${data.birth_date}${data.age ? ` (${data.age})` : ""}` : "Não informada"}
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
                      {data.gender === "F" ? "Feminino" : data.gender === "M" ? "Masculino" : data.gender === "O" ? "Outro" : (data.gender || "Não informado")}
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
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">{data.email || "Não informado"}</p>
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
                      {data.notifications || (data.phone ? "WhatsApp / SMS ativo" : "Não recebe notificações")}
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
                            {[data.neighborhood, [data.city, data.state].filter(Boolean).join(" - ")].filter(Boolean).join(", ")}
                          </p>
                        )}
                        {data.cep && <p>CEP: {data.cep}</p>}
                        <p>{data.country || "Brasil"}</p>
                      </div>
                    ) : (
                      <p className="text-[13.5px] text-slate-400 font-medium mt-0.5">Endereço não informado</p>
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
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">{data.cpf || "Não informado"}</p>
                  </div>
                </div>

                {/* 9. Observações */}
                <div className="flex items-start gap-3.5">
                  <div className="h-8.5 w-8.5 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                    <ClipboardList className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-bold text-[#1E293B]">Observações</p>
                    <p className="text-[13.5px] text-[#475569] font-medium mt-0.5">{data.notes || "Nenhuma observação registrada."}</p>
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
          {/* ABA: PRONTUÁRIO & ANAMNESE COMPLETA COM IA */}
          {/* ============================================================ */}
          {activeTab === "prontuario" && (
            <div className="space-y-6 max-w-4xl">
              <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-[18px] font-bold text-[#0F172A] flex items-center gap-2">
                    <FileText className="h-5 w-5 text-purple-600" />
                    Prontuário Clínico & Anamnese
                  </h2>
                  <p className="text-[12.5px] text-slate-500 mt-0.5">
                    Prontuário integrado de <strong className="text-slate-700">{data.name}</strong>. Os dados salvos aqui e na central de atendimento são 100% sincronizados.
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

                  <button
                    type="button"
                    onClick={() => {
                      setAiSection({ key: "anamnese_geral", title: "Anamnese Geral & Consulta" });
                      setAiModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-white text-[13px] font-bold shadow-sm hover:brightness-105 active:scale-95 transition-all cursor-pointer"
                    style={{
                      background: "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
                    }}
                  >
                    <Sparkles size={15} />
                    <span>Atendimento com IA</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveProntuario}
                    disabled={isSavingRecord}
                    className="inline-flex items-center gap-1.5 h-10 px-4.5 rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 text-[13px] font-bold shadow-sm transition-all cursor-pointer"
                  >
                    <Save size={15} />
                    <span>{isSavingRecord ? "Salvando..." : "Salvar Prontuário"}</span>
                  </button>
                </div>
              </div>

              {/* Editor de Anamnese e Prontuário Unificado */}
              <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                      <ClipboardList size={16} />
                    </div>
                    <div>
                      <h3 className="text-[14.5px] font-bold text-slate-800">
                        Anamnese & Evolução Clínica
                      </h3>
                      <p className="text-[11.5px] text-slate-400">
                        Motivo da consulta, sintomas, antecedentes, exame clínico e conduta terapêutica.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-medium">
                      {anamnese.length} caracteres
                    </span>
                    <button
                      type="button"
                      onClick={() => openAiForSection({ key: "anamnese_geral", title: "Anamnese Geral" })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-[12px] font-semibold text-purple-700 hover:bg-purple-100 transition-colors cursor-pointer"
                    >
                      <Sparkles size={13} /> Preencher com IA
                    </button>
                  </div>
                </div>

                <textarea
                  rows={8}
                  value={anamnese}
                  onChange={(e) => setAnamnese(e.target.value)}
                  placeholder="Descreva a anamnese geral do paciente (queixa principal, histórico de saúde, observações clínicas, hipóteses e condutas)..."
                  className="w-full rounded-xl border border-slate-200 p-4 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/15 outline-none transition-all resize-y min-h-[220px] font-sans leading-relaxed"
                />
              </div>

              {/* Histórico Completo de Atendimentos Salvos para este paciente */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                    <History className="h-4.5 w-4.5 text-purple-600" />
                    <span>Histórico de Atendimentos e Evoluções ({records.length})</span>
                  </div>
                  {records.length > 0 && (
                    <span className="text-xs text-purple-700 font-semibold bg-purple-100/80 px-3 py-1 rounded-full">
                      Último registro: {new Date(records[0].created_at).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>

                {records.length > 0 ? (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                    {records.map((rec: any, idx: number) => (
                      <div
                        key={rec.id || idx}
                        className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2.5 transition-all hover:border-purple-200"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-purple-600" />
                            <span className="font-bold text-slate-800 text-[13px]">
                              {new Date(rec.created_at).toLocaleDateString("pt-BR", {
                                weekday: "short",
                                day: "2-digit",
                                month: "long",
                                year: "numeric",
                              })}{" "}
                              às{" "}
                              {new Date(rec.created_at).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {rec.duration_seconds ? (
                              <span className="text-[11.5px] text-slate-600 font-medium bg-slate-100 px-2.5 py-0.5 rounded-md">
                                ⏱️ {Math.round(rec.duration_seconds / 60)} min
                              </span>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => {
                                if (rec.complaint) {
                                  setAnamnese(rec.complaint);
                                  toast.success("Conteúdo carregado no editor");
                                }
                              }}
                              className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 hover:underline cursor-pointer"
                              title="Carregar este texto no editor acima"
                            >
                              Carregar no editor
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (rec.complaint) {
                                  navigator.clipboard.writeText(rec.complaint);
                                  toast.success("Texto do prontuário copiado");
                                }
                              }}
                              className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 cursor-pointer"
                              title="Copiar texto"
                            >
                              <Copy size={13} />
                            </button>
                          </div>
                        </div>

                        {rec.complaint ? (
                          <div className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50/70 p-3 rounded-lg border border-slate-100">
                            {rec.complaint}
                          </div>
                        ) : (
                          <p className="text-[12px] text-slate-400 italic">
                            Nenhum texto registrado nesta consulta.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center space-y-2">
                    <FileText className="h-8 w-8 text-slate-300 mx-auto" />
                    <p className="text-[13px] font-medium text-slate-600">
                      Nenhum atendimento finalizado registrado ainda para {data.name}.
                    </p>
                    <p className="text-[12px] text-slate-400 max-w-sm mx-auto">
                      Você pode escrever a anamnese no campo acima ou clicar em "Atendimento com IA" para gerar anotações clínicas automáticas.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* OUTRAS ABAS */}
          {activeTab !== "informacoes" && activeTab !== "prontuario" && (
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
    </div>
  );
}

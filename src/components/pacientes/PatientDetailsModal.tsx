import { useState, useMemo } from "react";
import {
  X,
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
  ExternalLink,
  Save,
  Check,
  Stethoscope,
  Pill,
  ShieldAlert,
  Activity,
  UserCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  AiRecordAssistantModal,
  type AiSectionContext,
} from "@/components/prontuario/AiRecordAssistantModal";
import type { StructuredConsultationResult } from "@/lib/gemini";

export type PatientDetailsData = {
  id?: string;
  name: string;
  birth_date?: string | null;
  age?: string | null;
  gender?: string | null;
  email?: string | null;
  phone?: string | null;
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

const DEFAULT_PATIENT: PatientDetailsData = {
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
  { id: "prontuario", label: "Prontuário & IA" },
  { id: "timeline", label: "Linha do tempo" },
  { id: "carteira", label: "Carteira" },
  { id: "pacotes", label: "Pacotes" },
  { id: "financeiro", label: "Financeiro" },
  { id: "orcamentos", label: "Orçamentos" },
  { id: "documentos", label: "Documentos" },
  { id: "formularios", label: "Formulários" },
];

const CONDICOES_PRONTUARIO = [
  "Hipertensão",
  "Diabetes",
  "Doenças cardíacas",
  "Asma ou problemas respiratórios",
  "Problemas de tireoide",
  "Câncer",
  "Outras condições crônicas",
];

export function PatientDetailsModal({
  open,
  onOpenChange,
  patientData,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientData?: Partial<PatientDetailsData> | null;
  onEdit?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<string>("informacoes");

  // Estado do Prontuário dentro do Modal
  const [queixa, setQueixa] = useState("");
  const [historicoFamiliar, setHistoricoFamiliar] = useState("");
  const [tratamentos, setTratamentos] = useState("");
  const [alergias, setAlergias] = useState("");
  const [historicoPessoal, setHistoricoPessoal] = useState("");
  const [medicacoes, setMedicacoes] = useState("");
  const [condicoes, setConditions] = useState<Record<string, boolean>>({});

  // Estado do Assistente IA no Modal
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiSection, setAiSection] = useState<AiSectionContext | null>(null);

  const data = useMemo(() => {
    return {
      ...DEFAULT_PATIENT,
      ...patientData,
      name: patientData?.name || DEFAULT_PATIENT.name,
    };
  }, [patientData]);

  const openAiForSection = (sec: { key: string; title: string; placeholder?: string }) => {
    setAiSection(sec);
    setAiModalOpen(true);
  };

  const handleAiInsert = (
    content: string | StructuredConsultationResult,
    sectionKey?: string
  ) => {
    if (typeof content === "string") {
      if (sectionKey === "queixa") setQueixa(content);
      else if (sectionKey === "historico_familiar") setHistoricoFamiliar(content);
      else if (sectionKey === "tratamentos") setTratamentos(content);
      else if (sectionKey === "alergias") setAlergias(content);
      else if (sectionKey === "medicacoes") setMedicacoes(content);
      else if (sectionKey === "historico_pessoal") setHistoricoPessoal(content);
    } else {
      const isValid = (t?: string) =>
        Boolean(t && t.trim().length > 0 && t !== "Não informado na consulta.");

      if (isValid(content.queixaPrincipal)) {
        setQueixa(content.queixaPrincipal);
      }
      if (isValid(content.historicoFamiliar)) {
        setHistoricoFamiliar(content.historicoFamiliar);
      }
      if (isValid(content.tratamentosAnteriores) || isValid(content.condutaPlano)) {
        const full = [content.tratamentosAnteriores, content.condutaPlano ? `Conduta e Orientações:\n${content.condutaPlano}` : ""]
          .filter(isValid)
          .join("\n\n");
        setTratamentos(full);
      }
      if (isValid(content.alergias)) {
        setAlergias(content.alergias);
      }
      if (isValid(content.medicacoesEmUso)) {
        setMedicacoes(content.medicacoesEmUso);
      }
      if (isValid(content.historicoPessoal)) {
        setHistoricoPessoal((prev) => (prev ? `${prev}\n${content.historicoPessoal}` : content.historicoPessoal));
      }
      if (content.condicoesDetectadas && content.condicoesDetectadas.length > 0) {
        setConditions((prev) => {
          const next = { ...prev };
          content.condicoesDetectadas.forEach((cond) => {
            next[cond] = true;
          });
          return next;
        });
      }
    }
  };

  const handleSaveProntuarioLocal = () => {
    toast.success("Prontuário salvo com sucesso!", {
      description: `Registro atualizado para ${data.name}.`,
    });
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[94vw] md:w-[940px] max-h-[92vh] p-0 overflow-hidden rounded-3xl border border-border/70 bg-white shadow-2xl flex flex-col [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">Perfil e Detalhes do Paciente</DialogTitle>

        {/* Close button top right */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 z-50 h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* ============================================================ */}
          {/* LEFT SIDEBAR: Perfil, Foto, Contatos e Menus */}
          {/* ============================================================ */}
          <aside className="w-full md:w-[280px] shrink-0 bg-[#FBFBFC] border-b md:border-b-0 md:border-r border-[#EFEFEF] p-5 flex flex-col items-center overflow-y-auto">
            {/* Avatar Container */}
            <div className="relative mb-3">
              <div className="relative h-20 w-20 rounded-full overflow-hidden border-2 border-white shadow-md bg-purple-100 flex items-center justify-center">
                {data.photoUrl ? (
                  <img
                    src={data.photoUrl}
                    alt={data.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-[#7B3AF5] text-white font-bold text-xl flex items-center justify-center">
                    {data.name
                      .split(" ")
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join("")}
                  </div>
                )}

                <div className="absolute bottom-1.5 left-0 right-0 bg-[#7B3AF5] text-white text-[8px] font-extrabold uppercase tracking-widest text-center py-0.5 transform -rotate-12 shadow-sm">
                  PACIENTE
                </div>
              </div>

              <button
                type="button"
                className="absolute -top-1 -right-1 h-5.5 w-5.5 rounded-full bg-[#7B3AF5] text-white flex items-center justify-center shadow hover:scale-105 transition-transform cursor-pointer"
                title="Alterar foto"
                onClick={() => toast.info("Upload de foto")}
              >
                <Camera className="h-3 w-3" />
              </button>
            </div>

            {/* Nome Completo */}
            <h2 className="text-[15px] font-bold text-[#0F172A] text-center leading-tight">
              {data.name}
            </h2>

            <div className="mt-1 text-center space-y-0.5">
              <p className="text-[11.5px] font-medium text-[#64748B]">
                {data.gender || "Feminino"} • {data.age || "34 anos"}
              </p>
              <p className="text-[11.5px] font-medium text-[#64748B]">{data.phone}</p>
            </div>

            {/* Botão de Destaque: Atendimento / Consulta com IA */}
            <button
              type="button"
              onClick={() => {
                setActiveTab("prontuario");
                setAiSection({ key: "queixa", title: "Consulta do Paciente" });
                setAiModalOpen(true);
              }}
              className="w-full mt-3.5 h-10 px-3 rounded-xl text-white font-bold text-[12.5px] flex items-center justify-center gap-2 shadow-sm hover:brightness-105 active:scale-[0.98] transition-all cursor-pointer"
              style={{
                background: "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
              }}
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              <span>Atender com IA</span>
            </button>

            {/* Botão WhatsApp */}
            <div className="mt-2 w-full flex items-center gap-1.5">
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
                className="flex-1 h-9 px-3 rounded-xl bg-[#E8F8F0] hover:bg-[#D8F3E5] text-[#10B981] font-semibold text-[12px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>WhatsApp</span>
              </button>

              <button
                type="button"
                className="h-9 w-9 rounded-xl border border-[#E2E8F0] hover:bg-[#F1F5F9] text-[#64748B] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                title="Mais opções"
                onClick={() => toast.message("Opções do paciente")}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>

            {/* Sidebar Navigation Tabs */}
            <nav className="mt-4 w-full space-y-1">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full h-8.5 px-3.5 rounded-xl text-[12.5px] font-medium transition-all text-left flex items-center justify-between cursor-pointer ${
                      isActive
                        ? "bg-[#7B3AF5] text-white font-semibold shadow-sm"
                        : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.id === "prontuario" && (
                      <Sparkles className={`h-3 w-3 ${isActive ? "text-white" : "text-[#7B3AF5]"}`} />
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* ============================================================ */}
          {/* RIGHT CONTENT */}
          {/* ============================================================ */}
          <main className="flex-1 p-5 md:p-6 overflow-y-auto bg-white">
            {/* ABA 1: PRONTUÁRIO & CONSULTA IA EMBUTIDA */}
            {activeTab === "prontuario" ? (
              <div className="space-y-5">
                {/* Header da Aba de Prontuário */}
                <div className="flex items-center justify-between flex-wrap gap-3 pb-3.5 border-b border-slate-100">
                  <div>
                    <h3 className="text-[17px] font-bold text-slate-900 flex items-center gap-2">
                      <FileText className="h-5 w-5 text-purple-600" />
                      Prontuário Clínico & Anamnese
                    </h3>
                    <p className="text-[12.5px] text-slate-500 mt-0.5">
                      Campos estruturados para atendimento, histórico e conduta médica.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      to="/prontuario"
                      search={{ patientName: data.name, patientId: data.id } as any}
                      onClick={() => onOpenChange(false)}
                      className="inline-flex items-center gap-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-[12px] font-semibold transition-colors"
                      title="Abrir prontuário em tela cheia"
                    >
                      <ExternalLink size={13} />
                      <span className="hidden sm:inline">Tela cheia</span>
                    </Link>
                  </div>
                </div>

                {/* Seções do Prontuário */}
                <div className="space-y-4">
                  {/* 1. Queixa Principal */}
                  <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-purple-100 text-purple-700 flex items-center justify-center">
                          <ClipboardList size={14} />
                        </div>
                        <label className="text-[13.5px] font-bold text-slate-800">
                          Queixa Principal
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAiForSection({ key: "queixa", title: "Queixa Principal" })}
                        className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={12} /> IA
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={queixa}
                      onChange={(e) => setQueixa(e.target.value)}
                      placeholder="Descreva o motivo da consulta, sintomas, início e evolução..."
                      className="w-full rounded-lg border border-slate-200 p-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-1 focus:ring-purple-600/20 outline-none transition-all resize-y"
                    />
                  </div>

                  {/* 2. Histórico Familiar */}
                  <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center">
                          <UserCheck size={14} />
                        </div>
                        <label className="text-[13.5px] font-bold text-slate-800">
                          Histórico Familiar
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAiForSection({ key: "historico_familiar", title: "Histórico Familiar" })}
                        className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={12} /> IA
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={historicoFamiliar}
                      onChange={(e) => setHistoricoFamiliar(e.target.value)}
                      placeholder="Antecedentes familiares relevantes (pais, avós, irmãos)..."
                      className="w-full rounded-lg border border-slate-200 p-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-1 focus:ring-purple-600/20 outline-none transition-all resize-y"
                    />
                  </div>

                  {/* 3. Tratamentos Anteriores & Conduta */}
                  <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-teal-100 text-teal-700 flex items-center justify-center">
                          <Activity size={14} />
                        </div>
                        <label className="text-[13.5px] font-bold text-slate-800">
                          Tratamentos Anteriores & Conduta
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAiForSection({ key: "tratamentos", title: "Tratamentos Anteriores" })}
                        className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={12} /> IA
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={tratamentos}
                      onChange={(e) => setTratamentos(e.target.value)}
                      placeholder="Tratamentos prévios realizados, procedimentos e condutas discutidas..."
                      className="w-full rounded-lg border border-slate-200 p-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-1 focus:ring-purple-600/20 outline-none transition-all resize-y"
                    />
                  </div>

                  {/* 4. Alergias */}
                  <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-rose-100 text-rose-700 flex items-center justify-center">
                          <ShieldAlert size={14} />
                        </div>
                        <label className="text-[13.5px] font-bold text-slate-800">
                          Alergias
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAiForSection({ key: "alergias", title: "Alergias" })}
                        className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={12} /> IA
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={alergias}
                      onChange={(e) => setAlergias(e.target.value)}
                      placeholder="Alergias medicamentosas, alimentares ou ambientais..."
                      className="w-full rounded-lg border border-slate-200 p-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-1 focus:ring-purple-600/20 outline-none transition-all resize-y"
                    />
                  </div>

                  {/* 5. Histórico Médico Pessoal & Condições */}
                  <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center">
                          <Stethoscope size={14} />
                        </div>
                        <label className="text-[13.5px] font-bold text-slate-800">
                          Histórico Médico Pessoal
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAiForSection({ key: "historico_pessoal", title: "Histórico Médico Pessoal" })}
                        className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={12} /> IA
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                      {CONDICOES_PRONTUARIO.map((c) => (
                        <label key={c} className="flex items-center gap-2 text-[12px] text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!condicoes[c]}
                            onChange={(e) => setConditions((prev) => ({ ...prev, [c]: e.target.checked }))}
                            className="rounded text-purple-600 focus:ring-purple-500 h-3.5 w-3.5"
                          />
                          <span>{c}</span>
                        </label>
                      ))}
                    </div>

                    <div className="space-y-1 pt-1">
                      <label className="text-[12px] font-semibold text-slate-700">
                        Outras condições / Especifique:
                      </label>
                      <textarea
                        rows={2}
                        value={historicoPessoal}
                        onChange={(e) => setHistoricoPessoal(e.target.value)}
                        placeholder="Patologias prévias ou detalhes adicionais..."
                        className="w-full rounded-lg border border-slate-200 p-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-1 focus:ring-purple-600/20 outline-none transition-all resize-y"
                      />
                    </div>
                  </div>

                  {/* 6. Medicações em Uso */}
                  <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center">
                          <Pill size={14} />
                        </div>
                        <label className="text-[13.5px] font-bold text-slate-800">
                          Medicações em Uso Atualmente
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAiForSection({ key: "medicacoes", title: "Medicações" })}
                        className="text-[11.5px] font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={12} /> IA
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={medicacoes}
                      onChange={(e) => setMedicacoes(e.target.value)}
                      placeholder="Ex.: Losartana 50mg — 1x ao dia pela manhã..."
                      className="w-full rounded-lg border border-slate-200 p-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-1 focus:ring-purple-600/20 outline-none transition-all resize-y"
                    />
                  </div>
                </div>

                {/* Footer de Ação do Prontuário */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleSaveProntuarioLocal}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[13px] font-bold shadow-sm transition-all active:scale-98 cursor-pointer"
                  >
                    <Save size={15} />
                    <span>Salvar Prontuário</span>
                  </button>
                </div>
              </div>
            ) : activeTab === "informacoes" ? (
              /* ABA 2: INFORMAÇÕES PESSOAIS */
              <div className="space-y-6">
                <h3 className="text-[17px] font-bold text-[#0F172A]">Informações do Paciente</h3>

                <div className="space-y-4">
                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-[#1E293B]">Nome completo</p>
                      <p className="text-[13px] text-[#475569] font-medium mt-0.5">{data.name}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                      <CalIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-[#1E293B]">Data de nascimento</p>
                      <p className="text-[13px] text-[#475569] font-medium mt-0.5">
                        {data.birth_date || "26/01/1992 (34 anos)"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-[#1E293B]">Sexo</p>
                      <p className="text-[13px] text-[#475569] font-medium mt-0.5">
                        {data.gender || "Feminino"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-[#1E293B]">Email</p>
                      <p className="text-[13px] text-[#475569] font-medium mt-0.5">{data.email}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                      <Phone className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-[#1E293B]">Telefone</p>
                      <p className="text-[13px] text-[#475569] font-medium mt-0.5">{data.phone}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-[#1E293B]">Endereço</p>
                      <div className="text-[13px] text-[#7B3AF5] font-medium mt-0.5 leading-snug">
                        <p>{data.address || "Av. Pedro Álvares Cabral, SN"}</p>
                        <p>{data.neighborhood || "Vila Mariana"}, {data.city || "São Paulo"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-[#F3E8FF] text-[#7B3AF5] flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-[#1E293B]">CPF</p>
                      <p className="text-[13px] text-[#475569] font-medium mt-0.5">{data.cpf}</p>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (onEdit) onEdit();
                      else toast.info("Edição de informações do paciente");
                    }}
                    className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-[#7B3AF5] hover:underline cursor-pointer transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                    <span>Editar informações</span>
                  </button>
                </div>
              </div>
            ) : (
              /* OUTRAS ABAS */
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                  <FolderOpen className="h-6 w-6" />
                </div>
                <h4 className="text-[15px] font-bold text-[#0F172A]">
                  {TABS.find((t) => t.id === activeTab)?.label}
                </h4>
                <p className="text-[13px] text-[#64748B]">
                  Nenhum registro encontrado nesta seção no momento.
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
      </DialogContent>
    </Dialog>
  );
}

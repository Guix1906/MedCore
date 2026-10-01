import {
  AiRecordAssistantModal,
  type AiSectionContext,
} from "@/components/prontuario/AiRecordAssistantModal";
import ClinicalPhotos from "@/features/acompanhamentos/ClinicalPhotos";
import {
  usePatientClinicalHistory,
  type ClinicalHistoryItem,
} from "@/hooks/usePatientClinicalHistory";
import { supabase } from "@/integrations/supabase/client";
import {
  appendToRecord,
  formatConsultationRecord,
  type StructuredConsultationResult,
} from "@/lib/gemini";
import { DUR, EASE_OUT, fadeUp, staggerContainer } from "@/lib/motion";
import { patientsService } from "@/services/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Calendar,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardList,
  Clock,
  CloudUpload,
  Copy,
  FileDigit,
  FileText,
  Highlighter,
  History,
  Italic,
  List,
  ListOrdered,
  PlusCircle,
  Printer,
  Redo2,
  RemoveFormatting,
  Search,
  Settings,
  Sparkles,
  Stethoscope,
  Strikethrough,
  Timer,
  Type,
  Underline,
  Undo2,
  User,
} from "lucide-react";
import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { ProntuarioHub } from "./ProntuarioHub";

export interface RichEditorHandle {
  insertText: (text: string) => void;
  setText: (text: string) => void;
  getText: () => string;
}

type SaveState = "saved" | "saving" | "dirty";
const DirtyCtx = createContext<() => void>(() => {});

type TabKey = "prontuarios" | "anamnese" | "orcamento" | "plano" | "fotos" | "injetaveis";

const TABS: { key: TabKey; label: string }[] = [
  { key: "prontuarios", label: "Prontuários" },
  { key: "anamnese", label: "Novo Atendimento" },
  { key: "fotos", label: "Fotos clínicas" },
  { key: "orcamento", label: "Orçamento" },
  { key: "plano", label: "Plano de tratamento" },
  { key: "injetaveis", label: "Injetáveis" },
];

export default function ProntuarioPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Lê parâmetros da URL caso o atendimento tenha sido iniciado a partir da agenda ou paciente
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const paramPatientId = searchParams.get("patientId") || searchParams.get("id");
  const paramPatientName =
    searchParams.get("patientName") || searchParams.get("name") || searchParams.get("patient");
  const paramTab = searchParams.get("tab") as TabKey | null;

  const [tab, setTab] = useState<TabKey>(
    paramTab &&
      ["prontuarios", "anamnese", "fotos", "orcamento", "plano", "injetaveis"].includes(paramTab)
      ? paramTab
      : "prontuarios",
  );

  useEffect(() => {
    const pTab = searchParams.get("tab") as TabKey | null;
    if (
      pTab &&
      ["prontuarios", "anamnese", "fotos", "orcamento", "plano", "injetaveis"].includes(pTab)
    ) {
      setTab(pTab);
    }
  }, [searchParams]);

  const hasActivePatient = Boolean(paramPatientId || paramPatientName);

  // Busca dados reais do paciente no banco se fornecido
  const { data: dbPatient } = useQuery({
    queryKey: ["prontuario-db-patient", paramPatientId, paramPatientName],
    enabled: hasActivePatient,
    queryFn: async () => {
      if (paramPatientId) {
        try {
          const phpPat = await patientsService.getPatientById(paramPatientId);
          if (phpPat) return phpPat;
        } catch {}
        const { data } = await supabase
          .from("patients")
          .select("*")
          .eq("id", paramPatientId)
          .maybeSingle();
        if (data) return data;
      }
      if (paramPatientName) {
        const clean = paramPatientName.replace(/\(.*?\)/g, "").trim();
        try {
          const phpList = await patientsService.getPatients({ q: clean, limit: 1 });
          if (phpList && phpList[0]) return phpList[0];
        } catch {}
        const { data } = await supabase
          .from("patients")
          .select("*")
          .ilike("name", `%${clean}%`)
          .limit(1)
          .maybeSingle();
        if (data) return data;
      }
      return null;
    },
  });

  const patient = useMemo(() => {
    const rawName = dbPatient?.name || paramPatientName;
    if (!rawName) {
      return { id: undefined, initials: "--", name: "", age: "" };
    }
    const cleanName = rawName.replace(/\(.*?\)/g, "").trim();
    const initials = cleanName
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    return {
      id: dbPatient?.id || paramPatientId,
      initials: initials || "PA",
      name: cleanName,
      age: dbPatient?.birth_date
        ? `Nasc: ${new Date(dbPatient.birth_date).toLocaleDateString("pt-BR")}`
        : dbPatient?.insurance || "Em atendimento",
    };
  }, [dbPatient, paramPatientName, paramPatientId]);

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Ref de controle do editor Anamnese Geral (sempre inicia limpo para novos atendimentos)
  const queixaRef = useRef<RichEditorHandle>(null);

  // Busca o histórico completo de atendimentos clínicos e consultas desse paciente
  const { data: clinicalHistory = [], isLoading: loadingClinicalHistory } =
    usePatientClinicalHistory(patient.id, patient.name);

  const [historySearch, setHistorySearch] = useState("");
  const [historyFilterKind, setHistoryFilterKind] = useState<
    "todos" | "prontuario" | "consulta" | "evolucao"
  >("todos");
  const [showHistoryTimeline, setShowHistoryTimeline] = useState(true);
  const [recordToPrint, setRecordToPrint] = useState<ClinicalHistoryItem | null>(null);

  const filteredHistory = useMemo(() => {
    return clinicalHistory.filter((item) => {
      if (historyFilterKind !== "todos" && item.kind !== historyFilterKind) {
        return false;
      }
      if (!historySearch.trim()) return true;
      const q = historySearch.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.doctorName || "").toLowerCase().includes(q) ||
        (item.complaint || "").toLowerCase().includes(q) ||
        (item.clinicalHistory || "").toLowerCase().includes(q) ||
        (item.evolution || "").toLowerCase().includes(q) ||
        (item.conduct || "").toLowerCase().includes(q) ||
        (item.diagnosis || "").toLowerCase().includes(q) ||
        (item.diagnosisCode || "").toLowerCase().includes(q) ||
        (item.medications || "").toLowerCase().includes(q) ||
        (item.allergies || "").toLowerCase().includes(q) ||
        item.formattedDate.toLowerCase().includes(q)
      );
    });
  }, [clinicalHistory, historyFilterKind, historySearch]);

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

  // Estado do modal de Assistente IA
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiSection, setAiSection] = useState<AiSectionContext | null>(null);

  const openAiModal = (section: AiSectionContext) => {
    setAiSection(section);
    setAiModalOpen(true);
  };

  const handleAiInsert = (content: string | StructuredConsultationResult, sectionKey?: string) => {
    const text = typeof content === "string" ? content : formatConsultationRecord(content);
    const existing = queixaRef.current?.getText() ?? "";
    queixaRef.current?.setText(appendToRecord(existing, text));
    markDirty();
  };

  const markDirty = useCallback(() => {
    setSaveState("dirty");
  }, []);

  const copyPatient = async () => {
    const text = `${patient.name} — ${patient.age}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Dados do paciente copiados");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  // Estado do modal de confirmação de cancelamento
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const handleCancel = () => setCancelModalOpen(true);
  const [finalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent));
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!isFinalizing) setFinalizeConfirmOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFinalizing]);

  const secondsRef = useRef(0);

  const handleFinalize = async () => {
    const targetPatientId = patient?.id || dbPatient?.id || paramPatientId;
    const patientName = patient?.name || dbPatient?.name || paramPatientName || "Paciente";
    const anamneseText = queixaRef.current?.getText() || "";
    const elapsedSeconds = secondsRef.current;

    setIsFinalizing(true);
    setSaveState("saving");

    let persisted = false;
    let persistenceError: any = null;
    let savedRecord: any = null;

    // Persistência somente no banco (RLS exige records.edit); nada fica salvo no navegador.
    if (targetPatientId) {
      const { data: inserted, error: sbError } = await supabase
        .from("medical_records")
        .insert({
          patient_id: targetPatientId,
          complaint: anamneseText || null,
          duration_seconds: elapsedSeconds,
          finished_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (sbError) {
        persistenceError = sbError;
        console.error("Falha na gravação do prontuário:", sbError);
      } else {
        persisted = true;
        savedRecord = inserted;
      }
    } else {
      persistenceError = new Error("Paciente sem identificador cadastrado.");
    }

    if (!persisted) {
      setIsFinalizing(false);
      setSaveState("dirty");
      toast.error("Não foi possível salvar o prontuário no servidor", {
        description: persistenceError?.message || "Verifique sua conexão e tente novamente.",
      });
      return;
    }

    // 1. Atualização otimista imediata do histórico clínico do paciente no React Query
    if (savedRecord) {
      const now = new Date();
      const newHistoryItem: ClinicalHistoryItem = {
        id: savedRecord.id,
        kind: "prontuario",
        title: "Atendimento Clínico",
        date: savedRecord.created_at || savedRecord.finished_at || now.toISOString(),
        formattedDate: now.toLocaleDateString("pt-BR", {
          weekday: "short",
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
        time: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        durationSeconds: savedRecord.duration_seconds || elapsedSeconds || undefined,
        complaint: savedRecord.complaint || anamneseText || undefined,
        status: "Finalizado",
        raw: savedRecord,
      };

      queryClient.setQueriesData(
        { queryKey: ["patient-clinical-history"] },
        (old: any) => {
          if (!Array.isArray(old)) return [newHistoryItem];
          const exists = old.some((it: any) => it.id === savedRecord.id);
          return exists ? old : [newHistoryItem, ...old];
        },
      );
    }

    const durationFormatted = formatTime(elapsedSeconds);
    setSaveState("saved");
    setIsFinalizing(false);
    secondsRef.current = 0;
    queixaRef.current?.setText("");

    // Alterna imediatamente para a aba organizada de Prontuários com visão do histórico atualizado
    setTab("prontuarios");

    toast.success("Atendimento finalizado com sucesso!", {
      description: `Duração: ${durationFormatted}. Prontuário gravado para ${patientName}.`,
      action: {
        label: "Lista de pacientes",
        onClick: () => navigate({ to: "/pacientes" }),
      },
    });

    // Invalidação em paralelo em background sem travar a navegação nem a tela
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["patient-medical-records"] }),
      queryClient.invalidateQueries({ queryKey: ["patient-clinical-history"] }),
      queryClient.invalidateQueries({ queryKey: ["prontuario-hub-recent-patients"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  if (!hasActivePatient) {
    return (
      <ProntuarioHub
        onSelectPatient={(p) => {
          const targetTab = p.tab || "prontuarios";
          setTab(targetTab as TabKey);
          navigate({
            to: "/prontuario",
            search: {
              patientId: p.id || undefined,
              patientName: p.name || undefined,
            },
          });
        }}
      />
    );
  }

  return (
    <DirtyCtx.Provider value={markDirty}>
      <div className="min-h-[calc(100dvh-64px)] bg-surface text-foreground">
        <div className="page-container flex flex-col lg:flex-row items-stretch gap-5 pb-40 lg:pb-28">
          {/* Sidebar */}
          <aside className="w-full shrink-0 rounded-xl border border-border bg-card p-4 lg:w-[220px] lg:self-start">
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/prontuario",
                  search: { patientId: undefined, patientName: undefined },
                })
              }
              className="mb-3.5 flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-hover transition-colors cursor-pointer"
            >
              <ArrowLeft size={14} /> Voltar à central de hoje
            </button>

            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {patient.initials}
              </div>
              <div className="min-w-0 flex-1 rounded-xl border border-border bg-card p-4 md:p-5">
                <h1 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
                  {patient.name}
                </h1>
                <div className="text-sm leading-tight text-muted-foreground">{patient.age}</div>
              </div>
              <button
                onClick={copyPatient}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-ring cursor-pointer"
                aria-label="Copiar dados"
                title="Copiar dados do paciente"
              >
                <ClipboardList className="h-[18px] w-[18px]" />
              </button>
            </div>

            <nav className="flex max-w-full gap-2 overflow-x-auto border-t border-border pt-3 lg:flex-col">
              {TABS.map((t) => {
                const active = t.key === tab;
                const isAvailable =
                  t.key === "prontuarios" || t.key === "anamnese" || t.key === "fotos";
                return (
                  <button
                    key={t.key}
                    disabled={!isAvailable}
                    title={!isAvailable ? "Indisponível nesta tela" : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setTab(t.key)}
                    className={`group relative flex shrink-0 items-center justify-between whitespace-nowrap disabled:opacity-40 w-auto lg:w-full rounded-lg px-3 py-2 text-left text-sm transition-all duration-150 focus-ring cursor-pointer ${
                      active
                        ? "text-white font-semibold"
                        : "text-muted-foreground font-semibold hover:bg-primary/10 hover:text-primary"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="prontuario-tab-active"
                        className="absolute inset-0 rounded-full bg-primary shadow-sm"
                        transition={{ type: "spring", stiffness: 400, damping: 35 }}
                      />
                    )}
                    <span className="relative z-10">{t.label}</span>
                    {t.key === "prontuarios" && clinicalHistory.length > 0 && (
                      <span
                        className={`relative z-10 text-xs px-2 py-0.5 rounded-full font-bold ${
                          active ? "bg-white/20 text-white" : "bg-primary/15 text-primary"
                        }`}
                      >
                        {clinicalHistory.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Main content */}
          <main className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: DUR.base, ease: EASE_OUT }}
              >
                {tab === "prontuarios" && (
                  <motion.div
                    className="space-y-6"
                    variants={staggerContainer(0.07, 0.05)}
                    initial="hidden"
                    animate="show"
                  >
                    {/* 1. Header do Paciente & Resumo Clínico */}
                    <motion.div variants={fadeUp}>
                      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 text-primary">
                              <FileText size={18} className="shrink-0" />
                              <span className="text-xs font-semibold uppercase tracking-wider">
                                Prontuários do Paciente
                              </span>
                            </div>
                            <h2 className="mt-1 text-2xl font-semibold text-foreground">
                              Histórico Clínico Organizado
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Visualização cronológica de consultas, evoluções, diagnósticos e condutas de{" "}
                              <strong className="text-foreground">{patient.name}</strong>.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => setTab("anamnese")}
                            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover shadow-sm transition-all shrink-0 cursor-pointer"
                          >
                            <Stethoscope size={18} /> Iniciar Atendimento de Hoje
                          </button>
                        </div>

                        {/* Informações rápidas em pílulas */}
                        <div className="mt-5 pt-4 border-t border-border-soft flex flex-wrap items-center gap-2.5 text-xs">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border font-medium text-foreground">
                            <User size={13} className="text-primary" /> {patient.name}
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border font-medium text-foreground">
                            🏷️ {patient.age}
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-soft/60 border border-primary/20 font-semibold text-primary">
                            🩺 {clinicalHistory.length}{" "}
                            {clinicalHistory.length === 1
                              ? "registro clínico"
                              : "registros clínicos"}
                          </span>
                          {dbPatient?.cpf && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border font-medium text-muted-foreground">
                              CPF: {dbPatient.cpf}
                            </span>
                          )}
                          {dbPatient?.phone && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border font-medium text-muted-foreground">
                              Tel: {dbPatient.phone}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>

                    {/* 2. Barra de Busca e Filtros de Tipo */}
                    <motion.div variants={fadeUp}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Chips de Filtro */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                          <button
                            type="button"
                            onClick={() => setHistoryFilterKind("todos")}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              historyFilterKind === "todos"
                                ? "bg-primary text-white shadow-xs"
                                : "bg-card border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
                            }`}
                          >
                            Todos ({clinicalHistory.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setHistoryFilterKind("prontuario")}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              historyFilterKind === "prontuario"
                                ? "bg-primary text-white shadow-xs"
                                : "bg-card border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
                            }`}
                          >
                            🩺 Prontuários ({prontuariosCount})
                          </button>
                          <button
                            type="button"
                            onClick={() => setHistoryFilterKind("consulta")}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              historyFilterKind === "consulta"
                                ? "bg-primary text-white shadow-xs"
                                : "bg-card border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
                            }`}
                          >
                            📅 Consultas ({consultasCount})
                          </button>
                          <button
                            type="button"
                            onClick={() => setHistoryFilterKind("evolucao")}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              historyFilterKind === "evolucao"
                                ? "bg-primary text-white shadow-xs"
                                : "bg-card border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
                            }`}
                          >
                            📈 Evoluções ({evolucoesCount})
                          </button>
                        </div>

                        {/* Campo de Busca no Histórico */}
                        <div className="relative min-w-[260px]">
                          <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                          />
                          <input
                            type="text"
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                            placeholder="Buscar por queixa, CID, conduta, médico..."
                            className="w-full h-9 pl-9 pr-8 rounded-xl border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
                          />
                          {historySearch && (
                            <button
                              type="button"
                              onClick={() => setHistorySearch("")}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>

                    {/* 3. Lista de Registros Clínicos Organizados */}
                    <motion.div variants={fadeUp} className="space-y-4">
                      {loadingClinicalHistory ? (
                        <div className="p-12 text-center text-sm text-muted-foreground rounded-2xl border border-border bg-card">
                          Carregando prontuários do paciente…
                        </div>
                      ) : filteredHistory.length === 0 ? (
                        <div className="rounded-2xl border border-border bg-card p-12 text-center space-y-4">
                          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                            <FileText size={24} />
                          </div>
                          <div className="max-w-md mx-auto">
                            <h3 className="text-base font-semibold text-foreground">
                              {historySearch
                                ? `Nenhum registro corresponde à busca "${historySearch}"`
                                : "Nenhum prontuário registrado ainda"}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {historySearch
                                ? "Tente buscar por outro termo ou limpe os filtros."
                                : `Este é o momento ideal para iniciar a primeira consulta ou anamnese de ${patient.name}.`}
                            </p>
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => setTab("anamnese")}
                              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover shadow-sm transition-all cursor-pointer"
                            >
                              <Stethoscope size={16} /> Iniciar Primeiro Atendimento
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {filteredHistory.map((rec) => (
                            <div
                              key={rec.id}
                              className="p-5 rounded-2xl bg-card border border-border shadow-xs space-y-4 hover:border-primary/30 transition-all"
                            >
                              {/* Header do Card */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-soft">
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  {rec.kind === "prontuario" && (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary-soft text-primary border border-primary/20">
                                      <Stethoscope size={13} /> Prontuário Clínico
                                    </span>
                                  )}
                                  {rec.kind === "consulta" && (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-info/15 text-info border border-info/20">
                                      <Calendar size={13} /> {rec.type || "Consulta"}
                                    </span>
                                  )}
                                  {rec.kind === "evolucao" && (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-success/15 text-success border border-success/20">
                                      <Activity size={13} /> Evolução
                                    </span>
                                  )}

                                  <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                                    <Clock size={13} className="text-muted-foreground" />
                                    {rec.formattedDate} {rec.time ? `às ${rec.time}` : ""}
                                  </span>

                                  {rec.doctorName && (
                                    <span className="text-xs text-muted-foreground font-medium bg-surface border border-border px-2 py-0.5 rounded-md">
                                      {rec.doctorName}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  {rec.durationSeconds ? (
                                    <span className="text-xs text-muted-foreground font-medium bg-surface border border-border px-2 py-0.5 rounded-md">
                                      ⏱️ {Math.round(rec.durationSeconds / 60)} min
                                    </span>
                                  ) : null}

                                  {rec.status && (
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-surface border border-border text-muted-foreground">
                                      {rec.status}
                                    </span>
                                  )}

                                  {/* Ações do Card */}
                                  <div className="flex items-center gap-1.5 ml-auto">
                                    <button
                                      type="button"
                                      onClick={() => setRecordToPrint(rec)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-surface text-xs font-medium text-foreground transition-colors cursor-pointer"
                                      title="Imprimir prontuário formatado"
                                    >
                                      <Printer size={13} className="text-primary" /> Imprimir
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        const textToCopy = [
                                          `[Prontuário - ${rec.formattedDate} - ${rec.doctorName || patient.name}]`,
                                          rec.complaint ? `Queixa Principal: ${rec.complaint}` : "",
                                          rec.clinicalHistory
                                            ? `Histórico Clínico: ${rec.clinicalHistory}`
                                            : "",
                                          rec.evolution ? `Evolução: ${rec.evolution}` : "",
                                          rec.diagnosis
                                            ? `Diagnóstico: ${rec.diagnosis} ${rec.diagnosisCode ? `(${rec.diagnosisCode})` : ""}`
                                            : "",
                                          rec.conduct ? `Conduta: ${rec.conduct}` : "",
                                        ]
                                          .filter(Boolean)
                                          .join("\n\n");
                                        navigator.clipboard.writeText(textToCopy);
                                        toast.success(
                                          "Prontuário copiado para a área de transferência",
                                        );
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-surface text-xs font-medium text-foreground transition-colors cursor-pointer"
                                      title="Copiar texto do prontuário"
                                    >
                                      <Copy size={13} /> Copiar
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        const snippet = [
                                          `[Histórico importado de ${rec.formattedDate}]:`,
                                          rec.complaint ? `Queixa: ${rec.complaint}` : "",
                                          rec.evolution
                                            ? `Evolução anterior: ${rec.evolution}`
                                            : "",
                                          rec.diagnosis
                                            ? `Diagnóstico prévio: ${rec.diagnosis}`
                                            : "",
                                          rec.conduct ? `Conduta anterior: ${rec.conduct}` : "",
                                        ]
                                          .filter(Boolean)
                                          .join("\n");
                                        queixaRef.current?.insertText(`\n${snippet}\n\n`);
                                        setTab("anamnese");
                                        toast.success(
                                          "Histórico importado para o atendimento atual!",
                                        );
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-soft text-primary text-xs font-semibold hover:bg-primary-hover hover:text-white transition-colors cursor-pointer"
                                      title="Importar anotações para o atendimento de hoje"
                                    >
                                      Puxar p/ hoje
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Conteúdo Estruturado */}
                              <div className="space-y-3">
                                {/* Queixa Principal */}
                                {rec.complaint && (
                                  <div className="space-y-1">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                      <ClipboardList size={12} className="text-primary" /> Queixa
                                      Principal & Motivo
                                    </span>
                                    <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed bg-surface/70 p-3 rounded-xl border border-border/70">
                                      {rec.complaint}
                                    </div>
                                  </div>
                                )}

                                {/* Histórico / Anamnese / Evolução */}
                                {(rec.clinicalHistory || rec.evolution) && (
                                  <div className="space-y-1">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                      <FileText size={12} className="text-primary" /> Histórico &
                                      Evolução Clínica
                                    </span>
                                    <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed bg-surface/50 p-3 rounded-xl border border-border/70">
                                      {rec.clinicalHistory || rec.evolution}
                                    </div>
                                  </div>
                                )}

                                {/* Diagnóstico & CID */}
                                {(rec.diagnosis || rec.diagnosisCode) && (
                                  <div className="inline-flex items-center gap-2 p-2.5 rounded-xl bg-info/10 border border-info/20 text-xs">
                                    <strong className="text-info font-semibold">
                                      Diagnóstico:
                                    </strong>
                                    <span className="text-foreground font-medium">
                                      {rec.diagnosis}{" "}
                                      {rec.diagnosisCode ? `(${rec.diagnosisCode})` : ""}
                                    </span>
                                  </div>
                                )}

                                {/* Conduta & Prescrição */}
                                {rec.conduct && (
                                  <div className="space-y-1">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1">
                                      <Stethoscope size={12} /> Conduta & Prescrições
                                    </span>
                                    <div className="text-xs text-foreground bg-primary-soft/40 p-3 rounded-xl border border-primary/20 whitespace-pre-wrap leading-relaxed">
                                      {rec.conduct}
                                    </div>
                                  </div>
                                )}

                                {/* Retorno ou Alergias registradas */}
                                {(rec.returnDate || rec.allergies || rec.medications) && (
                                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                                    {rec.allergies && (
                                      <span className="px-2 py-0.5 rounded-md bg-destructive/10 text-destructive border border-destructive/20">
                                        Alergias: {rec.allergies}
                                      </span>
                                    )}
                                    {rec.medications && (
                                      <span className="px-2 py-0.5 rounded-md bg-warning/10 text-warning border border-warning/20">
                                        Medicações: {rec.medications}
                                      </span>
                                    )}
                                    {rec.returnDate && (
                                      <span className="px-2 py-0.5 rounded-md bg-muted border border-border">
                                        Retorno:{" "}
                                        {new Date(rec.returnDate).toLocaleDateString("pt-BR")}
                                        {rec.returnNotes ? ` (${rec.returnNotes})` : ""}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  </motion.div>
                )}

                {tab === "anamnese" && (
                  <motion.div
                    className="space-y-6"
                    variants={staggerContainer(0.07, 0.05)}
                    initial="hidden"
                    animate="show"
                  >
                    {/* Banner de Atendimento Ativo */}
                    <motion.div variants={fadeUp}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-card border border-border shadow-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                              Atendimento Ativo de Hoje
                            </span>
                          </div>
                          <h2 className="text-lg font-semibold text-foreground mt-0.5">
                            Anamnese & Registro Clínico
                          </h2>
                          <p className="text-xs text-muted-foreground">
                            Paciente: <strong className="text-foreground">{patient.name}</strong> •{" "}
                            {patient.age}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setTab("prontuarios")}
                            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-border bg-surface hover:bg-muted text-xs font-semibold text-foreground transition-colors cursor-pointer"
                          >
                            <FileText size={14} className="text-primary" />
                            Ver Prontuários Anteriores ({clinicalHistory.length})
                          </button>
                        </div>
                      </div>
                    </motion.div>

                    {/* 1. Editor do Atendimento Atual */}
                    <motion.div variants={fadeUp}>
                      <Section
                        title="Anamnese & Atendimento Atual"
                        onAiFill={() =>
                          openAiModal({
                            key: "anamnese_geral",
                            title: "Anamnese Geral",
                            placeholder: "Descreva a anamnese geral do paciente...",
                          })
                        }
                      >
                        <RichEditor
                          ref={queixaRef}
                          placeholder="Descreva a anamnese geral do paciente (queixa principal, histórico de saúde, exame clínico, hipóteses e conduta médica)..."
                          minHeight={340}
                        />
                      </Section>
                    </motion.div>

                    {/* 2. Histórico Completo de Atendimentos Anteriores do Paciente */}
                    <motion.div variants={fadeUp}>
                      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border-soft">
                          <div className="flex items-center gap-2">
                            <History className="h-5 w-5 text-primary" />
                            <div>
                              <h3 className="text-[15px] font-semibold text-foreground">
                                Histórico de Atendimentos do Paciente ({clinicalHistory.length})
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                Todos os prontuários, consultas e evoluções anteriores de{" "}
                                <strong className="text-foreground/80">{patient.name}</strong>.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setShowHistoryTimeline(!showHistoryTimeline)}
                              className="text-xs font-semibold text-primary hover:text-primary-hover hover:underline cursor-pointer"
                            >
                              {showHistoryTimeline ? "Ocultar histórico" : "Exibir histórico"}
                            </button>
                          </div>
                        </div>

                        {showHistoryTimeline && (
                          <div className="space-y-3.5">
                            {/* Busca rápida dentro do histórico */}
                            {clinicalHistory.length > 1 && (
                              <div className="relative">
                                <Search
                                  size={14}
                                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                                />
                                <input
                                  type="text"
                                  value={historySearch}
                                  onChange={(e) => setHistorySearch(e.target.value)}
                                  placeholder="Filtrar por queixa, conduta, médico ou diagnóstico..."
                                  className="w-full h-8.5 pl-8.5 pr-3 rounded-lg border border-border bg-muted/30 text-sm placeholder:text-muted-foreground focus:bg-card focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                                />
                              </div>
                            )}

                            {filteredHistory.length > 0 ? (
                              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                                {filteredHistory.map((rec) => (
                                  <div
                                    key={rec.id}
                                    className="p-4 rounded-xl bg-muted/36 border border-border/90 shadow-2xs space-y-2.5 transition-all hover:border-primary/25 hover:bg-muted/60"
                                  >
                                    <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border/70">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {rec.kind === "prontuario" && (
                                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-primary-soft text-primary">
                                            🩺 Prontuário
                                          </span>
                                        )}
                                        {rec.kind === "consulta" && (
                                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-info/15 text-info">
                                            📅 {rec.type || "Consulta"}
                                          </span>
                                        )}
                                        {rec.kind === "evolucao" && (
                                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-success/15 text-success">
                                            📈 Evolução
                                          </span>
                                        )}

                                        <span className="font-semibold text-foreground text-sm">
                                          {rec.formattedDate} {rec.time ? `às ${rec.time}` : ""}
                                        </span>

                                        {rec.doctorName && (
                                          <span className="text-xs text-muted-foreground font-medium">
                                            • {rec.doctorName}
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2">
                                        {rec.status && (
                                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-card border border-border text-muted-foreground">
                                            {rec.status}
                                          </span>
                                        )}

                                        {rec.durationSeconds ? (
                                          <span className="text-xs text-muted-foreground font-medium bg-card border border-border px-2 py-0.5 rounded-md">
                                            ⏱️ {Math.round(rec.durationSeconds / 60)} min
                                          </span>
                                        ) : null}

                                        {rec.complaint && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              queixaRef.current?.insertText(
                                                `\n[Histórico de ${rec.formattedDate}]:\n${rec.complaint}\n`,
                                              );
                                              toast.success(
                                                "Texto importado para o atendimento atual!",
                                              );
                                            }}
                                            className="text-xs font-semibold text-primary hover:text-primary-hover hover:underline cursor-pointer"
                                            title="Inserir este texto nas anotações do atendimento atual"
                                          >
                                            Inserir no editor
                                          </button>
                                        )}

                                        {rec.complaint && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              navigator.clipboard.writeText(rec.complaint || "");
                                              toast.success(
                                                "Texto copiado para a área de transferência",
                                              );
                                            }}
                                            className="text-muted-foreground hover:text-muted-foreground p-1 rounded hover:bg-surface-2/60 cursor-pointer"
                                            title="Copiar texto"
                                          >
                                            <Copy size={13} />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {rec.complaint ? (
                                      <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed bg-card p-3 rounded-lg border border-border/80">
                                        {rec.complaint}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-muted-foreground italic">
                                        Consulta registrada sem texto de anotações.
                                      </p>
                                    )}

                                    {rec.conduct && (
                                      <div className="text-xs text-primary-hover bg-primary-soft/70 p-2.5 rounded-lg border border-primary/15">
                                        <strong>Conduta:</strong> {rec.conduct}
                                      </div>
                                    )}

                                    {rec.diagnosis && (
                                      <div className="text-xs text-muted-foreground">
                                        <strong>Diagnóstico:</strong> {rec.diagnosis}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="py-6 text-center space-y-1">
                                <FileText className="h-7 w-7 text-muted-foreground/60 mx-auto" />
                                <p className="text-sm font-medium text-muted-foreground">
                                  {historySearch
                                    ? `Nenhum atendimento corresponde a "${historySearch}".`
                                    : `Nenhum atendimento anterior registrado para ${patient.name}.`}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </motion.div>
                )}

                {tab === "orcamento" && (
                  <EmptyTab
                    title="Orçamento"
                    description="Visualize e gerencie os orçamentos e propostas do paciente."
                  />
                )}
                {tab === "plano" && (
                  <EmptyTab
                    title="Plano de tratamento"
                    description="Defina objetivos, condutas e etapas do tratamento."
                  />
                )}
                {tab === "fotos" && (
                  <ClinicalPhotos
                    key={dbPatient?.id || paramPatientId || "no-patient"}
                    patientId={dbPatient?.id || paramPatientId || undefined}
                  />
                )}
                {tab === "injetaveis" && (
                  <EmptyTab
                    title="Injetáveis"
                    description="Registro e controle de procedimentos injetáveis, toxina botulínica e preenchedores."
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {/* Modal do Assistente de Prontuário IA */}
        <AiRecordAssistantModal
          isOpen={aiModalOpen}
          onClose={() => setAiModalOpen(false)}
          section={aiSection}
          patientName={patient.name}
          existingRecord={aiModalOpen ? queixaRef.current?.getText() : undefined}
          onInsert={handleAiInsert}
        />

        {/* Modal de Confirmação de Cancelamento do Prontuário */}
        <AlertDialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
          <AlertDialogContent>
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                aria-hidden="true"
              >
                <AlertTriangle className="h-6 w-6" />
              </div>
              <AlertDialogHeader className="flex-1 space-y-1.5">
                <AlertDialogTitle className="tracking-tight">
                  Cancelar atendimento?
                </AlertDialogTitle>
                <AlertDialogDescription className="leading-relaxed">
                  Tem certeza de que deseja descartar este atendimento? Todas as anotações clínicas
                  e alterações não salvas serão perdidas.
                </AlertDialogDescription>
              </AlertDialogHeader>
            </div>
            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel>Continuar atendimento</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={() => {
                  toast.info("Atendimento cancelado");
                  navigate({ to: "/pacientes" });
                }}
              >
                Sim, descartar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Confirmação do atalho ⌘S / Ctrl S: finalizar grava e encerra o atendimento. */}
        <AlertDialog open={finalizeConfirmOpen} onOpenChange={setFinalizeConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Finalizar atendimento agora?</AlertDialogTitle>
              <AlertDialogDescription>
                As anotações serão gravadas no prontuário e o atendimento será encerrado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar editando</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleFinalize()}>
                Finalizar atendimento
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {tab === "anamnese" && (
          <footer className="app-fixed-footer pointer-events-none fixed bottom-0 right-0 z-30 px-3 pb-3 md:px-6 md:pb-4">
            <div className="pointer-events-auto mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline bg-glass px-4 py-2.5 shadow-(--glass-shadow-lg) glass-blur">
              <div className="flex items-center gap-4">
                <ConsultationTimer
                  onTick={(seconds) => {
                    secondsRef.current = seconds;
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {saveState === "saving"
                    ? "Gravando no servidor…"
                    : "As anotações são gravadas ao finalizar."}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isFinalizing}
                  className="h-10 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={isFinalizing}
                  aria-keyshortcuts="Control+S Meta+S"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary-hover disabled:opacity-50"
                >
                  {isFinalizing ? "Gravando…" : "Finalizar atendimento"}
                  {!isFinalizing && (
                    <kbd className="hidden rounded-md bg-primary-foreground/20 px-1.5 py-0.5 font-sans text-xs font-medium sm:inline">
                      {isMac ? "⌘S" : "Ctrl S"}
                    </kbd>
                  )}
                </button>
              </div>
            </div>
          </footer>
        )}

        {/* Modal de Impressão e Visualização Completa do Prontuário */}
        <Dialog
          open={Boolean(recordToPrint)}
          onOpenChange={(open) => !open && setRecordToPrint(null)}
        >
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="border-b border-border pb-3">
              <DialogTitle className="flex items-center gap-2 text-foreground text-lg">
                <FileText className="text-primary h-5 w-5" />
                <span>Prontuário Médico Oficial • MedCore</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Documento clínico de atendimento de {patient.name}.
              </DialogDescription>
            </DialogHeader>

            {recordToPrint && (
              <div className="space-y-5 py-3" id="printable-record">
                {/* Identificação do Paciente e Consulta */}
                <div className="p-4 rounded-xl bg-surface border border-border space-y-2.5">
                  <div className="flex justify-between items-center text-xs text-muted-foreground border-b border-border-soft pb-2">
                    <span>
                      <strong>Data da Consulta:</strong> {recordToPrint.formattedDate}{" "}
                      {recordToPrint.time ? `às ${recordToPrint.time}` : ""}
                    </span>
                    <span className="font-semibold text-primary">
                      {recordToPrint.status || "Atendimento Realizado"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-foreground">
                    <div>
                      <strong className="text-muted-foreground">Paciente:</strong> {patient.name}
                    </div>
                    <div>
                      <strong className="text-muted-foreground">Idade/Nascimento:</strong>{" "}
                      {patient.age}
                    </div>
                    <div>
                      <strong className="text-muted-foreground">Médico Responsável:</strong>{" "}
                      {recordToPrint.doctorName || "Corpo Clínico MedCore"}
                    </div>
                    <div>
                      <strong className="text-muted-foreground">Duração:</strong>{" "}
                      {recordToPrint.durationSeconds
                        ? `${Math.round(recordToPrint.durationSeconds / 60)} min`
                        : "Não computada"}
                    </div>
                  </div>
                </div>

                {/* Queixa Principal */}
                {recordToPrint.complaint && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <ClipboardList size={13} className="text-primary" /> Queixa Principal & Motivo
                    </h4>
                    <div className="p-3.5 rounded-xl border border-border bg-card text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {recordToPrint.complaint}
                    </div>
                  </div>
                )}

                {/* Histórico / Anamnese / Evolução */}
                {(recordToPrint.clinicalHistory || recordToPrint.evolution) && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileText size={13} className="text-primary" /> Anamnese & Evolução Clínica
                    </h4>
                    <div className="p-3.5 rounded-xl border border-border bg-card text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {recordToPrint.clinicalHistory || recordToPrint.evolution}
                    </div>
                  </div>
                )}

                {/* Diagnóstico & CID */}
                {(recordToPrint.diagnosis || recordToPrint.diagnosisCode) && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Stethoscope size={13} className="text-primary" /> Hipótese Diagnóstica / CID-10
                    </h4>
                    <div className="p-3.5 rounded-xl border border-info/20 bg-info/10 text-sm text-foreground">
                      <strong>Diagnóstico:</strong> {recordToPrint.diagnosis}{" "}
                      {recordToPrint.diagnosisCode ? `(CID-10: ${recordToPrint.diagnosisCode})` : ""}
                    </div>
                  </div>
                )}

                {/* Conduta & Prescrições */}
                {recordToPrint.conduct && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                      <Check size={13} /> Conduta Clínica, Prescrições & Recomendações
                    </h4>
                    <div className="p-3.5 rounded-xl border border-primary/20 bg-primary-soft/40 text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                      {recordToPrint.conduct}
                    </div>
                  </div>
                )}

                {/* Retorno Previsto */}
                {recordToPrint.returnDate && (
                  <div className="p-3 rounded-xl border border-border bg-surface text-xs text-muted-foreground">
                    <strong>Previsão de Retorno:</strong>{" "}
                    {new Date(recordToPrint.returnDate).toLocaleDateString("pt-BR")}{" "}
                    {recordToPrint.returnNotes ? `— ${recordToPrint.returnNotes}` : ""}
                  </div>
                )}

                {/* Espaço para Assinatura e Carimbo Médico */}
                <div className="pt-8 text-center space-y-1 text-xs text-muted-foreground border-t border-border mt-6">
                  <div className="w-64 mx-auto border-t border-foreground/30 pt-1 font-medium text-foreground">
                    {recordToPrint.doctorName || "Assinatura do Médico"}
                  </div>
                  <div>CRM / Registro Profissional</div>
                </div>

                {/* Botões do Rodapé do Modal */}
                <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setRecordToPrint(null)}
                    className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-surface cursor-pointer"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover shadow-sm cursor-pointer"
                  >
                    <Printer size={14} /> Imprimir Prontuário
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DirtyCtx.Provider>
  );
}

/* --------------------------- Subcomponents --------------------------- */

function SaveIndicator({ state }: { state: SaveState }) {
  const cfg =
    state === "saved"
      ? {
          label: "Salvo no banco",
          icon: Check,
          cls: "text-success bg-success/10 border-success/15",
        }
      : state === "saving"
        ? {
            label: "Gravando…",
            icon: CloudUpload,
            cls: "text-primary bg-primary/10 border-primary/20",
          }
        : {
            label: "Em edição (não gravado)",
            icon: CircleDot,
            cls: "text-warning bg-warning/10 border-warning/15",
          };
  const Icon = cfg.icon;
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: EASE_OUT }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cfg.cls}`}
      >
        <Icon className={`h-3 w-3 ${state === "saving" ? "animate-pulse" : ""}`} />
        {cfg.label}
      </motion.span>
    </AnimatePresence>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
  onAiFill,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onAiFill?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <div className="flex w-full items-center justify-between px-0 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center text-left transition-colors focus-ring"
          aria-expanded={open}
        >
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        </button>

        <div className="flex items-center gap-3">
          {onAiFill && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAiFill();
              }}
              className="group relative inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] text-sm font-semibold text-white shadow-sm hover:brightness-105 active:scale-[0.98] transition-all duration-200"
              style={{
                background: "var(--primary)",
              }}
              title={`Preencher ${title} com IA`}
            >
              <Sparkles className="h-4 w-4 shrink-0 transition-transform group-hover:rotate-12 duration-200" />
              <span className="hidden sm:inline">Preencher com IA</span>
              <span className="sm:hidden">IA</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground focus-ring"
            aria-label={open ? "Recolher seção" : "Expandir seção"}
          >
            <motion.span
              animate={{ rotate: open ? 0 : -90 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="inline-block"
            >
              <ChevronDown className="h-4 w-4" />
            </motion.span>
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="pb-1 pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function EmptyTab({ title, description }: { title: string; description: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: DUR.base, ease: EASE_OUT }}
      className="border-[1.5px] border-dashed border-input bg-card p-16 text-center"
    >
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </motion.div>
  );
}

function MemedTab() {
  const [configOpen, setConfigOpen] = useState(false);
  const [active, setActive] = useState(false);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center justify-center rounded-[8px] border-[1.5px] border-input bg-card p-12 text-center shadow-sm">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FileDigit className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Prescrição Digital Memed
        </h2>
        <p className="mt-2 max-w-md text-[15px] text-muted-foreground">
          Emita receitas digitais utilizando a plataforma Memed, com assinatura eletrônica do médico
          e envio ao paciente.
        </p>

        {!active && (
          <div className="mt-6 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm font-medium text-warning">
            <AlertCircle className="h-4 w-4" />A integração com a Memed ainda não foi configurada.
          </div>
        )}

        {active && (
          <div className="mt-6 flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm font-medium text-success">
            <Check className="h-4 w-4" />✅ Integração ativa.
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button
            className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary-hover focus-ring"
            onClick={() =>
              toast.info("Fluxo Memed", { description: "Ponto de integração preparado." })
            }
          >
            <PlusCircle className="h-5 w-5" />
            Emitir Receita via Memed
          </button>
          <button
            onClick={() => setConfigOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-input bg-card px-6 py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted focus-ring"
          >
            <Settings className="h-5 w-5" />
            Configurar Integração
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Receitas emitidas</h3>
        <div className="rounded-[8px] border border-border bg-card overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-3 font-semibold text-foreground">Data</th>
                <th className="px-4 py-3 font-semibold text-foreground">Paciente</th>
                <th className="px-4 py-3 font-semibold text-foreground">Médico</th>
                <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                <th className="px-4 py-3 font-semibold text-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center">
                    <FileText className="mb-2 h-8 w-8 opacity-20" />
                    Nenhuma prescrição Memed foi emitida para este paciente.
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border-soft px-6 py-4">
            <DialogTitle>Configurações Memed</DialogTitle>
            <DialogDescription className="sr-only">
              Credenciais e ambiente da integração de prescrição digital.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto p-6 space-y-6">
            <div className="space-y-4 pt-2">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Credenciais
              </h4>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">API Key</label>
                  <input
                    type="text"
                    placeholder="Insira sua API Key"
                    className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">Secret Key</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">
                    Ambiente de Execução
                  </label>
                  <select className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-primary bg-card transition-all">
                    <option>Produção (integrations)</option>
                    <option>Sandbox (homologação)</option>
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-3 py-2 px-1 hover:bg-muted/30 rounded-lg transition-colors">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="h-4.5 w-4.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                  />
                  <span className="text-sm font-medium text-foreground">
                    Ativar Módulo de Prescrição Digital
                  </span>
                </label>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 bg-muted/30 px-6 py-4">
            <button
              onClick={() => setConfigOpen(false)}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                toast.success("Configurações salvas");
                setConfigOpen(false);
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary-hover"
            >
              Salvar Configuração
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------- Rich Text Editor ------------------------- */

type ToolButton = {
  icon: typeof Bold;
  cmd: string;
  arg?: string;
  label: string;
};

const GROUP_1: ToolButton[] = [
  { icon: Bold, cmd: "bold", label: "Negrito" },
  { icon: Italic, cmd: "italic", label: "Itálico" },
  { icon: Underline, cmd: "underline", label: "Sublinhado" },
  { icon: Strikethrough, cmd: "strikeThrough", label: "Tachado" },
];

const GROUP_ALIGN: ToolButton[] = [
  { icon: AlignLeft, cmd: "justifyLeft", label: "Alinhar à esquerda" },
  { icon: AlignCenter, cmd: "justifyCenter", label: "Centralizar" },
  { icon: AlignRight, cmd: "justifyRight", label: "Alinhar à direita" },
  { icon: AlignJustify, cmd: "justifyFull", label: "Justificar" },
];

const GROUP_LIST: ToolButton[] = [
  { icon: List, cmd: "insertUnorderedList", label: "Lista" },
  { icon: ListOrdered, cmd: "insertOrderedList", label: "Lista numerada" },
];

const RichEditor = forwardRef<
  RichEditorHandle,
  {
    placeholder?: string;
    minHeight?: number;
  }
>(function RichEditor({ placeholder, minHeight = 180 }, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(true);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const onDirty = useContext(DirtyCtx);

  useImperativeHandle(forwardedRef, () => ({
    insertText: (text: string) => {
      const el = ref.current;
      if (!el) return;
      const htmlFormatted = text.replace(/\n/g, "<br>");
      if (!el.innerHTML || el.innerHTML === "<br>" || el.textContent?.trim() === "") {
        el.innerHTML = htmlFormatted;
      } else {
        el.innerHTML = el.innerHTML + "<br><br>" + htmlFormatted;
      }
      setEmpty(false);
      onDirty();
    },
    setText: (text: string) => {
      const el = ref.current;
      if (!el) return;
      el.innerHTML = text.replace(/\n/g, "<br>");
      setEmpty(false);
      onDirty();
    },
    getText: () => ref.current?.innerText || "",
  }));

  const saveSelection = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  }, []);

  const refreshActive = useCallback(() => {
    const states: Record<string, boolean> = {};
    for (const cmd of [
      "bold",
      "italic",
      "underline",
      "strikeThrough",
      "justifyLeft",
      "justifyCenter",
      "justifyRight",
      "justifyFull",
      "insertUnorderedList",
      "insertOrderedList",
    ]) {
      try {
        states[cmd] = document.queryCommandState(cmd);
      } catch {
        states[cmd] = false;
      }
    }
    setActive(states);
  }, []);

  useEffect(() => {
    const handler = () => {
      const el = ref.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return;
      if (el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        saveSelection();
        refreshActive();
      }
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [saveSelection, refreshActive]);

  const restoreSelection = () => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return;
    const inside = sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (inside) return;
    sel.removeAllRanges();
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      sel.addRange(savedRange.current);
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.addRange(range);
    }
  };

  const updateEmpty = () => {
    const el = ref.current;
    if (!el) return;
    setEmpty(
      el.textContent?.trim().length === 0 && el.innerHTML.replace(/<br\s*\/?>/g, "").trim() === "",
    );
    onDirty();
  };

  const exec = (cmd: string, arg?: string) => {
    restoreSelection();
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      /* noop */
    }
    document.execCommand(cmd, false, arg);
    saveSelection();
    refreshActive();
    updateEmpty();
  };

  const colorInput = useRef<HTMLInputElement>(null);
  const hiliteInput = useRef<HTMLInputElement>(null);

  return (
    <div
      className="w-full overflow-hidden rounded-[8px] border border-border bg-card"
      style={{ minHeight: 285 }}
    >
      <div className="flex min-h-12 flex-wrap items-center gap-[6px] overflow-x-auto whitespace-nowrap border-b border-border bg-muted/40 px-3 py-2">
        {GROUP_1.map((b) => (
          <ToolBtn key={b.cmd} btn={b} active={active[b.cmd]} onClick={() => exec(b.cmd)} />
        ))}
        <Divider />
        <ToolBtn
          btn={{ icon: Type, cmd: "color", label: "Cor do texto" }}
          onClick={() => colorInput.current?.click()}
        />
        <input
          ref={colorInput}
          type="color"
          defaultValue="#8b47ff"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          onChange={(e) => exec("foreColor", e.target.value)}
        />
        <ToolBtn
          btn={{ icon: Highlighter, cmd: "hilite", label: "Destaque" }}
          onClick={() => hiliteInput.current?.click()}
        />
        <input
          ref={hiliteInput}
          type="color"
          defaultValue="#fff59d"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          onChange={(e) => exec("hiliteColor", e.target.value)}
        />
        <Divider />
        {GROUP_ALIGN.map((b) => (
          <ToolBtn key={b.cmd} btn={b} active={active[b.cmd]} onClick={() => exec(b.cmd)} />
        ))}
        <Divider />
        {GROUP_LIST.map((b) => (
          <ToolBtn key={b.cmd} btn={b} active={active[b.cmd]} onClick={() => exec(b.cmd)} />
        ))}
        <ToolBtn
          btn={{ icon: RemoveFormatting, cmd: "removeFormat", label: "Limpar formatação" }}
          onClick={() => exec("removeFormat")}
        />
        <Divider />
        <ToolBtn
          btn={{ icon: Undo2, cmd: "undo", label: "Desfazer" }}
          onClick={() => exec("undo")}
        />
        <ToolBtn
          btn={{ icon: Redo2, cmd: "redo", label: "Refazer" }}
          onClick={() => exec("redo")}
        />
      </div>

      <div className="relative">
        {empty && (
          <div
            className="pointer-events-none absolute left-[20px] top-[18px] text-[15px] font-normal leading-6 text-muted-foreground"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Anotações do atendimento"
          suppressContentEditableWarning
          onInput={updateEmpty}
          onKeyUp={() => {
            saveSelection();
            refreshActive();
          }}
          onMouseUp={() => {
            saveSelection();
            refreshActive();
          }}
          onBlur={saveSelection}
          className="prose-clinical px-5 py-[18px] text-foreground outline-none ring-0 focus:outline-none focus-visible:outline-none focus:ring-0 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          style={{ minHeight: Math.max(minHeight, 220) }}
        />
      </div>
    </div>
  );
});

function ToolBtn({
  btn,
  onClick,
  active,
}: {
  btn: ToolButton;
  onClick: () => void;
  active?: boolean;
}) {
  const Icon = btn.icon;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={btn.label}
      aria-label={btn.label}
      aria-pressed={active}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] transition-colors focus-ring ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
    </button>
  );
}

function Divider() {
  return <span className="mx-[2px] h-[26px] w-px shrink-0 bg-surface-2" />;
}

function formatTime(total: number) {
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

const ConsultationTimer = memo(function ConsultationTimer({
  onTick,
}: {
  onTick?: (sec: number) => void;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        onTick?.(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [onTick]);

  return (
    <div className="flex items-center gap-2 text-primary font-medium">
      <Timer className="h-5 w-5" />
      <span className="font-mono text-[15px] font-semibold tabular-nums text-foreground">
        {formatTime(seconds)}
      </span>
    </div>
  );
});

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
import InjectablesTab from "./InjectablesTab";
import QuotesTab from "./QuotesTab";
import { PatientPackagesTab } from "@/components/pacientes/PatientPackagesTab";

export interface RichEditorHandle {
  insertText: (text: string) => void;
  setText: (text: string) => void;
  getText: () => string;
}

type SaveState = "saved" | "saving" | "dirty";
const DirtyCtx = createContext<() => void>(() => {});

type TabKey = "prontuarios" | "anamnese" | "orcamento" | "plano" | "fotos" | "injetaveis";

const TABS: { key: TabKey; label: string }[] = [
  { key: "anamnese", label: "Atendimento" },
  { key: "prontuarios", label: "Histórico" },
  { key: "plano", label: "Plano de tratamento" },
  { key: "orcamento", label: "Orçamento" },
  { key: "injetaveis", label: "Injetáveis" },
  { key: "fotos", label: "Fotos" },
];

/** Extrai um bloco "RÓTULO:\n..." do texto do prontuário (formato gerado pelo assistente). */
function extractRecordSection(text: string | undefined, label: string): string {
  if (!text) return "";
  const match = text.match(new RegExp(`${label}[^:\\n]*:\\s*\\n?([\\s\\S]*?)(?:\\n\\s*\\n|$)`, "i"));
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function ageFrom(birthDate?: string | null): string {
  if (!birthDate) return "";
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age--;
  return age >= 0 ? `${age} anos` : "";
}

function groupByMonth(items: ClinicalHistoryItem[]): [string, ClinicalHistoryItem[]][] {
  const groups = new Map<string, ClinicalHistoryItem[]>();
  for (const item of items) {
    const d = new Date(item.date);
    const key = Number.isNaN(d.getTime())
      ? "Sem data"
      : d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

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

  const attendanceStarted = saveState !== "saved";

  const patientFacts = [
    ageFrom(dbPatient?.birth_date),
    dbPatient?.insurance,
    dbPatient?.phone,
  ].filter(Boolean) as string[];

  const lastRecord = useMemo(
    () => clinicalHistory.find((i) => i.kind === "prontuario" && Boolean(i.complaint)),
    [clinicalHistory],
  );

  // Alergias e medicações mais recentes registradas, para ficarem visíveis durante todo o atendimento
  const clinicalAlerts = useMemo(() => {
    let allergies = "";
    let medications = "";
    for (const rec of clinicalHistory) {
      if (!allergies) allergies = rec.allergies || extractRecordSection(rec.complaint, "ALERGIAS");
      if (!medications)
        medications = rec.medications || extractRecordSection(rec.complaint, "MEDICAÇÕES EM USO");
      if (allergies && medications) break;
    }
    return { allergies, medications };
  }, [clinicalHistory]);

  const pullIntoAttendance = (rec: ClinicalHistoryItem) => {
    const snippet = [
      `[Do atendimento de ${rec.formattedDate}]`,
      rec.complaint,
      rec.diagnosis ? `Diagnóstico: ${rec.diagnosis}${rec.diagnosisCode ? ` (${rec.diagnosisCode})` : ""}` : "",
      rec.conduct ? `Conduta: ${rec.conduct}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    queixaRef.current?.insertText(snippet);
    setTab("anamnese");
    toast.success("Trazido para o atendimento de hoje.");
  };

  // Avisa antes de fechar/recarregar com anotações não gravadas
  useEffect(() => {
    if (saveState !== "dirty") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

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
        <div className="page-container space-y-5 pb-40 lg:pb-28">
          {/* Cabeçalho fixo do paciente: identificação + alertas clínicos sempre visíveis */}
          <header className="sticky top-0 z-20 -mx-1 rounded-2xl border border-border bg-card/95 px-4 py-3.5 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/prontuario",
                    search: { patientId: undefined, patientName: undefined },
                  })
                }
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Voltar à central de prontuários"
                title="Voltar à central de prontuários"
              >
                <ArrowLeft size={18} />
              </button>

              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                  {patient.initials}
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold leading-tight tracking-tight text-foreground">
                    {patient.name}
                  </h1>
                  <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                    {patientFacts.map((fact, i) => (
                      <span key={fact} className="flex items-center gap-2">
                        {i > 0 && <span aria-hidden="true">·</span>}
                        {fact}
                      </span>
                    ))}
                    <button
                      onClick={copyPatient}
                      className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="Copiar dados do paciente"
                      title="Copiar dados do paciente"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {tab !== "anamnese" && (
                <button
                  type="button"
                  onClick={() => setTab("anamnese")}
                  className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
                >
                  <Stethoscope size={16} />
                  {attendanceStarted ? "Voltar ao atendimento" : "Iniciar atendimento"}
                </button>
              )}
            </div>

            {(clinicalAlerts.allergies || clinicalAlerts.medications) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border-soft pt-3 text-xs">
                {clinicalAlerts.allergies && (
                  <span className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-destructive/25 bg-destructive/8 px-2.5 py-1 text-foreground">
                    <AlertTriangle size={13} className="mt-px shrink-0 text-destructive" />
                    <span className="line-clamp-2">
                      <strong className="text-destructive">Alergias:</strong> {clinicalAlerts.allergies}
                    </span>
                  </span>
                )}
                {clinicalAlerts.medications && (
                  <span className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-foreground">
                    <ClipboardList size={13} className="mt-px shrink-0 text-primary" />
                    <span className="line-clamp-2">
                      <strong>Em uso:</strong> {clinicalAlerts.medications}
                    </span>
                  </span>
                )}
              </div>
            )}

            <nav className="mt-3 flex gap-1 overflow-x-auto" aria-label="Seções do prontuário">
              {TABS.map((t) => {
                const active = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setTab(t.key)}
                    className={`relative flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                      active ? "text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="prontuario-tab-active"
                        className="absolute inset-0 rounded-full bg-primary"
                        transition={{ type: "spring", stiffness: 400, damping: 35 }}
                      />
                    )}
                    <span className="relative z-10">{t.label}</span>
                    {t.key === "anamnese" && attendanceStarted && (
                      <span className="relative z-10 h-2 w-2 rounded-full bg-success" aria-label="em andamento" />
                    )}
                    {t.key === "prontuarios" && clinicalHistory.length > 0 && (
                      <span
                        className={`relative z-10 rounded-full px-1.5 text-xs ${
                          active ? "bg-white/20" : "bg-primary/12 text-primary"
                        }`}
                      >
                        {clinicalHistory.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </header>

          {/* ATENDIMENTO — fica sempre montado para não perder o texto ao trocar de aba */}
          <div hidden={tab !== "anamnese"} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    Atendimento de hoje
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Escreva, dite ou grave a consulta. Nada é salvo até você finalizar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    openAiModal({ key: "anamnese_geral", title: "Anamnese Geral" })
                  }
                  className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-[linear-gradient(135deg,#ff7a59,#d946ef_50%,#6366f1)] px-4 text-sm font-semibold text-white shadow-sm transition-[filter] hover:brightness-110"
                >
                  <Sparkles size={16} />
                  Assistente IA
                </button>
              </div>

              {lastRecord && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-surface/60 px-3.5 py-2 text-sm">
                  <span className="text-muted-foreground">
                    Último atendimento: <strong className="text-foreground">{lastRecord.formattedDate}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => pullIntoAttendance(lastRecord)}
                    className="cursor-pointer text-sm font-semibold text-primary hover:underline"
                  >
                    Trazer para este atendimento
                  </button>
                </div>
              )}

              <RichEditor
                ref={queixaRef}
                placeholder="Queixa, história, exame físico, hipóteses e conduta... ou use o Assistente IA para gravar a consulta."
                minHeight={420}
              />
            </section>

            <aside className="space-y-3 lg:sticky lg:top-44 lg:self-start" aria-label="Histórico recente">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <History size={15} className="text-primary" />
                  Histórico recente
                </h3>
                {clinicalHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTab("prontuarios")}
                    className="cursor-pointer text-xs font-semibold text-primary hover:underline"
                  >
                    Ver tudo ({clinicalHistory.length})
                  </button>
                )}
              </div>
              {loadingClinicalHistory ? (
                <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  Carregando…
                </p>
              ) : clinicalHistory.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                  Primeiro atendimento deste paciente.
                </p>
              ) : (
                <div className="max-h-[calc(100dvh-16rem)] space-y-2 overflow-y-auto pr-1">
                  {clinicalHistory.slice(0, 8).map((rec) => (
                    <HistoryCard
                      key={rec.id}
                      rec={rec}
                      compact
                      onPull={() => pullIntoAttendance(rec)}
                      onPrint={() => setRecordToPrint(rec)}
                    />
                  ))}
                </div>
              )}
            </aside>
          </div>

          {/* HISTÓRICO */}
          {tab === "prontuarios" && (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filtrar por tipo">
                  {(
                    [
                      ["todos", "Todos", clinicalHistory.length],
                      ["prontuario", "Prontuários", prontuariosCount],
                      ["consulta", "Consultas", consultasCount],
                      ["evolucao", "Evoluções", evolucoesCount],
                    ] as const
                  ).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={historyFilterKind === key}
                      onClick={() => setHistoryFilterKind(key)}
                      className={`shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        historyFilterKind === key
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label} <span className="opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
                <div className="relative sm:w-72">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="search"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Buscar queixa, CID, conduta, médico..."
                    aria-label="Buscar no histórico"
                    className="h-9 w-full rounded-full border border-border bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
              </div>

              {loadingClinicalHistory ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
                  Carregando prontuários do paciente…
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="space-y-3 rounded-2xl border border-dashed border-border bg-card p-12 text-center">
                  <FileText size={28} className="mx-auto text-muted-foreground/60" />
                  <p className="text-sm font-medium text-foreground">
                    {historySearch
                      ? `Nada encontrado para "${historySearch}".`
                      : "Nenhum registro clínico ainda."}
                  </p>
                  {!historySearch && (
                    <button
                      type="button"
                      onClick={() => setTab("anamnese")}
                      className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                    >
                      <Stethoscope size={16} /> Iniciar primeiro atendimento
                    </button>
                  )}
                </div>
              ) : (
                <ol className="relative space-y-6 border-l border-border pl-5 sm:ml-2">
                  {groupByMonth(filteredHistory).map(([month, items]) => (
                    <li key={month} className="space-y-3">
                      <h3 className="-ml-[27px] flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <span className="h-3 w-3 rounded-full border-2 border-primary bg-card" aria-hidden="true" />
                        {month}
                      </h3>
                      {items.map((rec) => (
                        <HistoryCard
                          key={rec.id}
                          rec={rec}
                          onPull={() => pullIntoAttendance(rec)}
                          onPrint={() => setRecordToPrint(rec)}
                        />
                      ))}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {tab === "plano" &&
            (patient.id ? (
              <PatientPackagesTab patientId={patient.id} patientName={patient.name} />
            ) : (
              <p className="text-sm text-muted-foreground">Paciente sem cadastro completo.</p>
            ))}

          {tab === "orcamento" && (
            <QuotesTab
              patientId={patient.id ?? undefined}
              patientName={patient.name}
              patientPhone={dbPatient?.phone}
              onCreatePlan={() => setTab("plano")}
            />
          )}

          {tab === "injetaveis" && (
            <InjectablesTab patientId={patient.id ?? undefined} onCreatePlan={() => setTab("plano")} />
          )}

          {tab === "fotos" && (
            <ClinicalPhotos
              key={dbPatient?.id || paramPatientId || "no-patient"}
              patientId={dbPatient?.id || paramPatientId || undefined}
            />
          )}
        </div>

        {/* Modal do Assistente de Prontuário IA */}
        <AiRecordAssistantModal
          isOpen={aiModalOpen}
          onClose={() => setAiModalOpen(false)}
          section={aiSection}
          patientName={patient.name}
          existingRecord={aiModalOpen ? queixaRef.current?.getText() : undefined}
          previousRecord={
            clinicalHistory.find((i) => i.kind === "prontuario" && Boolean(i.complaint))?.complaint
          }
          patientPhone={dbPatient?.phone}
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

        {/* Sempre montado: o cronômetro não zera ao trocar de aba */}
        {(
          <footer
            hidden={tab !== "anamnese"}
            className="app-fixed-footer pointer-events-none fixed bottom-0 right-0 z-30 px-3 pb-3 md:px-6 md:pb-4"
          >
            <div className="pointer-events-auto mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline bg-glass px-4 py-2.5 shadow-(--glass-shadow-lg) glass-blur">
              <div className="flex items-center gap-4">
                <ConsultationTimer
                  onTick={(seconds) => {
                    secondsRef.current = seconds;
                  }}
                />
                <SaveIndicator state={saveState} />
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
          label: "Nada pendente",
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

const KIND_BADGE: Record<string, { label: string; cls: string; icon: typeof Stethoscope }> = {
  prontuario: { label: "Prontuário", cls: "bg-primary-soft text-primary", icon: Stethoscope },
  consulta: { label: "Consulta", cls: "bg-info/12 text-info", icon: Calendar },
  evolucao: { label: "Evolução", cls: "bg-success/12 text-success", icon: Activity },
};

/** Cartão de um registro do histórico: resumo recolhido, texto completo ao expandir. */
function HistoryCard({
  rec,
  compact = false,
  onPull,
  onPrint,
}: {
  rec: ClinicalHistoryItem;
  compact?: boolean;
  onPull: () => void;
  onPrint: () => void;
}) {
  const [open, setOpen] = useState(false);
  const badge = KIND_BADGE[rec.kind] ?? KIND_BADGE.prontuario;
  const Icon = badge.icon;
  const body = rec.complaint || rec.clinicalHistory || rec.evolution || "";
  const signed = Boolean(rec.raw?.signed_at);

  const copy = async () => {
    const text = [
      `${badge.label} — ${rec.formattedDate}${rec.doctorName ? ` — ${rec.doctorName}` : ""}`,
      body,
      rec.diagnosis ? `Diagnóstico: ${rec.diagnosis}${rec.diagnosisCode ? ` (${rec.diagnosisCode})` : ""}` : "",
      rec.conduct ? `Conduta: ${rec.conduct}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <article
      className={`rounded-xl border border-border bg-card transition-colors hover:border-primary/30 ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
          <Icon size={12} />
          {rec.kind === "consulta" ? rec.type || badge.label : badge.label}
        </span>
        <span className="text-sm font-semibold text-foreground">
          {compact ? new Date(rec.date).toLocaleDateString("pt-BR") : rec.formattedDate}
          {!compact && rec.time ? <span className="font-normal text-muted-foreground"> · {rec.time}</span> : null}
        </span>
        {signed && (
          <span className="rounded-md bg-success/12 px-1.5 py-0.5 text-xs font-semibold text-success">Assinado</span>
        )}
        {!compact && rec.doctorName && <span className="text-xs text-muted-foreground">{rec.doctorName}</span>}
        {!compact && rec.durationSeconds ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} /> {Math.max(1, Math.round(rec.durationSeconds / 60))} min
          </span>
        ) : null}
      </div>

      {body ? (
        <p
          className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85 ${
            open ? "" : compact ? "line-clamp-3" : "line-clamp-4"
          }`}
        >
          {body}
        </p>
      ) : (
        <p className="mt-2 text-xs italic text-muted-foreground">Sem anotações.</p>
      )}

      {open && (rec.diagnosis || rec.conduct || rec.returnDate) && (
        <div className="mt-2 space-y-1.5 text-sm">
          {rec.diagnosis && (
            <p>
              <strong>Diagnóstico:</strong> {rec.diagnosis}
              {rec.diagnosisCode ? ` (CID-10 ${rec.diagnosisCode})` : ""}
            </p>
          )}
          {rec.conduct && (
            <p className="whitespace-pre-wrap">
              <strong>Conduta:</strong> {rec.conduct}
            </p>
          )}
          {rec.returnDate && (
            <p>
              <strong>Retorno:</strong> {new Date(rec.returnDate).toLocaleDateString("pt-BR")}
              {rec.returnNotes ? ` — ${rec.returnNotes}` : ""}
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {(body.length > 160 || rec.diagnosis || rec.conduct) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/8"
          >
            {open ? "Recolher" : "Ver completo"}
          </button>
        )}
        {body && (
          <button
            type="button"
            onClick={onPull}
            className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Trazer este texto para o atendimento de hoje"
          >
            Trazer para hoje
          </button>
        )}
        <span className="ml-auto flex items-center">
          <button
            type="button"
            onClick={copy}
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Copiar"
            title="Copiar"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Imprimir"
            title="Imprimir"
          >
            <Printer size={14} />
          </button>
        </span>
      </div>
    </article>
  );
}

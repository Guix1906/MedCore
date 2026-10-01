import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Mic,
  Square,
  Pause,
  Play,
  RefreshCw,
  Check,
  X,
  FileText,
  Copy,
  Edit3,
  Trash2,
  AlertCircle,
  Stethoscope,
  Pill,
  ShieldAlert,
  ClipboardCheck,
  Activity,
  UserCheck,
  CheckSquare,
  Square as SquareBox,
  Layers,
  ArrowLeft,
  ArrowRight,
  MessageSquareText,
  Lightbulb,
  ChevronDown,
  CalendarClock,
  FlaskConical,
  HeartPulse,
  Coffee,
  Brain,
  History,
  Minimize2,
  Printer,
  Send,
  TrendingUp,
  Siren,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { printClinicalDocument } from "@/lib/clinical-documents";
import { whatsappNumber } from "@/features/agenda/components/WhatsAppReminderButton";
import {
  CLINICAL_GROUPS,
  CLINICAL_SECTIONS,
  SPECIALTIES,
  SPEAKER_LABELS,
  SPEAKER_ORDER,
  formatConsultationRecord,
  formatExamRequest,
  formatPrescription,
  generateConsultationRecord,
  organizeTranscript,
  turnsToText,
  type Cid10Item,
  type ClinicalFieldKey,
  type Speaker,
  type StructuredConsultationResult,
  type TranscriptTurn,
} from "@/lib/gemini";

export interface AiSectionContext {
  key: string;
  title: string;
  placeholder?: string;
  currentContent?: string;
}

interface AiRecordAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  section?: AiSectionContext | null;
  /** Usado só para remover o nome do paciente antes do envio à IA. */
  patientName?: string;
  /** Texto já registrado no prontuário aberto: a IA só complementa e nada é apagado. */
  existingRecord?: string;
  /** Último atendimento do paciente: a IA aponta o que mudou desde ele. */
  previousRecord?: string;
  /** Telefone do paciente, para enviar as orientações por WhatsApp. */
  patientPhone?: string | null;
  onInsert: (content: string | StructuredConsultationResult, sectionKey?: string) => void;
}

type InputMode = "voice" | "text";
type RecordingState = "idle" | "recording" | "paused" | "finished";
type Step = "capture" | "transcript" | "record";
type DocKind = "receita" | "exames" | "orientacoes";

const DOC_TABS: { id: DocKind; label: string; printTitle: string }[] = [
  { id: "receita", label: "Receita", printTitle: "Receituário" },
  { id: "exames", label: "Pedido de exames", printTitle: "Solicitação de exames" },
  { id: "orientacoes", label: "Orientações ao paciente", printTitle: "Orientações ao paciente" },
];

const STEPS: { id: Step; label: string }[] = [
  { id: "capture", label: "Captura" },
  { id: "transcript", label: "Transcrição" },
  { id: "record", label: "Prontuário" },
];

const FIELD_ICONS: Record<ClinicalFieldKey, React.ReactNode> = {
  queixaPrincipal: <ClipboardCheck size={15} className="text-primary" />,
  historiaDoencaAtual: <History size={15} className="text-primary" />,
  historicoPessoal: <Stethoscope size={15} className="text-primary" />,
  historicoFamiliar: <UserCheck size={15} className="text-info" />,
  medicacoesEmUso: <Pill size={15} className="text-success" />,
  alergias: <ShieldAlert size={15} className="text-destructive" />,
  tratamentosAnteriores: <Activity size={15} className="text-teal-600 dark:text-teal-400" />,
  habitosDeVida: <Coffee size={15} className="text-warning" />,
  exameFisico: <HeartPulse size={15} className="text-destructive" />,
  hipotesesDiagnosticas: <Brain size={15} className="text-primary" />,
  examesSolicitados: <FlaskConical size={15} className="text-info" />,
  condutaPlano: <FileText size={15} className="text-primary" />,
  retorno: <CalendarClock size={15} className="text-success" />,
};

const SPEAKER_STYLES: Record<Speaker, string> = {
  medico: "bg-primary-soft text-primary border-primary/25",
  paciente: "bg-success/10 text-success border-success/25",
  acompanhante: "bg-info/10 text-info border-info/25",
  indefinido: "bg-muted text-muted-foreground border-border",
};

const textareaBase =
  "w-full rounded-lg border p-2.5 text-sm leading-relaxed outline-none transition-all resize-y [field-sizing:content] min-h-[2.75rem] focus:border-primary focus:ring-2 focus:ring-primary/10";

export function AiRecordAssistantModal({
  isOpen,
  onClose,
  section,
  patientName,
  existingRecord,
  previousRecord,
  patientPhone,
  onInsert,
}: AiRecordAssistantModalProps) {
  const isComplement = Boolean(existingRecord?.trim());
  const [minimized, setMinimized] = useState(false);
  const [specialty, setSpecialty] = useState<string>(() => {
    try {
      return localStorage.getItem("medcore.ai.specialty") || "clinica_geral";
    } catch {
      return "clinica_geral";
    }
  });
  const [cid10, setCid10] = useState<Cid10Item[]>([]);
  const [docs, setDocs] = useState<Record<DocKind, string>>({ receita: "", exames: "", orientacoes: "" });
  const [docTab, setDocTab] = useState<DocKind>("receita");

  const changeSpecialty = (value: string) => {
    setSpecialty(value);
    try {
      localStorage.setItem("medcore.ai.specialty", value);
    } catch {}
  };
  const [step, setStep] = useState<Step>("capture");
  const [mode, setMode] = useState<InputMode>("voice");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState("");
  const [manualText, setManualText] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(12).fill(15));

  // Etapa 2 — transcrição organizada
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  // Etapa 3 — prontuário estruturado
  const [result, setResult] = useState<StructuredConsultationResult | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [conditions, setConditions] = useState<string[]>([]);
  const [isStructuring, setIsStructuring] = useState(false);
  const [showEmptyFields, setShowEmptyFields] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>("");
  const liveTranscriptRef = useRef<string>("");
  const isRecordingRef = useRef<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Web Audio API para visualizador dinâmico
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const updateTranscript = (value: string) => {
    liveTranscriptRef.current = value;
    setTranscript(value);
  };

  const setupRecognition = useCallback(() => {
    if (typeof window === "undefined") return null;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "pt-BR";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = "";
      let newFinal = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const text = item[0]?.transcript || "";
        if (item.isFinal) {
          newFinal += text + " ";
        } else {
          interim += text;
        }
      }

      if (newFinal) {
        finalTranscriptRef.current = (
          (finalTranscriptRef.current ? finalTranscriptRef.current.trim() + " " : "") +
          newFinal.trim()
        ).trim();
      }

      updateTranscript(
        ((finalTranscriptRef.current ? finalTranscriptRef.current + " " : "") + interim).trim(),
      );
    };

    recognition.onerror = (event: any) => {
      console.warn("Speech recognition notice:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Permissão de microfone negada. Verifique as permissões do navegador.");
        stopRecording();
      }
    };

    recognition.onend = () => {
      if (isRecordingRef.current) {
        try {
          recognition.start();
        } catch {}
      }
    };

    return recognition;
  }, []);

  const startAudioVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.65;
      analyserRef.current = analyser;

      ctx.createMediaStreamSource(stream).connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const sampleIndices = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

      const updateBars = () => {
        if (!analyserRef.current || !isRecordingRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        setAudioLevels(
          sampleIndices.map((idx) =>
            Math.max(14, Math.min(100, Math.round(((dataArray[idx] || 0) / 255) * 150))),
          ),
        );
        animFrameRef.current = requestAnimationFrame(updateBars);
      };

      updateBars();
    } catch (e) {
      console.warn("Não foi possível acessar o visualizador de áudio:", e);
    }
  };

  const stopAudioVisualizer = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    setAudioLevels(Array(12).fill(15));
  };

  useEffect(() => {
    if (isOpen) {
      setStep("capture");
      setMode("voice");
      updateTranscript("");
      setManualText("");
      setTurns(null);
      setShowRaw(false);
      setResult(null);
      setEdited({});
      setSelected({});
      setConditions([]);
      setCid10([]);
      setDocs({ receita: "", exames: "", orientacoes: "" });
      setDocTab("receita");
      setMinimized(false);
      setShowEmptyFields(false);
      setRecordingState("idle");
      isRecordingRef.current = false;
      finalTranscriptRef.current = "";
      setRecordingSeconds(0);
    } else {
      stopRecording();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const startRecording = async () => {
    const recognition = recognitionRef.current || setupRecognition();
    recognitionRef.current = recognition;

    if (!recognition) {
      toast.info("Reconhecimento por voz", {
        description:
          "Seu navegador não possui suporte à Web Speech API. Você pode usar a aba de digitação.",
      });
      setMode("text");
      return;
    }

    try {
      finalTranscriptRef.current = liveTranscriptRef.current.trim();
      isRecordingRef.current = true;
      setRecordingState("recording");

      recognition.start();
      startAudioVisualizer();

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn("Erro ao iniciar gravação:", err);
      isRecordingRef.current = true;
      setRecordingState("recording");
    }
  };

  const pauseRecording = () => {
    isRecordingRef.current = false;
    setRecordingState("paused");
    try {
      recognitionRef.current?.stop();
    } catch {}
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopAudioVisualizer();
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    setRecordingState((prev) => (prev === "idle" ? "idle" : "finished"));
    try {
      recognitionRef.current?.stop();
    } catch {}
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopAudioVisualizer();
  };

  /** Finalizar pelo botão: para a gravação e já organiza a transcrição. */
  const finishConsultation = () => {
    stopRecording();
    // O navegador ainda pode entregar o último trecho reconhecido logo após o stop().
    setTimeout(() => {
      const raw = liveTranscriptRef.current.trim();
      if (raw) void runTranscription(raw);
    }, 700);
  };

  const rawInput = () => (mode === "voice" ? liveTranscriptRef.current : manualText).trim();

  const runTranscription = async (raw = rawInput()) => {
    if (!raw) {
      toast.error("Fale durante a consulta ou digite anotações antes de transcrever.");
      return;
    }
    if (isRecordingRef.current) stopRecording();
    setIsTranscribing(true);
    try {
      const organized = await organizeTranscript({ rawTranscript: raw, patientName });
      if (organized.length === 0) throw new Error("A IA não retornou nenhuma fala.");
      setTurns(organized);
      setShowRaw(false);
      setStep("transcript");
    } catch (err) {
      toast.error("Não foi possível organizar a transcrição", {
        description:
          (err instanceof Error && err.message) || "Tente novamente. Seu texto foi mantido.",
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const runStructuring = async (source: string) => {
    if (!source.trim()) {
      toast.error("Não há conteúdo para organizar.");
      return;
    }
    if (isRecordingRef.current) stopRecording();
    setIsStructuring(true);
    try {
      const res = await generateConsultationRecord({
        rawTranscript: source,
        patientName,
        existingRecord,
        previousRecord,
        specialty,
      });
      const nextEdited: Record<string, string> = {};
      const nextSelected: Record<string, boolean> = {};
      for (const sec of CLINICAL_SECTIONS) {
        nextEdited[sec.key] = res[sec.key];
        nextSelected[sec.key] = Boolean(res[sec.key]);
      }
      setResult(res);
      setEdited(nextEdited);
      setSelected(nextSelected);
      setConditions(res.condicoesDetectadas);
      setCid10(res.cid10);
      setDocs({
        receita: res.prescricoes.length ? formatPrescription(res.prescricoes) : "",
        exames: res.exames.length ? formatExamRequest(res.exames, res.cid10) : "",
        orientacoes: res.orientacoesPaciente,
      });
      setDocTab(res.prescricoes.length ? "receita" : res.exames.length ? "exames" : "orientacoes");
      setShowEmptyFields(false);
      setStep("record");
    } catch (err) {
      toast.error("Não foi possível organizar as ideias", {
        description:
          (err instanceof Error && err.message) ||
          "Tente novamente. Suas anotações foram mantidas.",
      });
    } finally {
      setIsStructuring(false);
    }
  };

  const organizeIdeas = () => {
    if (turns && turns.length > 0) return runStructuring(turnsToText(turns));
    return runStructuring(rawInput());
  };

  const updateTurn = (index: number, patch: Partial<TranscriptTurn>) => {
    setTurns((prev) => prev && prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const cycleSpeaker = (index: number) => {
    setTurns(
      (prev) =>
        prev &&
        prev.map((t, i) =>
          i === index
            ? { ...t, speaker: SPEAKER_ORDER[(SPEAKER_ORDER.indexOf(t.speaker) + 1) % SPEAKER_ORDER.length] }
            : t,
        ),
    );
  };

  const removeTurn = (index: number) => {
    setTurns((prev) => prev && prev.filter((_, i) => i !== index));
  };

  const copyText = async (id: string, text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success("Copiado!");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const buildFinalResult = (): StructuredConsultationResult | null => {
    if (!result) return null;
    const final: StructuredConsultationResult = { ...result, condicoesDetectadas: conditions, cid10 };
    for (const sec of CLINICAL_SECTIONS) {
      final[sec.key] = selected[sec.key] ? (edited[sec.key] ?? "").trim() : "";
    }
    return final;
  };

  const handleConfirmInsert = () => {
    const final = buildFinalResult();
    if (!final) {
      toast.error("Nenhum conteúdo clínico estruturado para inserir.");
      return;
    }
    onInsert(final, section?.key);
    toast.success("Prontuário preenchido!", {
      description: "Revise o texto inserido antes de salvar e assinar.",
    });
    onClose();
  };

  if (!isOpen) return null;

  const isRecording = recordingState === "recording";
  const isBusy = isTranscribing || isStructuring;
  const hasInput = Boolean((mode === "voice" ? transcript : manualText).trim());
  const selectedCount = CLINICAL_SECTIONS.filter(
    (s) => selected[s.key] && (edited[s.key] ?? "").trim(),
  ).length;
  const filledSections = CLINICAL_SECTIONS.filter((s) => (edited[s.key] ?? "").trim() || selected[s.key]);
  const emptySections = CLINICAL_SECTIONS.filter((s) => !filledSections.includes(s));
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canGoTo = (target: Step) =>
    !isBusy &&
    (target === "capture" || (target === "transcript" && !!turns) || (target === "record" && !!result));

  const docText = docs[docTab];
  const phoneNumber = whatsappNumber(patientPhone);

  const printDoc = () => {
    if (!docText.trim()) return;
    const tab = DOC_TABS.find((d) => d.id === docTab)!;
    if (!printClinicalDocument({ title: tab.printTitle, patientName, body: docText })) {
      toast.error("O navegador bloqueou a janela de impressão. Libere pop-ups para este site.");
    }
  };

  // Gravação em segundo plano: o assistente vira um botão flutuante e o médico segue navegando.
  if (minimized) {
    return (
      <div
        role="region"
        aria-label="Assistente de prontuário minimizado"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-3 pr-1.5 shadow-lg"
      >
        {isRecording ? (
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
        ) : (
          <Sparkles size={15} className="text-primary" aria-hidden="true" />
        )}
        <span className="text-sm font-semibold text-foreground">
          {isRecording
            ? `Gravando ${formatSeconds(recordingSeconds)}`
            : recordingState === "paused"
              ? `Pausado ${formatSeconds(recordingSeconds)}`
              : isBusy
                ? "IA trabalhando..."
                : "Assistente IA"}
        </span>
        {(isRecording || recordingState === "paused") && (
          <button
            type="button"
            onClick={isRecording ? pauseRecording : startRecording}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-muted text-foreground hover:bg-input"
            aria-label={isRecording ? "Pausar" : "Continuar gravando"}
          >
            {isRecording ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="h-8 cursor-pointer rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          Abrir
        </button>
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[92dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0 [&>button.absolute]:hidden"
        onInteractOutside={(event) => event.preventDefault()}
      >
        {/* Cabeçalho */}
        <div className="border-b border-border-soft bg-card px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff7a59,#d946ef_50%,#6366f1)] text-white shadow-sm"
                aria-hidden="true"
              >
                <Sparkles size={20} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <DialogTitle className="tracking-tight">Assistente de Prontuário IA</DialogTitle>
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
                    <Layers size={11} />
                    Revisão profissional necessária
                  </span>
                </div>
                <DialogDescription className="mt-0.5">
                  Grave ou digite a consulta, revise a transcrição e deixe a IA organizar o
                  prontuário.
                </DialogDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <button
                onClick={() => setMinimized(true)}
                className="cursor-pointer rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/80"
                aria-label="Minimizar"
                title="Minimizar e continuar gravando enquanto usa o sistema"
              >
                <Minimize2 size={17} />
              </button>
              <button
                onClick={onClose}
                className="cursor-pointer rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/80"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Etapas */}
          <ol className="mt-4 flex items-center gap-2" aria-label="Etapas">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const active = s.id === step;
              return (
                <li key={s.id} className="flex flex-1 items-center gap-2">
                  <button
                    type="button"
                    disabled={!canGoTo(s.id)}
                    onClick={() => setStep(s.id)}
                    aria-current={active ? "step" : undefined}
                    className={`flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-semibold transition-colors disabled:cursor-default ${
                      active
                        ? "bg-primary-soft text-primary"
                        : done
                          ? "cursor-pointer text-foreground hover:bg-muted"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : done
                            ? "bg-success text-white"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {done ? <Check size={13} /> : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Corpo */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {/* ETAPA 1 — CAPTURA */}
          {step === "capture" && (
            <>
              {isComplement && (
                <div className="flex items-start gap-2.5 rounded-xl border border-info/25 bg-info/8 px-3.5 py-2.5 text-sm text-foreground">
                  <History size={16} className="mt-0.5 shrink-0 text-info" />
                  <span>
                    <strong>Complementando o prontuário aberto.</strong> O que já está escrito é
                    mantido; a IA lê o registro atual e acrescenta só as informações novas.
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">Especialidade</span>
                  <select
                    value={specialty}
                    onChange={(e) => changeSpecialty(e.target.value)}
                    className="h-8 cursor-pointer rounded-lg border border-input bg-card px-2 text-sm text-foreground outline-none focus:border-primary"
                  >
                    {SPECIALTIES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                {previousRecord?.trim() && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingUp size={13} className="text-primary" />
                    A IA vai comparar com o último atendimento
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => setMode("voice")}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all ${
                      mode === "voice"
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Mic size={15} />
                    Gravar consulta
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isRecording) pauseRecording();
                      setMode("text");
                    }}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all ${
                      mode === "text"
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Edit3 size={15} />
                    Digitar / colar
                  </button>
                </div>

                {isRecording && (
                  <div className="flex items-center gap-2 rounded-full border border-destructive/25 bg-destructive/10 px-3 py-1 text-sm font-semibold text-destructive">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                    Gravando {formatSeconds(recordingSeconds)}
                  </div>
                )}
              </div>

              {mode === "voice" && (
                <div className="space-y-4">
                  <div
                    className={`flex flex-col items-center justify-center rounded-2xl border p-6 transition-all ${
                      isRecording
                        ? "border-destructive/25 bg-destructive/4"
                        : recordingState === "paused"
                          ? "border-warning/25 bg-warning/4"
                          : "border-border/90 bg-muted/42"
                    }`}
                  >
                    <div className="relative mb-3.5">
                      {isRecording && (
                        <span className="absolute -inset-3 animate-ping rounded-full bg-destructive/20" />
                      )}
                      {isRecording ? (
                        <button
                          type="button"
                          onClick={pauseRecording}
                          className="relative z-10 flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-destructive text-white shadow-md transition-all hover:bg-destructive/90 active:scale-95"
                          title="Pausar"
                        >
                          <Pause size={24} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={startRecording}
                          className="relative z-10 flex h-16 w-16 cursor-pointer items-center justify-center rounded-full text-white shadow-md transition-all hover:brightness-110 active:scale-95"
                          style={{
                            background:
                              "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
                          }}
                          title={recordingState === "idle" ? "Começar a gravar" : "Continuar gravando"}
                        >
                          {recordingState === "paused" ? (
                            <Play size={24} className="ml-0.5 fill-white" />
                          ) : (
                            <Mic size={26} />
                          )}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1 text-center">
                      <div className="text-[15px] font-semibold text-foreground">
                        {recordingState === "idle" && "Começar a gravar a consulta"}
                        {isRecording && "Ouvindo a consulta..."}
                        {recordingState === "paused" && `Pausado (${formatSeconds(recordingSeconds)})`}
                        {recordingState === "finished" && `Gravação concluída (${formatSeconds(recordingSeconds)})`}
                      </div>
                      <p className="max-w-md text-sm text-muted-foreground">
                        {recordingState === "idle" &&
                          "Converse normalmente com o paciente. Ao finalizar, a IA organiza a transcrição separando as falas."}
                        {isRecording && "Toque para pausar ou finalize quando terminar."}
                        {recordingState === "paused" && "Toque para continuar ou finalize a consulta."}
                        {recordingState === "finished" &&
                          "Você pode gravar mais um trecho ou seguir para a transcrição."}
                      </p>
                    </div>

                    {isRecording && (
                      <div className="mt-3.5 flex h-7 items-center gap-1" aria-hidden="true">
                        {audioLevels.map((lvl, i) => (
                          <span
                            key={i}
                            className="w-1.5 rounded-full bg-destructive transition-all duration-75"
                            style={{ height: `${lvl}%` }}
                          />
                        ))}
                      </div>
                    )}

                    {(isRecording || recordingState === "paused") && (
                      <button
                        type="button"
                        onClick={finishConsultation}
                        className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-sm transition-opacity hover:opacity-90"
                      >
                        <Square size={13} className="fill-current" />
                        Finalizar e transcrever
                      </button>
                    )}
                  </div>

                  {(transcript || isRecording) && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {isRecording ? "Texto captado (bruto)" : "Texto captado — pode editar"}
                        </span>
                        {transcript && !isRecording && (
                          <button
                            type="button"
                            onClick={() => {
                              updateTranscript("");
                              finalTranscriptRef.current = "";
                              setRecordingSeconds(0);
                              setRecordingState("idle");
                            }}
                            className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                          >
                            <Trash2 size={11} /> Descartar
                          </button>
                        )}
                      </div>
                      <textarea
                        value={transcript}
                        readOnly={isRecording}
                        onChange={(e) => {
                          updateTranscript(e.target.value);
                          finalTranscriptRef.current = e.target.value;
                        }}
                        placeholder="As falas aparecem aqui em tempo real."
                        className={`${textareaBase} max-h-48 border-border bg-card text-muted-foreground`}
                      />
                    </div>
                  )}
                </div>
              )}

              {mode === "text" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="ai-manual-text" className="text-sm font-semibold text-foreground">
                      Anotações ou relato da consulta
                    </label>
                    {manualText && (
                      <button
                        type="button"
                        onClick={() => setManualText("")}
                        className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 size={12} /> Limpar
                      </button>
                    )}
                  </div>
                  <textarea
                    id="ai-manual-text"
                    rows={7}
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder="Ex.: Paciente relata dor lombar há 2 semanas, pior ao esforço. Mãe com osteoporose. Usa losartana 50 mg pela manhã. Alergia a dipirona. PA 13/8. Solicito RX de coluna lombar, retorno em 15 dias..."
                    className={`${textareaBase} min-h-40 border-border bg-card text-foreground`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Anotações já escritas podem ir direto para "Organizar ideias".
                  </p>
                </div>
              )}
            </>
          )}

          {/* ETAPA 2 — TRANSCRIÇÃO ORGANIZADA */}
          {step === "transcript" && turns && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <MessageSquareText size={16} className="text-primary" />
                    Transcrição organizada
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Pontuação e termos corrigidos, sem resumo. Toque no nome para trocar quem falou.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowRaw((v) => !v)}
                    className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showRaw ? "Ocultar texto bruto" : "Ver texto bruto"}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText("transcript", turnsToText(turns))}
                    className="flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {copiedId === "transcript" ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                    Copiar
                  </button>
                </div>
              </div>

              {showRaw && (
                <div className="whitespace-pre-wrap rounded-xl border border-dashed border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  {rawInput() || "—"}
                </div>
              )}

              <ul className="space-y-2.5">
                {turns.map((turn, i) => (
                  <li key={i} className="group flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => cycleSpeaker(i)}
                      title="Trocar falante"
                      className={`mt-1 h-fit w-28 shrink-0 cursor-pointer truncate rounded-full border px-2 py-0.5 text-center text-xs font-semibold transition-opacity hover:opacity-80 ${SPEAKER_STYLES[turn.speaker]}`}
                    >
                      {SPEAKER_LABELS[turn.speaker]}
                    </button>
                    <textarea
                      value={turn.text}
                      onChange={(e) => updateTurn(i, { text: e.target.value })}
                      aria-label={`Fala de ${SPEAKER_LABELS[turn.speaker]}`}
                      className={`${textareaBase} border-transparent bg-transparent text-foreground hover:border-border`}
                    />
                    <button
                      type="button"
                      onClick={() => removeTurn(i)}
                      title="Remover fala"
                      className="mt-1.5 h-fit cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => setTurns((prev) => [...(prev ?? []), { speaker: "medico", text: "" }])}
                className="cursor-pointer text-xs font-semibold text-primary hover:underline"
              >
                + Adicionar fala
              </button>
            </div>
          )}

          {/* ETAPA 3 — PRONTUÁRIO ESTRUTURADO */}
          {step === "record" && result && (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-5"
              >
                {result.alertasAlergia.length > 0 && (
                  <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/8 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-destructive">
                      <Siren size={14} />
                      Alerta de alergia
                    </div>
                    <ul className="mt-1.5 space-y-1 text-sm font-medium text-foreground">
                      {result.alertasAlergia.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.resumo && (
                  <div className="rounded-xl border border-primary/20 bg-primary-soft/60 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                      Resumo da consulta
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-foreground">{result.resumo}</p>
                  </div>
                )}

                {result.mudancasDesdeUltima && (
                  <div className="rounded-xl border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <TrendingUp size={13} className="text-primary" />
                      Desde o último atendimento
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {result.mudancasDesdeUltima}
                    </p>
                  </div>
                )}

                {result.pendencias.length > 0 && (
                  <div className="rounded-xl border border-warning/30 bg-warning/6 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-warning">
                      <Lightbulb size={13} />
                      Pontos a confirmar
                    </div>
                    <ul className="mt-1.5 space-y-1 text-sm text-foreground">
                      {result.pendencias.map((p, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-warning">•</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Lembretes para você — não são inseridos no prontuário.
                    </p>
                  </div>
                )}

                {conditions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Condições identificadas:
                    </span>
                    {conditions.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary"
                      >
                        {c}
                        <button
                          type="button"
                          onClick={() => setConditions((prev) => prev.filter((x) => x !== c))}
                          aria-label={`Remover ${c}`}
                          className="cursor-pointer hover:text-destructive"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {cid10.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">CID-10 sugerido:</span>
                    {cid10.map((c) => (
                      <span
                        key={c.codigo}
                        title={c.descricao}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground"
                      >
                        <strong>{c.codigo}</strong> {c.descricao}
                        <button
                          type="button"
                          onClick={() => setCid10((prev) => prev.filter((x) => x.codigo !== c.codigo))}
                          aria-label={`Remover ${c.codigo}`}
                          className="cursor-pointer text-muted-foreground hover:text-destructive"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground">— confira antes de usar.</span>
                  </div>
                )}

                {CLINICAL_GROUPS.map((group) => {
                  const groupSections = filledSections.filter((s) => s.group === group.id);
                  if (groupSections.length === 0) return null;
                  return (
                    <section key={group.id} className="space-y-2.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.title}
                      </h3>
                      {groupSections.map((sec) => {
                        const isSelected = !!selected[sec.key];
                        const content = edited[sec.key] ?? "";
                        const needsReview = content.includes("(Revisar");
                        return (
                          <div
                            key={sec.key}
                            className={`rounded-xl border transition-all ${
                              isSelected
                                ? "border-primary/25 bg-card shadow-xs"
                                : "border-border/70 bg-muted/36 opacity-70"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5">
                              <button
                                type="button"
                                onClick={() => setSelected((p) => ({ ...p, [sec.key]: !p[sec.key] }))}
                                className="flex min-w-0 cursor-pointer items-center gap-2 text-left"
                                title={isSelected ? "Não inserir este campo" : "Inserir este campo"}
                              >
                                {isSelected ? (
                                  <CheckSquare size={16} className="shrink-0 text-primary" />
                                ) : (
                                  <SquareBox size={16} className="shrink-0 text-muted-foreground" />
                                )}
                                {FIELD_ICONS[sec.key]}
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {sec.title}
                                </span>
                              </button>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {needsReview && (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-warning/25 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                                    <AlertCircle size={11} />
                                    Revisar
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => copyText(sec.key, content)}
                                  className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground/80"
                                  title="Copiar campo"
                                >
                                  {copiedId === sec.key ? (
                                    <Check size={13} className="text-success" />
                                  ) : (
                                    <Copy size={13} />
                                  )}
                                </button>
                              </div>
                            </div>
                            <div className="p-2.5 pt-1.5">
                              <textarea
                                value={content}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setEdited((p) => ({ ...p, [sec.key]: value }));
                                  if (value.trim()) setSelected((p) => ({ ...p, [sec.key]: true }));
                                }}
                                placeholder={sec.description}
                                aria-label={sec.title}
                                className={`${textareaBase} border-border/80 bg-card text-foreground`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  );
                })}

                <section className="space-y-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Documentos
                  </h3>
                  <div className="rounded-xl border border-border bg-card">
                    <div role="tablist" className="flex flex-wrap gap-1 border-b border-border-soft p-1.5">
                      {DOC_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={docTab === tab.id}
                          onClick={() => setDocTab(tab.id)}
                          className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                            docTab === tab.id
                              ? "bg-primary-soft text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {tab.label}
                          {docs[tab.id].trim() ? "" : " (vazio)"}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-2 p-2.5">
                      <textarea
                        value={docText}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDocs((d) => ({ ...d, [docTab]: value }));
                        }}
                        aria-label={DOC_TABS.find((d) => d.id === docTab)?.label}
                        placeholder={
                          docTab === "receita"
                            ? "Nenhuma prescrição foi dita na consulta. Digite aqui se quiser emitir."
                            : docTab === "exames"
                              ? "Nenhum exame foi solicitado na consulta. Digite aqui se quiser emitir."
                              : "Nenhuma orientação foi dita na consulta. Digite aqui se quiser enviar."
                        }
                        className={`${textareaBase} min-h-28 border-border/80 bg-card font-mono text-[13px] text-foreground`}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <SecondaryButton disabled={!docText.trim()} onClick={printDoc}>
                          <Printer size={14} />
                          Imprimir
                        </SecondaryButton>
                        <SecondaryButton disabled={!docText.trim()} onClick={() => copyText(`doc-${docTab}`, docText)}>
                          {copiedId === `doc-${docTab}` ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                          Copiar
                        </SecondaryButton>
                        {docTab === "orientacoes" && (
                          <a
                            href={
                              phoneNumber && docText.trim()
                                ? `https://wa.me/${phoneNumber}?text=${encodeURIComponent(docText)}`
                                : undefined
                            }
                            target="_blank"
                            rel="noreferrer"
                            aria-disabled={!phoneNumber || !docText.trim()}
                            onClick={(e) => {
                              if (!phoneNumber) {
                                e.preventDefault();
                                toast.error("Paciente sem celular cadastrado.");
                              }
                            }}
                            className={`inline-flex h-10 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-4 text-sm font-semibold text-success transition-colors hover:bg-success/15 ${
                              !phoneNumber || !docText.trim() ? "pointer-events-auto cursor-not-allowed opacity-40" : "cursor-pointer"
                            }`}
                          >
                            <Send size={14} />
                            Enviar por WhatsApp
                          </a>
                        )}
                        {docTab === "receita" && docText.trim() && (
                          <span className="text-xs text-muted-foreground">
                            Receita simples. Controlados exigem receituário próprio.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {emptySections.length > 0 && (
                  <div className="rounded-xl border border-dashed border-border">
                    <button
                      type="button"
                      onClick={() => setShowEmptyFields((v) => !v)}
                      className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground"
                    >
                      <span>
                        Não mencionado na consulta ({emptySections.length}):{" "}
                        <span className="text-xs">{emptySections.map((s) => s.title).join(", ")}</span>
                      </span>
                      <ChevronDown
                        size={15}
                        className={`shrink-0 transition-transform ${showEmptyFields ? "rotate-180" : ""}`}
                      />
                    </button>
                    {showEmptyFields && (
                      <div className="space-y-2.5 border-t border-dashed border-border p-3">
                        {emptySections.map((sec) => (
                          <div key={sec.key}>
                            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                              {FIELD_ICONS[sec.key]}
                              {sec.title}
                            </label>
                            <textarea
                              value={edited[sec.key] ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                setEdited((p) => ({ ...p, [sec.key]: value }));
                                setSelected((p) => ({ ...p, [sec.key]: Boolean(value.trim()) }));
                              }}
                              placeholder={`${sec.description} — preencha se quiser incluir`}
                              className={`${textareaBase} border-border/80 bg-card text-foreground`}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft bg-muted/60 px-4 py-3 sm:px-6">
          {step === "capture" ? (
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancelar
            </button>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setStep(step === "record" && turns ? "transcript" : "capture")}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <ArrowLeft size={14} />
              {step === "record" && turns ? "Transcrição" : "Voltar à captura"}
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {step === "capture" && (
              <>
                {mode === "text" && (
                  <SecondaryButton disabled={isBusy || !hasInput} onClick={organizeIdeas} loading={isStructuring}>
                    <Sparkles size={14} />
                    Organizar ideias direto
                  </SecondaryButton>
                )}
                <PrimaryButton disabled={isBusy || !hasInput} onClick={() => runTranscription()}>
                  {isTranscribing ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Organizando transcrição...
                    </>
                  ) : (
                    <>
                      <MessageSquareText size={15} />
                      Transcrever organizado
                      <ArrowRight size={14} />
                    </>
                  )}
                </PrimaryButton>
              </>
            )}

            {step === "transcript" && (
              <>
                <SecondaryButton disabled={isBusy} onClick={() => runTranscription()} loading={isTranscribing}>
                  <RefreshCw size={14} />
                  Refazer
                </SecondaryButton>
                <PrimaryButton disabled={isBusy || !turns?.some((t) => t.text.trim())} onClick={organizeIdeas}>
                  {isStructuring ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Organizando ideias...
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} />
                      Organizar ideias
                      <ArrowRight size={14} />
                    </>
                  )}
                </PrimaryButton>
              </>
            )}

            {step === "record" && (
              <>
                <SecondaryButton
                  disabled={isBusy || selectedCount === 0}
                  onClick={() => {
                    const final = buildFinalResult();
                    if (final) void copyText("all", formatConsultationRecord(final));
                  }}
                >
                  {copiedId === "all" ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  Copiar tudo
                </SecondaryButton>
                <SecondaryButton disabled={isBusy} onClick={organizeIdeas} loading={isStructuring}>
                  <RefreshCw size={14} />
                  Reorganizar
                </SecondaryButton>
                <PrimaryButton disabled={isBusy || selectedCount === 0} onClick={handleConfirmInsert}>
                  <Check size={16} />
                  {isComplement ? "Acrescentar ao prontuário" : "Inserir no prontuário"} ({selectedCount})
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  loading,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-input bg-card px-4 text-sm font-semibold text-foreground/80 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
    >
      {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

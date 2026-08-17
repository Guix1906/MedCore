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
  Volume2,
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
} from "lucide-react";
import { toast } from "sonner";
import {
  generateConsultationRecord,
  StructuredConsultationResult,
  ClinicalSectionData,
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
  onInsert: (content: string | StructuredConsultationResult, sectionKey?: string) => void;
}

type InputMode = "voice" | "text";
type RecordingState = "idle" | "recording" | "paused" | "finished";

const SECTION_ICONS: Record<string, React.ReactNode> = {
  queixa: <ClipboardCheck size={16} className="text-purple-600" />,
  historico_familiar: <UserCheck size={16} className="text-blue-600" />,
  tratamentos: <Activity size={16} className="text-teal-600" />,
  alergias: <ShieldAlert size={16} className="text-rose-600" />,
  historico_pessoal: <Stethoscope size={16} className="text-indigo-600" />,
  medicacoes: <Pill size={16} className="text-emerald-600" />,
  conduta: <FileText size={16} className="text-violet-600" />,
};

export function AiRecordAssistantModal({
  isOpen,
  onClose,
  section,
  onInsert,
}: AiRecordAssistantModalProps) {
  const [mode, setMode] = useState<InputMode>("voice");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState("");
  const [manualText, setManualText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [structuredResult, setStructuredResult] = useState<StructuredConsultationResult | null>(null);
  const [editedSections, setEditedSections] = useState<Record<string, string>>({});
  const [selectedSections, setSelectedSections] = useState<Record<string, boolean>>({});
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [copiedSectionId, setCopiedSectionId] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>([15, 20, 25, 18, 22, 30, 24, 18, 20, 15, 22, 18]);

  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>("");
  const isRecordingRef = useRef<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Web Audio API para visualizador dinâmico
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

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

      const fullLive = (
        (finalTranscriptRef.current ? finalTranscriptRef.current + " " : "") +
        interim
      ).trim();

      setTranscript(fullLive);
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

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateBars = () => {
        if (!analyserRef.current || !isRecordingRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);
        const sampleIndices = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
        const newLevels = sampleIndices.map((idx) => {
          const raw = dataArray[idx] || 0;
          return Math.max(14, Math.min(100, Math.round((raw / 255) * 100 * 1.5)));
        });

        setAudioLevels(newLevels);
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
    setAudioLevels([15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15]);
  };

  useEffect(() => {
    if (isOpen) {
      setTranscript("");
      setManualText("");
      setStructuredResult(null);
      setEditedSections({});
      setSelectedSections({});
      setRecordingState("idle");
      isRecordingRef.current = false;
      finalTranscriptRef.current = "";
      setRecordingSeconds(0);
      setMode("voice");
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
        description: "Seu navegador não possui suporte à Web Speech API. Você pode usar a aba de digitação.",
      });
      setMode("text");
      return;
    }

    try {
      finalTranscriptRef.current = transcript.trim();
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

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    stopAudioVisualizer();
  };

  const resumeRecording = () => {
    startRecording();
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    setRecordingState("finished");

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    stopAudioVisualizer();
  };

  const handleGenerate = async () => {
    const rawInput = (mode === "voice" ? transcript : manualText).trim();
    if (!rawInput) {
      toast.error("Fale durante a consulta ou digite anotações antes de organizar.");
      return;
    }

    if (recordingState === "recording") {
      stopRecording();
    }

    setIsGenerating(true);

    try {
      const result = await generateConsultationRecord({
        rawTranscript: rawInput,
      });

      setStructuredResult(result);

      const initialEdited: Record<string, string> = {};
      const initialSelected: Record<string, boolean> = {};

      result.sections.forEach((sec) => {
        initialEdited[sec.id] = sec.content;
        initialSelected[sec.id] =
          Boolean(sec.content) && sec.content !== "Não informado na consulta.";
      });

      setEditedSections(initialEdited);
      setSelectedSections(initialSelected);

      toast.success("Informações organizadas com sucesso!", {
        description: "Os campos do prontuário foram mapeados para a sua revisão.",
      });
    } catch (err) {
      console.error("Erro ao estruturar consulta com IA:", err);
      toast.error("Não foi possível organizar no momento. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopySection = async (sectionId: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSectionId(sectionId);
      toast.success("Seção copiada!");
      setTimeout(() => setCopiedSectionId(null), 2000);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const handleSectionTextChange = (sectionId: string, val: string) => {
    setEditedSections((prev) => ({ ...prev, [sectionId]: val }));
  };

  const toggleSectionSelection = (sectionId: string) => {
    setSelectedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const handleConfirmInsert = () => {
    if (!structuredResult) {
      toast.error("Nenhum conteúdo clínico estruturado para inserir.");
      return;
    }

    const finalStructured: StructuredConsultationResult = {
      ...structuredResult,
      queixaPrincipal: selectedSections["queixa"] ? (editedSections["queixa"] || "") : "",
      historicoFamiliar: selectedSections["historico_familiar"] ? (editedSections["historico_familiar"] || "") : "",
      tratamentosAnteriores: selectedSections["tratamentos"] ? (editedSections["tratamentos"] || "") : "",
      alergias: selectedSections["alergias"] ? (editedSections["alergias"] || "") : "",
      historicoPessoal: selectedSections["historico_pessoal"] ? (editedSections["historico_pessoal"] || "") : "",
      medicacoesEmUso: selectedSections["medicacoes"] ? (editedSections["medicacoes"] || "") : "",
      condutaPlano: selectedSections["conduta"] ? (editedSections["conduta"] || "") : "",
    };

    onInsert(finalStructured, section?.key);
    toast.success("Prontuário preenchido com sucesso!", {
      description: "Os campos do prontuário foram atualizados conforme a consulta.",
    });
    onClose();
  };

  if (!isOpen) return null;

  const isRecording = recordingState === "recording";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      {/* Backdrop suave */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm transition-opacity"
      />

      {/* Modal Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col my-auto max-h-[92vh]"
      >
        {/* Cabeçalho */}
        <div className="relative px-6 py-4.5 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3.5">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm shrink-0"
              style={{
                background: "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
              }}
            >
              <Sparkles size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-[17px] font-bold text-slate-900 tracking-tight">
                  Assistente de Prontuário IA
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold bg-purple-50 text-purple-700 border border-purple-200/80">
                  <Layers size={11} />
                  Mapeado aos Campos do Prontuário
                </span>
              </div>
              <p className="text-[12.5px] text-slate-500 mt-0.5">
                Fale ou digite os dados clínicos e a IA organizará a consulta em formato de prontuário.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Seletor de Modo */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/60">
              <button
                type="button"
                onClick={() => setMode("voice")}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer ${
                  mode === "voice"
                    ? "bg-white text-purple-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Mic size={15} />
                Gravar Áudio (Consulta)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isRecording) stopRecording();
                  setMode("text");
                }}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer ${
                  mode === "text"
                    ? "bg-white text-purple-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Edit3 size={15} />
                Digitar / Colar
              </button>
            </div>

            {isRecording && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[12.5px] font-bold animate-pulse">
                <span className="h-2 w-2 rounded-full bg-rose-600" />
                Gravando consulta ({formatSeconds(recordingSeconds)})
              </div>
            )}
          </div>

          {/* MODO 1: GRAVAÇÃO DA CONSULTA */}
          {mode === "voice" && (
            <div className="space-y-4">
              <div
                className={`relative flex flex-col items-center justify-center p-6 rounded-2xl border transition-all ${
                  isRecording
                    ? "bg-rose-50/40 border-rose-200 shadow-sm"
                    : recordingState === "paused"
                      ? "bg-amber-50/40 border-amber-200"
                      : "bg-slate-50/70 border-slate-200/90"
                }`}
              >
                {/* Botão Central de Microfone */}
                <div className="relative mb-3.5">
                  {isRecording && (
                    <>
                      <span className="absolute -inset-3 rounded-full bg-rose-400/25 animate-ping" />
                      <span className="absolute -inset-6 rounded-full bg-rose-300/15 animate-pulse" />
                    </>
                  )}

                  {recordingState === "idle" ? (
                    <button
                      type="button"
                      onClick={startRecording}
                      className="relative z-10 flex h-18 w-18 items-center justify-center rounded-full text-white transition-all shadow-md hover:brightness-110 active:scale-95 cursor-pointer"
                      style={{
                        background: "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
                      }}
                      title="Começar a registrar consulta"
                    >
                      <Mic size={28} />
                    </button>
                  ) : isRecording ? (
                    <div className="relative z-10 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={pauseRecording}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 transition-all shadow-sm active:scale-95 cursor-pointer"
                        title="Pausar gravação"
                      >
                        <Pause size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-all shadow-md active:scale-95 cursor-pointer"
                        title="Finalizar consulta"
                      >
                        <Square size={22} className="fill-white" />
                      </button>
                    </div>
                  ) : recordingState === "paused" ? (
                    <div className="relative z-10 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={resumeRecording}
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-md active:scale-95 cursor-pointer"
                        title="Retomar consulta"
                      >
                        <Play size={24} className="fill-white ml-0.5" />
                      </button>
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-all shadow-sm active:scale-95 cursor-pointer"
                        title="Finalizar consulta"
                      >
                        <Square size={16} className="fill-white" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startRecording}
                      className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-purple-600 text-white hover:bg-purple-700 transition-all shadow-md active:scale-95 cursor-pointer"
                      title="Gravar novamente"
                    >
                      <Mic size={22} />
                    </button>
                  )}
                </div>

                <div className="text-center space-y-1">
                  <div className="text-[15px] font-bold text-slate-800">
                    {recordingState === "idle" && "Começar a registrar consulta"}
                    {isRecording && "Gravando consulta médica..."}
                    {recordingState === "paused" && `Consulta pausada (${formatSeconds(recordingSeconds)})`}
                    {recordingState === "finished" && `Consulta finalizada (${formatSeconds(recordingSeconds)})`}
                  </div>
                  <p className="text-[12.5px] text-slate-500 max-w-md">
                    {recordingState === "idle" &&
                      "A conversa será transcrita e organizada nos campos do prontuário após o término."}
                    {isRecording &&
                      "Transcrição em andamento. Converse naturalmente com o paciente."}
                    {recordingState === "paused" &&
                      "Gravação em pausa. Clique para retomar ou finalizar."}
                    {recordingState === "finished" &&
                      "Áudio concluído. Clique abaixo para organizar nos campos do prontuário com a IA."}
                  </p>
                </div>

                {isRecording && (
                  <div className="flex items-center gap-1 mt-3.5 h-7">
                    {audioLevels.map((lvl, i) => (
                      <span
                        key={i}
                        className="w-1.5 rounded-full bg-rose-500 transition-all duration-75"
                        style={{ height: `${lvl}%` }}
                      />
                    ))}
                  </div>
                )}

                {isRecording && (
                  <div className="flex items-center gap-3 mt-4 pt-3 border-t border-rose-200/60 w-full justify-center">
                    <button
                      type="button"
                      onClick={pauseRecording}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <Pause size={13} />
                      Pausar
                    </button>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 text-white text-[12.5px] font-semibold hover:bg-rose-700 transition-colors shadow-sm cursor-pointer"
                    >
                      <Square size={13} className="fill-white" />
                      Finalizar consulta
                    </button>
                  </div>
                )}
              </div>

              {/* TRANSCRIÇÃO */}
              {(transcript || isRecording) && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold uppercase tracking-wider text-purple-950 flex items-center gap-1.5">
                      <Volume2 size={13} className="text-purple-600" />
                      {isRecording ? "Transcrição em tempo real" : "Transcrição da consulta"}
                    </span>
                    {transcript && (
                      <button
                        type="button"
                        onClick={() => {
                          setTranscript("");
                          finalTranscriptRef.current = "";
                        }}
                        className="text-[11.5px] text-slate-400 hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 size={11} /> Limpar transcrição
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={3}
                    value={transcript}
                    onChange={(e) => {
                      setTranscript(e.target.value);
                      finalTranscriptRef.current = e.target.value;
                    }}
                    placeholder={
                      isRecording
                        ? "Ouvindo diálogo... As falas aparecerão aqui em tempo real."
                        : "A transcrição da consulta aparecerá aqui. Você pode editar livremente."
                    }
                    className="w-full rounded-xl border border-slate-200 p-3.5 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/10 outline-none transition-all resize-y leading-relaxed bg-white shadow-sm font-normal"
                  />
                </div>
              )}
            </div>
          )}

          {/* MODO 2: DIGITAÇÃO / TEXTO MANUAL */}
          {mode === "text" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13.5px] font-semibold text-slate-800">
                  Anotações ou relato clínico da consulta:
                </label>
                {manualText && (
                  <button
                    type="button"
                    onClick={() => setManualText("")}
                    className="text-[11.5px] text-slate-400 hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Trash2 size={12} /> Limpar
                  </button>
                )}
              </div>
              <textarea
                rows={5}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Ex.: Paciente relata dor lombar há 2 semanas com piora ao esforço. Mãe com histórico de osteoporose. Faz uso de Losartana 50mg pela manhã. Alergia a dipirona..."
                className="w-full rounded-xl border border-slate-200 p-3.5 text-[14px] text-slate-800 placeholder:text-slate-400 focus:border-purple-600 focus:ring-2 focus:ring-purple-600/10 outline-none transition-all resize-y leading-relaxed shadow-sm"
              />
            </div>
          )}

          {/* BOTÃO PRINCIPAL: ORGANIZAR CONSULTA COM IA */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={isGenerating || (!transcript.trim() && !manualText.trim())}
              onClick={handleGenerate}
              className="relative inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl text-[14px] font-semibold text-white transition-all shadow-sm hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              style={{
                background: "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
              }}
            >
              {isGenerating ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Mapeando campos do prontuário com IA...
                </>
              ) : (
                <>
                  <Sparkles size={17} />
                  Organizar consulta com IA
                </>
              )}
            </button>
          </div>

          {/* SEÇÃO: RESULTADO CLÍNICO MAPEADO NOS CAMPOS DO PRONTUÁRIO */}
          <AnimatePresence>
            {structuredResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="space-y-4 pt-4 border-t border-slate-200"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-[14px] font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <ClipboardCheck size={16} className="text-purple-600" />
                      Prontuário Estruturado pela IA
                    </h3>
                    <p className="text-[12px] text-slate-500 mt-0.5">
                      Revise as informações mapeadas para cada campo do prontuário antes de inserir.
                    </p>
                  </div>

                  {structuredResult.condicoesDetectadas.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11.5px] font-semibold">
                      <span>Condições identificadas:</span>
                      <span className="underline">{structuredResult.condicoesDetectadas.join(", ")}</span>
                    </div>
                  )}
                </div>

                {/* Grid / Stack de Cards Clínicos Mapeados */}
                <div className="space-y-3">
                  {structuredResult.sections.map((sec) => {
                    const isSelected = !!selectedSections[sec.id];
                    const content = editedSections[sec.id] ?? sec.content;
                    const isUnclear = sec.isUnclear || content.includes("(Revisar");
                    const isNotInformed = content === "Não informado na consulta." || !content.trim();

                    return (
                      <div
                        key={sec.id}
                        className={`rounded-xl border transition-all ${
                          isSelected
                            ? "bg-white border-purple-200/90 shadow-sm"
                            : "bg-slate-50/60 border-slate-200/70 opacity-75"
                        }`}
                      >
                        {/* Header do Card com Indicação do Campo do Prontuário */}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/70 border-b border-slate-100 rounded-t-xl flex-wrap gap-2">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => toggleSectionSelection(sec.id)}
                              className="text-purple-600 hover:text-purple-800 transition-colors cursor-pointer"
                              title={isSelected ? "Desmarcar esta seção" : "Incluir esta seção"}
                            >
                              {isSelected ? (
                                <CheckSquare size={16} className="text-purple-600" />
                              ) : (
                                <SquareBox size={16} className="text-slate-400" />
                              )}
                            </button>

                            <div className="flex items-center gap-1.5">
                              {SECTION_ICONS[sec.id] || <FileText size={15} />}
                              <span className="text-[13px] font-bold text-slate-800">
                                {sec.title}
                              </span>
                            </div>

                            <span className="text-[11px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                              {sec.fieldTarget}
                            </span>

                            {isUnclear && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertCircle size={11} />
                                Revisar informação
                              </span>
                            )}

                            {isNotInformed && (
                              <span className="text-[11.5px] text-slate-400 italic font-normal">
                                (Não informado na consulta)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleCopySection(sec.id, content)}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition-colors cursor-pointer"
                              title="Copiar seção"
                            >
                              {copiedSectionId === sec.id ? (
                                <Check size={13} className="text-emerald-600" />
                              ) : (
                                <Copy size={13} />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Corpo Editável do Campo */}
                        <div className="p-3">
                          <textarea
                            rows={isNotInformed ? 1 : 2}
                            value={content}
                            onChange={(e) => handleSectionTextChange(sec.id, e.target.value)}
                            placeholder="Não informado na consulta."
                            className={`w-full rounded-lg p-2.5 text-[13.5px] leading-relaxed transition-all resize-y outline-none ${
                              isNotInformed
                                ? "text-slate-400 bg-slate-50/50 border border-dashed border-slate-200"
                                : "text-slate-800 bg-white border border-slate-200/80 focus:border-purple-600 focus:ring-1 focus:ring-purple-600/20 font-medium"
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-2.5">
            {structuredResult && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-slate-300 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <RefreshCw size={14} className={isGenerating ? "animate-spin" : ""} />
                Regenerar
              </button>
            )}

            <button
              type="button"
              disabled={!structuredResult}
              onClick={handleConfirmInsert}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-purple-600 text-[13.5px] font-semibold text-white shadow-sm hover:bg-purple-700 transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              <Check size={16} />
              Inserir no prontuário
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

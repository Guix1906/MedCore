import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  memo,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Type,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  RemoveFormatting,
  Undo2,
  Redo2,
  ClipboardList,
  Lock,
  ChevronDown,
  Timer,
  Sparkles,
  Check,
  CloudUpload,
  CircleDot,
  Stethoscope,
  Pill,
  FileText,
  Settings,
  Download,
  Eye,
  Send,
  PlusCircle,
  AlertCircle,
  AlertTriangle,
  FileDigit,
} from "lucide-react";
import { DUR, EASE_OUT, fadeUp, staggerContainer, dropdownVariants } from "@/lib/motion";
import { createContext, useContext } from "react";
import {
  AiRecordAssistantModal,
  type AiSectionContext,
} from "@/components/prontuario/AiRecordAssistantModal";
import type { StructuredConsultationResult } from "@/lib/gemini";

export interface RichEditorHandle {
  insertText: (text: string) => void;
  setText: (text: string) => void;
  getText: () => string;
}

type SaveState = "saved" | "saving" | "dirty";
const DirtyCtx = createContext<() => void>(() => {});

type TabKey = "anamnese" | "orcamento" | "plano" | "fotos" | "injetaveis";

const TABS: { key: TabKey; label: string }[] = [
  { key: "anamnese", label: "Anamnese" },
  { key: "orcamento", label: "Orçamento" },
  { key: "plano", label: "Plano de tratamento" },
  { key: "fotos", label: "Fotos e anexos" },
  { key: "injetaveis", label: "Injetáveis" },
];

const CONDICOES = [
  "Hipertensão",
  "Diabetes",
  "Doenças cardíacas",
  "Asma ou problemas respiratórios",
  "Problemas de tireoide",
  "Câncer",
  "Outras condições crônicas",
];

const defaultPatient = {
  initials: "CR",
  name: "Clara Ribeiro",
  age: "34 anos, 6 meses, 24 dias",
};

export default function ProntuarioPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("anamnese");

  // Lê parâmetros da URL caso o atendimento tenha sido iniciado a partir da agenda ou paciente
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const paramPatientId = searchParams.get("patientId") || searchParams.get("id");
  const paramPatientName =
    searchParams.get("patientName") || searchParams.get("name") || searchParams.get("patient");

  // Busca dados reais do paciente no banco se fornecido
  const { data: dbPatient } = useQuery({
    queryKey: ["prontuario-db-patient", paramPatientId, paramPatientName],
    queryFn: async () => {
      if (paramPatientId) {
        const { data } = await supabase.from("patients").select("*").eq("id", paramPatientId).maybeSingle();
        if (data) return data;
      }
      if (paramPatientName) {
        const clean = paramPatientName.replace(/\(.*?\)/g, "").trim();
        const { data } = await supabase.from("patients").select("*").ilike("name", `%${clean}%`).limit(1).maybeSingle();
        if (data) return data;
      }
      return null;
    },
  });

  const patient = useMemo(() => {
    const rawName = dbPatient?.name || paramPatientName;
    if (!rawName) return defaultPatient;
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
        : "Em atendimento",
    };
  }, [dbPatient, paramPatientName, paramPatientId]);

  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacy, setPrivacy] = useState<"Privado" | "Compartilhado">("Privado");
  const [conditions, setConditions] = useState<Record<string, boolean>>({});
  const [especifique, setEspecifique] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Refs de controle imperativo dos editores para injeção via IA e preenchimento
  const queixaRef = useRef<RichEditorHandle>(null);
  const historicoRef = useRef<RichEditorHandle>(null);
  const tratamentosRef = useRef<RichEditorHandle>(null);
  const alergiasRef = useRef<RichEditorHandle>(null);
  const medicacoesRef = useRef<RichEditorHandle>(null);

  // Busca o último prontuário gravado desse paciente para preencher o formulário
  const { data: previousRecord } = useQuery({
    queryKey: ["prontuario-previous-record", patient.id],
    enabled: !!patient.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("medical_records")
        .select("*")
        .eq("patient_id", patient.id!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });

  const prefilledRef = useRef(false);
  useEffect(() => {
    if (previousRecord && !prefilledRef.current) {
      prefilledRef.current = true;
      if (previousRecord.complaint) queixaRef.current?.setText(previousRecord.complaint);
      if (previousRecord.family_history) historicoRef.current?.setText(previousRecord.family_history);
      if (previousRecord.conduct || previousRecord.surgical_history) {
        tratamentosRef.current?.setText(previousRecord.conduct || previousRecord.surgical_history || "");
      }
      if (previousRecord.allergies) alergiasRef.current?.setText(previousRecord.allergies);
      if (previousRecord.medications) medicacoesRef.current?.setText(previousRecord.medications);
      if (previousRecord.clinical_history) setEspecifique(previousRecord.clinical_history);
      if (previousRecord.evolution) {
        try {
          const parsed = JSON.parse(previousRecord.evolution);
          if (typeof parsed === "object" && parsed !== null) setConditions(parsed);
        } catch {}
      }
    }
  }, [previousRecord]);

  // Estado do modal de Assistente IA
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiSection, setAiSection] = useState<AiSectionContext | null>(null);

  const openAiModal = (section: AiSectionContext) => {
    setAiSection(section);
    setAiModalOpen(true);
  };

  const handleAiInsert = (
    content: string | StructuredConsultationResult,
    sectionKey?: string
  ) => {
    if (typeof content === "string") {
      if (sectionKey === "queixa") queixaRef.current?.setText(content);
      else if (sectionKey === "historico_familiar") historicoRef.current?.setText(content);
      else if (sectionKey === "tratamentos") tratamentosRef.current?.setText(content);
      else if (sectionKey === "alergias") alergiasRef.current?.setText(content);
      else if (sectionKey === "medicacoes") medicacoesRef.current?.setText(content);
      else if (sectionKey === "historico_pessoal") setEspecifique(content);
    } else {
      // Inserção multi-campo mapeada 1-para-1 com o prontuário
      const isValid = (t?: string) =>
        Boolean(t && t.trim().length > 0 && t !== "Não informado na consulta.");

      // 1. Campo: Queixa Principal
      if (isValid(content.queixaPrincipal)) {
        queixaRef.current?.setText(content.queixaPrincipal);
      }

      // 2. Campo: Histórico Familiar
      if (isValid(content.historicoFamiliar)) {
        historicoRef.current?.setText(content.historicoFamiliar);
      }

      // 3. Campo: Tratamentos Anteriores (+ Conduta se presente)
      let tratamentosText = "";
      if (isValid(content.tratamentosAnteriores)) {
        tratamentosText += content.tratamentosAnteriores;
      }
      if (isValid(content.condutaPlano)) {
        tratamentosText += `${tratamentosText ? "\n\n" : ""}Conduta e Orientações:\n${content.condutaPlano}`;
      }
      if (tratamentosText) {
        tratamentosRef.current?.setText(tratamentosText);
      }

      // 4. Campo: Alergias
      if (isValid(content.alergias)) {
        alergiasRef.current?.setText(content.alergias);
      }

      // 5. Campo: Medicações em uso atualmente
      if (isValid(content.medicacoesEmUso)) {
        medicacoesRef.current?.setText(content.medicacoesEmUso);
      }

      // 6. Campo: Histórico Médico Pessoal (Especifique)
      if (isValid(content.historicoPessoal)) {
        setEspecifique((prev) => (prev ? `${prev}\n${content.historicoPessoal}` : content.historicoPessoal));
      }

      // 7. Checkboxes de Condições detectadas automaticamente
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
    markDirty();
  };

  const markDirty = useCallback(() => {
    setSaveState("dirty");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveState("saving");
      window.setTimeout(() => setSaveState("saved"), 550);
    }, 700);
  }, []);

  useEffect(() => {
    if (Object.keys(conditions).length || especifique) markDirty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditions, especifique]);

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

  const handleCancel = () => {
    setCancelModalOpen(true);
  };

  const secondsRef = useRef(0);

  const handleFinalize = async () => {
    const targetPatientId = patient?.id || dbPatient?.id || paramPatientId;
    const queixaText = queixaRef.current?.getText() || "";
    const historicoText = historicoRef.current?.getText() || "";
    const tratamentosText = tratamentosRef.current?.getText() || "";
    const alergiasText = alergiasRef.current?.getText() || "";
    const medicacoesText = medicacoesRef.current?.getText() || "";

    setIsFinalizing(true);
    try {
      if (targetPatientId) {
        const { error } = await supabase.from("medical_records").insert({
          patient_id: targetPatientId,
          complaint: queixaText || null,
          family_history: historicoText || null,
          conduct: tratamentosText || null,
          surgical_history: tratamentosText || null,
          allergies: alergiasText || null,
          clinical_history: especifique || null,
          medications: medicacoesText || null,
          evolution: JSON.stringify(conditions),
          duration_seconds: secondsRef.current,
          finished_at: new Date().toISOString(),
        });

        if (error) {
          toast.error("Erro ao gravar prontuário no banco: " + error.message);
          setIsFinalizing(false);
          return;
        }

        queryClient.invalidateQueries({ queryKey: ["patient-medical-records", targetPatientId] });
        queryClient.invalidateQueries({ queryKey: ["patient-medical-records"] });
      }

      toast.success("Atendimento finalizado com sucesso!", {
        description: `Duração: ${formatTime(secondsRef.current)}. Prontuário clínico gravado para ${patient.name}.`,
      });

      setTimeout(() => navigate({ to: "/pacientes" }), 600);
    } catch (err: any) {
      toast.error("Erro inesperado: " + (err?.message || "falha ao finalizar"));
      setIsFinalizing(false);
    }
  };


  return (
    <DirtyCtx.Provider value={markDirty}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="flex w-full min-h-[calc(100vh-60px)] items-stretch gap-6 px-6 pb-32 pt-6">
          {/* Sidebar */}
          <aside className="-mt-6 w-[240px] shrink-0 border-r border-[#E5E7EB] pr-0 pt-6 min-h-[calc(100vh-80px)]">
            <div className="mb-4 flex items-center gap-3 pr-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[13px] font-semibold text-primary">
                {patient.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">
                  {patient.name}
                </div>
                <div className="text-[15px] leading-tight text-muted-foreground">{patient.age}</div>
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

            <nav className="-ml-2 flex flex-col gap-3 border-t border-[#E5E7EB] pl-0 pr-2 pt-3.5">
              {TABS.map((t) => {
                const active = t.key === tab;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`group relative flex items-center w-full rounded-[8px] px-3 py-2 text-left text-[14.5px] transition-all duration-150 focus-ring cursor-pointer ${
                      active
                        ? "text-white font-bold"
                        : "text-[#8B8C89] font-semibold hover:bg-[#7B3AF5]/10 hover:text-[#7B3AF5]"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="prontuario-tab-active"
                        className="absolute inset-0 rounded-[8px] shadow-sm"
                        style={{ backgroundColor: "#7B3AF5" }}
                        transition={{ type: "spring", stiffness: 400, damping: 35 }}
                      />
                    )}
                    <span className="relative z-10">{t.label}</span>
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
                {tab === "anamnese" && (
                  <motion.div
                    className="[&>*+*]:-ml-6 [&>*+*]:mt-11 [&>*+*]:border-t [&>*+*]:border-border-soft [&>*+*]:pl-6 [&>*+*]:pt-2"
                    variants={staggerContainer(0.07, 0.05)}
                    initial="hidden"
                    animate="show"
                  >
                    <motion.div variants={fadeUp}>
                      <Section
                        title="Queixa Principal"
                        onAiFill={() =>
                          openAiModal({
                            key: "queixa",
                            title: "Queixa Principal",
                            placeholder: "Descreva a queixa principal do paciente...",
                          })
                        }
                      >
                        <RichEditor
                          ref={queixaRef}
                          placeholder="Descreva a queixa principal do paciente..."
                          minHeight={200}
                        />
                      </Section>
                    </motion.div>

                    <motion.div variants={fadeUp}>
                      <Section
                        title="Histórico Familiar"
                        onAiFill={() =>
                          openAiModal({
                            key: "historico_familiar",
                            title: "Histórico Familiar",
                            placeholder: "Antecedentes familiares relevantes...",
                          })
                        }
                      >
                        <RichEditor
                          ref={historicoRef}
                          placeholder="Antecedentes familiares relevantes..."
                          minHeight={200}
                        />
                      </Section>
                    </motion.div>

                    <motion.div variants={fadeUp}>
                      <Section
                        title="Tratamentos Anteriores"
                        onAiFill={() =>
                          openAiModal({
                            key: "tratamentos",
                            title: "Tratamentos Anteriores",
                            placeholder: "Tratamentos e procedimentos anteriores...",
                          })
                        }
                      >
                        <RichEditor
                          ref={tratamentosRef}
                          placeholder="Tratamentos e procedimentos anteriores..."
                          minHeight={200}
                        />
                      </Section>
                    </motion.div>

                    <motion.div variants={fadeUp}>
                      <Section
                        title="Alergias"
                        onAiFill={() =>
                          openAiModal({
                            key: "alergias",
                            title: "Alergias",
                            placeholder: "Alergias medicamentosas, alimentares ou ambientais...",
                          })
                        }
                      >
                        <RichEditor
                          ref={alergiasRef}
                          placeholder="Alergias medicamentosas, alimentares ou ambientais..."
                          minHeight={200}
                        />
                      </Section>
                    </motion.div>

                    <motion.div variants={fadeUp}>
                      <Section
                        title="Histórico Médico Pessoal"
                        onAiFill={() =>
                          openAiModal({
                            key: "historico_pessoal",
                            title: "Histórico Médico Pessoal",
                            placeholder: "Condições crônicas e medicações...",
                          })
                        }
                      >
                        <div className="space-y-6">
                          <div>
                            <div className="text-[14.5px] font-semibold text-foreground">
                              Você tem ou já teve alguma das seguintes condições?
                            </div>
                            <div className="mt-1 text-[13px] text-muted-foreground">
                              (Marque todos que se aplicam)
                            </div>

                            <motion.ul
                              className="mt-4 space-y-2.5"
                              variants={staggerContainer(0.04, 0.02)}
                              initial="hidden"
                              animate="show"
                            >
                              {CONDICOES.map((c) => {
                                const checked = !!conditions[c];
                                return (
                                  <motion.li key={c} variants={fadeUp}>
                                    <label className="flex cursor-pointer items-center gap-3 text-[14.5px] text-foreground">
                                      <motion.button
                                        type="button"
                                        role="checkbox"
                                        aria-checked={checked}
                                        whileTap={{ scale: 0.88 }}
                                        onClick={() =>
                                          setConditions((prev) => ({ ...prev, [c]: !prev[c] }))
                                        }
                                        className={`flex h-[18px] w-[18px] items-center justify-center rounded-md border transition-colors focus-ring ${
                                          checked
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-[#d5d7e0] bg-white hover:border-primary/60"
                                        }`}
                                      >
                                        <AnimatePresence>
                                          {checked && (
                                            <motion.svg
                                              key="check"
                                              viewBox="0 0 12 12"
                                              className="h-3 w-3"
                                              fill="none"
                                              initial={{ scale: 0, opacity: 0 }}
                                              animate={{ scale: 1, opacity: 1 }}
                                              exit={{ scale: 0, opacity: 0 }}
                                              transition={{ duration: 0.15, ease: EASE_OUT }}
                                            >
                                              <path
                                                d="M2.5 6.2 5 8.7 9.5 3.5"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              />
                                            </motion.svg>
                                          )}
                                        </AnimatePresence>
                                      </motion.button>
                                      {c}
                                    </label>
                                  </motion.li>
                                );
                              })}
                            </motion.ul>
                          </div>

                          <div>
                            <label className="text-[14.5px] font-semibold text-foreground">
                              Especifique (se "Outras condições"):
                            </label>
                            <textarea
                              value={especifique}
                              onChange={(e) => setEspecifique(e.target.value)}
                              placeholder="Digite"
                              rows={4}
                              className="mt-2 w-full resize-y rounded-[4px] border-[1.5px] border-[#c9cdd6] bg-white px-4 py-3 text-[14.5px] text-foreground placeholder:text-muted-foreground/70 focus-ring"
                            />
                          </div>

                          <div>
                            <div className="text-[14.5px] font-semibold text-foreground">
                              Liste todas as medicações que você está tomando atualmente, incluindo doses:
                            </div>
                            <div className="mt-2">
                              <RichEditor
                                ref={medicacoesRef}
                                placeholder="Ex.: Losartana 50mg — 1x ao dia..."
                                minHeight={160}
                              />
                            </div>
                          </div>
                        </div>
                      </Section>
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
                  <EmptyTab
                    title="Fotos e anexos"
                    description="Envie imagens clínicas, exames e documentos do paciente."
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
          onInsert={handleAiInsert}
        />

        {/* Modal de Confirmação de Cancelamento do Prontuário */}
        <AnimatePresence>
          {cancelModalOpen && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setCancelModalOpen(false)}
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
              />

              {/* Dialog */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white p-6 shadow-2xl border border-slate-200"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
                    <AlertTriangle className="h-6 w-6" />
                  </div>

                  <div className="space-y-1.5 flex-1">
                    <h3 className="text-[17px] font-bold text-slate-900 tracking-tight">
                      Cancelar atendimento?
                    </h3>
                    <p className="text-[13.5px] leading-relaxed text-slate-500">
                      Tem certeza de que deseja descartar este atendimento? Todas as anotações clínicas e alterações não salvas serão perdidas.
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setCancelModalOpen(false)}
                    className="rounded-xl px-4 py-2.5 text-[14px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors focus-ring"
                  >
                    Continuar atendimento
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCancelModalOpen(false);
                      toast.info("Atendimento cancelado");
                      navigate({ to: "/pacientes" });
                    }}
                    className="rounded-xl bg-rose-600 px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-rose-700 transition-all active:scale-[0.98] focus-ring"
                  >
                    Sim, descartar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Footer bar */}
        <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#E5E7EB] bg-white/95 backdrop-blur md:pl-[56px]">
          <div className="flex h-14 w-full items-center px-6">
            {/* Bloco lateral esquerdo com a linha divisória perfeitamente alinhada */}
            <div className="h-full w-[240px] shrink-0 border-r border-[#E5E7EB]" />

            {/* Bloco alinhado com os campos de edição principais */}
            <div className="flex flex-1 items-center justify-between pl-10">
              {/* Esquerda: Contador de tempo + Botão Privado ao lado */}
              <div className="flex items-center gap-6">
                <ConsultationTimer onTick={(s) => { secondsRef.current = s; }} />

                <div className="relative">
                  <button
                    onClick={() => setPrivacyOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-full border border-border-soft bg-muted px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted/70 focus-ring"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    {privacy}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <AnimatePresence>
                    {privacyOpen && (
                      <motion.div
                        variants={dropdownVariants}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        style={{ transformOrigin: "bottom left" }}
                        className="absolute bottom-[calc(100%+6px)] left-0 w-44 overflow-hidden rounded-xl border border-border-soft bg-white shadow-lg z-40"
                      >
                        {(["Privado", "Compartilhado"] as const).map((opt) => (
                          <button
                            key={opt}
                            onClick={() => {
                              setPrivacy(opt);
                              setPrivacyOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted ${
                              privacy === opt ? "text-primary" : "text-foreground"
                            }`}
                          >
                            <Lock className="h-3.5 w-3.5" />
                            {opt}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Canto direito inferior: Cancelar + Finalizar Atendimento */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="text-[14.5px] font-medium text-muted-foreground hover:text-foreground focus-ring rounded-md px-2 py-1.5 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={isFinalizing}
                  className="rounded-xl bg-primary px-5 py-2.5 text-[14.5px] font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_rgba(139,71,255,0.55)] transition-all hover:bg-primary-hover focus-ring disabled:opacity-50 cursor-pointer"
                >
                  {isFinalizing ? "Finalizando e gravando..." : "Finalizar atendimento"}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </DirtyCtx.Provider>
  );
}

/* --------------------------- Subcomponents --------------------------- */

function SaveIndicator({ state }: { state: SaveState }) {
  const cfg =
    state === "saved"
      ? { label: "Salvo", icon: Check, cls: "text-emerald-600 bg-emerald-50 border-emerald-100" }
      : state === "saving"
        ? {
            label: "Salvando…",
            icon: CloudUpload,
            cls: "text-primary bg-primary/10 border-primary/20",
          }
        : { label: "Editado", icon: CircleDot, cls: "text-amber-600 bg-amber-50 border-amber-100" };
  const Icon = cfg.icon;
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: EASE_OUT }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${cfg.cls}`}
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
          <h2 className="text-[17px] font-bold tracking-tight text-foreground">{title}</h2>
        </button>

        <div className="flex items-center gap-3">
          {onAiFill && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAiFill();
              }}
              className="group relative inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] text-[13.5px] font-semibold text-white shadow-sm hover:brightness-105 active:scale-[0.98] transition-all duration-200"
              style={{
                background: "linear-gradient(135deg, #FF7A59 0%, #D946EF 50%, #6366F1 100%)",
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
      className="border-[1.5px] border-dashed border-[#c9cdd6] bg-white p-16 text-center"
    >
      <h2 className="text-[17px] font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </motion.div>
  );
}

function MemedTab() {
  const [configOpen, setConfigOpen] = useState(false);
  const [active, setActive] = useState(false);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center justify-center rounded-[8px] border-[1.5px] border-[#c9cdd6] bg-white p-12 text-center shadow-sm">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FileDigit className="h-8 w-8" />
        </div>
        <h2 className="text-[20px] font-bold tracking-tight text-foreground">Prescrição Digital Memed</h2>
        <p className="mt-2 max-w-md text-[15px] text-muted-foreground">
          Emita receitas digitais utilizando a plataforma Memed, com assinatura eletrônica do médico e envio ao paciente.
        </p>
        
        {!active && (
          <div className="mt-6 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-700">
            <AlertCircle className="h-4 w-4" />
            A integração com a Memed ainda não foi configurada.
          </div>
        )}
        
        {active && (
          <div className="mt-6 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-700">
            <Check className="h-4 w-4" />
            ✅ Integração ativa.
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button 
            className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-[14.5px] font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_rgba(139,71,255,0.55)] transition-all hover:bg-primary-hover focus-ring"
            onClick={() => toast.info("Fluxo Memed", { description: "Ponto de integração preparado." })}
          >
            <PlusCircle className="h-5 w-5" />
            Emitir Receita via Memed
          </button>
          <button 
            onClick={() => setConfigOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-[#c9cdd6] bg-white px-6 py-3 text-[14.5px] font-semibold text-foreground transition-all hover:bg-muted focus-ring"
          >
            <Settings className="h-5 w-5" />
            Configurar Integração
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-[17px] font-bold tracking-tight text-foreground">Receitas emitidas</h3>
        <div className="rounded-[8px] border border-[#D9DCE3] bg-white overflow-hidden">
          <table className="w-full text-left text-[14px]">
            <thead className="border-b border-[#E5E7EB] bg-muted/30">
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

      {configOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="border-b border-border-soft px-6 py-4 flex items-center justify-between">
              <h3 className="text-[17px] font-bold text-foreground">Configurações Memed</h3>
              <button 
                onClick={() => setConfigOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <PlusCircle className="h-5 w-5 rotate-45" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6 space-y-6">
              <div className="space-y-4 pt-2">
                <h4 className="text-[14px] font-bold text-foreground uppercase tracking-wider">Credenciais</h4>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-foreground">API Key</label>
                    <input type="text" placeholder="Insira sua API Key" className="w-full rounded-lg border border-[#c9cdd6] px-3 py-2.5 text-[14px] outline-none focus:border-primary transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-foreground">Secret Key</label>
                    <input type="password" placeholder="••••••••" className="w-full rounded-lg border border-[#c9cdd6] px-3 py-2.5 text-[14px] outline-none focus:border-primary transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-foreground">Ambiente de Execução</label>
                    <select className="w-full rounded-lg border border-[#c9cdd6] px-3 py-2.5 text-[14px] outline-none focus:border-primary bg-white transition-all">
                      <option>Produção (integrations)</option>
                      <option>Sandbox (homologação)</option>
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-center gap-3 py-2 px-1 hover:bg-muted/30 rounded-lg transition-colors">
                    <input 
                      type="checkbox" 
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="h-4.5 w-4.5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer" 
                    />
                    <span className="text-[14px] font-medium text-foreground">Ativar Módulo de Prescrição Digital</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 bg-muted/30 px-6 py-4">
              <button 
                onClick={() => setConfigOpen(false)}
                className="text-[14px] font-medium text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  toast.success("Configurações salvas");
                  setConfigOpen(false);
                }}
                className="rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground transition-all hover:bg-primary-hover"
              >
                Salvar Configuração
              </button>
            </div>
          </motion.div>
        </div>
      )}
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
      className="w-full overflow-hidden rounded-[8px] border border-[#D9DCE3] bg-white"
      style={{ minHeight: 285 }}
    >
      <div className="flex h-[56px] items-center gap-[6px] overflow-x-auto whitespace-nowrap border-b border-[#E5E7EB] bg-white px-[18px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
            className="pointer-events-none absolute left-[20px] top-[18px] text-[15px] font-normal leading-6 text-[#9CA3AF]"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
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
          className="prose prose-sm max-w-none px-[20px] py-[18px] text-[15px] font-medium leading-6 text-[#7E8192] outline-none ring-0 focus:outline-none focus-visible:outline-none focus:ring-0 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
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
          : "text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#111827]"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
    </button>
  );
}

function Divider() {
  return <span className="mx-[2px] h-[26px] w-px shrink-0 bg-[#E5E7EB]" />;
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


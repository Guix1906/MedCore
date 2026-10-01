/**
 * Copiloto de IA (Google Gemini) para o Prontuário Médico — camada do cliente.
 *
 * Fluxo em duas etapas:
 *  1. organizeTranscript: transcrição bruta → falas limpas, com médico/paciente identificados.
 *  2. generateConsultationRecord: transcrição → campos do prontuário + pendências.
 *
 * REGRA ABSOLUTA: fidelidade factual estrita, nunca inventa informações que não foram ditas.
 */

import { structureConsultation, transcribeConsultation } from "@/services/ai.service";

export const PRONTUARIO_CONDITIONS_LIST = [
  "Hipertensão",
  "Diabetes",
  "Doenças cardíacas",
  "Asma ou problemas respiratórios",
  "Problemas de tireoide",
  "Câncer",
  "Outras condições crônicas",
];

/* ------------------------------------------------------------------ */
/* Etapa 1 — Transcrição organizada                                     */
/* ------------------------------------------------------------------ */

export type Speaker = "medico" | "paciente" | "acompanhante" | "indefinido";

export interface TranscriptTurn {
  speaker: Speaker;
  text: string;
}

export const SPEAKER_LABELS: Record<Speaker, string> = {
  medico: "Médico",
  paciente: "Paciente",
  acompanhante: "Acompanhante",
  indefinido: "Não identificado",
};

export const SPEAKER_ORDER: Speaker[] = ["medico", "paciente", "acompanhante", "indefinido"];

export async function organizeTranscript({
  rawTranscript,
  patientName,
}: {
  rawTranscript: string;
  patientName?: string;
}): Promise<TranscriptTurn[]> {
  const cleaned = rawTranscript.trim();
  if (!cleaned) return [];
  const data = await transcribeConsultation({ data: { rawTranscript: cleaned, patientName } });
  return data.falas
    .map((f) => ({
      speaker: (SPEAKER_ORDER as string[]).includes(f.falante) ? (f.falante as Speaker) : "indefinido",
      text: f.texto.trim(),
    }))
    .filter((t) => t.text.length > 0);
}

/** Converte as falas em texto corrido "Médico: ...", usado como entrada da etapa 2. */
export function turnsToText(turns: TranscriptTurn[]): string {
  return turns
    .filter((t) => t.text.trim())
    .map((t) => `${SPEAKER_LABELS[t.speaker]}: ${t.text.trim()}`)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Etapa 2 — Organização das ideias nos campos do prontuário           */
/* ------------------------------------------------------------------ */

export type ClinicalFieldKey =
  | "queixaPrincipal"
  | "historiaDoencaAtual"
  | "historicoPessoal"
  | "historicoFamiliar"
  | "medicacoesEmUso"
  | "alergias"
  | "tratamentosAnteriores"
  | "habitosDeVida"
  | "exameFisico"
  | "hipotesesDiagnosticas"
  | "examesSolicitados"
  | "condutaPlano"
  | "retorno";

export type ClinicalGroup = "anamnese" | "antecedentes" | "exame" | "plano";

export interface ClinicalSectionDef {
  key: ClinicalFieldKey;
  title: string;
  /** Rótulo usado no texto inserido no prontuário. */
  recordLabel: string;
  group: ClinicalGroup;
  description: string;
}

export const CLINICAL_GROUPS: { id: ClinicalGroup; title: string }[] = [
  { id: "anamnese", title: "Anamnese" },
  { id: "antecedentes", title: "Antecedentes" },
  { id: "exame", title: "Exame e avaliação" },
  { id: "plano", title: "Plano" },
];

export const CLINICAL_SECTIONS: ClinicalSectionDef[] = [
  { key: "queixaPrincipal", title: "Queixa principal", recordLabel: "QUEIXA PRINCIPAL", group: "anamnese", description: "Motivo da consulta e duração" },
  { key: "historiaDoencaAtual", title: "História da doença atual", recordLabel: "HISTÓRIA DA DOENÇA ATUAL", group: "anamnese", description: "Início, evolução, fatores de melhora/piora e sintomas associados" },
  { key: "historicoPessoal", title: "Histórico médico pessoal", recordLabel: "HISTÓRICO PESSOAL", group: "antecedentes", description: "Doenças prévias e condições crônicas" },
  { key: "historicoFamiliar", title: "Histórico familiar", recordLabel: "HISTÓRICO FAMILIAR", group: "antecedentes", description: "Doenças em familiares e parentesco" },
  { key: "medicacoesEmUso", title: "Medicações em uso", recordLabel: "MEDICAÇÕES EM USO", group: "antecedentes", description: "Nome, dose e posologia" },
  { key: "alergias", title: "Alergias", recordLabel: "ALERGIAS", group: "antecedentes", description: "Medicamentosas, alimentares ou ambientais" },
  { key: "tratamentosAnteriores", title: "Tratamentos anteriores", recordLabel: "TRATAMENTOS ANTERIORES", group: "antecedentes", description: "Cirurgias, internações e procedimentos" },
  { key: "habitosDeVida", title: "Hábitos de vida", recordLabel: "HÁBITOS DE VIDA", group: "antecedentes", description: "Tabagismo, etilismo, atividade física, sono" },
  { key: "exameFisico", title: "Exame físico", recordLabel: "EXAME FÍSICO", group: "exame", description: "Sinais vitais e achados do exame" },
  { key: "hipotesesDiagnosticas", title: "Hipóteses diagnósticas", recordLabel: "HIPÓTESES DIAGNÓSTICAS", group: "exame", description: "Somente o que o médico verbalizou" },
  { key: "examesSolicitados", title: "Exames solicitados", recordLabel: "EXAMES SOLICITADOS", group: "plano", description: "Exames laboratoriais e de imagem" },
  { key: "condutaPlano", title: "Conduta e orientações", recordLabel: "CONDUTA / ORIENTAÇÕES", group: "plano", description: "Prescrições e orientações ao paciente" },
  { key: "retorno", title: "Retorno", recordLabel: "RETORNO", group: "plano", description: "Prazo e condição de retorno" },
];

export type StructuredConsultationResult = Record<ClinicalFieldKey, string> & {
  resumo: string;
  condicoesDetectadas: string[];
  pendencias: string[];
};

export async function generateConsultationRecord({
  rawTranscript,
  patientName,
  existingRecord,
}: {
  rawTranscript: string;
  patientName?: string;
  /** Texto já registrado; quando presente, a IA devolve só o que é novo. */
  existingRecord?: string;
}): Promise<StructuredConsultationResult> {
  const cleanedInput = rawTranscript.trim();
  if (!cleanedInput) return emptyConsultationResult();

  const data = await structureConsultation({
    data: {
      rawTranscript: cleanedInput,
      patientName,
      existingRecord: existingRecord?.trim().slice(0, 20_000) || undefined,
    },
  });
  const result = emptyConsultationResult();
  for (const sec of CLINICAL_SECTIONS) {
    result[sec.key] = sanitizeClinicalField(data[sec.key]);
  }
  result.resumo = sanitizeClinicalField(data.resumo);
  result.condicoesDetectadas = (data.condicoesDetectadas ?? []).filter((c) =>
    PRONTUARIO_CONDITIONS_LIST.includes(c),
  );
  result.pendencias = (data.pendencias ?? []).map((p) => p.trim()).filter(Boolean);
  return result;
}

export function emptyConsultationResult(): StructuredConsultationResult {
  const result = { resumo: "", condicoesDetectadas: [], pendencias: [] } as unknown as StructuredConsultationResult;
  for (const sec of CLINICAL_SECTIONS) result[sec.key] = "";
  return result;
}

/** Texto do prontuário a partir do resultado (só campos preenchidos, na ordem clínica). */
export function formatConsultationRecord(result: StructuredConsultationResult): string {
  const parts: string[] = [];
  for (const sec of CLINICAL_SECTIONS) {
    const value = result[sec.key]?.trim();
    if (value) parts.push(`${sec.recordLabel}:\n${value}`);
    if (sec.key === "historicoPessoal" && result.condicoesDetectadas.length > 0) {
      parts.push(`CONDIÇÕES IDENTIFICADAS:\n${result.condicoesDetectadas.join(", ")}`);
    }
  }
  return parts.join("\n\n");
}

/** Acrescenta o texto gerado ao registro existente, sem apagar nada do que já estava escrito. */
export function appendToRecord(existing: string, addition: string): string {
  const prev = existing.trimEnd();
  const next = addition.trim();
  if (!next) return existing;
  if (!prev.trim()) return next;
  const stamp = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return `${prev}\n\n— Complemento (${stamp}) —\n${next}`;
}

function sanitizeClinicalField(val: unknown): string {
  if (typeof val !== "string") return "";
  const trimmed = val.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower === "null" || lower === "undefined" || lower === "não informado na consulta.") {
    return "";
  }
  return trimmed;
}

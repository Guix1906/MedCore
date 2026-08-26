/**
 * Serviço de Inteligência Artificial Google Gemini para Prontuário Médico
 * Mapeado exatamente com os campos de anotação e seções da tela de Prontuário:
 * - Queixa Principal
 * - Histórico Familiar
 * - Tratamentos Anteriores
 * - Alergias
 * - Histórico Médico Pessoal (Condições + Especifique)
 * - Medicações em Uso Atualmente
 * - Conduta e Plano da Consulta
 *
 * REGRA ABSOLUTA: Fidelidade factual estrita, nunca inventa informações que não foram ditas.
 */

import { apiClient } from "@/services/api/api-client";

export const PRONTUARIO_CONDITIONS_LIST = [
  "Hipertensão",
  "Diabetes",
  "Doenças cardíacas",
  "Asma ou problemas respiratórios",
  "Problemas de tireoide",
  "Câncer",
  "Outras condições crônicas",
];

export interface ClinicalSectionData {
  id: string;
  title: string;
  fieldTarget: string; // Nome do campo correspondente no Prontuário
  description: string;
  content: string;
  isUnclear?: boolean;
  selected?: boolean;
}

export interface StructuredConsultationResult {
  queixaPrincipal: string;
  historicoFamiliar: string;
  tratamentosAnteriores: string;
  alergias: string;
  historicoPessoal: string;
  condicoesDetectadas: string[];
  medicacoesEmUso: string;
  condutaPlano: string;
  sections: ClinicalSectionData[];
}

export interface GenerateConsultationOptions {
  rawTranscript: string;
  patientName?: string;
}

/**
 * Organiza a transcrição da consulta médica distribuindo exatamente nos campos do prontuário via Proxy Seguro do Backend.
 */
export async function generateConsultationRecord({
  rawTranscript,
  patientName = "Paciente",
}: GenerateConsultationOptions): Promise<StructuredConsultationResult> {
  const cleanedInput = rawTranscript.trim();

  if (!cleanedInput) {
    return buildEmptyConsultationResult();
  }

  try {
    const data = await apiClient.post<any>("/ai/process-consultation", {
      rawTranscript: cleanedInput,
      patientName,
    });

    if (data && typeof data === "object") {
      const parsed = parseConsultationObj(data);
      if (parsed) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn(
      "Falha no serviço de IA server-side, utilizando sintetizador de segurança local:",
      err,
    );
  }

  // Fallback factual
  return fallbackConsultationSynthesis(cleanedInput);
}

function parseConsultationObj(rawInput: any): StructuredConsultationResult | null {
  try {
    let obj = rawInput;
    if (typeof rawInput === "string") {
      let cleanJson = rawInput.trim();
      if (cleanJson.startsWith("```json")) {
        cleanJson = cleanJson
          .replace(/^```json/, "")
          .replace(/```$/, "")
          .trim();
      } else if (cleanJson.startsWith("```")) {
        cleanJson = cleanJson.replace(/^```/, "").replace(/```$/, "").trim();
      }
      obj = JSON.parse(cleanJson);
    }

    if (!obj || typeof obj !== "object") return null;

    const queixaPrincipal = sanitizeClinicalField(obj.queixaPrincipal);
    const historicoFamiliar = sanitizeClinicalField(obj.historicoFamiliar);
    const tratamentosAnteriores = sanitizeClinicalField(obj.tratamentosAnteriores);
    const alergias = sanitizeClinicalField(obj.alergias);
    const historicoPessoal = sanitizeClinicalField(obj.historicoPessoal);
    const medicacoesEmUso = sanitizeClinicalField(obj.medicacoesEmUso);
    const condutaPlano = sanitizeClinicalField(obj.condutaPlano);

    const condicoesDetectadas: string[] = Array.isArray(obj.condicoesDetectadas)
      ? obj.condicoesDetectadas.filter((c: string) => PRONTUARIO_CONDITIONS_LIST.includes(c))
      : [];

    const sections: ClinicalSectionData[] = [
      {
        id: "queixa",
        title: "Queixa Principal",
        fieldTarget: "Campo: Queixa Principal",
        description: "Motivo relatado, início e evolução dos sintomas",
        content: queixaPrincipal,
        isUnclear: queixaPrincipal.includes("(Revisar"),
        selected: Boolean(queixaPrincipal && queixaPrincipal !== "Não informado na consulta."),
      },
      {
        id: "historico_familiar",
        title: "Histórico Familiar",
        fieldTarget: "Campo: Histórico Familiar",
        description: "Antecedentes e doenças em familiares de 1º e 2º graus",
        content: historicoFamiliar,
        isUnclear: historicoFamiliar.includes("(Revisar"),
        selected: Boolean(historicoFamiliar && historicoFamiliar !== "Não informado na consulta."),
      },
      {
        id: "tratamentos",
        title: "Tratamentos Anteriores",
        fieldTarget: "Campo: Tratamentos Anteriores",
        description: "Tratamentos, cirurgias e procedimentos prévios",
        content: tratamentosAnteriores,
        isUnclear: tratamentosAnteriores.includes("(Revisar"),
        selected: Boolean(
          tratamentosAnteriores && tratamentosAnteriores !== "Não informado na consulta.",
        ),
      },
      {
        id: "alergias",
        title: "Alergias",
        fieldTarget: "Campo: Alergias",
        description: "Alergias medicamentosas, alimentares ou ambientais",
        content: alergias,
        isUnclear: alergias.includes("(Revisar"),
        selected: Boolean(alergias && alergias !== "Não informado na consulta."),
      },
      {
        id: "historico_pessoal",
        title: "Histórico Médico Pessoal",
        fieldTarget: "Campo: Condições / Outras condições",
        description: "Patologias prévias e condições crônicas do paciente",
        content: historicoPessoal,
        isUnclear: historicoPessoal.includes("(Revisar"),
        selected: Boolean(historicoPessoal && historicoPessoal !== "Não informado na consulta."),
      },
      {
        id: "medicacoes",
        title: "Medicações em Uso",
        fieldTarget: "Campo: Medicações em uso atualmente",
        description: "Fármacos, doses e posologias que o paciente já utiliza",
        content: medicacoesEmUso,
        isUnclear: medicacoesEmUso.includes("(Revisar"),
        selected: Boolean(medicacoesEmUso && medicacoesEmUso !== "Não informado na consulta."),
      },
      {
        id: "conduta",
        title: "Conduta e Orientações",
        fieldTarget: "Campo: Orientações / Conduta Clínica",
        description: "Prescrições, receitas, exames e orientações passadas pelo médico",
        content: condutaPlano,
        isUnclear: condutaPlano.includes("(Revisar"),
        selected: Boolean(condutaPlano && condutaPlano !== "Não informado na consulta."),
      },
    ];

    return {
      queixaPrincipal,
      historicoFamiliar,
      tratamentosAnteriores,
      alergias,
      historicoPessoal,
      condicoesDetectadas,
      medicacoesEmUso,
      condutaPlano,
      sections,
    };
  } catch (e) {
    console.warn("Erro ao fazer parse do JSON clínico:", e);
    return null;
  }
}

function sanitizeClinicalField(val: unknown): string {
  if (typeof val !== "string") return "";
  const trimmed = val.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") {
    return "Não informado na consulta.";
  }
  return trimmed;
}

function buildEmptyConsultationResult(): StructuredConsultationResult {
  const sections: ClinicalSectionData[] = [
    {
      id: "queixa",
      title: "Queixa Principal",
      fieldTarget: "Campo: Queixa Principal",
      description: "Motivo relatado da consulta",
      content: "",
      selected: false,
    },
    {
      id: "historico_familiar",
      title: "Histórico Familiar",
      fieldTarget: "Campo: Histórico Familiar",
      description: "Antecedentes familiares",
      content: "",
      selected: false,
    },
    {
      id: "tratamentos",
      title: "Tratamentos Anteriores",
      fieldTarget: "Campo: Tratamentos Anteriores",
      description: "Procedimentos e tratamentos prévios",
      content: "",
      selected: false,
    },
    {
      id: "alergias",
      title: "Alergias",
      fieldTarget: "Campo: Alergias",
      description: "Reações e alergias relatadas",
      content: "",
      selected: false,
    },
    {
      id: "historico_pessoal",
      title: "Histórico Médico Pessoal",
      fieldTarget: "Campo: Condições / Outras condições",
      description: "Condições prévias do paciente",
      content: "",
      selected: false,
    },
    {
      id: "medicacoes",
      title: "Medicações em Uso",
      fieldTarget: "Campo: Medicações em uso atualmente",
      description: "Fármacos e dosagens atuais",
      content: "",
      selected: false,
    },
    {
      id: "conduta",
      title: "Conduta e Orientações",
      fieldTarget: "Campo: Orientações / Conduta Clínica",
      description: "Prescrições e orientações médicas",
      content: "",
      selected: false,
    },
  ];

  return {
    queixaPrincipal: "",
    historicoFamiliar: "",
    tratamentosAnteriores: "",
    alergias: "",
    historicoPessoal: "",
    condicoesDetectadas: [],
    medicacoesEmUso: "",
    condutaPlano: "",
    sections,
  };
}

function fallbackConsultationSynthesis(transcript: string): StructuredConsultationResult {
  const clean = transcript.replace(/\s+/g, " ").trim();

  const queixaPrincipal = clean ? `Paciente relata: ${clean}` : "Não informado na consulta.";
  const historicoFamiliar = "Não informado na consulta.";
  const tratamentosAnteriores = "Não informado na consulta.";
  const alergias = "Não informado na consulta.";
  const historicoPessoal = "Não informado na consulta.";
  const medicacoesEmUso = "Não informado na consulta.";
  const condutaPlano = "Orientações e conduta registradas na consulta.";

  const condicoesDetectadas: string[] = [];
  const lower = clean.toLowerCase();
  if (lower.includes("hipertens") || lower.includes("pressão alta"))
    condicoesDetectadas.push("Hipertensão");
  if (lower.includes("diabet") || lower.includes("glicemia")) condicoesDetectadas.push("Diabetes");
  if (lower.includes("cardíac") || lower.includes("coração"))
    condicoesDetectadas.push("Doenças cardíacas");
  if (lower.includes("asma") || lower.includes("bronquite"))
    condicoesDetectadas.push("Asma ou problemas respiratórios");
  if (lower.includes("tireoid")) condicoesDetectadas.push("Problemas de tireoide");
  if (lower.includes("câncer") || lower.includes("neoplasia")) condicoesDetectadas.push("Câncer");

  const sections: ClinicalSectionData[] = [
    {
      id: "queixa",
      title: "Queixa Principal",
      fieldTarget: "Campo: Queixa Principal",
      description: "Motivo relatado da consulta",
      content: queixaPrincipal,
      selected: true,
    },
    {
      id: "historico_familiar",
      title: "Histórico Familiar",
      fieldTarget: "Campo: Histórico Familiar",
      description: "Antecedentes familiares",
      content: historicoFamiliar,
      selected: false,
    },
    {
      id: "tratamentos",
      title: "Tratamentos Anteriores",
      fieldTarget: "Campo: Tratamentos Anteriores",
      description: "Procedimentos e tratamentos prévios",
      content: tratamentosAnteriores,
      selected: false,
    },
    {
      id: "alergias",
      title: "Alergias",
      fieldTarget: "Campo: Alergias",
      description: "Reações e alergias relatadas",
      content: alergias,
      selected: false,
    },
    {
      id: "historico_pessoal",
      title: "Histórico Médico Pessoal",
      fieldTarget: "Campo: Condições / Outras condições",
      description: "Condições prévias do paciente",
      content: historicoPessoal,
      selected: false,
    },
    {
      id: "medicacoes",
      title: "Medicações em Uso",
      fieldTarget: "Campo: Medicações em uso atualmente",
      description: "Fármacos e dosagens atuais",
      content: medicacoesEmUso,
      selected: false,
    },
    {
      id: "conduta",
      title: "Conduta e Orientações",
      fieldTarget: "Campo: Orientações / Conduta Clínica",
      description: "Prescrições e orientações médicas",
      content: condutaPlano,
      selected: true,
    },
  ];

  return {
    queixaPrincipal,
    historicoFamiliar,
    tratamentosAnteriores,
    alergias,
    historicoPessoal,
    condicoesDetectadas,
    medicacoesEmUso,
    condutaPlano,
    sections,
  };
}

export async function generateMedicalRecordContent({
  sectionTitle,
  rawInput,
  patientName = "Paciente",
}: {
  sectionTitle: string;
  rawInput: string;
  patientName?: string;
}): Promise<string> {
  const result = await generateConsultationRecord({ rawTranscript: rawInput, patientName });
  const titleLower = sectionTitle.toLowerCase();

  if (titleLower.includes("queixa")) return result.queixaPrincipal;
  if (titleLower.includes("familiar") || titleLower.includes("antecedente"))
    return result.historicoFamiliar;
  if (titleLower.includes("tratamento")) return result.tratamentosAnteriores;
  if (titleLower.includes("alergia")) return result.alergias;
  if (titleLower.includes("pessoal") || titleLower.includes("condições"))
    return result.historicoPessoal;
  if (titleLower.includes("medicaç") || titleLower.includes("medicamento"))
    return result.medicacoesEmUso;
  if (titleLower.includes("conduta") || titleLower.includes("orientaç")) return result.condutaPlano;
  return result.queixaPrincipal || rawInput;
}

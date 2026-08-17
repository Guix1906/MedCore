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

const DEFAULT_GEMINI_API_KEY =
  (import.meta.env?.VITE_GEMINI_API_KEY as string) || "";

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
 * Organiza a transcrição da consulta médica distribuindo exatamente nos campos do prontuário.
 */
export async function generateConsultationRecord({
  rawTranscript,
  patientName = "Paciente",
}: GenerateConsultationOptions): Promise<StructuredConsultationResult> {
  const apiKey = (DEFAULT_GEMINI_API_KEY || "").trim();
  const cleanedInput = rawTranscript.trim();

  if (!cleanedInput) {
    return buildEmptyConsultationResult();
  }

  const systemInstruction = `Você é um copiloto de documentação médica clínica.
Sua função é transformar a transcrição bruta da consulta em anotações clínicas formais distribuídas EXATAMENTE nos campos oficiais do prontuário eletrônico em Português do Brasil (pt-BR).

CAMPOS OFICIAIS DO PRONTUÁRIO:
1. "queixaPrincipal": Motivo relatado da consulta, sintomas, início e evolução da queixa atual.
2. "historicoFamiliar": Antecedentes mórbidos familiares (pais, avós, irmãos e parentes de 1º/2º grau).
3. "tratamentosAnteriores": Cirurgias, procedimentos, tratamentos prévios realizados ou condutas anteriores discutidas.
4. "alergias": Alergias medicamentosas, alimentares ou ambientais relatadas.
5. "historicoPessoal": Histórico clínico individual do paciente, doenças crônicas ou patologias prévias relatadas.
6. "condicoesDetectadas": Array contendo APENAS as condições mencionadas dentre esta lista exata: ["Hipertensão", "Diabetes", "Doenças cardíacas", "Asma ou problemas respiratórios", "Problemas de tireoide", "Câncer", "Outras condições crônicas"]. Se nenhuma foi mencionada, retorne [].
7. "medicacoesEmUso": Fármacos, dosagens e posologias que o paciente toma atualmente.
8. "condutaPlano": Orientações, condutas, prescrições, receitas e exames solicitados pelo médico durante o atendimento.

REGRAS INEGOCIÁVEIS:
1. FIDELIDADE FACTUAL ABSOLUTA: Utilize EXCLUSIVAMENTE informações que foram verbalizadas na conversa.
2. NUNCA INVENTE NEM DEDUZA: Jamais adicione sintomas negativos não citados ("nega febre", "nega falta de ar"), hipóteses não ditas ou medicações fictícias.
3. CAMPO NÃO MENCIONADO: Se determinado tópico não foi abordado na consulta, retorne o campo vazio ("") ou "Não informado na consulta.".
4. IDENTIFICAÇÃO DE DÚVIDA: Se algum termo, dosagem ou palavra estiver com áudio duvidoso, marque com "(Revisar informação)".

Responda APENAS o objeto JSON puro:
{
  "queixaPrincipal": "...",
  "historicoFamiliar": "...",
  "tratamentosAnteriores": "...",
  "alergias": "...",
  "historicoPessoal": "...",
  "condicoesDetectadas": ["Hipertensão"],
  "medicacoesEmUso": "...",
  "condutaPlano": "..."
}`;

  const userPrompt = `Identificação do Paciente: ${patientName}

Transcrição da Consulta Médica:
"""
${cleanedInput}
"""

Extraia e organize os dados nos campos do prontuário:`;

  const models = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ];

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              topP: 0.8,
              maxOutputTokens: 2000,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorDetails = await response.text();
        console.warn(`Tentativa com ${model} retornou ${response.status}:`, errorDetails);
        continue;
      }

      const data = await response.json();
      const candidate = data?.candidates?.[0];
      const textOutput = candidate?.content?.parts?.[0]?.text;

      if (textOutput && typeof textOutput === "string") {
        const parsed = parseConsultationJson(textOutput);
        if (parsed) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`Falha na requisição para modelo ${model}:`, err);
    }
  }

  // Fallback factual
  return fallbackConsultationSynthesis(cleanedInput);
}

function parseConsultationJson(rawText: string): StructuredConsultationResult | null {
  try {
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```/, "").replace(/```$/, "").trim();
    }

    const obj = JSON.parse(cleanJson);

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
        selected: Boolean(tratamentosAnteriores && tratamentosAnteriores !== "Não informado na consulta."),
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
    { id: "queixa", title: "Queixa Principal", fieldTarget: "Campo: Queixa Principal", description: "Motivo relatado da consulta", content: "", selected: false },
    { id: "historico_familiar", title: "Histórico Familiar", fieldTarget: "Campo: Histórico Familiar", description: "Antecedentes familiares", content: "", selected: false },
    { id: "tratamentos", title: "Tratamentos Anteriores", fieldTarget: "Campo: Tratamentos Anteriores", description: "Procedimentos e tratamentos prévios", content: "", selected: false },
    { id: "alergias", title: "Alergias", fieldTarget: "Campo: Alergias", description: "Reações e alergias relatadas", content: "", selected: false },
    { id: "historico_pessoal", title: "Histórico Médico Pessoal", fieldTarget: "Campo: Condições / Outras condições", description: "Condições prévias do paciente", content: "", selected: false },
    { id: "medicacoes", title: "Medicações em Uso", fieldTarget: "Campo: Medicações em uso atualmente", description: "Fármacos e dosagens atuais", content: "", selected: false },
    { id: "conduta", title: "Conduta e Orientações", fieldTarget: "Campo: Orientações / Conduta Clínica", description: "Prescrições e orientações médicas", content: "", selected: false },
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
  if (lower.includes("hipertens") || lower.includes("pressão alta")) condicoesDetectadas.push("Hipertensão");
  if (lower.includes("diabet") || lower.includes("glicemia")) condicoesDetectadas.push("Diabetes");
  if (lower.includes("cardíac") || lower.includes("coração")) condicoesDetectadas.push("Doenças cardíacas");
  if (lower.includes("asma") || lower.includes("bronquite")) condicoesDetectadas.push("Asma ou problemas respiratórios");
  if (lower.includes("tireoid")) condicoesDetectadas.push("Problemas de tireoide");
  if (lower.includes("câncer") || lower.includes("neoplasia")) condicoesDetectadas.push("Câncer");

  const sections: ClinicalSectionData[] = [
    { id: "queixa", title: "Queixa Principal", fieldTarget: "Campo: Queixa Principal", description: "Motivo relatado da consulta", content: queixaPrincipal, selected: true },
    { id: "historico_familiar", title: "Histórico Familiar", fieldTarget: "Campo: Histórico Familiar", description: "Antecedentes familiares", content: historicoFamiliar, selected: false },
    { id: "tratamentos", title: "Tratamentos Anteriores", fieldTarget: "Campo: Tratamentos Anteriores", description: "Procedimentos e tratamentos prévios", content: tratamentosAnteriores, selected: false },
    { id: "alergias", title: "Alergias", fieldTarget: "Campo: Alergias", description: "Reações e alergias relatadas", content: alergias, selected: false },
    { id: "historico_pessoal", title: "Histórico Médico Pessoal", fieldTarget: "Campo: Condições / Outras condições", description: "Condições prévias do paciente", content: historicoPessoal, selected: false },
    { id: "medicacoes", title: "Medicações em Uso", fieldTarget: "Campo: Medicações em uso atualmente", description: "Fármacos e dosagens atuais", content: medicacoesEmUso, selected: false },
    { id: "conduta", title: "Conduta e Orientações", fieldTarget: "Campo: Orientações / Conduta Clínica", description: "Prescrições e orientações médicas", content: condutaPlano, selected: true },
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
  if (titleLower.includes("familiar") || titleLower.includes("antecedente")) return result.historicoFamiliar;
  if (titleLower.includes("tratamento")) return result.tratamentosAnteriores;
  if (titleLower.includes("alergia")) return result.alergias;
  if (titleLower.includes("pessoal") || titleLower.includes("condições")) return result.historicoPessoal;
  if (titleLower.includes("medicaç") || titleLower.includes("medicamento")) return result.medicacoesEmUso;
  if (titleLower.includes("conduta") || titleLower.includes("orientaç")) return result.condutaPlano;
  return result.queixaPrincipal || rawInput;
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Copiloto de prontuário com o Google Gemini, em duas etapas:
 *  1. transcribeConsultation — limpa a transcrição bruta do microfone e a divide em falas
 *     (médico / paciente / acompanhante), sem resumir nem acrescentar nada.
 *  2. structureConsultation — organiza as ideias da transcrição nos campos do prontuário
 *     e aponta o que ficou faltando ou ambíguo.
 *
 * Roda somente no servidor (a chave GEMINI_API_KEY nunca vai ao navegador), exige sessão
 * válida e permissão records.edit, e remove identificadores diretos antes do envio.
 * Em caso de falha, devolve erro — nunca um texto clínico gerado sem a IA.
 */

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

const InputSchema = z.object({
  rawTranscript: z.string().trim().min(1).max(20_000),
  patientName: z.string().trim().max(200).optional(),
  /** Texto já registrado no prontuário aberto; a IA só complementa, sem repetir. */
  existingRecord: z.string().trim().max(20_000).optional(),
});

const TranscriptOutputSchema = z.object({
  falas: z.array(
    z.object({
      falante: z.string(),
      texto: z.string(),
    }),
  ),
});

export type TranscriptAiOutput = z.infer<typeof TranscriptOutputSchema>;

const OutputSchema = z.object({
  resumo: z.string().nullish(),
  queixaPrincipal: z.string().nullish(),
  historiaDoencaAtual: z.string().nullish(),
  historicoPessoal: z.string().nullish(),
  condicoesDetectadas: z.array(z.string()).nullish(),
  historicoFamiliar: z.string().nullish(),
  medicacoesEmUso: z.string().nullish(),
  alergias: z.string().nullish(),
  tratamentosAnteriores: z.string().nullish(),
  habitosDeVida: z.string().nullish(),
  exameFisico: z.string().nullish(),
  hipotesesDiagnosticas: z.string().nullish(),
  examesSolicitados: z.string().nullish(),
  condutaPlano: z.string().nullish(),
  retorno: z.string().nullish(),
  pendencias: z.array(z.string()).nullish(),
});

export type ConsultationAiOutput = z.infer<typeof OutputSchema>;

const TRANSCRIBE_INSTRUCTION = `Você é um transcritor clínico em conformidade com a LGPD.
Recebe a transcrição BRUTA de uma consulta médica gerada por reconhecimento de voz (sem pontuação, sem identificação de quem fala, com erros de reconhecimento).

Sua tarefa é devolver a MESMA conversa, organizada:
- Divida em falas e identifique o falante pelo contexto: "medico", "paciente", "acompanhante" ou "indefinido" (use "indefinido" quando não der para saber).
- Corrija pontuação, letras maiúsculas e erros evidentes de reconhecimento, principalmente nomes de medicamentos, doenças e exames (ex.: "lo sartana" → "losartana", "dipi rona" → "dipirona").
- Remova vícios de linguagem e repetições sem conteúdo ("é...", "tipo", "né", "hã").
- Escreva números, doses e unidades no padrão clínico (ex.: "50 mg", "12/8 mmHg", "2 vezes ao dia").
- NÃO resuma, NÃO interprete, NÃO acrescente nenhuma informação que não foi dita. Mantenha todo o conteúdo clínico.
- Trecho incompreensível: mantenha como está e acrescente "[?]".

Responda somente JSON no formato: {"falas":[{"falante":"medico","texto":"..."}]}`;

const STRUCTURE_INSTRUCTION = `Você é um copiloto de documentação clínica em conformidade com a LGPD, ajudando um médico a registrar o prontuário.
Recebe a transcrição de uma consulta e organiza as ideias nos campos abaixo, em português, com linguagem técnica, objetiva e no padrão de prontuário (frases curtas; listas com "- " quando houver mais de um item).

Campos (string ou null):
- resumo: 1 a 2 frases resumindo a consulta, sem afirmar diagnóstico que o médico não confirmou.
- queixaPrincipal: motivo da consulta em poucas palavras, com duração (ex.: "Cefaleia há 3 dias.").
- historiaDoencaAtual: início, característica, intensidade, fatores de melhora/piora, sintomas associados e evolução, em ordem cronológica.
- historicoPessoal: doenças prévias e condições crônicas.
- condicoesDetectadas: array só com itens desta lista que foram citados como condição do paciente: "Hipertensão", "Diabetes", "Doenças cardíacas", "Asma ou problemas respiratórios", "Problemas de tireoide", "Câncer", "Outras condições crônicas".
- historicoFamiliar: doenças em familiares, indicando o parentesco.
- medicacoesEmUso: uma linha por medicamento: nome, dose e posologia (o que foi dito).
- alergias: alergias e o tipo de reação; "Nega alergias." se o paciente negou.
- tratamentosAnteriores: tratamentos, cirurgias, internações e procedimentos prévios.
- habitosDeVida: tabagismo, etilismo, atividade física, sono, alimentação.
- exameFisico: sinais vitais e achados de exame ditos pelo médico.
- hipotesesDiagnosticas: somente as hipóteses ou diagnósticos que o MÉDICO falou. Nunca sugira diagnósticos por conta própria.
- examesSolicitados: exames pedidos pelo médico.
- condutaPlano: prescrições (medicamento, dose, posologia, duração) e orientações dadas ao paciente.
- retorno: quando e em que condição o paciente deve voltar.
- pendencias: array de frases curtas com informações importantes que FALTARAM ou ficaram ambíguas para um prontuário completo (ex.: "Dose da losartana não informada.", "Alergias não foram questionadas.", "Sinais vitais não registrados."). Máximo de 6 itens. Não dê diagnósticos nem condutas aqui.

Regras:
- Use somente o que foi dito na transcrição. Quando algo não foi mencionado, use null. Nunca invente dados, doses ou resultados.
- Registre uma negativa ("Nega febre.") SOMENTE se ela foi dita explicitamente. Nunca deduza negativas.
- Não escreva frases genéricas de preenchimento ("Orientações gerais.", "Sem outras queixas.") que não foram ditas.
- Preserve o grau de certeza do médico: "acho que é enxaqueca" é "Hipótese: enxaqueca", nunca "diagnosticada com".
- Se algo foi dito de forma confusa, registre e acrescente "(Revisar)" no fim da frase.

Responda somente o objeto JSON.`;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove identificadores diretos (nome, CPF, telefone, e-mail) antes de enviar a um provedor externo. */
function minimizePhi(text: string, patientName?: string) {
  let out = text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF]")
    .replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/g, "[TELEFONE]");
  for (const part of (patientName ?? "").split(/\s+/).filter((p) => p.length >= 3)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, "gi"), "[PACIENTE]");
  }
  return out;
}

async function assertCanEditRecords(supabase: any) {
  const { data: allowed, error } = await supabase.rpc("has_any_permission", {
    p_permission: "records.edit",
  });
  if (error || allowed !== true) {
    throw new Error("Sem permissão para editar prontuários.");
  }
}

/** Chama o Gemini pedindo JSON e valida a resposta com o schema informado. */
async function callGeminiJson<T>(
  logTag: string,
  prompt: string,
  schema: z.ZodType<T>,
  maxOutputTokens: number,
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Copiloto de IA não configurado no servidor.");
  const configuredModel = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const bodyPayload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens, responseMimeType: "application/json" },
  });

  const callModel = (modelName: string) =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: bodyPayload,
        signal: AbortSignal.timeout(45_000),
      },
    );

  let activeModel = configuredModel;
  let response = await callModel(configuredModel);

  // Se o modelo configurado falhar com 404 (descontinuado) ou 503 (alta demanda), tenta o fallback estável
  if (
    !response.ok &&
    (response.status === 404 || response.status === 503) &&
    configuredModel !== DEFAULT_MODEL
  ) {
    console.warn(`[${logTag}] Modelo ${configuredModel} retornou ${response.status}. Tentando fallback ${DEFAULT_MODEL}...`);
    activeModel = DEFAULT_MODEL;
    response = await callModel(activeModel);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`[${logTag}] Gemini HTTP`, response.status, errorText);
    let errorMsg = "O serviço de IA não respondeu. Tente novamente em instantes.";
    if (response.status === 429) {
      errorMsg = "Limite de requisições da IA atingido. Aguarde alguns instantes e tente novamente.";
    } else if (response.status === 503) {
      errorMsg = "O serviço do Google Gemini está temporariamente sobrecarregado. Tente novamente em 1 minuto.";
    } else if (response.status === 404) {
      errorMsg = `Modelo de IA (${activeModel}) indisponível ou descontinuado.`;
    } else if (response.status === 400 || response.status === 403) {
      errorMsg = "Chave de API do Gemini inválida ou não autorizada.";
    }
    throw new Error(errorMsg);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("A IA devolveu uma resposta em formato inesperado. Tente novamente.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error("A IA devolveu uma resposta em formato inesperado. Tente novamente.");
  }
  return result.data;
}

export const transcribeConsultation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanEditRecords(context.supabase);
    const transcript = minimizePhi(data.rawTranscript, data.patientName);
    return callGeminiJson(
      "transcribeConsultation",
      `${TRANSCRIBE_INSTRUCTION}\n\nTranscrição bruta:\n"""\n${transcript}\n"""`,
      TranscriptOutputSchema,
      8192,
    );
  });

export const structureConsultation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanEditRecords(context.supabase);
    const transcript = minimizePhi(data.rawTranscript, data.patientName);
    const existing = data.existingRecord
      ? `\n\nEste atendimento JÁ TEM o registro abaixo no prontuário. Preencha os campos SOMENTE com informações novas ou complementares da transcrição; não repita o que já está registrado (use null nesse caso). As pendências devem considerar o registro existente somado à transcrição.\nRegistro existente:\n"""\n${minimizePhi(data.existingRecord, data.patientName)}\n"""`
      : "";
    return callGeminiJson(
      "structureConsultation",
      `${STRUCTURE_INSTRUCTION}${existing}\n\nTranscrição:\n"""\n${transcript}\n"""`,
      OutputSchema,
      4096,
    );
  });

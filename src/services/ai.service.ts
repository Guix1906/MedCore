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
  /** Último atendimento registrado, para comparar a evolução. */
  previousRecord: z.string().trim().max(8_000).optional(),
  specialty: z.string().trim().max(40).optional(),
});

/** Foco extra por especialidade (o que a IA deve procurar na transcrição e cobrar nas pendências). */
const SPECIALTY_GUIDANCE: Record<string, string> = {
  clinica_geral: "",
  pediatria:
    "Consulta de PEDIATRIA: registre peso, altura, perímetro cefálico, desenvolvimento neuropsicomotor, vacinação, alimentação/aleitamento e quem acompanha a criança. Doses de medicamentos costumam ser por kg: se o peso não foi dito, inclua nas pendências.",
  dermatologia:
    "Consulta de DERMATOLOGIA: no exame físico descreva lesões (tipo, localização, tamanho, cor, distribuição), fototipo, exposição solar e uso de cosméticos/procedimentos estéticos.",
  ortopedia:
    "Consulta de ORTOPEDIA: registre mecanismo de trauma, lateralidade (direito/esquerdo), amplitude de movimento, força, testes especiais citados, escala de dor e limitação funcional.",
  ginecologia:
    "Consulta de GINECOLOGIA/OBSTETRÍCIA: registre DUM, ciclo menstrual, G/P/A, método contraceptivo, último preventivo e, se gestante, idade gestacional.",
  cardiologia:
    "Consulta de CARDIOLOGIA: registre PA, FC, dor torácica (característica), dispneia (classe funcional), edema, fatores de risco cardiovascular e exames cardiológicos prévios.",
  psiquiatria:
    "Consulta de PSIQUIATRIA/SAÚDE MENTAL: registre humor, sono, apetite, ideação suicida (somente se perguntada), uso de substâncias, adesão a psicofármacos e exame do estado mental descrito.",
  estetica:
    "Consulta de ESTÉTICA: registre área tratada, queixa estética, procedimentos prévios (toxina, preenchedores, lasers) e datas, produto/lote se citado, fototipo e expectativas do paciente.",
};

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
  metaPaciente: z.string().nullish(),
  sintomasPaciente: z.string().nullish(),
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
  prescricoes: z
    .array(
      z.object({
        medicamento: z.string(),
        dose: z.string().nullish(),
        posologia: z.string().nullish(),
        duracao: z.string().nullish(),
        via: z.string().nullish(),
      }),
    )
    .nullish(),
  exames: z.array(z.string()).nullish(),
  cid10: z.array(z.object({ codigo: z.string(), descricao: z.string() })).nullish(),
  orientacoesPaciente: z.string().nullish(),
  alertasAlergia: z.array(z.string()).nullish(),
  mudancasDesdeUltima: z.string().nullish(),
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
- metaPaciente: metas e objetivos clínicos ou pessoais que o paciente expressou verbalmente (ex.: meta de emagrecimento ou perda de peso em kg, redução de medidas, disposição física, controle de ansiedade/compulsão alimentar, melhora de taxas laboratoriais ou qualidade de vida).
- sintomasPaciente: sintomas específicos detalhados relatados pelo paciente (ex.: náuseas, fraqueza, queimação, fadiga crônica, dor de cabeça, constipação, compulsão alimentar, plenitude pós-prandial ou alterações de sono).
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

Campos para documentos (arrays vazios quando não houver):
- prescricoes: array com cada medicamento que o MÉDICO prescreveu nesta consulta: {"medicamento","dose","posologia","duracao","via"}. Só o que foi dito; o que faltar fica null. Não inclua medicações de uso contínuo que o paciente já usava, a menos que o médico as tenha prescrito/renovado.
- exames: array com cada exame solicitado, um por item (ex.: "Hemograma completo").
- cid10: array {"codigo","descricao"} com o código CID-10 mais provável para CADA hipótese ou diagnóstico que o médico falou. Nunca crie CID para algo que o médico não mencionou. Use códigos válidos (ex.: {"codigo":"G43.9","descricao":"Enxaqueca, não especificada"}). Não seja mais específico que o médico: se ele não citou o agente/tipo, use o código "não especificado" (ex.: "amigdalite bacteriana" → J03.9, não J03.0).
- orientacoesPaciente: texto curto em linguagem simples, dirigido ao paciente ("Você deve..."), com as orientações, como tomar os remédios prescritos e quando retornar — somente o que o médico orientou. Sem jargão. null se não houve orientação.
- alertasAlergia: OBRIGATÓRIO checar: compare cada item de prescricoes com as alergias citadas, incluindo nomes comerciais (Novalgina = dipirona, Amoxil = amoxicilina, Voltaren = diclofenaco). Array de alertas quando algum medicamento PRESCRITO tem relação com uma alergia citada (mesmo princípio ativo, sinônimo ou mesma classe; ex.: alergia a dipirona e prescrição de metamizol; alergia a penicilina e prescrição de amoxicilina). Vazio se não houver conflito.
- mudancasDesdeUltima: se houver "Atendimento anterior", 1 a 4 linhas com o que mudou desde ele (sintomas novos/resolvidos, medicações iniciadas/suspensas, resultados). null se não houver atendimento anterior.

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

// ============== ANÁLISE DO PLANO DE ACOMPANHAMENTO ==============

const PlanAnalysisSchema = z.object({
  panorama: z.string(),
  pontosAtencao: z.array(z.string()).max(8),
  proximoRetorno: z.array(z.string()).max(6),
});
export type PlanAnalysis = z.infer<typeof PlanAnalysisSchema>;

const PLAN_INSTRUCTION = `Você é um assistente clínico que resume, para o MÉDICO responsável, a situação de um plano de acompanhamento (ex.: emagrecimento com injetáveis). Leia os dados abaixo e devolva JSON com:
- panorama: 2 a 4 frases em português, objetivas, sobre como o paciente está evoluindo no plano (prazo, peso x meta, adesão às aplicações, regularidade das evoluções e retornos).
- pontosAtencao: até 6 itens curtos com o que merece atenção agora (ex.: retorno atrasado, aplicações perdidas, peso estagnado ou subindo, ausência de registros, protocolo terminando). Lista vazia se nada chamar atenção.
- proximoRetorno: até 5 itens curtos do que avaliar ou registrar no próximo retorno.

Regras:
- Use SOMENTE os dados fornecidos. Nunca invente medidas, doses, sintomas ou resultados.
- Quando faltar dado (ex.: sem peso registrado), diga que falta, sem supor valores.
- Não faça diagnóstico nem prescreva; são sugestões de apoio à decisão do médico.
- Responda somente o objeto JSON.`;

export const analyzeTreatmentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ treatmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCanEditRecords(context.supabase);
    const sb = context.supabase as any;
    const id = data.treatmentId;
    // Leitura com a sessão do usuário (respeita as permissões do banco)
    const [t, evo, meds, uses] = await Promise.all([
      sb.from("treatments").select("*, patients(name)").eq("id", id).maybeSingle(),
      sb
        .from("treatment_evolutions")
        .select("occurred_on, notes, weight_kg, parameters, next_step, is_return")
        .eq("treatment_id", id)
        .order("occurred_on", { ascending: true }),
      sb
        .from("treatment_medications")
        .select("name, dose, unit, route, frequency, period, start_date, status")
        .eq("treatment_id", id),
      sb
        .from("treatment_medication_uses")
        .select("medication_name, dose, used_at")
        .eq("treatment_id", id)
        .order("used_at", { ascending: true }),
    ]);
    if (t.error || !t.data) throw new Error("Plano não encontrado.");
    const plan = t.data;
    const patientName: string | undefined = plan.patients?.name;
    const today = new Date().toISOString().slice(0, 10);

    const lines = [
      `Hoje: ${today}`,
      `Plano: ${plan.title} | status ${plan.status} | início ${plan.start_date} | fim previsto ${plan.end_date ?? "não definido"}`,
      `Objetivo: ${plan.objective ?? "não informado"}`,
      `Próximo retorno previsto: ${plan.next_return_date ?? "não definido"} (intervalo ${plan.return_days ?? "?"} dias)`,
      `Peso inicial: ${plan.initial_weight_kg ?? "não informado"} | meta: ${plan.target_weight_kg ?? "não informada"} | altura: ${plan.height_cm ? `${plan.height_cm} cm` : "não informada"}`,
      `Observações do plano: ${plan.notes ?? "nenhuma"}`,
      "",
      `Evoluções (${evo.data?.length ?? 0}):`,
      ...(evo.data ?? []).map(
        (e: any) =>
          `- ${e.occurred_on}${e.is_return ? " [retorno]" : ""}${e.weight_kg != null ? ` peso ${e.weight_kg} kg` : ""}: ${e.notes ?? ""}${e.parameters ? ` | parâmetros: ${e.parameters}` : ""}${e.next_step ? ` | conduta: ${e.next_step}` : ""}`,
      ),
      "",
      `Prescrições (${meds.data?.length ?? 0}):`,
      ...(meds.data ?? []).map(
        (m: any) =>
          `- ${m.name} ${m.dose ?? ""}${m.unit ?? ""} ${m.route ?? ""} ${m.frequency ?? ""} início ${m.start_date ?? "?"} [${m.status}]`,
      ),
      "",
      `Aplicações registradas (${uses.data?.length ?? 0}; [NÃO TOMOU]/[ADIADA]/[SUSPENSA] = não aplicada):`,
      ...(uses.data ?? []).map((u: any) => `- ${String(u.used_at).slice(0, 10)} ${u.medication_name ?? ""} ${u.dose ?? ""}`),
    ].join("\n");

    return callGeminiJson(
      "analyzeTreatmentPlan",
      `${PLAN_INSTRUCTION}\n\nDados do plano:\n"""\n${minimizePhi(lines.slice(0, 18_000), patientName)}\n"""`,
      PlanAnalysisSchema,
      2048,
    );
  });

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
    const guidance = SPECIALTY_GUIDANCE[data.specialty ?? ""] ?? "";
    const specialty = guidance ? `\n\n${guidance}` : "";
    const previous = data.previousRecord
      ? `\n\nAtendimento anterior deste paciente (somente para comparar a evolução; NÃO copie dados dele para os campos desta consulta):\n"""\n${minimizePhi(data.previousRecord, data.patientName)}\n"""`
      : "";
    return callGeminiJson(
      "structureConsultation",
      `${STRUCTURE_INSTRUCTION}${specialty}${existing}${previous}\n\nTranscrição:\n"""\n${transcript}\n"""`,
      OutputSchema,
      6144,
    );
  });

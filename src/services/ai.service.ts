import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Copiloto de prontuário: estrutura a transcrição da consulta com o Google Gemini.
 *
 * Roda somente no servidor (a chave GEMINI_API_KEY nunca vai ao navegador), exige sessão
 * válida e permissão records.edit, e remove identificadores diretos antes do envio.
 * Em caso de falha, devolve erro — nunca um texto clínico gerado sem a IA.
 */

const InputSchema = z.object({
  rawTranscript: z.string().trim().min(1).max(20_000),
  patientName: z.string().trim().max(200).optional(),
});

const OutputSchema = z.object({
  queixaPrincipal: z.string().nullish(),
  historicoFamiliar: z.string().nullish(),
  tratamentosAnteriores: z.string().nullish(),
  alergias: z.string().nullish(),
  historicoPessoal: z.string().nullish(),
  condicoesDetectadas: z.array(z.string()).nullish(),
  medicacoesEmUso: z.string().nullish(),
  condutaPlano: z.string().nullish(),
});

export type ConsultationAiOutput = z.infer<typeof OutputSchema>;

const INSTRUCTION = [
  "Você é um copiloto de documentação clínica em conformidade com a LGPD.",
  "Transforme a transcrição em um objeto JSON com as chaves: queixaPrincipal, historicoFamiliar,",
  "tratamentosAnteriores, alergias, historicoPessoal, condicoesDetectadas (array), medicacoesEmUso, condutaPlano.",
  "Use somente o que foi dito. Quando algo não foi mencionado, use null. Nunca invente dados.",
].join(" ");

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

export const structureConsultation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permissionError } = await (context.supabase as any).rpc(
      "has_any_permission",
      { p_permission: "records.edit" },
    );
    if (permissionError || allowed !== true) {
      throw new Error("Sem permissão para editar prontuários.");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Copiloto de IA não configurado no servidor.");
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const transcript = minimizePhi(data.rawTranscript, data.patientName);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${INSTRUCTION}\n\nTranscrição:\n"""\n${transcript}\n"""` }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      console.error("[structureConsultation] Gemini HTTP", response.status, await response.text().catch(() => ""));
      throw new Error("O serviço de IA não respondeu. Tente novamente em instantes.");
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
    const result = OutputSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error("A IA devolveu uma resposta em formato inesperado. Tente novamente.");
    }
    return result.data;
  });

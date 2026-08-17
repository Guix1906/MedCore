/**
 * Utilitários de Segurança e Sanitização de Dados para o Medcore
 */

/**
 * Sanitiza sequências de texto removendo tags de script, manipuladores de evento e protocolos perigosos (XSS Prevention)
 */
export function sanitizeInput(input: string | null | undefined): string {
  if (!input) return "";

  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/on\w+\s*=\s*[^>\s]+/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:\s*text\/html/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
}

/**
 * Remove qualquer tag HTML do texto, deixando apenas o conteúdo puramente textual
 */
export function stripHtmlTags(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/<\/?[^>]+(>|$)/g, "").trim();
}

/**
 * Parsing seguro de objetos JSON que previne exceção não tratada e poluição de protótipo
 */
export function safeJSONParse<T>(jsonString: string | null | undefined, fallback: T): T {
  if (!jsonString) return fallback;
  try {
    const parsed = JSON.parse(jsonString);
    if (parsed && typeof parsed === "object") {
      // Previne Prototype Pollution
      delete parsed.__proto__;
      delete parsed.constructor;
      delete parsed.prototype;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Logs a raw database/API error server-side and throws a generic,
 * user-facing message so internal schema details never leak to the client.
 */
export function sanitizeDbError(error: unknown, label: string): never {
  console.error(`[${label}] raw error:`, error);

  // Se for um erro do Supabase ou similar com mensagem útil, repassa ela
  const e = (error ?? {}) as { message?: string; details?: string };
  const message =
    e.message || e.details || "Não foi possível concluir a operação. Tente novamente.";

  throw new Error(message);
}

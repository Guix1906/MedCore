/**
 * Utilitários de data compartilhados entre features.
 * Mantido pequeno e sem dependências — pode ser importado
 * tanto em código de UI quanto em services.
 */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toLocalDateTimeInputValue(d: Date): string {
  return `${toLocalDateInputValue(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Hoje no fuso do navegador ("YYYY-MM-DD"). `toISOString()` vira o dia seguinte após 21h no Brasil. */
export function todayLocal(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toLocalDateInputValue(d);
}

/**
 * Data sem horário do banco ("YYYY-MM-DD") como Date local ao meio-dia.
 * `new Date("2026-10-06")` é meia-noite UTC, que no Brasil ainda é o dia 05.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" → "DD/MM/AAAA" sem deslocamento de fuso. */
export function formatDateOnly(value: string | null | undefined, fallback = "—"): string {
  return parseDateOnly(value)?.toLocaleDateString("pt-BR") ?? fallback;
}

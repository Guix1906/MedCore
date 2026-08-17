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

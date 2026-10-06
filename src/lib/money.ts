/**
 * Converte valor digitado no padrão brasileiro em número.
 * Aceita "600", "600,5", "1.200,00", "1.200", "R$ 1.200,00" e "1200.50".
 * Devolve null quando o texto não é um valor válido.
 */
export function parseMoneyBR(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value ?? "")
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    // Vírgula decimal: os pontos são separadores de milhar.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.200" ou "1.200.000": milhar sem centavos.
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

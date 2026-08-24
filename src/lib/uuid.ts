/**
 * UUID Validation and Safe Formatting Utility
 * Ensures that all identifiers sent to PostgreSQL UUID columns in Supabase are valid UUIDs.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val?: string | null): boolean {
  if (!val || typeof val !== "string") return false;
  return UUID_REGEX.test(val.trim());
}

export function toValidUuid(val?: string | null): string | null {
  if (!val || typeof val !== "string") return null;
  const trimmed = val.trim();
  if (isUuid(trimmed)) return trimmed;

  // Deterministic 128-bit hash to UUID format v4
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  const hex3 = ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0");
  const hex4 = ((h1 + h2) >>> 0).toString(16).padStart(8, "0");

  const full = (hex1 + hex2 + hex3 + hex4).slice(0, 32).padEnd(32, "0");
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-4${full.slice(13, 16)}-a${full.slice(17, 20)}-${full.slice(20, 32)}`;
}

export function ensureValidUuid(val?: string | null, fallback?: string): string {
  const converted = toValidUuid(val);
  if (converted) return converted;
  if (fallback && isUuid(fallback)) return fallback;
  return "00000000-0000-4000-a000-000000000000";
}

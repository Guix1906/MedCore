import type { CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Identidade visual da tela de login de cada cliente (meedcore.vercel.app/<slug>).
 * A plataforma cadastra logo, cores e frase na aba Clientes; o layout é sempre o mesmo.
 */

export type LoginBranding = {
  slug: string | null;
  name: string;
  logoUrl: string | null;
  /** Logo pintada de branco sobre o painel colorido (bom para logos de uma cor). */
  logoWhite: boolean;
  primary: string | null;
  secondary: string | null;
  tagline: string | null;
};

/** Login padrão (consultório Dr. Jonatas Bandeira), usado em /auth. */
export const DEFAULT_BRANDING: LoginBranding = {
  slug: null,
  name: "Dr. Jonatas Bandeira - Nutrologia",
  logoUrl: null,
  logoWhite: true,
  primary: null,
  secondary: null,
  tagline: "Cuidado nutrológico com precisão, do primeiro atendimento ao acompanhamento.",
};

export const LAST_CLINIC_KEY = "medcore:last-clinic";

const HEX = /^#[0-9a-f]{6}$/i;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: any }>;
const callRpc = supabase.rpc.bind(supabase) as unknown as Rpc;

export async function fetchLoginBranding(slug: string): Promise<LoginBranding | null> {
  const { data, error } = await callRpc("get_login_branding", { p_slug: slug });
  if (error) throw error;
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  return {
    slug: s(r.slug),
    name: s(r.name) ?? "Clínica",
    logoUrl: s(r.logo_url),
    logoWhite: r.logo_white !== false,
    primary: s(r.primary),
    secondary: s(r.secondary),
    tagline: s(r.tagline),
  };
}

/** Cores do cliente aplicadas sobre os tokens da tela de login (ver .auth-canvas[data-brand]). */
export function brandingStyle(b: LoginBranding): CSSProperties | undefined {
  if (!b.primary || !HEX.test(b.primary)) return undefined;
  const secondary = b.secondary && HEX.test(b.secondary) ? b.secondary : b.primary;
  return { "--brand": b.primary, "--brand-2": secondary } as CSSProperties;
}

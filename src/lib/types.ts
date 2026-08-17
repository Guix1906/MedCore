import type { ElementType } from "react";

/**
 * Linha genérica vinda do banco (Supabase) quando o shape exato não é
 * conhecido em tempo de compilação (joins dinâmicos, jsonb, etc).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbRow = Record<string, any>;

/** Valor JSON arbitrário (colunas jsonb como new_data/old_data). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

/** Componente de ícone (lucide-react e similares). */
export type IconType = ElementType;

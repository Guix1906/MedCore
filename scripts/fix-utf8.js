import fs from "fs";

const files = {
  "src/features/dashboard/dashboard-utils.ts": `/**
 * Utilitários e formatadores do Dashboard
 */

export const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const fmtBR = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

export function parseMeta(
  desc: string | null | undefined
): { color?: string; status?: string; clientId?: string; type?: string } | null {
  if (!desc) return null;
  const m = desc.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}
`,
  "src/features/acompanhamentos/types.ts": `/**
 * Tipos e Interfaces do Módulo de Acompanhamentos e Tratamentos
 */

export type TreatmentStatus = "em_andamento" | "pausado" | "finalizado" | "cancelado";

export type Treatment = {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  title: string;
  objective: string | null;
  start_date: string;
  end_date: string | null;
  status: TreatmentStatus;
  total_value: number;
  down_payment: number;
  discount: number;
  installments_count: number;
  payment_method: string | null;
  first_due_date: string | null;
  patient?: { name: string; phone?: string | null; email?: string | null } | null;
  doctor?: { name: string } | null;
  phases?: TreatmentPhase[];
  created_at: string;
};

export type TreatmentPhase = {
  id: string;
  treatment_id: string;
  title: string;
  order_index: number;
  status: "pendente" | "em_andamento" | "concluida";
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
};

export type TreatmentMedication = {
  id: string;
  treatment_id: string;
  name: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  status: "active" | "completed" | "suspended";
};
`,
  "src/features/acompanhamentos/acompanhamentos-utils.ts": `import type { TreatmentStatus } from "./types";

export const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const STATUS_MAP: Record<TreatmentStatus, { label: string; bg: string; text: string; border: string }> = {
  em_andamento: {
    label: "Em Andamento",
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
    border: "border-emerald-500/20",
  },
  pausado: {
    label: "Pausado",
    bg: "bg-amber-500/10",
    text: "text-amber-500",
    border: "border-amber-500/20",
  },
  finalizado: {
    label: "Finalizado",
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    border: "border-blue-500/20",
  },
  cancelado: {
    label: "Cancelado",
    bg: "bg-rose-500/10",
    text: "text-rose-500",
    border: "border-rose-500/20",
  },
};
`,
  "src/components/agenda/novo-agendamento/novo-agendamento-tokens.ts": `/**
 * Design tokens para o modal de novo agendamento
 */
export const GREEN = {
  grad: "bg-primary",
  gradSoft: "bg-primary/15",
  text: "text-primary",
  border: "border-primary/30",
  ring: "focus-visible:ring-primary/40",
  badge: "bg-primary/10 text-primary border-primary/20",
  glow: "shadow-[0_0_24px_-4px_rgba(132,204,22,0.25)]",
};

export const COLOR_OPTIONS = [
  { label: "Verde Lima", value: "#84cc16", className: "bg-[#84cc16]" },
  { label: "Esmeralda", value: "#10b981", className: "bg-[#10b981]" },
  { label: "Ciano", value: "#06b6d4", className: "bg-[#06b6d4]" },
  { label: "Azul", value: "#3b82f6", className: "bg-[#3b82f6]" },
  { label: "Âmbar", value: "#f59e0b", className: "bg-[#f59e0b]" },
  { label: "Rosa", value: "#ec4899", className: "bg-[#ec4899]" },
];
`,
  "src/types/financial.ts": `import { z } from "zod";

/**
 * Vocabulário Canônico do Módulo Financeiro (MedCore)
 */
export enum FinancialType {
  RECEITA = "receita",
  DESPESA = "despesa",
}

export enum FinancialStatus {
  PAGO = "pago",
  PENDENTE = "pendente",
  VENCIDO = "vencido",
  CANCELADO = "cancelado",
}

export const FinancialTypeSchema = z.enum(["receita", "despesa"]);
export const FinancialStatusSchema = z.enum(["pago", "pendente", "vencido", "cancelado"]);

export function normalizeFinancialType(type: string | null | undefined): FinancialType {
  const t = (type || "").toLowerCase().trim();
  if (t === "income" || t === "receita") return FinancialType.RECEITA;
  if (t === "expense" || t === "despesa") return FinancialType.DESPESA;
  return FinancialType.RECEITA;
}

export function normalizeFinancialStatus(status: string | null | undefined): FinancialStatus {
  const s = (status || "").toLowerCase().trim();
  if (s === "completed" || s === "pago" || s === "concluido") return FinancialStatus.PAGO;
  if (s === "pending" || s === "pendente") return FinancialStatus.PENDENTE;
  if (s === "overdue" || s === "vencido") return FinancialStatus.VENCIDO;
  if (s === "canceled" || s === "cancelado") return FinancialStatus.CANCELADO;
  return FinancialStatus.PENDENTE;
}

export const TransactionSchema = z.object({
  id: z.string(),
  company_id: z.string().optional().nullable(),
  patient_id: z.string().optional().nullable(),
  doctor_id: z.string().optional().nullable(),
  appointment_id: z.string().optional().nullable(),
  category_id: z.string().optional().nullable(),
  account_id: z.string().optional().nullable(),
  type: z.string().transform(normalizeFinancialType),
  status: z.string().transform(normalizeFinancialStatus),
  description: z.string().default(""),
  amount: z.coerce.number().default(0),
  date: z.string(),
  due_date: z.string().optional().nullable(),
  payment_method: z.string().optional().nullable(),
  created_at: z.string().optional().nullable(),
  updated_at: z.string().optional().nullable(),
});

export type CanonicalTransaction = z.infer<typeof TransactionSchema>;
`
};

for (const [p, content] of Object.entries(files)) {
  fs.writeFileSync(p, content, "utf8");
  console.log("Written utf8:", p);
}
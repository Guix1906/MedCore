import { z } from "zod";

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

/**
 * Adaptador bidirecional de compatibilidade para tipos legados.
 */
export function normalizeFinancialType(type: string | null | undefined): FinancialType {
  const t = (type || "").toLowerCase().trim();
  if (t === "income" || t === "receita") return FinancialType.RECEITA;
  if (t === "expense" || t === "despesa") return FinancialType.DESPESA;
  return FinancialType.RECEITA;
}

/**
 * Adaptador bidirecional de compatibilidade para status legados.
 */
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

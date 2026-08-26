import type { TreatmentStatus } from "./types";

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

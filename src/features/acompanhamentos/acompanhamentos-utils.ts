import type { TreatmentStatus } from "./types";

export const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const STATUS_MAP: Record<
  TreatmentStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  em_andamento: {
    label: "Em Andamento",
    bg: "bg-success/10",
    text: "text-success",
    border: "border-success/20",
  },
  pausado: {
    label: "Pausado",
    bg: "bg-warning/10",
    text: "text-warning",
    border: "border-warning/20",
  },
  finalizado: {
    label: "Finalizado",
    bg: "bg-info/10",
    text: "text-info",
    border: "border-info/20",
  },
  cancelado: {
    label: "Cancelado",
    bg: "bg-destructive/10",
    text: "text-destructive",
    border: "border-destructive/20",
  },
};

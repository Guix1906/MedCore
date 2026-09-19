export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatClinicalDate(value: string | null): string {
  return value ? value.slice(0, 10).split("-").reverse().join("/") : "Sem data";
}

export function protocolDeadline(status: string, endDate: string | null, today = localDate()) {
  if (status === "finalizado") return "Plano concluído";
  if (status === "cancelado") return "Cancelado";
  if (!endDate) return "Sem prazo";
  if (endDate < today) return "Protocolo vencido";
  if (endDate === today) return "Protocolo vence hoje";
  const soon = new Date(`${today}T12:00:00`);
  soon.setDate(soon.getDate() + 7);
  return endDate <= localDate(soon) ? "Protocolo a vencer" : "Dentro do prazo";
}

export const PAYMENT_METHODS = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  boleto: "Boleto",
  transferencia: "Transferência",
  convenio: "Convênio",
};
export const currency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function moneyCents(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error("Informe valores positivos com até duas casas decimais.");
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents > 999999999999)
    throw new Error("Valor acima do limite permitido.");
  return cents;
}

export function paymentPreview(total: string, discount: string, down: string, count: number) {
  const totalCents = moneyCents(total);
  const discountCents = moneyCents(discount);
  const downCents = moneyCents(down);
  const balance = totalCents - discountCents - downCents;
  if (totalCents <= 0 || balance < 0)
    throw new Error("Entrada e desconto não podem ultrapassar o valor total.");
  if (!Number.isInteger(count) || count < 1 || count > 120 || (balance > 0 && balance < count)) {
    throw new Error("Informe de 1 a 120 parcelas, com pelo menos R$ 0,01 por parcela.");
  }
  const parts =
    balance === 0
      ? []
      : Array.from(
          { length: count },
          (_, i) => (Math.floor(balance / count) + (i < balance % count ? 1 : 0)) / 100,
        );
  return {
    total: totalCents / 100,
    discount: discountCents / 100,
    down: downCents / 100,
    balance: balance / 100,
    parts,
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "Não foi possível concluir a operação. Tente novamente.";
}

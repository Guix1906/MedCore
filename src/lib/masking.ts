/**
 * Utilitários para Proteção e Mascaramento de Dados Pessoais (LGPD)
 */

/**
 * Mascara um CPF para proteção visual (Exemplo: 123.***.***-45)
 */
export function formatMaskedCPF(cpf: string | null | undefined): string {
  if (!cpf) return "Não informado";
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return cpf;
  return `${clean.slice(0, 3)}.***.***-${clean.slice(9)}`;
}

/**
 * Mascara um número de telefone (Exemplo: (99) 9****-8934)
 */
export function formatMaskedPhone(phone: string | null | undefined): string {
  if (!phone) return "Não informado";
  const clean = phone.replace(/\D/g, "");
  if (clean.length < 10) return phone;
  const ddd = clean.slice(0, 2);
  const last4 = clean.slice(-4);
  return `(${ddd}) 9****-${last4}`;
}

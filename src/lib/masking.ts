/**
 * Utilitários para Proteção, Validação e Mascaramento de Dados Pessoais (LGPD)
 */

/**
 * Valida um CPF brasileiro de acordo com o algoritmo oficial dos dígitos verificadores (módulo 11).
 */
export function isValidCPF(cpf: string | null | undefined): boolean {
  if (!cpf) return false;
  const clean = cpf.replace(/\D/g, "");

  // Deve conter exatamente 11 dígitos
  if (clean.length !== 11) return false;

  // Rejeita números com todos os dígitos iguais (ex: 000.000.000-00, 111.111.111-11, etc.)
  if (/^(\d)\1{10}$/.test(clean)) return false;

  // Validação do 1º dígito verificador
  let sum1 = 0;
  for (let i = 0; i < 9; i++) {
    sum1 += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let remainder1 = (sum1 * 10) % 11;
  if (remainder1 === 10 || remainder1 === 11) remainder1 = 0;
  if (remainder1 !== parseInt(clean.charAt(9), 10)) return false;

  // Validação do 2º dígito verificador
  let sum2 = 0;
  for (let i = 0; i < 10; i++) {
    sum2 += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  let remainder2 = (sum2 * 10) % 11;
  if (remainder2 === 10 || remainder2 === 11) remainder2 = 0;
  if (remainder2 !== parseInt(clean.charAt(10), 10)) return false;

  return true;
}

/**
 * Formata um CPF no padrão 000.000.000-00 à medida que o usuário digita.
 */
export function formatCPF(value: string | null | undefined): string {
  if (!value) return "";
  const clean = value.replace(/\D/g, "").slice(0, 11);
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}.${clean.slice(3)}`;
  if (clean.length <= 9) return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

/**
 * Formata um telefone ou WhatsApp no padrão brasileiro (00) 00000-0000.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const clean = value.replace(/\D/g, "").slice(0, 11);
  if (clean.length <= 2) return clean;
  if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
  if (clean.length <= 10) return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7, 11)}`;
}

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

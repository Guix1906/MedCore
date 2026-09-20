import { validDate } from "./operations-math";
import { cents } from "./finance-math";
import type { StatementLine } from "./operations-schema";

function decodeValue(value: string) {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
      if (entity.startsWith("#")) {
        const hex = entity[1].toLowerCase() === "x";
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          throw new Error("Entidade inválida no OFX.");
        return String.fromCodePoint(code);
      }
      const values: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      return values[entity.toLowerCase()];
    })
    .trim();
}
function tag(block: string, name: string, required = true) {
  const matches = [...block.matchAll(new RegExp(`<${name}\\s*>([^<]*)`, "gi"))];
  if (matches.length > 1 || (required && (!matches.length || !matches[0][1].trim())))
    throw new Error(`Campo ${name} ausente ou repetido no OFX.`);
  return matches.length ? decodeValue(matches[0][1]) : "";
}
export function parseStatementOfx(text: string): {
  account: string;
  bank: string;
  currency: string;
  lines: StatementLine[];
} {
  if (text.length > 2_000_000) throw new Error("Arquivo acima de 2 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Declarações externas não são permitidas no OFX.");
  if (!/<OFX\s*>/i.test(text) || !/<\/OFX\s*>\s*$/i.test(text))
    throw new Error("Arquivo OFX incompleto ou inválido.");
  const statements = [...text.matchAll(/<(STMTRS|CCSTMTRS)\s*>([\s\S]*?)<\/\1\s*>/gi)];
  if (statements.length !== 1 || (text.match(/<(?:STMTRS|CCSTMTRS)\s*>/gi) ?? []).length !== 1)
    throw new Error("Importe um extrato de uma única conta por arquivo.");
  for (const [, status] of text.matchAll(/<STATUS\s*>([\s\S]*?)<\/STATUS\s*>/gi)) {
    if (tag(status, "CODE") !== "0")
      throw new Error("O banco informou erro no arquivo OFX. Exporte novamente o extrato.");
  }
  const statement = statements[0][2];
  const currency = tag(statement, "CURDEF").toUpperCase();
  if (currency !== "BRL")
    throw new Error(
      "O financeiro aceita somente extratos em BRL. Não há conversão automática de moeda.",
    );
  const account = tag(statement, "ACCTID");
  const bank = tag(statement, "BANKID", false);
  const blocks = [...statement.matchAll(/<STMTTRN\s*>([\s\S]*?)<\/STMTTRN\s*>/gi)];
  if (blocks.length !== (statement.match(/<STMTTRN\s*>/gi) ?? []).length)
    throw new Error("Movimento incompleto no OFX.");
  if (blocks.length < 1 || blocks.length > 1000)
    throw new Error("Importe de 1 a 1000 movimentos por arquivo.");
  const ids = new Set<string>();
  const lines = blocks.map(([, block], index) => {
    const external_id = tag(block, "FITID");
    const posted = tag(block, "DTPOSTED");
    const raw = tag(block, "TRNAMT");
    const date = `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}`;
    if (
      !/^\d{8}(?:\d{6}(?:\.\d+)?)?(?:\[[+-]?\d+(?:\.\d+)?(?::[^\]\r\n]+)?\])?$/.test(posted) ||
      !validDate(date)
    )
      throw new Error(`Data inválida no movimento ${index + 1}.`);
    if (
      posted.length >= 14 &&
      /^\d{14}/.test(posted) &&
      (Number(posted.slice(8, 10)) > 23 ||
        Number(posted.slice(10, 12)) > 59 ||
        Number(posted.slice(12, 14)) > 59)
    )
      throw new Error(`Horário inválido no movimento ${index + 1}.`);
    if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw))
      throw new Error(`Valor inválido no movimento ${index + 1}.`);
    const amount = Number(raw);
    if (!Number.isFinite(amount) || Math.abs(amount) > 999999999999.99 || cents(amount) === 0)
      throw new Error(`Valor inválido no movimento ${index + 1}.`);
    if (external_id.length > 200 || ids.has(external_id))
      throw new Error(`FITID repetido ou inválido no movimento ${index + 1}.`);
    ids.add(external_id);
    const description =
      [tag(block, "NAME", false), tag(block, "MEMO", false)].filter(Boolean).join(" · ") ||
      tag(block, "TRNTYPE");
    return { external_id, date, amount, description };
  });
  return { account, bank, currency, lines };
}
export async function readOfxFile(file: File) {
  if (file.size > 2_000_000) throw new Error("Selecione um OFX de até 2 MB.");
  const bytes = await file.arrayBuffer();
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 1024));
  const charset = header.match(/CHARSET\s*:\s*([^\s]+)/i)?.[1];
  const declared =
    header.match(/encoding=["']([^"']+)["']/i)?.[1] ??
    (charset && charset.toUpperCase() !== "NONE"
      ? charset
      : header.match(/ENCODING\s*:\s*([^\s]+)/i)?.[1]);
  const encoding =
    declared && /^(1252|windows-1252|iso-8859-1|latin1)$/i.test(declared)
      ? "windows-1252"
      : declared && /^(utf-8|utf8|65001|unicode)$/i.test(declared)
        ? "utf-8"
        : !declared || /^usascii$/i.test(declared)
          ? "utf-8"
          : null;
  if (!encoding)
    throw new Error(
      `Codificação OFX não suportada: ${declared}. Exporte em UTF-8 ou Windows-1252.`,
    );
  return parseStatementOfx(new TextDecoder(encoding, { fatal: true }).decode(bytes));
}

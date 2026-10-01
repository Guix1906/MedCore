/**
 * Impressão de documentos clínicos (receita, pedido de exames, orientações) em uma janela
 * própria, com cabeçalho do paciente e linha de assinatura.
 */

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printClinicalDocument({
  title,
  patientName,
  body,
}: {
  title: string;
  patientName?: string;
  body: string;
}) {
  const win = window.open("", "_blank", "width=820,height=1000");
  if (!win) return false;
  const date = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  win.document.write(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: 13pt; line-height: 1.6; margin: 0; }
  h1 { font-size: 17pt; letter-spacing: .08em; text-transform: uppercase; text-align: center; margin: 0 0 18px; }
  .meta { display: flex; justify-content: space-between; border-bottom: 1px solid #999; padding-bottom: 8px; margin-bottom: 22px; font-size: 11.5pt; }
  .body { white-space: pre-wrap; min-height: 420px; }
  .sign { margin-top: 70px; text-align: center; }
  .sign .line { border-top: 1px solid #333; width: 300px; margin: 0 auto 4px; }
  .sign small { color: #555; }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta"><span><strong>Paciente:</strong> ${escapeHtml(patientName || "______________________")}</span><span>${date}</span></div>
  <div class="body">${escapeHtml(body)}</div>
  <div class="sign"><div class="line"></div><small>Assinatura e carimbo do médico (CRM)</small></div>
  <script>window.onload = function(){ window.focus(); window.print(); };</script>
</body></html>`);
  win.document.close();
  return true;
}

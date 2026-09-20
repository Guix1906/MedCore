export function exportFinanceCsv(filename: string, rows: (string | number | null)[][]) {
  const text = rows
    .map((row) =>
      row
        .map((value) => {
          const raw = value === null ? "Pendente" : String(value);
          const safe = typeof value === "string" && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(";"),
    )
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

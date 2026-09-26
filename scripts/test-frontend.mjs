import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const cache = new Map();
function load(relative) {
  const path = resolve(root, relative);
  if (cache.has(path)) return cache.get(path).exports;
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = new Module(path);
  cache.set(path, module);
  module.require = (id) => {
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const absolute = id.startsWith("@/")
      ? resolve(root, "src", id.slice(2))
      : resolve(dirname(path), id);
    const candidate = [
      absolute,
      absolute + ".ts",
      absolute + ".tsx",
      resolve(absolute, "index.ts"),
    ].find(existsSync);
    if (!candidate) throw new Error(`Missing module: ${id}`);
    return load(candidate);
  };
  module._compile(output, path);
  return module.exports;
}

const { patientAge, patientProfileData } = load("src/lib/patient-display.ts");
const today = new Date(2026, 8, 26, 12);
assert.equal(patientAge("1990-09-26", today), 36);
assert.equal(patientAge("1990-09-27", today), 35);
assert.equal(patientAge("2026-09-26", today), 0);
assert.equal(patientAge("2024-02-29", today), 2);
for (const value of [undefined, null, "", "invalid", "1990-02-30", "2026-09-27", "2023-02-29"])
  assert.equal(patientAge(value, today), null);
const profile = patientProfileData({
  id: "fixture",
  name: "Paciente de teste",
  birth_date: null,
  gender: null,
  created_at: "2026-01-01T12:00:00Z",
  active: true,
});
assert.equal(profile.age, null);
assert.equal(profile.gender, null);
assert.equal(profile.birth_date, null);
assert.doesNotMatch(JSON.stringify(profile), /Clara|Feminino|34 anos|unsplash/);

const { shiftAgendaDate } = load("src/components/agenda/agenda-types.ts");
const jan = new Date(2026, 0, 31, 10, 45);
const feb = shiftAgendaDate(jan, "mes", 1);
assert.equal(feb.getMonth(), 1);
assert.equal(feb.getDate(), 28);
assert.equal(feb.getHours(), 10);
assert.equal(feb.getMinutes(), 45);
assert.equal(jan.getMonth(), 0, "navigation must not mutate the original date");
assert.equal(shiftAgendaDate(new Date(2024, 0, 31), "mes", 1).getDate(), 29);
assert.equal(shiftAgendaDate(new Date(2026, 0, 15), "mes", -1).getFullYear(), 2025);
assert.equal(shiftAgendaDate(new Date(2026, 8, 26), "semana", 1).getDate(), 3);
assert.equal(shiftAgendaDate(today, "dia", -1).getDate(), 25);
assert.equal(shiftAgendaDate(today, "lista", 1).getDate(), 27);

const { summarizeAgenda, overviewRange } = load("src/features/visao-geral/overview-utils.ts");
const event = (id, date, status, professional = "doctor-a", extra = {}) => ({
  id,
  source: "event",
  kind: "evento",
  start: new Date(date),
  end: null,
  title: id,
  description: status ? `<!--AGENDAMENTO_META:${JSON.stringify({ status })}-->` : null,
  assignedTo: professional,
  status: null,
  ...extra,
});
const fixtures = [
  event("one", "2026-09-01T09:00:00", "confirmado"),
  event("two", "2026-09-26T10:00:00", "completed"),
  event("three", "2026-09-30T23:59:59", "cancelado", "doctor-b"),
  event("unknown", "2026-09-26T11:00:00", null, null),
  event("outside", "2026-10-01T00:00:00", "confirmado"),
  event("task", "2026-09-26T09:00:00", "todo", null, { source: "task", kind: "tarefa" }),
  event("holiday", "2026-09-07T00:00:00", null, null, { kind: "feriado" }),
];
const summary = summarizeAgenda(fixtures, today, "mes");
assert.equal(summary.total, 4);
assert.equal(summary.statusCounts.get("Confirmado"), 1);
assert.equal(summary.statusCounts.get("Concluído"), 1);
assert.equal(summary.statusCounts.get("Cancelado"), 1);
assert.equal(summary.statusCounts.get("Não informado"), 1);
assert.equal(summary.buckets.length, 30);
assert.equal(
  summary.buckets.reduce((sum, item) => sum + item.count, 0),
  summary.total,
);
assert.equal(
  summary.weekDays.reduce((sum, item) => sum + item.count, 0),
  summary.total,
);
assert.equal(
  Array.from(summary.professionals.values()).reduce((a, b) => a + b, 0),
  summary.total,
);
assert.equal(summarizeAgenda(fixtures, today, "mes", "doctor-a").total, 2);
assert.equal(summarizeAgenda(fixtures, today, "mes", "doctor-b", "Confirmado").total, 0);
assert.equal(summarizeAgenda(fixtures, today, "mes", "todos", "Cancelado").total, 1);
assert.equal(summarizeAgenda([], today, "mes").total, 0);
assert.ok(summarizeAgenda([], today, "ano").buckets.every((bucket) => bucket.count === 0));
const range = overviewRange(new Date(2026, 8, 1), "semana");
assert.equal(range.start.getDay(), 0);
assert.equal(range.start.getDate(), 30);
assert.equal(range.start.getMonth(), 7);
assert.equal(range.end.getDay(), 6);
assert.equal(summarizeAgenda(fixtures, today, "ano").buckets.length, 12);

const { baseChartOptions } = load("src/components/ds/Chart.tsx");
const chart = baseChartOptions({
  chart: { id: "fixture" },
  xaxis: { categories: ["A", "B"] },
  tooltip: { shared: true },
});
const { FONT_STACK } = load("src/lib/fonts.ts");
assert.match(FONT_STACK, /^-apple-system.*Inter/);
assert.equal(chart.chart.fontFamily, FONT_STACK);
assert.equal(chart.chart.toolbar.show, false);
assert.equal(chart.xaxis.labels.style.fontSize, "12px");
assert.equal(chart.tooltip.style.fontFamily, FONT_STACK);
assert.equal(chart.tooltip.shared, true);
assert.deepEqual(baseChartOptions({ yaxis: [{ min: 0 }, { opposite: true }] }).yaxis, [
  { min: 0 },
  { opposite: true },
]);

const { PageHeader } = load("src/components/ui-app/PageHeader.tsx");
const { EmptyState } = load("src/components/ui-app/EmptyState.tsx");
const { Input } = load("src/components/ui/input.tsx");
const { Button } = load("src/components/ui/button.tsx");
const header = renderToStaticMarkup(
  React.createElement(PageHeader, {
    title: "Pacientes",
    description: "Histórico e contatos",
    actions: React.createElement(Button, {}, "Novo paciente"),
  }),
);
assert.equal((header.match(/<h1/g) ?? []).length, 1);
assert.match(header, /Histórico e contatos/);
assert.match(header, /flex-wrap/);
assert.match(
  renderToStaticMarkup(React.createElement(Input, { "aria-label": "Nome" })),
  /aria-label="Nome"/,
);
assert.match(
  renderToStaticMarkup(
    React.createElement(EmptyState, { title: "Sem dados", description: "Ajuste os filtros" }),
  ),
  /Ajuste os filtros/,
);

const css = readFileSync(resolve(root, "src/styles.css"), "utf8");
const color = (name) => {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  assert.ok(value, name);
  return value;
};
const luminance = (hex) => {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
for (const token of [
  "foreground",
  "muted-foreground",
  "primary",
  "success",
  "warning",
  "destructive",
])
  assert.ok(contrast(color(token), color("card")) >= 4.5, `${token} needs WCAG AA contrast`);
assert.ok(contrast(color("primary"), color("primary-foreground")) >= 4.5);
assert.match(css, /:focus-visible\s*\{[^}]*outline: 2px solid var\(--ring\)/);
assert.doesNotMatch(css, /outline:\s*none\s*!important/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /left: var\(--app-sidebar-width\)/);
assert.ok(existsSync(resolve(root, "public/assets/medcore-symbol-transparent.png")));
assert.match(css, /--font-sans:[^;]*-apple-system[^;]*"Inter"/);
assert.match(css, /--glass-bg:\s*rgb\(/);
assert.match(css, /--glass-filter:\s*saturate\(180%\) blur\(20px\)/);
assert.match(css, /@supports not \(\(backdrop-filter/);
assert.match(css, /prefers-reduced-transparency:\s*reduce[^{]*\{[^}]*--glass-filter:\s*none/);
for (const layer of ["header", "sheet", "dialog", "popover", "tooltip", "alert", "select"])
  assert.match(css, new RegExp("--z-" + layer + ":\\s*\\d+"), "z-index layer " + layer);

const { groupSearchRows, matchSearchPages, normalizeSearch } = load("src/lib/global-search.ts");
assert.equal(normalizeSearch("  Relatórios "), "relatorios");
const pages = [
  { to: "/agenda", label: "Agenda" },
  { to: "/visao-geral", label: "Indicadores da agenda" },
  { to: "/relatorios", label: "Relatórios" },
  { to: "/configuracoes", label: "Configurações" },
];
const pageTargets = (term) => matchSearchPages(pages, term).map((page) => page.to);
assert.deepEqual(pageTargets("agen"), ["/agenda", "/visao-geral"]);
assert.deepEqual(pageTargets("relat"), ["/relatorios"]);
assert.deepEqual(pageTargets("CONFIGURAÇÕES"), ["/configuracoes"]);
assert.deepEqual(pageTargets("ana"), []);
assert.deepEqual(pageTargets("   "), []);
assert.deepEqual(
  groupSearchRows([
    { kind: "patient", id: "1" },
    { kind: "treatment", id: "2" },
    { kind: "patient", id: "3" },
  ]).map((group) => [group.kind, group.rows.map((row) => row.id)]),
  [
    ["patient", ["1", "3"]],
    ["treatment", ["2"]],
  ],
);

const { groupByDay, formatNotificationTime } = load("src/lib/notification-groups.ts");
const notificationGroups = groupByDay(
  [
    { id: "a", created_at: "2026-09-26T08:00:00" },
    { id: "b", created_at: "2026-09-25T23:59:00" },
    { id: "c", created_at: "2026-09-20T10:00:00" },
    { id: "d", created_at: "invalid" },
    { id: "e", created_at: "2026-09-26T00:00:00" },
  ],
  today,
);
assert.deepEqual(
  notificationGroups.map((group) => [group.label, group.items.map((item) => item.id)]),
  [
    ["Hoje", ["a", "e"]],
    ["Ontem", ["b"]],
    ["Anteriores", ["c", "d"]],
  ],
);
assert.deepEqual(groupByDay([], today), []);
assert.equal(formatNotificationTime("invalid", "today"), "");

const { SegmentedControl } = load("src/components/ui-app/SegmentedControl.tsx");
const segmented = renderToStaticMarkup(
  React.createElement(SegmentedControl, {
    value: "todas",
    onChange: () => {},
    "aria-label": "Filtrar notificações",
    options: [
      { value: "nao_lidas", label: "Não lidas" },
      { value: "todas", label: "Todas" },
    ],
  }),
);
assert.match(segmented, /role="group"/);
assert.match(segmented, /aria-label="Filtrar notificações"/);
assert.equal((segmented.match(/aria-pressed="true"/g) ?? []).length, 1);
assert.match(segmented, /aria-pressed="true"[^>]*>Todas</);

// Modo escuro: mesmos tokens em .dark, texto e status com contraste AA sobre --card.
const darkBlock = css.match(/\n\.dark\s*\{([^}]*)\}/)?.[1];
assert.ok(darkBlock, "dark theme block");
const darkColor = (name) => {
  const value = darkBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  assert.ok(value, `dark ${name}`);
  return value;
};
for (const token of [
  "foreground",
  "muted-foreground",
  "primary",
  "success",
  "warning",
  "destructive",
])
  assert.ok(
    contrast(darkColor(token), darkColor("card")) >= 4.5,
    `dark ${token} needs WCAG AA contrast`,
  );
// Botões preenchidos com texto branco no escuro: mínimo de 3:1 (mesmo patamar do macOS).
for (const token of ["primary", "success", "warning", "destructive"])
  assert.ok(contrast(darkColor(token), "#ffffff") >= 3, `dark ${token} with white text`);
assert.match(css, /\.dark\s*\{[^}]*--glass-bg:\s*rgb\(/);
assert.match(css, /@theme static\s*\{[^}]*--shadow-lg:/);

const { resolveTheme, isThemePreference, THEME_INIT_SCRIPT, DEFAULT_THEME } =
  load("src/lib/theme.ts");
assert.equal(DEFAULT_THEME, "light");
assert.equal(resolveTheme("light", true), "light");
assert.equal(resolveTheme("dark", false), "dark");
assert.equal(resolveTheme("system", true), "dark");
assert.equal(resolveTheme("system", false), "light");
assert.ok(isThemePreference("system") && !isThemePreference("sepia") && !isThemePreference(null));
assert.match(THEME_INIT_SCRIPT, /medcore:theme/);
assert.doesNotThrow(() => new Function(THEME_INIT_SCRIPT));

const { chartColor, CHART_COLORS } = load("src/components/ds/Chart.tsx");
assert.equal(chartColor(CHART_COLORS.primary, "light"), CHART_COLORS.primary);
assert.notEqual(chartColor(CHART_COLORS.primary, "dark"), CHART_COLORS.primary);
assert.equal(chartColor("#123456", "dark"), "#123456");
const darkChart = baseChartOptions({ colors: [CHART_COLORS.success] }, "dark");
assert.equal(darkChart.theme.mode, "dark");
assert.equal(darkChart.tooltip.theme, "dark");
assert.equal(darkChart.chart.background, "transparent");
assert.notEqual(darkChart.colors[0], CHART_COLORS.success);

const { nextSort, sortRows } = load("src/lib/table-sort.ts");
assert.deepEqual(nextSort(null, "name"), { key: "name", direction: "asc" });
assert.deepEqual(nextSort({ key: "name", direction: "asc" }, "name"), {
  key: "name",
  direction: "desc",
});
assert.deepEqual(nextSort({ key: "name", direction: "desc" }, "qty"), {
  key: "qty",
  direction: "asc",
});
const stock = [
  { id: "a", name: "Álcool", qty: 10, due: null },
  { id: "b", name: "agulha", qty: 2, due: new Date(2026, 0, 2) },
  { id: "c", name: "Bisturi 10", qty: 2, due: new Date(2025, 5, 1) },
  { id: "d", name: "Bisturi 9", qty: 7, due: undefined },
];
const accessors = { name: (r) => r.name, qty: (r) => r.qty, due: (r) => r.due };
const ids = (rows) => rows.map((r) => r.id).join("");
assert.equal(ids(sortRows(stock, { key: "name", direction: "asc" }, accessors)), "badc");
assert.equal(ids(sortRows(stock, { key: "name", direction: "desc" }, accessors)), "cdab");
assert.equal(ids(sortRows(stock, { key: "qty", direction: "asc" }, accessors)), "bcda");
assert.equal(ids(sortRows(stock, { key: "due", direction: "asc" }, accessors)), "cbad");
assert.equal(ids(sortRows(stock, { key: "due", direction: "desc" }, accessors)), "bcad");
assert.equal(ids(sortRows(stock, null, accessors)), "abcd");
assert.equal(ids(stock), "abcd", "sorting must not mutate the original rows");

const { StatusBadge } = load("src/components/ui-app/StatusBadge.tsx");
const badge = renderToStaticMarkup(React.createElement(StatusBadge, { tone: "danger" }, "Vencido"));
assert.match(badge, /Vencido/);
assert.match(badge, /<svg[^>]*aria-hidden="true"/, "status keeps an icon, not only color");
assert.match(badge, /text-destructive/);

const { SortableHeader } = load("src/components/ui-app/SortableHeader.tsx");
const sortableHead = (sort) =>
  renderToStaticMarkup(
    React.createElement(SortableHeader, { label: "Nome", sortKey: "name", sort, onSort: () => {} }),
  );
assert.match(sortableHead(null), /aria-sort="none"/);
assert.match(sortableHead({ key: "name", direction: "asc" }), /aria-sort="ascending"/);
assert.match(sortableHead({ key: "name", direction: "desc" }), /aria-sort="descending"/);
assert.match(sortableHead({ key: "other", direction: "asc" }), /aria-sort="none"/);
assert.match(sortableHead(null), /<button type="button"/);
console.log(
  "Frontend: real filtered indicators, calendar navigation, missing patient data, chart defaults, glass tokens, search and notification grouping, semantic components, AA token contrast (light and dark), theme resolution, table sorting and status badges passed.",
);

# MedCore Design System v2

Fundação visual do MedCore. Todos os módulos devem consumir estes primitivos
para garantir consistência total.

## Tokens (src/styles.css)

### Cores
- `--primary` `#6d3ff5` — brand
- `--primary-soft` `#ede6ff` — accent
- `--success` `#16b364`, `--warning` `#f59e0b`, `--danger` `#ef3e5c`, `--info` `#2986ff`
- `--foreground` `#0f1424`, `--muted-foreground` `#5a6178`
- `--surface` `#f7f8fa`, `--surface-2` `#f1f3f6`
- `--border` `#eaecf0` (quase invisível — luxo)

### Sombras (extremamente suaves)
- `--shadow-xs` `--shadow-sm` `--shadow-md` `--shadow-lg` `--shadow-xl`
- `--shadow-focus` (ring roxo translúcido)

### Motion
- `--dur-fast` 180ms · `--dur-base` 280ms · `--dur-slow` 480ms
- `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)` — padrão do sistema

### Raio
- `--radius` `14px` (padrão de cards/inputs)

## Utilities Tailwind

- `surface-1` — card básico (borda + shadow-xs)
- `surface-2` — card principal (borda + shadow-sm)
- `surface-hover` — hover-lift sutil (usar com `surface-2`)
- `glass` — vidro com blur
- `text-display` — números/hero (38px, tight)
- `text-eyebrow` — rótulo pequeno maiúsculo
- `kbd-chip` — chip de atalho de teclado
- `card-premium` — cartão elevado (legado, mantido)
- `mc-skeleton` — shimmer loading
- `mc-press` — feedback tátil (scale 0.97 no active)
- `focus-ring` `input-focus` — estados de foco padronizados

## Primitivos React (`@/components/ds`)

### `<Card interactive padding="md">`
Container base. `padding: "sm" | "md" | "lg"`, `interactive` ativa hover-lift.

### `<CardHeader title subtitle action eyebrow />`
Cabeçalho consistente para todos os cards.

### `<KPICard label value hint trend icon accent />`
KPI padrão do dashboard. `accent: primary | success | warning | danger | info`.

### `<StatNumber value format prefix suffix decimals />`
Contador animado (countup.js oficial). Respeita `prefers-reduced-motion`.
Helper: `formatBRL(v)` para moeda.

### `<Chart type series options height />`
Wrapper do ApexCharts com defaults MedCore (fonte Inter, paleta, grid suave,
tooltips limpos, animações). Carregado via `lazy` para não pesar o bundle.

Exports: `CHART_COLORS`, `CHART_PALETTE`, `baseChartOptions(overrides)`.

## Regras de uso

1. **Nunca** hardcodar cores em componentes (`text-white`, `#8b47ff`, etc.).
   Sempre usar tokens semânticos.
2. Números importantes → `<StatNumber>`.
3. Gráficos novos → `<Chart>` (ApexCharts). Recharts será migrado por fase.
4. Cards → `<Card>` + `<CardHeader>`. Nada de `div` com bordas soltas.
5. Animações → `framer-motion` com tokens `DUR` e `EASE_OUT` de `@/lib/motion`.

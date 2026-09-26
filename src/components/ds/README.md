# MedCore Design System

A interface segue uma linguagem inspirada no macOS: base neutra (clara ou escura), roxo MedCore como cor de ação e vidro (glassmorphism) só na camada de navegação e controles. A fonte é a do sistema (SF Pro nas plataformas Apple), com Inter como alternativa nas demais. Os tokens ficam em `src/styles.css`; componentes compartilhados ficam em `ui`, `ui-app` e `ds`. O símbolo e o nome MedCore vêm sempre de `BrandLogo`.

## Camadas

De baixo para cima: **fundo em gradiente (`app-canvas`) → conteúdo opaco (cards, tabelas, formulários, prontuário) → vidro nos controles (header, sidebar, barras fixas, menus, busca) → janelas sobrepostas (Dialog, Sheet, AlertDialog)**.

## Padrões visuais

| Uso                | Token / padrão                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ação principal     | `primary` / `primary-hover`, com texto `primary-foreground`. Botões em pílula (`Button`)                                                                                               |
| Destaque suave     | `primary/10` ou `primary-soft`; não usar como estado clínico                                                                                                                           |
| Fundo / superfície | `app-canvas` (gradiente suave atrás de tudo) / `card`                                                                                                                                  |
| Vidro              | Barras: `bg-glass` + `glass-blur`. Menus, popovers, busca e alertas: `bg-glass-strong` + `glass-blur-strong`. Sempre com `border-hairline`                                             |
| Texto              | `foreground` / `muted-foreground` (níveis intermediários com opacidade, ex.: `text-foreground/80`)                                                                                     |
| Estados            | `success`, `warning`, `destructive`, `info`, sempre com texto e ícone (`StatusBadge`). Fundos de estado com `bg-{token}/10`                                                            |
| Bordas             | `border`, `border-soft`, `input`; `hairline` sobre vidro                                                                                                                               |
| Camadas            | `z-(--z-sidebar)`, `z-(--z-header)`, `z-(--z-sheet)` = `z-(--z-dialog)` (a ordem de abertura decide), `z-(--z-popover)`, `z-(--z-tooltip)`, `z-(--z-alert)`, `z-(--z-select)`          |
| Tipografia         | `--font-sans`; em gráficos e estilos inline use `FONT_STACK`. Escala do Tailwind (12, 14, 16, 18, 20, 24 px) + `text-[15px]` (títulos de card) e `text-[28px]` (KPIs). Pesos 400 e 600 |
| Cantos             | 10 px (`rounded-md`), 14 px (`rounded-lg`), 18 px (`rounded-xl`), 22 px (`rounded-2xl`) e pílula (`rounded-full`)                                                                      |
| Sombras            | A escala `shadow-*` foi suavizada no `@theme`; vidro usa `shadow-(--glass-shadow)` / `shadow-(--glass-shadow-lg)`                                                                      |
| Espaçamento        | 16 px no celular; 24 px no desktop; `page-container` limita a largura a 1600 px                                                                                                        |
| Movimento          | Curto e funcional (`--ease-apple`); respeitar `prefers-reduced-motion`                                                                                                                 |

Cores fixas (hex) ficam restritas a dados: cor de profissional, evento, tratamento, séries de gráfico e marcas de terceiros (Google, WhatsApp). Fundos de evento usam 14% da cor do profissional sobre `--card` (`color-mix`), o que funciona nos dois temas.

## Aparência (claro, escuro e automático)

- Os mesmos tokens têm valores próprios em `.dark` (em `src/styles.css`). Texto e estados mantêm contraste AA sobre `--card`; botões preenchidos com texto branco ficam em pelo menos 3:1, como no macOS.
- A escolha fica no menu da conta (Claro, Escuro ou Automático), é guardada em `localStorage` (`medcore:theme`) e aplicada antes da primeira pintura por `THEME_INIT_SCRIPT` (`src/lib/theme.ts`). O padrão é Claro.
- `useTheme()` sincroniza a preferência com o sistema e outras abas; `useResolvedTheme()` informa o tema efetivo para bibliotecas que não leem CSS.
- Em código novo, prefira tokens. Cores de categoria (ex.: `teal`, `sky`) usam fundo translúcido (`bg-teal-500/10`) e texto com variante `dark:`.

## Vidro

- Use só em header, sidebar, barras fixas de ferramentas, menus, popovers, busca global, alertas e no painel de login. Cards, tabelas, formulários e prontuário ficam opacos.
- No máximo 3–4 camadas de vidro visíveis ao mesmo tempo.
- Sem suporte a `backdrop-filter`, o vidro fica quase opaco; com `prefers-reduced-transparency` ou `prefers-contrast: more`, fica opaco.
- Texto sobre vidro precisa de contraste AA. Não aplique cor de marca no fundo do vidro, só na ação principal e em status.

## Componentes

- `PageHeader`: título único da página, descrição opcional, ícone e `actions`. Prefira uma ação principal por contexto.
- `Card`, `CardHeader`, `SectionCard`: superfícies opacas. `CardHeader` aceita `subtitle` — use-o como frase-resumo de cada gráfico.
- `KPICard`: label, valor (28 px, algarismos tabulares), contexto e cor semântica. Ausência de informação não deve ser substituída por um exemplo.
- `StatusBadge`: estado com cor, ícone e texto juntos (`success`, `warning`, `danger`, `info`, `primary`, `neutral`).
- `SegmentedControl`: filtros mutuamente exclusivos (até 5–7 opções), com trilho neutro e segmento ativo elevado. `semantics="navigation"` marca o ativo com `aria-current="page"` quando troca seção ou rota.
- `StickyToolbar`: pílula de vidro que fica logo abaixo do cabeçalho ao rolar (uma por tela). Precisa ser filha direta do container alto da página.
- `SortableHeader` + `sortRows`/`nextSort` (`src/lib/table-sort.ts`): ordenação por clique no cabeçalho, com `aria-sort`. Clicar de novo inverte a ordem.
- Tabelas: `.mc-table` (cabeçalho fixo em vidro fino, linhas alternadas, `.num` para números alinhados à direita) ou `ui/table` (com `TableFooter` para totais).
- `Button`: pílula por padrão; variantes `default`, `outline`, `secondary`, `tinted`, `glass`, `ghost`, `destructive` e `link`. `Input`, `Textarea`, `Tabs`: tamanhos e foco compartilhados. Não apagar o foco global.
- `Dialog`, `Sheet`, `AlertDialog`, `Popover`: sempre Radix, nunca sobreposições manuais (`fixed inset-0`). Dialog até ~560 px para tarefas curtas; Sheet de 420–520 px (flutua a 8 px das bordas a partir de 640 px); AlertDialog em vidro para confirmações. Formulários com dados bloqueiam o fechamento por clique fora (`onInteractOutside`), mas mantêm Esc e o botão Fechar.
- `GlobalSearch`: busca no estilo Spotlight (`Ctrl K` / `⌘ K`), com resultados agrupados por tipo, recentes da sessão e atalhos para páginas permitidas. Os recentes ficam em `sessionStorage`, separados por usuário, e são apagados ao sair.
- `NotificationCenter`: popover de vidro com filtro segmentado e grupos Hoje / Ontem / Anteriores; "não lida" é indicada por ponto e peso do título.
- `Chart`: única biblioteca de gráficos (ApexCharts), com `FONT_STACK`, paleta comum (`CHART_COLORS`), eixos legíveis e tema claro/escuro automático (`chartColor` converte a paleta). `summary` descreve o gráfico para leitores de tela. `baseChartOptions` preserva defaults ao receber overrides; `yaxis` também aceita múltiplos eixos.
- `StatNumber`: valor disponível desde a primeira renderização; animação breve e desativada em movimento reduzido.

## Navegação e responsividade

O cabeçalho global tem 64 px, é de vidro e ganha uma linha fina ao rolar a página. O menu lateral flutua a 10 px das bordas e ocupa 72 px recolhido ou 240 px expandido. Rodapés fixos devem usar `app-fixed-footer` e a variável `--app-sidebar-width`, nunca um deslocamento fixo de 56 px; o do prontuário é uma barra de vidro flutuante.

Use `min-w-0` nos filhos de grids/flex, rolagem local em tabelas largas e abas, e formulários com uma coluna no celular. Conteúdo essencial não pode depender de hover. A ficha de paciente é compartilhada pela listagem e pela Agenda, e pode ser aberta por `/pacientes?patientId=...`.

## Telas

- **Dashboard**: KPIs no topo, cards opacos com frase-resumo, agrupamento do fluxo de caixa em controle segmentado e período num popover de vidro.
- **Agenda**: a partir de 1280 px, calendário e filtros ficam numa barra lateral de vidro; barra de ferramentas com Hoje, ‹ › e Dia · Semana · Mês · Lista; grade opaca. O novo agendamento mostra as etapas (Tipo, Dados, Data e horário, Plano e cobrança…) e leva direto a cada seção.
- **Prontuário**: texto do documento com `prose-clinical` (~72 caracteres por linha, peso regular, entrelinha 1,6); rodapé flutuante com `⌘S`/`Ctrl S`, que pede confirmação antes de finalizar.
- **Financeiro** e **Relatórios**: seções/categorias num `SegmentedControl` dentro de `StickyToolbar`.
- **Configurações**: lista lateral no estilo Ajustes do macOS, com busca, linhas agrupadas (rótulo à esquerda, controle à direita) e a última seção aberta lembrada.

## Integridade da apresentação

Sem exemplos preenchendo cadastros reais, sucesso antes da confirmação do servidor ou controles que apenas alteram o destaque visual. Indicadores da Agenda usam o período e os filtros efetivos. DRE/DFC mantêm os cálculos existentes; mudanças de classificação precisam de revisão contábil própria.

A cor em Configurações é um dado cadastral, não um seletor de tema global. Não introduzir cores fixas paralelas para botões e títulos. Cores de profissionais, eventos e séries podem conservar seu significado específico.

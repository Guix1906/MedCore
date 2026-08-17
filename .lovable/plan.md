# UX Premium MedCore — Plano de Implementação

Meta: elevar o MedCore ao nível Linear/Stripe/Vercel em fluidez e refinamento, **sem quebrar nada** e **sem inflar o bundle**. Vou entregar em fases, para você validar visualmente entre cada uma.

## Princípios (aplicados em todas as fases)

- Easing padrão: `cubic-bezier(0.22, 1, 0.36, 1)` — duração 250-500ms.
- Só animar `transform` e `opacity`. Nunca `width/height/top/left`.
- Respeitar `prefers-reduced-motion` globalmente (hook `useReducedMotion`).
- Alvo 60 FPS; nada bloqueando main thread.
- Bibliotecas já instaladas (Framer Motion, Sonner, DnD Kit, TanStack Query, Recharts) são reaproveitadas. **Novas** bibliotecas só quando pagam o custo em bundle.

## Bibliotecas — decisões

**Adicionar agora**: `@formkit/auto-animate`, `@floating-ui/react`, `react-virtuoso`, `lenis`, `split-type`.

**Adiar / substituir**:
- **GSAP**: substituído por Framer Motion (já no bundle). Só entra se a landing exigir timeline complexa.
- **CountUp.js**: já temos `CountUp` custom em `src/components/finance/CountUp.tsx` — reuso.
- **ApexCharts**: já usamos Recharts em todo o dashboard/financeiro. Trocar tudo seria retrabalho de 2 dias sem ganho visível. Mantenho Recharts com animações refinadas.
- **TanStack Table**: entra só na Fase 3 (Pacientes/Financeiro), onde há tabelas reais.
- **Lottie**: só se você me passar o `.json` da animação para o login.
- **tsParticles**: só no login (Fase 5).
- **React Three Fiber**: só quando existir landing page (hoje não existe — fora de escopo).

## Fases

### Fase 1 — Fundação de movimento (base para tudo)
- Tokens de motion em `src/styles.css` (durations, easings, shadows premium).
- Hook `useReducedMotion` + variantes Framer reutilizáveis (`fadeUp`, `staggerContainer`, `scaleIn`).
- Wrapper `<PageTransition>` no `__root` para fade+slide entre rotas.
- Lenis para scroll suave global (com opt-out em modais/dropdowns).
- Skeleton com shimmer refinado.

### Fase 2 — AppShell + Sidebar + Header
- Sidebar: entrada slide+fade, hover com scale sutil no ícone, tooltip Floating UI quando recolhida, indicador ativo com layoutId (magic move).
- Header: botões com hover elevation, dropdowns com scale+fade+blur.
- Notification badge e busca global com microinterações.

### Fase 3 — Dashboard + Financeiro
- Cards em cascata (stagger 80ms, fade+translateY+scale sutil).
- CountUp já existe — aplicar em todos números remanescentes.
- Gráficos Recharts com `isAnimationActive` + `animationEasing="ease-out"`, linhas desenhando progressivamente.
- Troca de período com AnimatePresence entre datasets.

### Fase 4 — Tabelas + Listas (Pacientes, Financeiro, Estoque)
- Migrar tabela de Pacientes para **TanStack Table** (sort/filter/paginação/seleção).
- Lista de pacientes com **React Virtuoso** quando > 100 registros.
- **Auto Animate** em add/remove de linhas (transações, itens de estoque).
- Fade sequencial no primeiro paint.

### Fase 5 — Agenda + Prontuário + Modais + Toasts
- Agenda: refinar DnD Kit (sombra dinâmica, rotação leve, ghost flutuante).
- Prontuário: timeline com stagger, accordion Framer, fade+slide entre abas.
- Modais/Dialogs shadcn: backdrop blur, scale 0.95→1.
- Toasts Sonner com ícones animados (Framer).

### Fase 6 — Login + Microinterações finais
- Login (`/auth`): logo com entrada Framer, campos em sequência, botão por último, tsParticles no background.
- Checkbox/Switch/Input com borda animada, popovers com scale, progress bar contínua.
- Auditoria de performance (Lighthouse) + code splitting nas rotas pesadas.

## Fora de escopo (por enquanto)
- **Landing page com R3F**: o projeto não tem landing pública. Se quiser, criamos depois em fase separada.
- **GSAP** e **ApexCharts**: mantidos fora salvo necessidade concreta.

## Entrega
Cada fase vira um commit isolado; você valida no preview e me diz se quer ajustes antes da próxima. Começo pela **Fase 1 + Fase 2** juntas (fundação + AppShell) porque uma depende da outra visualmente.

Confirma para eu começar?
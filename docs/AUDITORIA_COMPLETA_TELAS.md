# AUDITORIA COMPLETA DE CÓDIGO E GUIA DE EDIÇÃO TELA POR TELA — MEDCORE

> **Documento Gerado:** Auditoria Arquitetural e Técnica Completa  
> **Sistema:** MedCore (Gestão Clínica, Agenda, Prontuário, Acompanhamentos e Financeiro)  
> **Stack Principal:** TanStack Start / TanStack Router (React 19, TypeScript), Supabase (PostgreSQL, Realtime, Auth), Tailwind CSS v4, ApexCharts, Lucide Icons.  
> **Objetivo:** Mapear cada tela, componente por componente e linha de código por linha de código, fornecendo a anatomia exata do sistema e um guia prático para edição, manutenção e expansão de funcionalidades.

---

## ÍNDICE GERAL DE TELAS E SEÇÕES

1. [Visão Geral da Arquitetura & Fundação Global](#1-visão-geral-da-arquitetura--fundação-global)
   - 1.1 Roteamento e Inicialização (`src/routes/__root.tsx`)
   - 1.2 Shell Central da Aplicação (`src/components/AppShell.tsx`)
   - 1.3 Guardião de Autenticação (`src/routes/_authenticated/route.tsx`)
2. [Tela 1: Autenticação & Recuperação de Acesso (`src/routes/auth.tsx`)](#2-tela-1-autenticação--recuperação-de-acesso)
3. [Tela 2: Dashboard Principal da Clínica (`src/routes/_authenticated/dashboard.tsx`)](#3-tela-2-dashboard-principal-da-clínica)
4. [Tela 3: Indicadores da Agenda (`src/routes/_authenticated/visao-geral.tsx`)](#4-tela-3-indicadores-da-agenda)
5. [Tela 4: Agenda Médica & Atendimentos (`src/routes/_authenticated/agenda.tsx`)](#5-tela-4-agenda-médica--atendimentos)
6. [Tela 5: Gestão de Pacientes (`src/routes/_authenticated/pacientes.tsx`)](#6-tela-5-gestão-de-pacientes)
7. [Tela 6: Prontuário Eletrônico & Atendimento Clínico (`src/routes/_authenticated/prontuario.tsx`)](#7-tela-6-prontuário-eletrônico--atendimento-clínico)
8. [Tela 7: Acompanhamentos Clínicos & Protocolos (`src/routes/_authenticated/acompanhamentos.tsx`)](#8-tela-7-acompanhamentos-clínicos--protocolos)
9. [Tela 8: Detalhes do Acompanhamento Clínico (`src/routes/_authenticated/acompanhamentos.$id.tsx`)](#9-tela-8-detalhes-do-acompanhamento-clínico)
10. [Tela 9: Módulo Financeiro Completo (`src/routes/_authenticated/financeiro.tsx`)](#10-tela-9-módulo-financeiro-completo)
11. [Tela 10: Controle de Estoque & Insumos (`src/routes/_authenticated/estoque.tsx`)](#11-tela-10-controle-de-estoque--insumos)
12. [Tela 11: Relatórios & BI Analítico (`src/routes/_authenticated/relatorios.tsx`)](#12-tela-11-relatórios--bi-analítico)
13. [Tela 12: Configurações Gerais da Clínica (`src/routes/_authenticated/configuracoes.tsx`)](#13-tela-12-configurações-gerais-da-clínica)
14. [Tela 13: Administração, Usuários & Permissões (`src/routes/_authenticated/admin.tsx`)](#14-tela-13-administração-usuários--permissões)
15. [Mapa de Tabelas do Banco de Dados Supabase](#15-mapa-de-tabelas-do-banco-de-dados-supabase)
16. [Guia Rápido de Troubleshooting & Comandos de Verificação](#16-guia-rápido-de-troubleshooting--comandos-de-verificação)

---

## 1. VISÃO GERAL DA ARQUITETURA & FUNDAÇÃO GLOBAL

```
                         ┌────────────────────────┐
                         │   src/routes/__root    │
                         │ (Providers, Theme, SEO)│
                         └───────────┬────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
     ┌───────────────────────┐               ┌───────────────────────┐
     │   src/routes/auth     │               │  _authenticated/route │
     │  (Login, Signup, OTP) │               │   (Cache Auth Guard)  │
     └───────────────────────┘               └───────────┬───────────┘
                                                         │
                                                         ▼
                                             ┌───────────────────────┐
                                             │  components/AppShell  │
                                             │ (Sidebar, Nav, Guard) │
                                             └───────────┬───────────┘
                                                         │
         ┌──────────────┬──────────────┬─────────────────┼──────────────┬──────────────┐
         ▼              ▼              ▼                 ▼              ▼              ▼
    /dashboard       /agenda       /pacientes       /prontuario   /acompanhamentos /financeiro
   (/visao-geral)                                                                 (/estoque,
                                                                                   /relatorios,
                                                                                   /configuracoes,
                                                                                   /admin)
```

### 1.1 Roteamento e Inicialização (`src/routes/__root.tsx`)
- **Arquivo Principal:** `src/routes/__root.tsx` (230 linhas)
- **Papel:** É a casca raiz de toda a aplicação (Root Shell). Gerencia tags HTML (`lang="pt-BR"`), cabeçalhos SEO, fontes Google (Inter), folha de estilos CSS global, e os Providers universais.
- **Estruturas Chave:**
  - `ScriptOnce`: Injeta `THEME_INIT_SCRIPT` no `<head>` antes do React hidratar, prevenindo o "flash" branco no tema escuro.
  - `SmoothScroll`: Instala o Lenis para rolagem suave na página.
  - `Toaster`: Notificações Sonner posicionadas em `top-right` com suporte a `richColors` e `closeButton`.
  - `QueryClientProvider`: Provedor TanStack Query para todo o gerenciamento de cache de dados.
  - **Mecanismo de Recuperação de Deploy Obsoleto (Stale Deploy Recovery):**
    - Escuta eventos `vite:preloadError` e rejeições de promessas de scripts dinâmicos. Quando uma nova versão é publicada na Vercel e o usuário ainda está com a aba aberta com hashes de chunks antigos, o sistema recarrega a página automaticamente (com guarda de 10 segundos no `sessionStorage`) para obter o novo manifesto sem gerar tela preta para o usuário.
  - **Sincronização de Sessão Supabase:**
    - `supabase.auth.onAuthStateChange` invalida as rotas e limpa queries em `SIGNED_IN`, `SIGNED_OUT` e `USER_UPDATED`.
- **Como Editar:**
  - *Adicionar nova meta tag ou alterar título base:* Altere a função `head` nas linhas 107-155.
  - *Mudar posição ou comportamento das notificações:* Altere o componente `<Toaster />` na linha 226.

---

### 1.2 Shell Central da Aplicação (`src/components/AppShell.tsx`)
- **Arquivo Principal:** `src/components/AppShell.tsx` (559 linhas)
- **Componentes Filhos:**
  - `src/components/GlobalSearch.tsx` (Busca Global `Ctrl + K`)
  - `src/components/NotificationCenter.tsx` (Central de Notificações)
  - `src/components/app/confirm-dialog.tsx` (Host de diálogos de confirmação)
  - `src/components/motion/PageTransition.tsx` (Transição suave de página)
- **Papel:** Fornece a moldura corporativa com o menu lateral retrátil (Sidebar), barra superior de navegação (Topbar), central de avisos, atalho de busca rápida, seletor de tema e menu do usuário.
- **Seções de Menu Pré-Configuradas:**
  1. **Início:** Dashboard (`/dashboard`)
  2. **Atendimento:**
     - Agenda (`/agenda`)
     - Indicadores da agenda (`/visao-geral`)
     - Pacientes (`/pacientes`)
     - Prontuário (`/prontuario`)
     - Acompanhamentos (`/acompanhamentos`)
  3. **Gestão:**
     - Financeiro (`/financeiro`)
     - Estoque (`/estoque`)
     - Relatórios (`/relatorios`)
  4. **Sistema:**
     - Configurações (`/configuracoes`)
     - Administração (`/admin`)
- **Regras de Negócio e Segurança no AppShell:**
  - `useSessionTimeout()`: Monitora inatividade do operador e desconecta sessões ociosas.
  - `usePermissions()`: Verifica o status da conta do usuário. Se `access.mode === "blocked"`, exibe imediatamente `BlockedAccessScreen`; se sem clínica, exibe `NoAccessScreen`.
  - Exibe o banner de convites pendentes `PendingInvitationsBanner` caso o usuário tenha sido convidado para outras unidades.
  - Persiste a preferência de sidebar fixada ou colapsada no `localStorage` com a chave `medcore:sidebar-pinned`.
- **Como Editar:**
  - *Adicionar um novo item no menu lateral:* Localize a constante `navSections` (linhas 73-100) e adicione o novo objeto `{ to: "/sua-rota", label: "Seu Nome", icon: SeuIcone }`.
  - *Alterar link ou telefone do WhatsApp de suporte:* Edite a constante `WHATSAPP_URL` na linha 102.

---

### 1.3 Guardião de Autenticação (`src/routes/_authenticated/route.tsx`)
- **Arquivo:** `src/routes/_authenticated/route.tsx` (59 linhas)
- **Papel:** Envolve todas as páginas restritas do sistema sob a pasta `src/routes/_authenticated/`.
- **Anatomia do Código:**
  - `beforeLoad`: Executa antes de qualquer renderização de rota autenticada.
  - **Cache em Memória de 0ms:** Mantém o objeto de usuário em `cachedUser` com duração de 10 minutos (`AUTH_CACHE_DURATION = 10 * 60 * 1000`). Isso faz com que a troca de telas entre telas autenticadas seja instantânea, sem fazer requisições redundantes de rede ao Supabase Auth a cada clique.
  - Função exportada `invalidateAuthRouteCache()`: Limpa o cache imediatamente ao fazer login ou logout.
  - Caso não haja usuário autenticado, dispara `throw redirect({ to: "/auth", search: { redirect: ... } })`.

---

## 2. TELA 1: AUTENTICAÇÃO & RECUPERAÇÃO DE ACESSO

```
=============================================================================
ROTA: /auth (Pública)
ARQUIVO: src/routes/auth.tsx (689 linhas)
SERVIÇOS: Supabase Auth, src/services/site-origin.ts
=============================================================================
```

### 2.1 Visão Geral & Recursos
Tela responsável pelo fluxo completo de entrada e recuperação de contas da clínica Dr. Jonatas Bandeira:
- Entrada com e-mail e senha (`signin`).
- Cadastro de novo operador (`signup`).
- Recuperação de senha por e-mail com link mágico (`forgot`).
- Redefinição de senha / Aceite de convite de equipe (`password`).
- Login social com Google OAuth (`handleGoogleSignIn`).

### 2.2 Anatomia do Código
- **Parâmetros de Busca na URL (`AuthSearch`):**
  - `redirect`: Caminho seguro validado por `safeRedirectPath()` para onde o usuário será enviado após entrar.
  - `modo`: `"convite"` ou `"nova-senha"`.
- **Estados Internos do Componente:**
  - `mode`: Tipo `AuthMode` (`"signin" | "signup" | "forgot" | "password"`).
  - `email`, `password`, `confirmPassword`, `fullName`: Dados dos inputs.
  - `sessionEmail`: Exibido quando o usuário está definindo uma nova senha através de um link recebido por e-mail.
  - `linkError`: Captura erros de hash na URL (ex: `#error=access_denied&error_code=otp_expired`).
  - `formError`: Mensagens de erro formatadas amigavelmente para o usuário.
  - `busy`, `googleBusy`: Estados de carregamento dos botões.
- **Funções Principais:**
  - `submit()` (linhas 260-358):
    - No modo `signin`: chama `supabase.auth.signInWithPassword`, invalida as queries de permissões e navega para a página de destino.
    - No modo `signup`: valida senha mínima de 8 caracteres, executa `supabase.auth.signUp` com metadados `full_name`.
    - No modo `password`: valida confirmação de senha idêntica e chama `supabase.auth.updateUser({ password })`.
    - No modo `forgot`: executa `supabase.auth.resetPasswordForEmail` apontando o retorno para `/auth?modo=nova-senha`.
  - `handleGoogleSignIn()` (linhas 360-380): Dispara o fluxo OAuth via `supabase.auth.signInWithOAuth({ provider: "google" })`.

### 2.3 Guia de Edição da Tela de Autenticação
- **Alterar textos de boas-vindas ou subtítulos:** Altere os dicionários `titles` e `descriptions` nas linhas 382-395.
- **Modificar cores dos efeitos decorativos (Aurora de fundo):** Edite os estilos CSS associados às classes `auth-blob--aqua`, `auth-blob--sky`, `auth-blob--rose`, `auth-blob--violet` em `src/styles.css`.
- **Adicionar campos no cadastro (ex: Telefone):**
  1. No JSX do formulário (modo `signup`), adicione o `<Input id="auth-phone" name="phone" placeholder="Seu telefone" />`.
  2. Na função `submit`, extraia o telefone com `formData.get("phone")` e envie no objeto `options.data` de `supabase.auth.signUp`.

---

## 3. TELA 2: DASHBOARD PRINCIPAL DA CLÍNICA

```
=============================================================================
ROTA: /dashboard (Autenticada)
ARQUIVO: src/routes/_authenticated/dashboard.tsx (1782 linhas)
COMPILADO COM: src/features/dashboard/dashboard-utils.ts,
                src/features/finance/finance-api.ts,
                src/features/finance/finance-math.ts
BANCO SUPABASE: events, appointments, patients, transactions, transaction_payments
=============================================================================
```

### 3.1 Visão Geral & Módulos da Tela
O Dashboard é o centro de comando diário do consultório, combinando métricas operacionais, agendamentos futuros e inteligência financeira em uma interface reativa.

### 3.2 Seções Detalhadas de Código
1. **Resumo Operacional (KPI Cards - linhas 715-745):**
   - *Agendamentos no período:* Quantidade total de consultas no range de datas selecionado.
   - *Próximas 24 horas:* Consultas marcadas para hoje e amanhã com contagem regressiva.
   - *Pacientes cadastrados:* Total de registros ativos na base de pacientes.
   - *Aniversariantes do mês:* Identifica pacientes com aniversário no mês de referência para campanhas de relacionamento.
2. **Próximas 24 Horas & Faturamento Diário (linhas 748-857):**
   - Lista interativa dos próximos pacientes agendados. Cada card possui cor temática associada ao profissional ou tipo de procedimento, horário e link de acesso rápido à Agenda.
   - Gráfico de colunas de faturamento diário (`ApexRevenueDaily`) com preenchimento em gradiente e tooltip com valores formatados em moeda brasileira (BRL).
3. **Módulo de Fluxo de Caixa Integrado (linhas 859-1146):**
   - Gráfico misto empilhado (`Chart` tipo `"line"` com ApexCharts):
     - Barra Vermelha: Saídas (despesas pagas).
     - Barra Verde: Entradas Realizadas (receitas já recebidas).
     - Barra Azul Suave: A Receber (receitas previstas em aberto).
     - Linha Lilás: Curva do Resultado de Caixa Líquido.
   - Seletor de visualização do fluxo: `Diária`, `Semanal`, `Mensal` e `Anual`.
   - Seletor de Período flutuante com Presets (`Hoje`, `Esta semana`, `Este mês`, `Últimos 7 dias`, `Últimos 30 dias` e `Customizado`).
   - Botão de Visibilidade Financeira (`Eye` / `EyeOff`): Oculta todos os valores numéricos de dinheiro com `R$ ••••••` para proteger a privacidade na recepção.
4. **Demografia & Status Clínicos (linhas 1149-1220):**
   - Gráfico Donut de Status por Agendamento (`ApexDonut`): Agendado, Confirmado, Concluído, Cancelado, Falta.
   - Gráfico Donut de Distribuição por Sexo: Percentual de pacientes Feminino vs Masculino.
   - Lista dos Próximos Aniversariantes do Mês com avatares de iniciais e data.
5. **Relatórios Dinâmicos & Heatmap de Atendimento (linhas 1222-1340):**
   - Abas com `SegmentedControl`: Por Profissional, Por Tipo de Atendimento, Por Status, Por Categoria Financeira.
   - Gráfico horizontal de barras (`ApexBar`) com valores e percentuais.
   - **Heatmap de Horários Mais Movimentados:** Matriz com colunas por dia da semana (Dom a Sáb) e linhas por hora (07h às 21h), calculando a intensidade de calor da célula de acordo com o volume de consultas registradas.

### 3.3 Sincronização em Tempo Real (Realtime - linhas 131-184)
O Dashboard possui tripla sincronização:
- **LocalStorage Listener:** Escuta alterações no storage local através de outras abas.
- **Custom Window Events:** Escuta disparos de `medcore_events_updated`, `medcore_local_title_saved` e `medcore_patients_updated`.
- **Supabase Realtime Channel (`dashboard-financial-sync`):** Escuta eventos de inserção, atualização e exclusão (`*`) nas tabelas `transactions`, `transaction_payments` e `events`. Ao ocorrer qualquer alteração no banco, todas as queries de agendamentos e finanças são invalidadas e recalculadas em segundo plano.

### 3.4 Guia de Edição do Dashboard
- **Alterar o intervalo padrão de datas ao abrir a tela:**
  - Modifique a função `initialRange()` nas linhas 103-112.
- **Adicionar um novo KPI card no topo:**
  - Localize a `<section aria-label="Resumo">` na linha 716 e adicione um novo `<KPICard label="Título" value={suaVariavel} icon={<SeuIcone />} />`.
- **Alterar as faixas de horário do Heatmap:**
  - Localize a tabela de horários na linha 1290 e edite o array `heat.hours` calculado no bloco de useMemo da tela.

---

## 4. TELA 3: INDICADORES DA AGENDA

```
=============================================================================
ROTA: /visao-geral (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/visao-geral.tsx (25 linhas)
COMPONENTE: src/features/visao-geral/components/DashboardPage.tsx (318 linhas)
UTILITÁRIO: src/features/visao-geral/overview-utils.ts
HOOK: src/features/agenda/hooks/use-agenda-data.ts
=============================================================================
```

### 4.1 Visão Geral
Tela puramente analítica voltada à produtividade da recepção e ocupação médica, desvinculada de dados de receita/caixa. Permite que secretárias e coordenadores acompanhem o volume e as taxas de comparecimento.

### 4.2 Anatomia do Código
- **Filtros Disponíveis (linhas 71-159):**
  - Período: SegmentedControl com opções `Semana`, `Mês`, `Ano`.
  - Data de referência: `input[type="date"]`.
  - Dropdown de Profissional: Lista os membros da clínica ou apenas o médico autorizado pelas permissões.
  - Dropdown de Status: `Todos`, `Confirmado`, `Concluído`, `Cancelado`, `Faltou`.
- **Cálculo dos Dados (`summarizeAgenda` em `overview-utils.ts`):**
  - Agrupa agendamentos em buckets de tempo (dias para semana/mês ou meses para ano).
  - Conta frequências por status.
  - Agrupa atendimentos por dia da semana (Segunda a Sábado).
- **Componentes Renderizados:**
  - 4 KPICards: Total de agendamentos, Confirmados, Concluídos e Cancelados.
  - Gráfico de barras temporais de evolução de volume.
  - Painel de barras de progresso percentual por status (`statusBarClass`).
  - Gráfico de barras de dias da semana mais concorridos.
  - Tabela ranqueada de agendamentos por profissional.

### 4.3 Guia de Edição dos Indicadores
- **Adicionar uma nova opção de agrupamento (ex: Trimestre):**
  1. Em `overview-utils.ts`, expanda o tipo `OverviewPeriod = "semana" | "mes" | "ano" | "trimestre"`.
  2. Adicione a lógica de intervalo na função de sumarização.
  3. No componente `DashboardPage.tsx`, adicione a opção no `SegmentedControl` da linha 83.

---

## 5. TELA 4: AGENDA MÉDICA & ATENDIMENTOS

```
=============================================================================
ROTA: /agenda (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/agenda.tsx (523 linhas)
COMPONENTES: src/features/agenda/components/ (DailyGrid, WeeklyGrid, MonthGrid,
             ListView, ActivityDrawer, AgendaToolbar, AgendaHeader, WhatsAppReminderButton,
             AddToGoogleCalendarButton)
SIDEBAR: src/components/agenda/AgendaSidebar.tsx
MODAIS: src/components/agenda/agenda-modals.tsx, novo-agendamento-dialog.tsx
HOOKS: use-agenda-data.ts, use-agenda-mutations.ts, use-agenda-filters.ts,
       use-agenda-keyboard.ts, use-agenda-deep-link.ts
=============================================================================
```

### 5.1 Visão Geral da Tela
A Agenda é o coração operacional do MedCore. Oferece visualização em 4 formatos intercambiáveis, suporte a arrastar e soltar (Drag and Drop), redimensionamento de horários, filtros avançados por cidade, integração com WhatsApp para lembretes de consulta e sincronização com Google Calendar.

### 5.2 Modos de Exibição
1. **Grade Diária (`DailyGrid.tsx`):** Exibe a linha do tempo do dia das 07:00 às 21:00, com linha vermelha indicadora do horário exato atual em tempo real. Permite visualizar colunas de múltiplos profissionais simultaneamente.
2. **Grade Semanal (`WeeklyGrid.tsx`):** Visão padrão para desktop, dividindo a semana em 7 colunas verticais com horários e cards dimensionados de acordo com a duração do procedimento.
3. **Grade Mensal (`MonthGrid.tsx`):** Calendário tradicional com blocos compactos para visão de médio prazo.
4. **Visualização em Lista (`ListView.tsx`):** Linha do tempo linear e acessível, otimizada para recepção em telas compactas e celulares.

### 5.3 Painel de Filtros Laterais (`AgendaSidebar.tsx`)
- Mini calendário mensal para salto rápido de data.
- Checkboxes dinâmicos com contadores de quantidade para:
  - Tipo de evento: Consulta médica, Retorno, Procedimento, Cirurgia, Tarefa interna, Prazo.
  - Status: Agendado, Confirmado, Em atendimento, Concluído, Cancelado, Falta.
  - Profissionais vinculados à clínica.
  - Cidades de atendimento (conforme cadastrado em configurações).

### 5.4 Gaveta de Ações do Agendamento (`ActivityDrawer.tsx`)
Aberta lateralmente ao clicar em qualquer consulta na grade. Permite:
- Visualizar todos os dados do paciente (nome, telefone, convênio).
- **Botão "WhatsApp":** Dispara mensagem formatada ("Olá [Nome], confirmamos sua consulta com Dr. Jonatas Bandeira...").
- **Botão "Google Calendar":** Adiciona o evento diretamente na agenda do Google do operador ou paciente.
- **Botão "Prontuário":** Encaminha imediatamente para `/prontuario?patientId=...` já com o paciente carregado para atendimento.
- **Botão "Concluir":** Atualiza o status para concluído com um clique.
- **Edição & Exclusão:** Altera data, horário e médico, ou remove com confirmação segura.

### 5.5 Drag & Drop e Redimensionamento
- `handleReschedule(activity, newDate)`: Captura o evento arrastado e recalcula o horário mantendo a mesma duração.
- `handleResize(activity, newStart, newEnd)`: Captura o redimensionamento da borda inferior do card e altera o horário de término no banco.

### 5.6 Atalhos de Teclado (`useAgendaKeyboard`)
- `Seta para Esquerda`: Período anterior (dia/semana/mês).
- `Seta para Direita`: Próximo período.
- `T`: Volta para a data de hoje.
- `N`: Abre o diálogo de novo agendamento.

### 5.7 Guia de Edição da Agenda
- **Alterar o intervalo de horários visíveis (ex: começar às 06:00 e ir até às 22:00):**
  - Edite as constantes `START_HOUR` e `END_HOUR` em `DailyGrid.tsx` e `WeeklyGrid.tsx`.
- **Adicionar um novo tipo de agendamento (ex: "Teleconsulta"):**
  1. Em `src/components/agenda/agenda-types.ts`, adicione `"teleconsulta"` ao tipo `ActivityKind`.
  2. Em `src/features/agenda/components/KindIcon.tsx`, adicione o ícone correspondente (ex: `Video` do Lucide).
  3. No arquivo `novo-agendamento-dialog.tsx`, adicione a opção no seletor de tipo de atendimento.

---

## 6. TELA 5: GESTÃO DE PACIENTES

```
=============================================================================
ROTA: /pacientes (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/pacientes.tsx (671 linhas)
COMPONENTES: src/components/pacientes/ (PatientModal.tsx, PatientFullProfileView.tsx,
             PatientFinanceTab.tsx, PatientPackagesTab.tsx)
VIRTUALIZAÇÃO: react-virtuoso (TableVirtuoso, Virtuoso)
TABELA: @tanstack/react-table
=============================================================================
```

### 6.1 Visão Geral da Tela
Listagem completa e cadastro geral dos pacientes da clínica. Utiliza tabelas virtualizadas (`react-virtuoso`) para garantir performance máxima (60 FPS contínuos) mesmo com bases de mais de 10.000 pacientes.

### 6.2 Recursos & Anatomia de Código
- **Colunas da Tabela Virtualizada (linhas 77-95):**
  1. `Paciente`: Nome completo com avatar de iniciais.
  2. `Contato`: Telefone mascarado `(99) 99999-9999` e/ou e-mail.
  3. `CPF`: Exibição protegida com máscara.
  4. `Idade`: Calculada automaticamente com base na data de nascimento (`patientAge`).
  5. `Convênio`: Ex: "Particular", "Unimed", etc.
  6. `Status`: Badge visual verde para Ativo e cinza para Inativo.
  7. `Ações`: Dropdown menu com opções.
- **Filtros e Busca:**
  - Campo de busca instantânea que pesquisa em nome, CPF, telefone ou e-mail.
  - Filtro por status via `SegmentedControl`: `Todos`, `Ativos`, `Inativos`.
- **Ações Disponíveis por Paciente:**
  - `Ver Prontuário`: Redireciona diretamente para a tela de atendimento do prontuário eletrônico.
  - `Ver Ficha Completa`: Abre o modal `PatientFullProfileView` contendo perfil, endereço, histórico de consultas, aba financeira (`PatientFinanceTab`) e pacotes (`PatientPackagesTab`).
  - `Editar Dados`: Abre o formulário `PatientModal`.
  - `Ativar / Inativar`: Alterna status no banco via `supabase.from("patients").update(...)`.
  - `Excluir`: Exclusão definitiva com diálogo de segurança `confirmDialog()`.

### 6.3 Modal de Cadastro & Edição (`PatientModal.tsx`)
- Campos suportados:
  - Dados Pessoais: Nome completo, CPF, RG, Data de nascimento, Sexo biológico.
  - Contato: Celular/WhatsApp, Telefone fixo, E-mail.
  - Endereço Completo: CEP com preenchimento automático via API ViaCEP, Logradouro, Número, Complemento, Bairro, Cidade e UF.
  - Dados Clínicos / Convênio: Tipo de atendimento, Nome do convênio, Número da carteirinha, Alergias conhecidas e Observações gerais.
- Validação estruturada com Zod e formatação automática de máscaras (CPF, telefone, CEP).

### 6.4 Guia de Edição da Tela de Pacientes
- **Adicionar uma nova coluna na tabela de pacientes (ex: "Profissão"):**
  1. Em `src/routes/_authenticated/pacientes.tsx`, no array `columns`, adicione:
     ```tsx
     columnHelper.accessor("profession", { header: "Profissão" }),
     ```
  2. No componente `TableVirtuoso`, renderize a nova célula dentro do `itemContent`.
- **Tornar o CPF visível sem máscara:**
  - No accessor de CPF, substitua o utilitário de mascaramento por exibição direta do valor ou máscara padrão `999.999.999-99`.

---

## 7. TELA 6: PRONTUÁRIO ELETRÔNICO & ATENDIMENTO CLÍNICO

```
=============================================================================
ROTA: /prontuario (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/prontuario.tsx (22 linhas)
COMPONENTE PRINCIPAL: src/components/prontuario/ProntuarioPage.tsx (1360 linhas)
RECEPCÃO / HUB: src/components/prontuario/ProntuarioHub.tsx
IA / ASSISTENTE: src/components/prontuario/AiRecordAssistantModal.tsx
FOTOS: src/features/acompanhamentos/ClinicalPhotos.tsx
HISTÓRICO: src/hooks/usePatientClinicalHistory.ts
=============================================================================
```

### 7.1 Visão Geral & Modos de Operação
O Prontuário Médico possui dois estados principais:
- **Estado 1: Prontuário Hub (`ProntuarioHub`):** Exibido quando nenhum paciente está em atendimento. Apresenta barra de busca rápida, pacientes agendados para hoje e últimos prontuários abertos.
- **Estado 2: Atendimento Ativo:** Exibido quando a URL possui `?patientId=...` ou `?patientName=...`. Abre o prontuário completo do paciente.

### 7.2 Anatomia do Atendimento Ativo
1. **Cabeçalho Clínico do Paciente (linhas 250-340):**
   - Nome, idade calculada, gênero, dados de contato e badges de alertas médicos (ex: "Hipertenso", "Diabético Tipo 2", "Alergia a Dipirona").
   - Botão "Trocar de Paciente" (retorna ao Hub).
   - Botão "Histórico Clínico" (abre gaveta lateral com todas as consultas passadas em ordem cronológica).
   - **Indicador de Salvamento em Tempo Real:** Badges com estados `"Salvo"`, `"Salvando alterações..."` e `"Alterações pendentes"`.
2. **Abas Clínicas:**
   - **Aba 1: Anamnese & Evolução:**
     - Editor de Texto Enriquecido (Rich Text) completo com botões de formatação: Negrito, Itálico, Sublinhado, Riscado, Alinhamento de parágrafo, Título 1, Título 2, Lista com marcadores, Lista numérica, Desfazer, Refazer e Limpar estilos.
     - **Assistente de IA Médica (`AiRecordAssistantModal.tsx`):** Integração com o Google Gemini. O médico pode ditar o atendimento por áudio ou colar anotações livres; a IA estrutura os dados nos padrões de consulta:
       - Queixa Principal (QP)
       - História da Doença Atual (HDA)
       - Antecedentes Pessoais e Familiares
       - Exame Físico e Dados Antropométricos
       - Hipótese Diagnóstica e CID-10
       - Conduta Terapêutica e Prescrição
   - **Aba 2: Orçamento Clínico:**
     - Montagem de orçamentos de tratamentos, seleção de procedimentos tabelados, descontos, parcelamento e impressão de proposta clínica.
   - **Aba 3: Plano de Tratamento:**
     - Definição das metas terapêuticas do paciente, cronograma de sessões e datas previstas de acompanhamento.
   - **Aba 4: Fotos Clínicas (`ClinicalPhotos.tsx`):**
     - Galeria com upload de imagens com categorias (Antes, Depois, Exames).
     - Comparador visual interativo de Antes e Depois com slider deslizante lado a lado.
   - **Aba 5: Procedimentos Injetáveis:**
     - Registro de aplicações (toxina botulínica, preenchedores de ácido hialurônico, bioestimuladores).
     - Registro de lotes, marcas, quantidades em unidades/ml e marcação anatômica.

### 7.3 Guia de Edição do Prontuário
- **Adicionar uma nova aba no prontuário (ex: "Exames Laboratoriais"):**
  1. Em `src/components/prontuario/ProntuarioPage.tsx`, no tipo `TabKey`, adicione `"exames"`.
  2. No array `TABS` (linhas 93-99), adicione `{ key: "exames", label: "Exames laboratoriais" }`.
  3. No bloco de renderização de abas (linhas 450+), renderize o seu novo componente quando `tab === "exames"`.
- **Customizar o prompt da Inteligência Artificial:**
  - Abra `src/components/prontuario/AiRecordAssistantModal.tsx` e edite o system prompt que instrui o Gemini a formatar os dados clínicos.

---

## 8. TELA 7: ACOMPANHAMENTOS CLÍNICOS & PROTOCOLOS

```
=============================================================================
ROTA: /acompanhamentos (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/acompanhamentos.tsx (2969 linhas)
COMPONENTES: src/features/acompanhamentos/ (TreatmentAlerts.tsx, ClinicalFollowup.tsx)
BANCO SUPABASE: treatments, treatment_sessions, transactions
=============================================================================
```

### 8.1 Visão Geral da Tela
Gerencia tratamentos continuados e protocolos de longa duração (ex: emagrecimento, modulação hormonal, estética avançada). Conecta metas médicas com o faturamento da clínica.

### 8.2 Modos de Visualização & Recursos
- **Visualizações Alternáveis:**
  - **Cards em Grid:** Visualização visual em grade com cartões detalhados.
  - **Tabela:** Visão condensada para conferência de datas e valores.
  - **Kanban:** Colunas dinâmicas divididas por status do tratamento:
    - *Em andamento*
    - *Pausado*
    - *Finalizado*
    - *Cancelado*
- **KPI Cards de Topo:**
  - Total de protocolos ativos.
  - Tratamentos em andamento.
  - Retornos previstos nos próximos 7 dias.
  - Valor total contratado em tratamentos.
- **Painel de Alertas Clínicos (`TreatmentAlerts`):**
  - Notifica automaticamente quando um paciente está com o retorno atrasado além do intervalo programado (`return_days`) ou quando um ciclo medicamentoso está terminando.

### 8.3 Modal de Criação de Tratamento (`NewTreatmentModal`)
O diferencial deste módulo é a **amarração clínica-financeira automática**:
- O operador seleciona: Paciente, Médico responsável, Nome do protocolo, Objetivo terapêutico, Data de início, Previsão de término e Intervalo de retornos em dias.
- Na aba financeira do modal: Valor total, Valor da entrada, Desconto, Quantidade de parcelas e Meio de pagamento.
- **Ao salvar:** Além de inserir o registro na tabela `treatments`, o sistema cria imediatamente os títulos financeiros correspondentes na tabela `transactions` vinculados ao paciente e à clínica, garantindo que o caixa e o contas a receber fiquem 100% conciliados.

### 8.4 Guia de Edição dos Acompanhamentos
- **Adicionar uma nova coluna no Kanban de tratamentos:**
  1. Em `src/routes/_authenticated/acompanhamentos.tsx`, edite o enum de status em `Treatment["status"]` (linha 73).
  2. Adicione a cor e rótulo no dicionário `STATUS_LABEL` (linhas 95-100).
  3. Adicione a coluna no loop de renderização do modo Kanban.

---

## 9. TELA 8: DETALHES DO ACOMPANHAMENTO CLÍNICO

```
=============================================================================
ROTA: /acompanhamentos/$id (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/acompanhamentos.$id.tsx (1183 linhas)
COMPONENTES: src/features/acompanhamentos/ (ClinicalFollowup.tsx, MedicationUsePanel.tsx,
             TreatmentFinance.tsx)
=============================================================================
```

### 9.1 Visão Geral da Tela
Página dedicada a um protocolo clínico específico identificado pelo seu UUID na URL (`/acompanhamentos/$id`).

### 9.2 Abas de Detalhes
1. **Aba 1: Resumo do Tratamento:**
   - Barra de progresso dos dias transcorridos vs total de dias do plano.
   - Contagem regressiva para o próximo retorno médico.
   - Botão direto para iniciar conversa no WhatsApp do paciente.
   - Ações de alteração de status (Pausar tratamento, Finalizar com sucesso, Cancelar).
2. **Aba 2: Medicações & Suplementação (`MedicationUsePanel`):**
   - Prescrições vinculadas ao protocolo.
   - Divisão visual por turnos de ingestão: *Manhã*, *Almoço*, *Tarde*, *Noite*.
   - Checkboxes de conferência de adesão e cálculo de duração dos frascos/cápsulas.
3. **Aba 3: Evolução Clínica & Sessões (`ClinicalFollowup`):**
   - Registro de sessões realizadas com notas de evolução médica.
   - Parâmetros antropométricos: Peso (kg), Altura, IMC, Percentual de gordura corporal (%GC) e Massa muscular esquelética.
   - Gráficos de linha demonstrando a curva de evolução do paciente ao longo do tratamento.
4. **Aba 4: Financeiro do Protocolo (`TreatmentFinance` & `PlanPayments`):**
   - Extrato exclusivo das parcelas do tratamento.
   - Identificação visual de parcelas quitadas e pendentes.
   - Botão para dar baixa no recebimento direto pela tela do tratamento.

---

## 10. TELA 9: MÓDULO FINANCEIRO COMPLETO

```
=============================================================================
ROTA: /financeiro (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/financeiro.tsx (212 linhas)
ABAS & RECURSOS: src/features/finance/ (CashFlow.tsx, ContasPagarTab.tsx,
                 ContasReceberTab.tsx, BankReconciliation.tsx, CategoriesManager.tsx,
                 NewTitle.tsx, PaymentHistory.tsx, OperationForm.tsx)
API & CÁLCULOS: src/features/finance/finance-api.ts, finance-math.ts, cash-flow-math.ts
=============================================================================
```

### 10.1 Visão Geral
Sistema completo de gestão financeira clínica, abrangendo fluxo de caixa diário e projetado, contas a pagar, contas a receber, conciliação bancária via extrato OFX e plano de contas por categorias.

### 10.2 Abas do Módulo Financeiro
1. **Fluxo de Caixa (`CashFlow.tsx`):**
   - Resumo de Saldo em Contas, Total Entrado, Total Saído e Saldo do Período.
   - Gráfico de movimentações financeiras com projeção de recebimentos futuros.
   - Filtros por conta bancária específica ou visão consolidada da clínica.
2. **Contas a Pagar (`ContasPagarTab.tsx`):**
   - Gestão de compromissos com fornecedores, aluguel, laboratórios, compras de insumos e comissões médicas.
   - Badges de situação: *Vencido*, *Vence Hoje*, *A Vencer*, *Pago*.
   - Baixa de título com escolha da conta bancária de saída, data real do pagamento e anexo de comprovante.
3. **Contas a Receber (`ContasReceberTab.tsx`):**
   - Controle de recebimentos de consultas particulares, convênios médicos e parcelas de acompanhamentos clínicos.
   - Registro de recebimento com cálculo automático de taxas de operadoras de cartão de crédito.
   - Emissão de comprovante/recibo.
4. **Conciliação Bancária (`BankReconciliation.tsx`):**
   - Leitor e parser de arquivos de extrato bancário `.OFX`.
   - Comparação inteligente entre os lançamentos do extrato do banco e os títulos cadastrados no sistema.
   - Permite conciliar títulos existentes ou gerar novos lançamentos com 1 clique a partir das linhas do extrato.
5. **Categorias Financeiras (`CategoriesManager.tsx`):**
   - Árvore de plano de contas (Receitas Operacionais, Custos Variáveis, Despesas Fixas, Impostos).
   - Gerenciamento de cores e ícones para categorização nos gráficos do dashboard.

### 10.3 Modal de Lançamento & Edição de Título (`NewTitle.tsx` e `OperationForm.tsx`)
- Suporta lançamentos únicos, recorrentes ou parcelados.
- Ao selecionar parcelamento (ex: 6x), gera automaticamente as 6 parcelas com datas de vencimento mensais sucessivas.
- **Proteção de Saída de Tela (`useBlocker`):** Impede que o usuário troque de página acidentalmente se houver dados digitados e não salvos no formulário.

---

## 11. TELA 10: CONTROLE DE ESTOQUE & INSUMOS

```
=============================================================================
ROTA: /estoque (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/estoque.tsx (729 linhas)
BANCO SUPABASE: inventory_items, inventory_movements
SERVIÇO: src/services/api/inventory.service.ts
=============================================================================
```

### 11.1 Visão Geral
Controle patrimonial e de validade dos medicamentos, seringas, agulhas, suplementos e materiais descartáveis utilizados nos procedimentos da clínica.

### 11.2 Anatomia dos Indicadores & Tabela
- **KPI Cards de Topo:**
  1. *Itens em Estoque:* Quantidade total de itens cadastrados no inventário.
  2. *Estoque Baixo:* Itens cuja quantidade em estoque está menor ou igual à quantidade mínima de segurança (`quantity <= min_quantity`).
  3. *Validade Crítica:* Produtos que vencerão nos próximos 30 dias.
  4. *Valor Patrimonial:* Soma total do valor imobilizado em produtos (`quantity * unit_cost`).
- **Colunas da Tabela:**
  - Código/SKU, Nome do Insumo, Categoria, Quantidade Atual e Unidade de Medida (`un`, `ml`, `frasco`, `cx`, `ampola`), Ponto de Pedido (Quantidade Mínima), Data de Validade (com alerta visual em vermelho se vencido e amarelo se próximo), Fornecedor, Custo Unitário e Localização física (armário, gaveta, sala).
- **Modais Integrados:**
  - **Novo / Editar Item:** Formulário completo para cadastro do produto.
  - **Movimentação de Estoque:** Registra operações de **Entrada** (compra, devolução) ou **Saída** (utilização em procedimento clínico, descarte por vencimento, perda), atualizando o saldo do produto no banco e gravando um histórico na tabela `inventory_movements`.

---

## 12. TELA 11: RELATÓRIOS & BI ANALÍTICO

```
=============================================================================
ROTA: /relatorios (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/relatorios.tsx (643 linhas)
CATEGORIAS: Financeiro, Clínico, Operacional, Estoque
EXPORTAÇÃO: CSV / Planilhas
=============================================================================
```

### 12.1 Visão Geral & Pilares Analíticos
Painel analítico para tomada de decisões estratégicas da gestão da clínica com filtros temporais de `7 dias`, `30 dias`, `90 dias` e `12 meses`.

### 12.2 Quatro Módulos de Inteligência
1. **Relatório Financeiro:**
   - DRE Operacional simplificado: Receitas Realizadas, Despesas Pagas, Lucro Líquido do Período e Margem Operacional.
   - Gráfico de colunas comparativo de Receitas versus Despesas mês a mês.
   - Gráfico Donut de Despesas por Categoria para identificação de centros de custo com maior impacto.
2. **Relatório Clínico:**
   - Novos pacientes conquistados no período.
   - Tratamentos iniciados vs concluídos e taxa de conclusão de protocolos.
   - Distribuição de pacientes por gênero e faixas etárias.
3. **Relatório Operacional:**
   - Volume total de agendamentos realizados.
   - Taxas de confirmação, comparecimento e absenteísmo (no-show/faltas).
   - Análise de ocupação por dias da semana e horários de pico.
4. **Relatório de Estoque:**
   - Consumo de insumos no período selecionado.
   - Relação de entradas versus saídas e itens de maior giro.
- **Exportação:** Botão "Exportar Relatório" gera arquivo `.csv` formatado compatível com Excel e Google Sheets.

---

## 13. TELA 12: CONFIGURAÇÕES GERAIS DA CLÍNICA

```
=============================================================================
ROTA: /configuracoes (Autenticada)
ARQUIVO ROTA: src/routes/_authenticated/configuracoes.tsx (809 linhas)
COMPONENTES: Dados da Clínica, Serviços e Preços, Categorias, Contas Financeiras,
             Cidades de Atendimento (useClinicCities)
=============================================================================
```

### 13.1 Seções de Configuração
1. **Dados da Clínica:**
   - Nome fantasia, Razão Social, CNPJ, CRM/RQE do responsável técnico.
   - Telefones de contato, WhatsApp comercial da recepção.
   - Endereço completo da sede da clínica.
   - Horários padrão de abertura e fechamento do consultório.
2. **Serviços & Procedimentos:**
   - Tabela de procedimentos oferecidos (ex: "Consulta Nutrológica", "Bioimpedância", "Aplicação de Injetável").
   - Preço padrão particular e convênio, duração estimada em minutos e percentual de comissão médica.
   - Modal para cadastrar, editar e inativar procedimentos.
3. **Categorias Financeiras:**
   - Acesso ao gerenciador de plano de contas de receitas e despesas.
4. **Contas Financeiras & Caixas (`FinanceOperations`):**
   - Cadastro de contas bancárias (Banco do Brasil, Itaú, Bradesco, Santander, Nubank, etc.).
   - Cadastro de caixas físicos (gaveta da recepção).
   - Cadastro de máquinas de cartão com taxas de débito e crédito parcelado.
5. **Cidades de Atendimento (`useClinicCities`):**
   - Configuração das cidades onde a equipe atende. Alimenta os filtros e formulários de agendamento na Agenda médica.

---

## 14. TELA 13: ADMINISTRAÇÃO, USUÁRIOS & PERMISSÕES

```
=============================================================================
ROTA: /admin (Autenticada / Restrita a Gestores)
ARQUIVO ROTA: src/routes/_authenticated/admin.tsx (36 linhas)
COMPONENTE: src/features/admin/AdminPage.tsx (203 linhas)
ABAS: UsersTab.tsx, RolesTab.tsx, AuditTab.tsx
PERMISSÕES: src/features/admin/permissions.ts, PermissionMatrix.tsx
=============================================================================
```

### 14.1 Visão Geral & Segurança
Painel de controle de governança da clínica. Garante o controle total sobre quem acessa o sistema e quais informações cada colaborador pode visualizar ou alterar.

### 14.2 Abas de Gestão
1. **Usuários & Equipe (`UsersTab.tsx`):**
   - Listagem de membros da clínica com status: *Ativo*, *Pendente de Aceite* ou *Bloqueado*.
   - Associação de usuário a um perfil de profissional médico cadastrado (`doctor_id`).
   - **Configuração do Escopo de Agenda (`agendaScope`):**
     - `own`: Médico visualiza estritamente os seus próprios pacientes e horários.
     - `selected`: Secretária ou assistente visualiza a agenda apenas dos médicos selecionados.
     - `all`: Gestor ou recepção geral visualiza a agenda de toda a clínica.
   - Diálogo de Convite (`InviteDialog`): Envia convite por e-mail com link de primeiro acesso.
   - Edição de Membro (`MemberSheet`): Altera nome, papel e escopo de permissões.
2. **Perfis & Matriz de Permissões (`RolesTab.tsx` & `PermissionMatrix.tsx`):**
   - Papéis padrão: *Administrador*, *Médico*, *Recepcionista / Secretária*, *Financeiro*.
   - Matriz interativa de permissões granulares:
     - `agenda.view`, `agenda.manage`
     - `patients.view`, `patients.manage`
     - `clinical.records` (prontuário)
     - `finance.view`, `finance.manage`, `finance.accounts`
     - `inventory.view`, `inventory.manage`
     - `settings.manage`
     - `users.view`, `roles.manage`, `audit.view`
   - Checkboxes reativos que salvam a permissão diretamente no Supabase com atualização imediata para todos os usuários logados.
3. **Auditoria de Ações & Segurança (`AuditTab.tsx`):**
   - Histórico em tempo real de auditoria (`activity_logs`):
     - Data e hora precisa do evento.
     - Nome e e-mail do operador responsável.
     - Ação realizada (ex: `paciente.criado`, `agendamento.remarcado`, `titulo.pago`, `permissao.alterada`).
     - Detalhes das alterações (valores anteriores versus novos valores).

---

## 15. MAPA DE TABELAS DO BANCO DE DADOS SUPABASE

| Tabela Supabase | Finalidade Principal no MedCore | Telas que Consomem/Gravam |
| :--- | :--- | :--- |
| `patients` | Cadastro central de pacientes e dados de contato | Pacientes, Agenda, Prontuário, Acompanhamentos, Dashboard |
| `appointments` | Agendamentos clínicos e status de atendimento | Agenda, Visão Geral, Dashboard, Prontuário, Relatórios |
| `events` | Tarefas internas, prazos e reuniões da equipe | Agenda, Dashboard |
| `treatments` | Protocolos e acompanhamentos continuados | Acompanhamentos, Acompanhamentos/$id, Prontuário, Relatórios |
| `treatment_sessions` | Sessões de evolução clínica do protocolo | Acompanhamentos/$id |
| `treatment_medication_uses` | Uso e adesão medicamentosa por turno | Acompanhamentos/$id |
| `transactions` | Títulos financeiros de receitas e despesas | Financeiro, Dashboard, Acompanhamentos, Relatórios |
| `transaction_payments` | Baixas, pagamentos parciais e liquidações | Financeiro, Dashboard |
| `categories` | Categorias do plano de contas financeiro | Financeiro, Configurações, Dashboard |
| `financial_accounts` | Contas bancárias, carteiras digitais e caixas | Financeiro, Configurações |
| `inventory_items` | Itens e insumos do estoque da clínica | Estoque, Relatórios |
| `inventory_movements` | Histórico de entradas e saídas de insumos | Estoque, Relatórios |
| `company_members` | Vínculo de usuários às empresas/clínicas | Admin, AppShell, Agenda, Visão Geral |
| `user_roles` | Papéis atribuídos a cada colaborador | Admin, AppShell, permissions |
| `role_permissions` | Matriz de permissões por perfil | Admin, permissions |
| `activity_logs` | Logs de auditoria e segurança | Admin (AuditTab) |

---

## 16. GUIA RÁPIDO DE TROUBLESHOOTING & COMANDOS DE VERIFICAÇÃO

### Regras Mandatórias do Projeto (AGENTS.md)
1. **Deploy:** Push no branch `main` do GitHub publica automaticamente na Vercel (projeto `medcoreapp`).
2. **Histórico:** Não realizar force push, rebase ou amend em commits já enviados.
3. **Checagem de Saúde do Código:** Sempre rodar a validação de tipos antes de enviar alterações:
   ```powershell
   cmd.exe /c npx tsc --noEmit
   ```
4. **Banco de Dados:** Qualquer nova tabela, coluna ou política RLS deve ser criada em arquivo SQL sob `supabase/migrations/` e aplicada no console do Supabase.

---
*Documento de Auditoria e Especificação Técnica gerado com sucesso.*

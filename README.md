# MedCore � Sistema de Gest�o Cl�nica e Prontu�rio Eletr�nico

Sistema completo para cl�nicas m�dicas, gest�o de pacientes, agenda inteligente, prontu�rio eletr�nico (PEP), financeiro e copiloto de IA cl�nica, em estrita conformidade com a **LGPD (Lei Geral de Prote��o de Dados)** e padr�es de seguran�a de dados de sa�de (**PHI**).

---

## ??? Arquitetura do Sistema

- **Frontend**: [React 19](https://react.dev/), [TanStack Start](https://tanstack.com/start), [TanStack Router](https://tanstack.com/router), [TanStack Query](https://tanstack.com/query), Tailwind CSS v4, Radix UI, Framer Motion.
- **Backend (BFF / Core API)**: PHP 8.2+ REST API de alta performance com arquitetura MVC limpa, JWT HS256 com claims RFC 7519, rate limiting e isolamento multi-tenant estrito.
- **Banco de Dados Prim�rio**: Supabase PostgreSQL (com RLS e `security_invoker = on`) + SQLite local para armazenamento de storage e BFF.
- **IA / Copiloto Cl�nico**: Google Gemini (executado 100% via Proxy Server-Side com anonimiza��o e minimiza��o pr�via de PHI).

---

## ?? Seguran�a e Conformidade LGPD

1. **Isolamento Multi-Tenant**: Toda consulta, atualiza��o e exclus�o � estritamente vinculada ao `company_id` validado criptograficamente no token JWT. Acesso cruzado entre cl�nicas retorna `HTTP 404 Not Found`.
2. **Prote��o de PHI**: Nenhum dado de sa�de � armazenado em texto claro no `localStorage` ou `sessionStorage` do navegador.
3. **Chaves de API Isoladas**: Chaves mestras (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) residem exclusivamente no servidor e nunca vazam para o bundle JavaScript de produ��o.
4. **JWT Hardening**: Tokens com validade curta (30 minutos), identificador �nico `jti`, claims `iss`/`aud`, rejei��o de `alg: none` e lista de revoga��o de tokens (logout seguro).
5. **CORS Restrito**: Apenas origens explicitamente configuradas em `CORS_ALLOWED_ORIGINS` recebem cabe�alhos de acesso com credenciais.
6. **Pre-commit Secrets Scanner**: Script automatizado (`scripts/check-secrets.js`) que impede commits acidentais de segredos ou bancos de dados.

---

## ?? Instala��o e Execu��o

### Pr�-requisitos
- **Node.js**: v20+ e npm
- **PHP**: v8.2+ com extens�es `pdo_sqlite` e `curl`

### 1. Clonar e Instalar Depend�ncias
```bash
git clone https://github.com/Guix1906/MedCore.git
cd MedCore
npm install
```

### 2. Configurar Vari�veis de Ambiente
Copie os modelos de vari�veis de ambiente:
```bash
# Frontend (.env)
cp .env.example .env

# Backend (backend/.env)
cp backend/.env.example backend/.env
```

Gere uma chave segura para `JWT_SECRET` no arquivo `backend/.env` (m�nimo 32 caracteres).

### 3. Migra��o do Banco de Dados
```bash
php backend/cli/migrate.php
```

### 4. Executar em Desenvolvimento
```bash
# Terminal 1: Backend PHP
php -S 127.0.0.1:8000 -t backend/public

# Terminal 2: Frontend TanStack Start / Vite
npm run dev
```

---

## ?? Testes Automatizados

O projeto inclui su�tes de testes de seguran�a, multi-tenant e regras financeiras:

```bash
# 1. Testes de Isolamento Multi-Tenant (Garante que Cl�nica A n�o acessa Cl�nica B)
php -c backend/php.ini backend/tests/test_multitenant.php

# 2. Testes de Seguran�a Criptogr�fica do JWT (Validade, Algoritmos, Revoga��o)
php -c backend/php.ini backend/tests/test_jwt.php

# 3. Testes de Matem�tica e Equival�ncia Financeira
node scripts/test-financial-math.js

# 4. Verifica��o Est�tica de Tipos TypeScript
npx tsc --noEmit

# 5. Verifica��o de Linter
npm run lint
```

---

## Financeiro: titulos e baixas

O financeiro do frontend usa o Supabase como fonte unica; nao alterna para o PHP em caso de falha. A API PHP legada nao recebe novas baixas deste fluxo. Antes da troca em producao, reconcilie eventuais registros exclusivos do PHP: estas migracoes nao os importam automaticamente.

Aplique primeiro `20260919140000_treatment_followup.sql` e depois `20260919160000_financial_settlements.sql`, em homologacao com backup. A segunda migracao conserva os titulos, converte pagamentos integrais existentes em eventos identificados como legado e bloqueia a migracao se encontrar baixas parciais sem historico ou valores inconsistentes. Conta/data/autoria ausentes nao sao inventadas. As migracoes locais nao comprovam aplicacao no banco publicado.

Baixas novas exigem valor, data, forma, conta da mesma clinica e identificador de solicitacao. O banco serializa concorrencia, rejeita excesso sobre o saldo e preserva estornos com justificativa. Estorno corrige uma baixa incorreta; nao representa devolucao real. Titulos com historico, mesmo estornado, nao podem ser excluidos ou regenerados. As parcelas de tratamentos usam o mesmo historico do financeiro geral.

Recebido/pago sao calculados pelos eventos ativos, em suas datas; a receber/pagar usa saldo residual por vencimento. O resultado das baixas inclui recebiveis de cartao: nao e lucro nem saldo bancario. Comprovantes impressos nao sao documentos fiscais.

A agenda gera uma unica cobranca pendente por evento. Conclusao de atendimento e sinal informado na agenda nao confirmam pagamento: a baixa deve ser registrada no Financeiro. Falhas de sincronizacao sao apresentadas e nao criam registros sem paciente/origem como alternativa.

Revise os papeis antes da publicacao: owner/admin/finance_admin podem administrar; finance_edit pode lancar/baixar; finance_view pode consultar. No cadastro legado sem company_id, administradores e recepcionistas ativos tem acesso operacional, mas recepcionistas nao pagam despesas nem estornam. Registros legados sem empresa continuam explicitamente separados, sem atribuicao automatica de clinica. As permissoes financeiras nao concedem acesso ao prontuario.

### Fluxo de caixa por conta

Depois das duas migracoes anteriores, aplique `20260919180000_financial_cash_flow.sql` em homologacao antes de publicar esta versao. A migracao de baixas anterior teve delimitadores SQL corrigidos; use o arquivo atualizado. Nenhuma dessas alteracoes comprova aplicacao no ambiente publicado.

A aba Fluxo de caixa calcula, por clinica, conta e periodo, saldo anterior, recebimentos, pagamentos, resultado do periodo, transferencias liquidas e saldo final. Contas inativas continuam no historico. Os valores sao registros administrativos: nao sao consulta nem conciliacao automatica do banco. Nao se usa o campo legado current_balance como saldo oficial.

Somente administradores financeiros (permissao accounts) confirmam a abertura e registram/corrigem transferencias. A abertura exige saldo real conferido, data, natureza (caixa/banco ou recebiveis de cartao) e referencia, com autoria e auditoria. O valor e o saldo no inicio do dia informado: movimentos daquele dia entram depois; os anteriores ja estao incorporados. Saldos legados sem data nao sao presumidos. Contas nao classificadas ou sem abertura valida para o periodo deixam o consolidado pendente, em vez de simular saldo zero. Aberturas confirmadas nao podem ser reescritas pela interface; eventuais erros exigem conciliacao administrativa auditada.

Transferencias usam a tabela existente, sem criar receitas/despesas, com duas contas da mesma clinica, identificador estavel da solicitacao e historico de correcao. O registro nao executa transferencia, nao consulta fundos nem impede saldo administrativo negativo. Estorno corrige um registro errado e recalcula periodos anteriores; dinheiro efetivamente transferido de volta exige outro movimento. Repetir uma solicitacao com os mesmos dados nao duplica o registro.

Recebiveis de cartao sao exibidos separadamente da disponibilidade. Contas classificadas rejeitam baixas de natureza incompativel e transferencias internas comuns nao liquidam adquirentes. Contas ainda nao classificadas podem continuar recebendo baixas, mas nao tem saldo oficial exibido; classifique e confira antes de usar os saldos. A abertura recusa historico posterior a sua data que misture cartoes com outros meios. Baixas legadas/sem conta sao sinalizadas, sem atribuir uma conta por suposicao.

### Financeiro operacional

A navegacao possui somente **Fluxo de Caixa, Contas a Pagar, Contas a Receber, Conciliacao OFX, DRE e DFC**. A abertura padrao e o Fluxo de Caixa. Nao existem grupos, Visao Geral ou submenus operacionais redundantes. Links antigos de extrato/lancamentos abrem o fluxo; planos levam a receber; repasses levam a pagar; relatorios levam a DRE. Em telas pequenas, um seletor substitui a barra de secoes.

Pagar e Receber compartilham busca, situacao, vencimentos, resumo compacto e tabela. Abrem com todos os saldos pendentes, sem recorte mensal. O resumo considera a busca e a clinica, independente do periodo/situacao da lista, conforme indicado na tela. Parcelas de um mesmo plano sao agrupadas e expansiveis; os pagamentos continuam no mesmo historico usado na ficha do paciente. Recebimentos parciais e saldos livres existentes sao preservados. Valores sem vencimento ficam fora do atraso e da previsao mensal. O cadastro avulso pede competencia, categoria cadastrada e pagador/fornecedor. Criar uma conta nao confirma um pagamento.

Contas financeiras e confirmacao de abertura ficam em **Configuracoes > Contas financeiras**. Categorias continuam no cadastro ja existente. Nao ha aba independente de cartoes: os depositos da operadora ficam em um bloco recolhido no Fluxo de Caixa, preservando bruto, taxa, liquido e quitacao do paciente. Planos continuam em Acompanhamentos. O historico de pagamentos abre em painel lateral, sem perder a lista.

Fluxo, exportacao, conciliacao e DFC usam os movimentos efetivos de disponibilidade: pagamentos de caixa/banco, transferencias e depositos liquidos de cartao. Transferencias internas nao inflam entradas/saidas consolidadas. A abertura e conferida no historico das contas; uma divergencia entre movimentos e saldos bloqueia a exibicao do saldo como definitivo. Busca e filtros adicionais nao transformam o recorte em saldo bancario. Contas sem abertura ou classificacao geram pendencia explicita.

**OFX nativo:** arquivos SGML/OFX 1 e XML/OFX 2 em UTF-8 ou Windows-1252, ate 2 MB e 1.000 movimentos, uma unica conta em BRL. A importacao mostra conta bancaria do arquivo, periodo e quantidade para conferencia antes de gravar. O identificador FITID e preservado; o banco rejeita reimportacoes divergentes e nao duplica identicas. Importar nao cria pagamentos nem titulos. Sugestoes exigem conta/data/valor iguais e confirmacao humana; multiplos candidatos nunca sao escolhidos automaticamente. Desfazer vinculo fica no detalhe com justificativa e historico. Datas sao as datas de lancamento declaradas pelo banco, sem deslocamento automatico de fuso.

**DRE e DFC:** abas separadas, tabela em primeiro plano, exportacao CSV e composicao consultavel por valor. A DRE usa competencia e apresenta subtotais na ordem do demonstrativo. A DFC mostra abertura, atividades, variacao e fechamento no mesmo escopo do Fluxo. Classificacoes pendentes ficam em aviso e formulario recolhido; resultados incompletos sao explicitamente parciais. Os demonstrativos sao gerenciais e nao substituem escrituracao contabil.

As migracoes financeiras anteriores continuam necessarias, inclusive as estruturas historicas de operacoes:

1. `20260919200000_financial_operations.sql`
2. `20260919201000_financial_shifts.sql`
3. `20260919202000_financial_cards_commissions.sql`
4. `20260919203000_financial_reconciliation.sql`
5. `20260919204000_financial_operation_guards.sql`
6. `20260920220000_retire_financial_shift_control.sql`

A ultima migracao disponibiliza a desativacao administrativa de turnos antigos em Configuracoes. Nao desativa contas automaticamente. Exige permissao, contagem e motivo; encerra o turno estruturado aberto na mesma transacao, preserva auditoria e nao modifica pagamentos ou saldos. Sessoes antigas nao estruturadas exigem conferencia administrativa. Novas contas de caixa nao precisam de turno. Homologue as migracoes antes de publicar; arquivos locais nao comprovam aplicacao no banco.

Limites preservados: conciliacao de uma linha com um movimento, liquidacao integral de um recebimento de cartao por vez, sem integracao automatica bancaria/adquirente. Depositos agrupados, chargebacks e devolucoes reais nao sao simulados. O cadastro de categorias ainda nao automatiza a classificacao DRE/DFC; use a revisao dos demonstrativos. A estruturacao contratual de saldo livre e sua repactuacao atomica ainda dependem da evolucao do modelo de planos; esta reorganizacao nao altera contratos existentes nem promete corrigi-los por edicoes de descricao.

### Verificacao e homologacao financeira

```bash
node scripts/test-financial-layout.mjs
node scripts/test-financial-operations.mjs
node scripts/test-cash-flow.mjs
node scripts/test-financial-ledger.mjs
node scripts/test-treatment-followup.mjs
npx tsc --noEmit
npm run build
```

O cenario `supabase/tests/financial_simplified_cash.sql` verifica a desativacao de turnos legados, auditoria, contagem e pagamentos sem turno. Os cenarios `supabase/tests/financial_operations.sql`, `financial_cash_flow.sql` e `financial_settlements.sql` exigem PostgreSQL/Supabase de homologacao, com ON_ERROR_STOP; usam transacao e ROLLBACK. Nao apontar a producao. Exercite tambem concorrencia em duas sessoes: recebimento versus fechamento de turno, liquidacao versus estorno da baixa, duas aprovacoes do mesmo recebimento, conciliacao versus correcao. Verifique perfis somente-leitura, recepcao, administrador, usuario anonimo e isolamento entre duas clinicas. O build e os testes JavaScript locais nao comprovam execucao das migracoes nem validacao do banco remoto.

## ?? Build de Produ��o

```bash
npm run build
```

---

## ?? Licen�a
Propriedade de MedCore Health Hub. Todos os direitos reservados.

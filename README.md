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

### Operacoes: caixa, cartoes, repasses, conciliacao e demonstrativos

A aba **Financeiro > Operacoes** complementa os mesmos titulos, baixas e contas. Aplique, nesta ordem, apos as tres migracoes anteriores:

1. `20260919200000_financial_operations.sql`
2. `20260919201000_financial_shifts.sql`
3. `20260919202000_financial_cards_commissions.sql`
4. `20260919203000_financial_reconciliation.sql`
5. `20260919204000_financial_operation_guards.sql`

Publique o frontend somente depois de aplicar e homologar a serie completa. Escritas nas novas estruturas e nos cadastros de caixa/repasse ficam restritas a RPCs autorizadas. As operacoes registram autoria, escopo da clinica e auditoria. Falhas de resposta preservam o identificador da solicitacao para repetir sem duplicar; nao inicie outro registro para compensar um timeout.

**Caixa por turno:** reutiliza cash_register_sessions e vincula pagamentos/transferencias ao turno. A primeira abertura por administrador ativa o controle obrigatorio daquela conta do tipo caixa, com abertura financeira previamente confirmada. Depois, o operador pode abrir/fechar seu turno. A data operacional e CURRENT_DATE do banco, exibida na tela; nao e inferida pelo navegador. Somente dinheiro do operador/data do turno e aceito nessa conta. Pix e outros meios usam contas proprias. Sangria e suprimento usam transferencias entre contas, incorporadas ao turno automaticamente. Fundo inicial e contagem final nao criam movimentos financeiros. Diferencas sao registradas para apuracao, nao ajustadas automaticamente. Turnos fechados nao aceitam estorno de seus movimentos. Sessoes legadas abertas exigem conferencia administrativa antes de ativar novo turno.

**Cartoes:** liquidacao manual integral de uma baixa por vez, apos conferencia com a adquirente. O bruto e transferido de recebiveis para banco; a taxa confirmada gera uma unica despesa paga e classificada, resultando no credito liquido. Nao ha nova receita nem nova baixa do paciente. A correcao justificada da liquidacao estorna transferencia e taxa atomicamente; preserva a quitacao original do paciente. A taxa gerada e cancelada com seu historico estornado para nao deixar uma despesa ficticia a pagar. Desfaca a conciliacao antes de corrigir uma liquidacao. Contas de recebiveis nao representam cartoes corporativos/faturas a pagar: despesas exigem registro da saida bancaria efetiva.

**Repasses:** aprovacao explicita de percentual sobre um recebimento bruto, com profissional da mesma clinica, competencia, vencimento e justificativa da regra contratual. Nao se usa automaticamente o percentual de service_types. Reutiliza commission_payouts e gera titulo pendente em A pagar, onde ocorrem baixas parciais e comprovantes. A soma aprovada nao ultrapassa o recebimento. Um profissional nao tem dois repasses ativos da mesma baixa. Cancelar um repasse sem pagamentos preserva o historico e permite nova aprovacao corrigida. Titulos com apuracao legada exigem conciliacao antes de nova aprovacao. Nao estorne a origem enquanto houver repasse ativo. Repasses com pagamentos exigem resolucao administrativa da obrigacao; nao sao apagados automaticamente.

**Conciliacao:** importa CSV UTF-8 de ate 2 MB e 1000 linhas, cabecalho exato `external_id,date,amount,description`. Data ISO AAAA-MM-DD, decimal com ponto, sinal negativo para saida; campos com virgulas usam aspas duplas. Utilize o identificador estavel do extrato bancario. Reimportacao identica nao duplica; referencia reutilizada com outros valores gera erro e desfaz o lote inteiro. Importar nao cria baixas. O vinculo manual exige conta, data e valor exatos, um movimento por linha, sem conciliacao automatica por aproximacao. Depositos de cartao usam o liquido, nao o bruto e a taxa novamente. Desfazer vinculo exige motivo e preserva historico. Linhas e movimentos sem correspondencia permanecem visiveis. OFX e arquivos de outros layouts precisam ser convertidos para o CSV documentado; nao ha importador OFX nativo nesta entrega.

**DRE/DFC gerenciais:** DRE usa valor do titulo por competencia, nao pagamentos ou vencimentos. Grupos estruturados distinguem receitas, deducoes, custos, despesas operacionais, resultado financeiro, tributos e movimentos patrimoniais fora da DRE. A DFC direta separa atividades operacionais, investimento e financiamento, considerando contas de disponibilidade, liquidacao de cartao e taxas sem duplicidade. Transferencias entre contas disponiveis se anulam. Competencia e classificacao ausentes geram pendencias explicitas; o resultado liquido definitivo da DRE nao e exibido enquanto houver pendencias. Sao demonstrativos gerenciais, nao escrituracao ou declaracoes fiscais. Competencias de parcelas e regras contratuais devem ser conferidas pelo responsavel financeiro, nao presumidas pelo sistema.

Fora desta entrega: integracao automatica bancaria/adquirente/fiscal, convenios, antecipacoes, liquidacoes parciais em lote e chargebacks de cartao, importador OFX nativo, automacao contratual de repasses, devolucoes/cancelamentos de planos com pagamentos e entidade cadastral completa de responsavel financeiro. Essas operacoes nao sao simuladas nem tratadas como estornos de erros.

### Verificacao e homologacao financeira

```bash
node scripts/test-financial-operations.mjs
node scripts/test-cash-flow.mjs
node scripts/test-financial-ledger.mjs
node scripts/test-treatment-followup.mjs
npx tsc --noEmit
npm run build
```

Os cenarios `supabase/tests/financial_operations.sql`, `financial_cash_flow.sql` e `financial_settlements.sql` exigem PostgreSQL/Supabase de homologacao, com ON_ERROR_STOP; usam transacao e ROLLBACK. Nao apontar a producao. Exercite tambem concorrencia em duas sessoes: recebimento versus fechamento de turno, liquidacao versus estorno da baixa, duas aprovacoes do mesmo recebimento, conciliacao versus correcao. Verifique perfis somente-leitura, recepcao, administrador, usuario anonimo e isolamento entre duas clinicas. O build e os testes JavaScript locais nao comprovam execucao das migracoes nem validacao do banco remoto.

## ?? Build de Produ��o

```bash
npm run build
```

---

## ?? Licen�a
Propriedade de MedCore Health Hub. Todos os direitos reservados.

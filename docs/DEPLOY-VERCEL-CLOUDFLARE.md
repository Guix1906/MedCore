# Guia de Deploy: MedCore na Vercel ou no Cloudflare Workers

O MedCore pode ser publicado na **Vercel**, com o **Cloudflare** como DNS/proxy, ou diretamente no **Cloudflare Workers**. As seções 1 a 4 descrevem a opção Vercel. A seção 5 descreve o deploy nativo no Cloudflare, independente da publicação existente.

---

## 1. Arquitetura da Solução

```
[ Usuário / Navegador ]
          │
          ▼ HTTPS
[ Cloudflare (DNS + Proxy + WAF + CDN) ]
          │
          ▼ CNAME (SSL Full/Strict)
[ Vercel (TanStack Start / Nitro Serverless & Static) ]
          │
          ▼ API / Banco
[ Supabase Cloud (PostgreSQL + RLS + Auth) ]
```

* **Frontend:** TanStack Start compilado nativamente para a Vercel através do Nitro (`NITRO_PRESET=vercel`).
* **DNS & CDN:** Cloudflare gerenciando o domínio customizado (ex: `app.suaclinica.com.br`).
* **Banco & Sessão:** Supabase na nuvem já configurado com dados, tabelas e políticas de RLS.

---

## 2. Passo a Passo: Publicação na Vercel

### 2.1 Importar o Projeto
1. Acesse o painel da [Vercel](https://vercel.com) e clique em **"Add New..." > "Project"**.
2. Conecte sua conta do GitHub e selecione o repositório **`MedCore`**.
3. Na tela de configuração de projeto:
   * **Framework Preset:** Selecione **"Other"** (o arquivo `vercel.json` cuidará do build).
   * **Root Directory:** `./` (raiz do projeto).
   * **Build Command:** `NITRO_PRESET=vercel npm run build` (ou deixe o padrão que puxa do `vercel.json`).

### 2.2 Configurar Variáveis de Ambiente na Vercel
Na seção **Environment Variables** do projeto na Vercel, adicione as seguintes variáveis:

| Variável | Valor Recomendado | Descrição |
| :--- | :--- | :--- |
| `NITRO_PRESET` | `vercel` | Instruir o Nitro a compilar para Vercel Serverless |
| `VITE_SUPABASE_URL` | `https://yqgafvblxxyksximctzk.supabase.co` | URL da instância Supabase do MedCore |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | *(Sua chave anon/publishable do Supabase)* | Chave pública de acesso do cliente |
| `VITE_API_URL` | *(Opcional - URL do backend PHP se publicado)* | URL da API REST (ex: `https://api.suaclinica.com.br/api`) |

Clique em **"Deploy"**. A Vercel fará a compilação e fornecerá um domínio gratuito (ex: `medcore-guix.vercel.app`).

---

## 3. Passo a Passo: Apontamento via Cloudflare

Para utilizar seu próprio domínio (ex: `suaclinica.com.br` ou subdomínio `app.suaclinica.com.br`):

### 3.1 Adicionar o Domínio na Vercel
1. No projeto na Vercel, vá em **Settings > Domains**.
2. Digite seu domínio (ex: `app.suaclinica.com.br`) e clique em **Add**.
3. A Vercel exibirá as instruções de DNS (normalmente um registro `CNAME` apontando para `cname.vercel-dns.com`).

### 3.2 Configurar os Registros no Cloudflare
1. Acesse o painel do [Cloudflare](https://dash.cloudflare.com) e clique na sua zona/domínio.
2. Acesse a aba **DNS > Records** e clique em **Add Record**:
   * **Type:** `CNAME`
   * **Name:** `app` (ou `@` se for a raiz)
   * **Target:** `cname.vercel-dns.com`
   * **Proxy status:** **Proxied (Nuvem Laranja ativada)** ou **DNS Only (Nuvem Cinza)** durante a validação inicial.
   * **TTL:** `Auto`
3. Salve o registro.

### 3.3 Configuração de SSL/TLS no Cloudflare
Para evitar loops de redirecionamento (erro `ERR_TOO_MANY_REDIRECTS`) entre o Cloudflare e a Vercel:
1. No Cloudflare, vá em **SSL/TLS > Overview**.
2. Defina o modo de criptografia para **Full** ou **Full (strict)**.
3. Em **SSL/TLS > Edge Certificates**, certifique-se de que **Always Use HTTPS** está ativado.

---

## 4. Teste e Validação

1. Após a propagação do DNS (geralmente menos de 5 minutos no Cloudflare), acesse a URL configurada no seu navegador.
2. A tela de login (`/auth`) do MedCore deverá abrir com HTTPS com cadeado verde/válido.
3. Autentique-se com sua conta de acesso e confira o carregamento do Dashboard e de todos os módulos clínicos.

---

## 5. Publicação nativa no Cloudflare Workers

O destino configurado em `wrangler.json` é o Worker **`medcore`**, na conta `dd5779c3caa4bfffb221ff20f1d407c6`. Seu endereço é `https://medcore.guigos191.workers.dev`.

Esta opção publica o servidor TanStack Start/Nitro e os assets juntos. Não basta enviar somente `.output/public`: as rotas e as server functions precisam de `.output/server`. Não é necessário instalar outro plugin Vite; o wrapper Lovable já inclui Nitro.

O preset Cloudflare do Nitro sobrescreve a opção de nível superior `inlineDynamicImports`. Por isso, `vite.config.ts` também aplica `rollupConfig.output.inlineDynamicImports` neste alvo, evitando a exportação SSR inválida `ssr_exports` na combinação atual de Nitro e Rolldown. A configuração padrão da Vercel permanece igual.

### 5.1 Variáveis e dependências

Use as dependências de `package-lock.json` e as variáveis públicas do mesmo Supabase usado pelo cliente:

```dotenv
VITE_SUPABASE_URL=https://yqgafvblxxyksximctzk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<chave-publicavel-ou-anon>
```

Configure-as no ambiente de build ou no `.env.local`, que não deve ser versionado. Nunca use `service_role` ou uma chave `sb_secret_` no frontend.

`scripts/build-cloudflare.mjs` seleciona `cloudflare-module`, compila todos os ambientes do Vite, exige a URL HTTPS e a chave pública, e adiciona `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` ao arquivo Wrangler **gerado**. Essas duas bindings são necessárias para as server functions de auditoria. Nenhuma credencial privada é adicionada ao arquivo Wrangler versionado.

### 5.2 Compilar e publicar

```bash
npm ci
npm run build:cloudflare
npx wrangler deploy --config .output/server/wrangler.json --dry-run
```

Para publicar pelo terminal, autentique o Wrangler no navegador, na conta indicada em `wrangler.json`, e execute:

```bash
npx wrangler login
npm run deploy:cloudflare
```

A autenticação do conector MCP é independente do login do Wrangler. O conector pode publicar pela API; o comando acima precisa da própria autorização local do Wrangler. Não copie tokens para o repositório.

O deploy usa a configuração gerada em `.output/server/wrangler.json`, incluindo as bindings de runtime. Não publique um build antigo nem use apenas `wrangler deploy` sem antes executar `build:cloudflare`.

### 5.3 Escopo e autenticação do sistema

- `npm run build` e `vercel.json` continuam preservando o destino Vercel. O deploy Workers não altera DNS nem substitui os outros Workers da conta.
- O banco, as políticas RLS, as migrações e os usuários do Supabase não são alterados pelo deploy do frontend.
- Se convites, confirmação de cadastro e recuperação de senha forem usados no novo endereço, adicione `https://medcore.guigos191.workers.dev/**` às Redirect URLs autorizadas em Supabase Auth. Preserve as URLs da Vercel enquanto ela continuar ativa. Mude o Site URL somente se o Worker passar a ser o endereço principal.
- O backend PHP não é executado no Workers. O adaptador existente usa Supabase em HTTPS quando a API configurada é localhost. Recursos que dependem especificamente do PHP, como o proxy de IA, exigem uma API HTTPS publicada separadamente.
- Depois da publicação, confira `/auth`, os assets e o redirecionamento das rotas protegidas. A verificação de login e dos fluxos clínicos exige uma sessão autorizada; não use dados reais de pacientes para testes de deploy.

Persistem pendências anteriores à publicação: erros de tipagem em Pacientes, Agenda, Financeiro e Administração, além do aviso de hidratação React `#418` ao abrir diretamente rotas protegidas sem sessão. Esse mesmo aviso ocorre na versão existente da Vercel; as rotas continuam redirecionando para o login. Essas pendências não foram alteradas neste deploy.

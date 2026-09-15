# Guia de Deploy: MedCore na Vercel via Cloudflare

Este guia orienta a publicação do frontend do MedCore na **Vercel**, utilizando o **Cloudflare** para gerenciamento de DNS, proteção DDoS e terminação SSL no seu domínio próprio.

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
3. Autentique-se com sua conta de acesso e confira o carregamento instantâneo do Dashboard e de todos os módulos clínicos.

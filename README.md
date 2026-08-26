# MedCore — Sistema de Gestão Clínica e Prontuário Eletrônico

Sistema completo para clínicas médicas, gestão de pacientes, agenda inteligente, prontuário eletrônico (PEP), financeiro e copiloto de IA clínica, em estrita conformidade com a **LGPD (Lei Geral de Proteção de Dados)** e padrões de segurança de dados de saúde (**PHI**).

---

## ??? Arquitetura do Sistema

- **Frontend**: [React 19](https://react.dev/), [TanStack Start](https://tanstack.com/start), [TanStack Router](https://tanstack.com/router), [TanStack Query](https://tanstack.com/query), Tailwind CSS v4, Radix UI, Framer Motion.
- **Backend (BFF / Core API)**: PHP 8.2+ REST API de alta performance com arquitetura MVC limpa, JWT HS256 com claims RFC 7519, rate limiting e isolamento multi-tenant estrito.
- **Banco de Dados Primário**: Supabase PostgreSQL (com RLS e `security_invoker = on`) + SQLite local para armazenamento de storage e BFF.
- **IA / Copiloto Clínico**: Google Gemini (executado 100% via Proxy Server-Side com anonimização e minimização prévia de PHI).

---

## ?? Segurança e Conformidade LGPD

1. **Isolamento Multi-Tenant**: Toda consulta, atualização e exclusão é estritamente vinculada ao `company_id` validado criptograficamente no token JWT. Acesso cruzado entre clínicas retorna `HTTP 404 Not Found`.
2. **Proteção de PHI**: Nenhum dado de saúde é armazenado em texto claro no `localStorage` ou `sessionStorage` do navegador.
3. **Chaves de API Isoladas**: Chaves mestras (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) residem exclusivamente no servidor e nunca vazam para o bundle JavaScript de produção.
4. **JWT Hardening**: Tokens com validade curta (30 minutos), identificador único `jti`, claims `iss`/`aud`, rejeição de `alg: none` e lista de revogação de tokens (logout seguro).
5. **CORS Restrito**: Apenas origens explicitamente configuradas em `CORS_ALLOWED_ORIGINS` recebem cabeçalhos de acesso com credenciais.
6. **Pre-commit Secrets Scanner**: Script automatizado (`scripts/check-secrets.js`) que impede commits acidentais de segredos ou bancos de dados.

---

## ?? Instalação e Execução

### Pré-requisitos
- **Node.js**: v20+ e npm
- **PHP**: v8.2+ com extensões `pdo_sqlite` e `curl`

### 1. Clonar e Instalar Dependências
```bash
git clone https://github.com/Guix1906/MedCore.git
cd MedCore
npm install
```

### 2. Configurar Variáveis de Ambiente
Copie os modelos de variáveis de ambiente:
```bash
# Frontend (.env)
cp .env.example .env

# Backend (backend/.env)
cp backend/.env.example backend/.env
```

Gere uma chave segura para `JWT_SECRET` no arquivo `backend/.env` (mínimo 32 caracteres).

### 3. Migração do Banco de Dados
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

O projeto inclui suítes de testes de segurança, multi-tenant e regras financeiras:

```bash
# 1. Testes de Isolamento Multi-Tenant (Garante que Clínica A não acessa Clínica B)
php -c backend/php.ini backend/tests/test_multitenant.php

# 2. Testes de Segurança Criptográfica do JWT (Validade, Algoritmos, Revogação)
php -c backend/php.ini backend/tests/test_jwt.php

# 3. Testes de Matemática e Equivalência Financeira
node scripts/test-financial-math.js

# 4. Verificação Estática de Tipos TypeScript
npx tsc --noEmit

# 5. Verificação de Linter
npm run lint
```

---

## ?? Build de Produção

```bash
npm run build
```

---

## ?? Licença
Propriedade de MedCore Health Hub. Todos os direitos reservados.

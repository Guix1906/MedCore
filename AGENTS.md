# MedCore

- Deploy: push no `main` do GitHub publica automaticamente na Vercel (projeto `medcoreapp`).
- Não reescrever o histórico publicado (force push, rebase ou amend de commits já enviados) sem combinar antes.
- Mantenha o `main` funcionando: rode `npx tsc --noEmit` e os scripts `scripts/test-*.{js,mjs}` antes de enviar.
- Banco: Supabase. Toda migração nova vai em `supabase/migrations/` e precisa ser aplicada manualmente no projeto.

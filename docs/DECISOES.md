# Registro de Decisões de Arquitetura e Segurança (ADR) — MedCore

## ADR 01 — Purga de Histórico Git e Compatibilidade com Lovable
- **Contexto**: Arquivos SQLite contendo dados de saúde (PHI) foram rastreados e sincronizados com o repositório GitHub (ackend/database/medcore.sqlite e ackend/public/database/medcore.sqlite).
- **Opções Avaliadas**:
  1. *Purga Imediata com git filter-repo / BFG e force-push*:
     - Prós: Remove os dados do histórico de commits.
     - Contras: Quebra a sincronização do histórico do editor Lovable (conforme regra explícita em AGENTS.md: *"Avoid rewriting published git history — force pushing, or rebasing/amending/squashing commits that are already pushed — as it rewrites history on Lovable's side"*).
  2. *Remoção do Rastreamento Ativo + .gitignore + Purga Coordenada (Recomendada e Aplicada)*:
     - Prós: Remove imediatamente os arquivos do working tree e rastreamento (git rm --cached), impede novos commits de dados via .gitignore, e mantém a integridade da branch ativa no Lovable.
     - Ação Humana Necessária: Agendar janela de manutenção para rotação de segredos, pausa temporária do sync no Lovable, execução do git filter-repo e force-push coordenado com invalidação de forks e clones existentes.

## ADR 02 — Unificação da Camada de Dados (Supabase vs PHP/SQLite)
- **Contexto**: O frontend continha duas fontes de dados divergentes (Supabase com RLS em ~33 arquivos e PHP/SQLite em ~20 arquivos), além de salvar dados de pacientes no localStorage.
- **Decisão**: Eleger o **Supabase** como a fonte canônica principal de persistência relacional com RLS maduro e autenticação de pacientes, utilizando o backend PHP como camada de serviços, proxy seguro de IA médica (Gemini) e tarefas de backend. Eliminar completamente a persistência de PHI no localStorage.

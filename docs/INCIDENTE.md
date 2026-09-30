# Relatório de Incidente de Segurança da Informação — MedCore

## 1. Identificação do Incidente
- **Data da Identificação**: 26 de Agosto de 2026
- **Classificação de Gravidade**: CRÍTICA
- **Natureza do Incidente**: Exposição pública e versionamento em repositório de arquivos de banco de dados SQLite contendo Dados Pessoais e Dados Pessoais Sensíveis de Saúde (PHI / Protected Health Information).
- **Arquivos Envolvidos**:
  - backend/public/database/medcore.sqlite (acessível via docroot web público)
  - backend/database/medcore.sqlite (versionado no Git)

## 2. Tipologia dos Dados Expostos
- Nomes completos de pacientes e médicos;
- Números de CPF e telefones;
- Prontuários médicos, histórico clínico, queixas, prescrições e medicações;
- Transações financeiras de consultas e tratamentos.

## 3. Avaliação de Impacto Regulatório (LGPD — Art. 48)
- O Artigo 48 da Lei Geral de Proteção de Dados (Lei nº 13.709/2018) estipula que o controlador deve comunicar à autoridade nacional (ANPD) e aos titulares a ocorrência de incidente de segurança que possa acarretar risco ou dano relevante aos titulares.
- **Risco aos Titulares**: Risco relevante de discriminação, violação da privacidade e sigilo médico-paciente.
- **Recomendação**:
  1. O DPO (Encarregado de Proteção de Dados) e a assessoria jurídica da clínica devem avaliar formalmente a notificação compulsória à ANPD no prazo regulamentar.
  2. Notificação individual aos titulares afetados com orientações sobre medidas preventivas.

## 4. Medidas de Contenção e Remediação Implementadas
1. Remoção imediata do diretório de banco de dados de dentro da pasta pública web (public/).
2. Desvinculação dos arquivos .sqlite do controle de versão Git (git rm --cached).
3. Inclusão de regras estritas no .gitignore para impedir novo versionamento de bases de dados locais ou arquivos em storage/.
4. Implementação de regras de bloqueio HTTP via roteador PHP e .htaccess.
5. Planejamento de purga de histórico com git filter-repo e rotação de credenciais.

### Pendências (atualizado em 29/09/2026)
- Os arquivos `.sqlite` **continuam no histórico do Git** (commits de 23/08/2026, p.ex. `8da42f9`, `d0ea2f2`). A purga exige `git filter-repo` + force push, o que reescreve o histórico no Lovable (ver AGENTS.md): pausar a sincronização, purgar, forçar o push e pedir que clones/forks sejam descartados. Se o repositório já foi público, considere os dados expostos.
- Avaliação formal da notificação à ANPD ainda não registrada.

---

# Incidente 2 — Controle de acesso do banco anulado (26/09 a 29/09/2026)

## 1. Identificação
- **Data da identificação**: 29 de setembro de 2026 (auditoria do sistema).
- **Classificação**: CRÍTICA.
- **Natureza**: migrações aplicadas entre 26/09 e 27/09/2026 removeram o isolamento de dados:
  - `20260926181000_reset_all_system_test_data.sql`: função `reset_all_system_test_data()` liberada para `anon`, capaz de apagar transações, pagamentos, eventos e consultas de todas as clínicas usando apenas a chave pública do site.
  - `20260927200000_fix_agenda_events_and_appointments.sql`: `is_company_member()` passou a aceitar qualquer usuário autenticado; `events` e `appointments` ficaram legíveis por qualquer conta (inclusive cadastros públicos pendentes); `save_agenda_event` e `get_agenda_events` rodavam sem verificação e sem revogação de `anon`.
  - `20260926150000_appointment_finance_flow.sql`: cobrança, baixa e cancelamento de agendamentos sem verificação de permissão.
  - `20260927190000_safe_patient_deletion.sql`: `delete_treatment` sem verificação; `delete_patient` apagava prontuários.

## 2. Dados potencialmente expostos
- Agenda (títulos com nome do paciente, observações, valores de procedimento e sinal) de todas as clínicas.
- Integridade de todo o financeiro e da agenda (exclusão em massa por qualquer pessoa).

## 3. Contenção
- Migração `20260929120000_security_hardening.sql`: remove o reset, restaura `is_company_member`, recria as políticas por clínica e adiciona verificação de permissão a todas as RPCs citadas; exclusão de paciente passa a preservar o prontuário.
- Frontend: removidos os botões "Zerar", os filtros que escondiam registros por data e todas as cópias locais de dados clínicos/financeiros.

## 4. Ações pendentes (responsável: controlador/DPO)
1. Aplicar a migração em produção e conferir a consulta de privilégios ao final do arquivo.
2. Verificar nos logs do Supabase (API/PostgREST) chamadas a `reset_all_system_test_data`, `get_agenda_events` e `save_agenda_event` sem sessão, e leituras de `events`/`appointments` por contas não aprovadas, no período de 26/09 a 29/09.
3. Com base nisso, avaliar a comunicação à ANPD e aos titulares (LGPD, art. 48).
4. Desativar cadastros públicos (Supabase Auth → Sign-ups) se não forem necessários; hoje eles entram como "Aguardando aprovação".

# Relatório de Incidente de Segurança da Informação — MedCore

## 1. Identificação do Incidente
- **Data da Identificação**: 26 de Agosto de 2026
- **Classificação de Gravidade**: CRÍTICA
- **Natureza do Incidente**: Exposição pública e versionamento em repositório de arquivos de banco de dados SQLite contendo Dados Pessoais e Dados Pessoais Sensíveis de Saúde (PHI / Protected Health Information).
- **Arquivos Envolvidos**:
  - ackend/public/database/medcore.sqlite (acessível via docroot web público)
  - ackend/database/medcore.sqlite (versionado no Git)

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

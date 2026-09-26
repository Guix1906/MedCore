# MedCore - Relatório de repaginação do frontend

Data: 26/09/2026.

## Diagnóstico principal

**A base pode ser reaproveitada. O maior ganho será unificar identidade, componentes e comportamentos, não acrescentar efeitos.** Recomendo uma interface clínica clara e sóbria, preservando o roxo, com menos competição visual, melhor leitura e ações previsíveis.

Escopo: inventário de 151 arquivos TSX e revisão das 13 rotas com interface, suas principais abas, formulários, sobreposições, estilos, navegação e estados compartilhados. Também foram considerados os redirecionamentos, estados de acesso e componentes de apoio.

**Limite:** análise estática do código, sem navegação autenticada, acesso a pacientes reais ou certificação de integrações, cálculos ou segurança do banco. Riscos de corte e sobreposição foram identificados na implementação, não observados em capturas de tela. O código da aplicação não foi alterado; somente este relatório foi criado.

## 1. Prioridades anteriores ao acabamento

**P0:** confiança ou uso essencial. **P1:** base da repaginação. **P2:** refinamentos posteriores.

| Prioridade | Achado | Encaminhamento |
| --- | --- | --- |
| P0 | `PatientDetailsModal.tsx:194` anuncia prontuário salvo, mas o handler apenas mostra um toast. | Corrigir esse fluxo específico ou encaminhar ao salvamento real. Não se trata de uma conclusão sobre todos os fluxos de prontuário. |
| P0 | Exemplos aparecem no lugar de dados ausentes dos pacientes e de indicadores de Visão Geral. | Mostrar Não informado, Sem dados ou Erro, conforme o caso; demonstrações devem ser separadas de registros reais. |
| P0 | A seleção Privado/Compartilhado em `ProntuarioPage.tsx` não tem aplicação encontrada na gravação do componente. | A apresentação precisa refletir a regra efetiva. Isso não determina a segurança das políticas do banco. |
| P1 | Filtros de Visão Geral não chegam ao painel; vários modos de DRE/DFC apenas alteram o destaque do controle. | Entregar o comportamento prometido ou indicar indisponibilidade, antes de polir esses controles. |
| P1 | Alternância de MedCore/ClinicMed e vocabulário jurídico indevido em uma aplicação clínica. | Uniformizar marca e linguagem. Em DRE/DFC, revisar também os agrupamentos, não apenas seus nomes. |
| P1 | `src/styles.css:532` remove outline e sombras dos campos, inclusive no foco por teclado. | Restaurar um indicador visível e consistente. Limpeza visual não deve significar perda de orientação. |

## 2. Direção visual

| Elemento | Proposta |
| --- | --- |
| Identidade | Clínica contemporânea, clara e profissional; sem aparência de página promocional nas telas de trabalho. |
| Tipografia | Manter Barlow de forma consistente, inclusive nos gráficos; hoje partes pedem Inter enquanto o documento carrega Barlow. |
| Cores | Roxo `#6D3FF5`, fundo `#F7F8FA`, cards brancos, texto `#0F1424` e secundário `#5A6178`, aproveitando a base existente. |
| Escala | Corpo de 14-16 px, metadados de 12-13 px e títulos de 24-28 px. Evitar informação essencial em 10-11 px. |
| Hierarquia | Uma ação principal por contexto; menos caixa alta, extrabold, gradientes, bordas aninhadas e sombras. |
| Espaçamento | Poucos raios e uma escala baseada em 4/8 px. Referência: 16 px de margem no celular e 24 px no desktop. |
| Estados | Verde, âmbar e vermelho com significado; não como decoração de seções inteiras. Prejuízo não deve continuar verde. |
| Ícones | Consolidar Lucide, com tamanhos e espessuras coerentes; reduzir mistura com emojis e glifos. |
| Movimento | Animações curtas e funcionais; evitar brilho contínuo e contagens prolongadas de valores importantes. |

Não começaria por modo escuro ou novas bibliotecas de animação. Primeiro, consolidaria uma versão clara excelente.

## 3. Estrutura global

- **Cabeçalho:** otimizar e recortar a marca; reservar espaço para menu e ações no celular. O wordmark usado tem 2.085.103 bytes e 1536 x 1024 px. A classe permite altura de 88 px em um cabeçalho de 64 px, com filtros de brilho/contraste: preparar um arquivo apropriado é melhor que corrigir a marca por CSS.
- **Menu:** mostrar agrupamentos e tornar subitens acessíveis expandido, recolhido e no celular. Visão Geral hoje depende do flyout da agenda, não renderizado como submenu no modo expandido/móvel.
- **Busca:** adicionar acionador visível, além de Ctrl/Cmd+K, e abrir o registro encontrado em vez da listagem genérica. A busca precisa ser encontrável por toque.
- **Notificações:** o componente existe, mas não aparece montado no AppShell. Integrar o fluxo completo ou não apresentá-lo como pronto.
- **Atalhos:** Novo paciente deve abrir cadastro; Meu perfil precisa de destino correspondente; Ajuda não deve parecer funcional quando apenas informa disponibilidade futura. Explicitar a finalidade do WhatsApp do topo.
- **Títulos:** AppShell recebe `title`, mas não o apresenta como título de página. Pacientes, Estoque e Configurações precisam de cabeçalho real.
- **Camadas:** padronizar sobreposições de menus, detalhes, edição e confirmação, em vez de resolver cada caso com valores como 9999.

## 4. Tela por tela

### 1. Autenticação - `/auth`

**Marca e composição:** aproximar a identidade azul/ciano do produto roxo. Reduzir halos, vidro e elementos flutuantes. O uso de `h-screen`, `max-h-screen` e `overflow-hidden` com colunas empilhadas cria risco de corte: permitir rolagem e priorizar o formulário no celular.

**Campos e ações:** melhorar labels, usar placeholders neutros e não pressupor que todo usuário é médico. Padronizar regras de senha, mostrar/ocultar, autocomplete e erros junto aos campos. Manter Entrar como ação dominante e Google como alternativa com disponibilidade real.

**Estados auxiliares:** exibir confirmação persistente de recuperação, preservar convite e link expirado e trocar mensagens técnicas de provedor por orientação compreensível. Evitar promessas absolutas de conformidade; usar textos verificáveis e destinos reais de privacidade/termos.

### 2. Dashboard - `/dashboard`

**Hierarquia:** organizar título, indicadores essenciais, operação de hoje e análises. O gráfico financeiro não deve obrigatoriamente dominar a primeira leitura para todas as rotinas.

**Filtros e financeiro:** esclarecer o alcance dos diferentes controles de período. Padronizar gráfico de caixa, previsto/realizado, resultado do período e ocultação de valores. Manter o estado financeiro indisponível sem inventar totais.

**Agenda e análises:** simplificar próximos agendamentos em lista operacional com horário, paciente, profissional e ação contextual. Dar menor prioridade visual a aniversariantes e demografia. Usar resumos com links para Relatórios, evitando três painéis equivalentes com estilos diferentes.

### 3. Visão Geral - `/visao-geral`

**Função:** definir a tela como Indicadores da agenda ou integrar sua finalidade à área analítica existente.

**Problemas concretos:** o período e várias séries são fixos; filtros da rota não chegam ao painel; Adicionar filtro e Ver mais possuem caminhos sem ação. Sem eventos, podem aparecer cinco agendamentos e status de exemplo. Corrigir antes do acabamento.

**Gráficos:** identificar demonstração por visualização, não apenas por banner geral. Substituir medidores sem proporção explícita por gráficos com significado e denominador claros. Reduzir gráficos simultâneos, melhorar texto dos eixos e dar legenda à ocupação/mapa de calor.

### 4. Agenda - `/agenda`

**Navegação e filtros:** reduzir o peso das duas laterais e oferecer filtros também abaixo de `lg`. Reorganizar busca, cidade, visualização e criação em telas pequenas. Evitar a mesma ação principal competindo no topo e na lateral.

**Dia, semana, mês e lista:** preservar rolagem interna da semana; garantir todas as semanas do mês acessíveis. Anterior/Próximo deve avançar um mês no modo mensal, não um dia. Expor Lista como opção, hoje ausente do seletor principal. Unificar cores entre dia/semana e mês/lista; melhorar badges pequenos e suavizar hachuras/linha do agora. O expediente deve corresponder à configuração da clínica.

**Novo agendamento:** priorizar paciente, profissional, tipo e data/hora. Separar Selecionar paciente, Cadastrar paciente e Primeira consulta. Agrupar localização, plano/cobrança, recorrência, participantes, anexos e lembretes por contexto. O componente atual reúne mais de 3.300 linhas e muitas responsabilidades.

**Detalhes do formulário:** adaptar tabelas e checklist ao celular; distinguir arquivo selecionado, enviado e com erro; identificar recursos futuros e canais realmente disponíveis. Diferenciar sinal previsto de recebido e consulta coberta pelo plano de cobrança avulsa. Usar cores de profissional/tipo separadas da indicação de status.

**Editar e visualizar:** reutilizar campos entre criar/editar, substituir prompts e não simular sucesso em Duplicar/WhatsApp. No painel de detalhes, priorizar atendimento e separar financeiro. Resolver portais/camadas sem `z-index: 9999` generalizado. Informações essenciais precisam estar disponíveis por clique, não só por hover.

### 5. Pacientes - `/pacientes`

**Lista:** título claro, busca ampla, contador sem termo técnico virtualizado, tabela mais leve e cards móveis como os da Administração. Nome, contato e situação devem ter prioridade sobre a apresentação simultânea de todas as colunas. Ordenação e abertura devem funcionar por teclado.

**Cadastro:** uma coluna no celular e grupos Identificação, Contato, Endereço e Observações. Padronizar nome obrigatório, CPF, data de nascimento, telefone, e-mail, convênio e endereço, com máscaras e erros associados aos campos. Distinguir erro de carregamento de uma lista realmente vazia.

**Perfil:** unificar ficha completa e ficha aberta pela agenda. Informações agrupadas; Linha do tempo separada da nova evolução; Financeiro e Pacotes com o mesmo conteúdo em todos os contextos. Carteira, Orçamentos, Documentos e Formulários não devem parecer apenas sem registros quando ainda não implementados.

**Confiança e continuidade:** remover idade/gênero de exemplo e ações de foto/opções sem fluxo. Sem telefone, não anunciar WhatsApp aberto. Dar URL estável ao paciente para recarregar, compartilhar o endereço e voltar sem perder o contexto. Corrigir o falso salvamento de prontuário no modal específico.

### 6. Prontuário - `/prontuario`

**Central:** preservar busca, fila e recentes, esclarecendo o escopo local destes. Manter identificação inequívoca do paciente. A busca deve corresponder ao que promete pesquisar também no caminho de fallback.

**Atendimento:** trocar lateral fixa de 240 px por navegação adaptada ao celular. Escurecer texto do editor, simplificar ferramentas e diferenciar atendimento atual de histórico. Ao reutilizar conteúdo anterior, preservar seu contexto de data e origem.

**Abas:** Orçamento, Plano e Injetáveis usam `EmptyTab`: integrar ao fluxo efetivo ou indicar indisponibilidade. A aba Fotos e anexos atualmente entrega fotos clínicas; o nome deve corresponder aos formatos e conteúdos aceitos.

**Gravação e saída:** rodapé deve acompanhar menu de 56/232 px. Preservar confirmação de descarte e estados reais de gravação. A escolha Privado/Compartilhado precisa refletir uma regra efetiva, não apenas mudar o texto selecionado.

**IA:** reduzir a identidade visual paralela, organizar Capturar/Revisar/Inserir e eliminar controles redundantes. Preservar revisão humana, seleção de seções e informação ausente. Inserir no editor não pode parecer finalizar/salvar. Deixar gravando, pausado, processando e erro inequívocos, com cuidado ao fechar uma edição em andamento.

### 7. Acompanhamentos - `/acompanhamentos`

**Visão geral:** padronizar KPIs, busca, status e alternância Cards/Fases. Priorizar paciente, plano e próximo retorno; reduzir caixa alta, sombras e elementos promocionais.

**Progresso e alertas:** usar Prazo transcorrido, pois tempo não equivale a evolução clínica. Explicar as colunas do quadro e separar severidade dos alertas. Ausência de alertas não precisa parecer uma situação de atenção.

**Gerenciamento e criação:** Gerenciar deve ser resumo/edição rápida, sem duplicar toda a página. Agrupar criação em dados do plano, cronograma e observações; apresentar data final. Retorno previsto não deve parecer agendamento automático. Solicitar justificativa de status em diálogo próprio, sem remover a exigência do motivo.

### 8. Detalhe do acompanhamento - `/acompanhamentos/$id`

**Cabeçalho e resumo:** priorizar contexto clínico e próxima ação. Separar navegação, comunicação e Pausar/Retomar/Concluir. Não transformar término de prazo em conclusão clínica automática.

**Medicações e ocorrências:** dose, via, frequência e suspensão legíveis. Preservar Programado versus Realizado e dose clínica versus quantidade de estoque. Tomada, ausência, suspensão e adiamento precisam de texto e ícone além de cor.

**Evolução e fotos:** evolução em linha do tempo, com data e autoria disponível. Peso comparável quando houver dados reais suficientes. Fotos lado a lado com data, região e objetivo, preservando privacidade, proporção e cronologia.

**Financeiro do plano:** reutilizar contratado/recebido/saldo do paciente e abrir o contexto correto para pagamento. Evitar mandar o usuário para um financeiro genérico sem plano ou paciente selecionado.

### 9. Financeiro - `/financeiro`

**A linguagem jurídica é um dos maiores desalinhamentos do frontend.** Corrigir escritório, custas processuais, receitas jurídicas e outros termos conforme o significado real. Em DRE/DFC, revisar os agrupamentos envolvidos com o responsável financeiro/contábil: trocar somente rótulos não garante enquadramento correto dos valores.

| Área | Melhorias específicas |
| --- | --- |
| Estrutura comum | Mesma identidade nas seis abas; BRL, alinhamento, período e estados consistentes. Preservar a navegação móvel existente. Uma ação principal coerente por contexto. |
| Fluxo de Caixa | Reduzir botões/filtros duplicados, aumentar leitura da lista e separar resultado do período, saldo disponível e recebíveis. Gráfico com legenda precisa, sem chamar resultado acumulado de saldo bancário indevidamente. |
| Posição por conta | Abertura e fechamento legíveis, com separação entre caixa/bancos e recebíveis futuros de cartão. Nunca apresentar abertura não confirmada como zero. |
| Transferência | Resumo origem/destino/valor e aviso de registro administrativo; não sugerir execução de transferência bancária real. |
| Contas a Pagar | Reduzir altura de filtros e cards antes da lista. Priorizar favorecido, vencimento, status e saldo; distinguir valor original/restante e padronizar Registrar pagamento. Separar ação destrutiva. |
| Contas a Receber | Ação de criação encontrável, nomes adequados para paciente/pagador/profissional, previsão distinta de realizado e Cobrar distinto de Receber. Explicar o filtro Associado conforme sua função real. |
| Cobrança | Revisar destinatário e mensagem antes de abrir WhatsApp; não anunciar envio quando apenas abrir o aplicativo. |
| OFX | Harmonizar Conciliação com Conferência local. Preservar aviso de armazenamento no navegador. Organizar importar, prévia, conferir e concluir; sugestão de correspondência não equivale a vínculo comprovado. Explicar ações em lote. |
| DRE | O demonstrativo mensal existe, mas alternância Sistema/Simulação e seleções de Matriz, Margens, Diagnóstico e Visão Sócios não entregam as mudanças sugeridas pelos controles atuais. Entregar ou retirar esses controles. AV tem efeito e deve ser preservado. Simplificar subtotais e não mostrar prejuízo em verde. |
| DFC | A apresentação mensal existe, mas vários modos/abas não têm conteúdo correspondente. Evidenciar saldo inicial, entradas, saídas, geração líquida e saldo final. Confirmação de sincronização deve depender da resposta, não do clique. |
| Novo título | Organizar descrição/pagador, valor/categoria e vencimento/competência. Explicar as datas. Criar obrigação não é registrar pagamento. |
| Pagamentos | Resumo de original, liquidado e saldo; pagamentos parciais claros; nomes legíveis de formas e contas antes de identificadores técnicos. Preservar proteções contra repetição da operação. |
| Cancelamento e estorno | Não confundir exclusão visual, cancelamento, correção por estorno e devolução de dinheiro. Nome e confirmação precisam corresponder ao efeito real. |
| Comprovante | Documento imprimível separado da navegação, com clínica, paciente/pagador, valor e data. Preservar a informação de que não é nota fiscal nem comprovante bancário. |

Há orientações cruzadas dizendo para configurar o plano no Financeiro e em Acompanhamentos. Definir um caminho único e contextualizado, inclusive a partir de Pacotes do paciente, para não fazer a pessoa circular entre módulos.

### 10. Estoque - `/estoque`

**Lista e indicadores:** título e KPIs consistentes. Simplificar oito colunas e quatro ações por item; oferecer visão móvel. Separar estoque baixo de validade, com estados regular/próximo/vencido. Manter quantidade e unidade inequívocas.

**Cadastro e edição:** modais com larguras declaradas de 560/420 px precisam de tratamento responsivo e de altura/rolagem. Agrupar identificação, controle, validade e compra/localização.

**Movimentação:** mostrar saldo antes/depois, item, quantidade e motivo. Preservar bloqueio de alteração direta da quantidade na edição e tornar sua explicação visível. Dar acesso contextual ao histórico disponível.

### 11. Relatórios - `/relatorios`

**Quatro áreas:** Financeiro, Clínico, Operacional e Estoque devem compartilhar composição e componentes. Explicar período versus posição atual e distinguir recebido/pago de previsto.

**Gráficos:** mesmas legendas, cores e definições do dashboard. Melhorar texto dos eixos e oferecer leitura textual ou tabular equivalente. Cada gráfico deve responder uma pergunta clara.

**Exportação e estados:** área, período e recorte explícitos. Preservar o bloqueio de exportação em indisponibilidade e a mensagem de relatório sem estimar totais. Conectar resumos às telas de origem quando houver ação correspondente.

### 12. Configurações - `/configuracoes`

**Navegação:** adaptar cinco abas longas ao celular, aproveitando a solução já usada no Financeiro/Administração. Separar configuração da clínica de perfil pessoal.

**Clínica:** agrupar identidade, contato e operação; não apresentar nome fictício como cadastro. A cor primária salva não tem aplicação encontrada nos tokens: implementar prévia efetiva ou esclarecer sua finalidade. Horário informado deve corresponder à agenda.

**Serviços e categorias:** moeda/duração/comissão consistentes, zero distinto de ausência e modal responsivo. Adição de categoria previsível e exclusão contextual, com consequências claras quando houver vínculos.

**Contas e cidades:** natureza, abertura e situação das contas legíveis; controles legados separados da rotina atual. Preservar ligação das cidades com filtros/agendamentos. Padronizar Salvar alterações, estado pendente, sucesso e erro.

### 13. Administração - `/admin`

**Boa referência interna:** reaproveitar cards móveis, componentes Radix, labels associados e confirmações. Os indicadores de usuários já funcionam como filtros; esse padrão pode beneficiar outras listagens.

**Cadastro e acesso:** distinguir cadastro direto de convite por e-mail. Alinhar textos de senha à política efetiva; seis dígitos e oito caracteres aparecem em fluxos diferentes. Agrupar ficha de membro e apresentar resumo das alterações.

**Perfis e permissões:** preservar permissões herdadas/individuais, limites de concessão e impactos coletivos. Melhorar comparação de perfis e facilitar a leitura da matriz sem esconder permissões sensíveis.

**Auditoria e estados:** melhorar apresentação Antes/Depois e informar que CSV exporta registros carregados, não necessariamente todo o histórico filtrado. Estados sem acesso, aprovação e migração precisam de linguagem consistente e detalhes técnicos separados da orientação principal.

## 5. Componentes, estados e acessibilidade

| Superfície | Diretriz |
| --- | --- |
| Cards e cabeçalhos | Consolidar bibliotecas existentes, sem criar uma quarta camada. `PageHeader` e `KPICard` existem, mas não foram encontradas chamadas JSX. O cabeçalho atual precisa de escala adequada antes de adoção geral. |
| Tabelas | Valores alinhados, ordenação acessível, ações previsíveis e estratégia móvel explícita. |
| Campos | Mesmas dimensões, labels associados, obrigatoriedade coerente e estados de foco/erro/desabilitado/somente leitura distinguíveis. |
| Datas e horários | Unificar controles e interpretação local. Hoje deve respeitar o dia local, sem conversão indevida por UTC. |
| Abas e menus | Links para rotas e abas semânticas para painéis. Não depender apenas de cor ou hover. |
| Diálogos e painéis | Corpo rolável, rodapé previsível, dimensões limitadas à janela, foco contido e restauração ao acionador. Reutilizar Radix/confirm-dialog em vez de prompts. |
| Ícones e tooltips | Nome acessível e área clicável confortável; tooltip como complemento, com posicionamento contido na janela. |
| Carregamento | Corrigir `pj-skeleton`/`pj-fade-in`, ausentes do CSS que define `mc-skeleton`. Usar placeholders proporcionais ao conteúdo. Preservar o carregador neutro já adotado. |
| Vazio e erro | Separar vazio inicial, busca sem resultado, erro, sem acesso, recurso futuro e gravação pendente. Não transformar falha em zero ou ausência de cadastros. |
| Gravação | Distinguir edição local, envio, confirmação pendente, persistido e erro. Não prometer autosave ou sucesso sem confirmação. |
| Sessão | Melhorar aviso de inatividade sem enfraquecer a política existente de encerramento. Orientar sobre edição não salva. |
| Idioma | Traduzir 404/erro raiz e ajustar `lang="en"` para pt-BR. Revisar textos de componentes, incluindo nomes acessíveis. |
| Mensagens | Não prometer que dados foram preservados sem confirmação. Comunicar o ocorrido e uma ação de recuperação válida. |
| Movimento | Estender suporte a movimento reduzido a gráficos e contadores próprios, não somente ao CSS. |
| Gráficos | Padronizar fontes, legendas e cores antes de decidir migração de biblioteca. ApexCharts e Recharts coexistirem não prova lentidão. |
| Marca e impressão | Otimizar os arquivos efetivamente usados e separar documentos imprimíveis da navegação do aplicativo. |

### Evidências de legibilidade

Há **303 ocorrências de classes `text-[Npx]` abaixo de 12 px em 47 arquivos** e **176 cores hexadecimais distintas em 1.290 ocorrências**. São contagens do código, incluindo legado e biblioteca, não de elementos simultaneamente visíveis nem de erros independentes.

Contrastes calculados para cores sólidas sRGB:

| Combinação | Razão aproximada |
| --- | --- |
| Cinza `#9CA3AF` no branco | 2,54:1 |
| Texto do editor `#7E8192` no branco | 3,86:1 |
| Texto verde `#10B981` no fundo `#E8F8F0` do botão de mensagem | 2,31:1 |
| Branco no destrutivo padrão `#EF3E5C` | 3,81:1 |
| Branco no roxo `#6D3FF5` | 5,71:1 |
| Secundário `#5A6178` no branco | 6,15:1 |

Referência para texto comum essencial: **4,5:1**; texto grande possui critério de 3:1 nos casos aplicáveis. Estas amostras não constituem uma certificação integral de acessibilidade. Controles principais por toque devem ter área confortável, preferencialmente em torno de 44 x 44 px, sem exigir que o ícone tenha esse tamanho visual.

## 6. Ordem de execução e metas

1. **Confiança:** corrigir sucesso sem persistência, exemplos apresentados como fatos e controles sem efeito correspondente.
2. **Fundação:** marca, tipografia, cores, foco, componentes, estados e camadas.
3. **Tela-piloto:** shell e Agenda, cobrindo desktop, celular, filtros, grade e formulários.
4. **Rotina clínica:** Pacientes, Prontuário, IA e continuidade do paciente entre telas.
5. **Gestão integrada:** Financeiro e Acompanhamentos, incluindo linguagem e contexto de planos/pagamentos.
6. **Conclusão da migração visual:** Estoque, Relatórios, Configurações, Administração e impressão, reaproveitando os padrões consolidados.

**Metas futuras, não resultados observados em navegador:** layouts utilizáveis a 320/390, 768, 1024 e 1440 px; rolagem horizontal contida a tabelas/grades; foco visível; ações acessíveis com teclado virtual; contexto preservado ao recarregar; nenhum sucesso fictício; logo do cabeçalho idealmente até 100 KB com qualidade adequada.

A mudança visual não deve ampliar permissões, retirar justificativas, confundir programado com realizado ou mudar significados clínicos/financeiros. Não é necessário reescrever o framework para atingir a proposta.

## 7. Referências para execução

| Área | Arquivos principais |
| --- | --- |
| Fundação | `src/styles.css`, `src/components/ds/`, `src/components/ui/`, `src/components/ui-app/`. |
| Estrutura global | `src/components/AppShell.tsx`, `GlobalSearch.tsx`, `NotificationCenter.tsx`, `src/routes/__root.tsx`. |
| Entrada e painéis | `src/routes/auth.tsx`, `src/routes/_authenticated/dashboard.tsx`, `src/features/visao-geral/components/`. |
| Agenda | `src/routes/_authenticated/agenda.tsx`, `src/components/agenda/`, `src/features/agenda/components/`. |
| Pacientes e prontuário | `src/routes/_authenticated/pacientes.tsx`, `src/components/pacientes/`, `src/components/prontuario/`. |
| Acompanhamentos | `src/routes/_authenticated/acompanhamentos.tsx`, `src/routes/_authenticated/acompanhamentos.$id.tsx`, `src/features/acompanhamentos/`. |
| Financeiro | `src/routes/_authenticated/financeiro.tsx`, `src/features/finance/`, `src/components/finance/`. |
| Demais módulos | `src/routes/_authenticated/estoque.tsx`, `relatorios.tsx`, `configuracoes.tsx`, `src/features/admin/`. |
| Marca | `public/assets/medcore-wordmark-v3.png` e demais variantes em `public/assets/`. |

As rotas `/` e `/operacional` redirecionam ao dashboard; não foram contadas como painéis adicionais. Código sem montagem JSX encontrada, como `PatientDrawer`, `MemedTab`, `ManagementReports`, `TitleList`, `TreatmentFinance` e `CardDeposits`, não foi contado como tela ativa. Confirmar consumidores antes de reaproveitar ou remover esses componentes.


## Repaginação aplicada - 26/09/2026

A direção visual foi implementada no código: tema claro roxo MedCore, tipografia Barlow, superfícies e contrastes consistentes, navegação agrupada com busca visível e notificações, cabeçalhos padronizados e adaptação de formulários, abas e sobreposições para telas menores.

A Agenda ganhou filtros em painel acessível por toque, opção Lista e navegação mensal correta. Pacientes ganhou cards móveis, ficha com URL estável e a mesma ficha na Agenda, sem dados pessoais de exemplo. O Prontuário recebeu editor com texto mais escuro e rodapé compatível com o menu expandido ou recolhido. O salvamento na ficha mantém as anotações e informa erro se o servidor recusar a gravação.

Visão Geral agora se apresenta como Indicadores da agenda. Período, profissional e status filtram os mesmos agendamentos acessíveis na Agenda; séries fixas, ociosidade estimada e pacientes demonstrativos foram retirados. Controles sem conteúdo de simulação, matriz e modos de DRE/DFC foram removidos; seleção mensal, análise vertical, exportação e detalhamento continuam disponíveis. As regras de cálculo e classificação financeira não foram alteradas: a revisão contábil indicada no diagnóstico continua sendo um trabalho separado.

Login, Dashboard, Acompanhamentos, Financeiro, Estoque, Relatórios, Configurações e Administração seguem a mesma base visual. A cor armazenada no cadastro da clínica foi identificada como dado cadastral, sem prometer personalização de toda a interface. Funcionalidades de prontuário ainda indisponíveis não são apresentadas como operacionais.

Esta entrega não inclui migrações, publicação em produção, revisão das políticas de acesso do banco ou certificação clínica/contábil. O diagnóstico acima permanece como registro da análise anterior à implementação.

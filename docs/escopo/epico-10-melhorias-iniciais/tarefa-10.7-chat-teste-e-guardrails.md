# Tarefa 10.7 — Criar Chat de Teste e Guardrails de Conteúdo

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Planejada; documentação criada antes do início da implementação
- **Dependências:** Épicos 03 (identidade e autorização), 05 (chaves, Gateway e ledger), 06 (custos e orçamentos), 07 (provedores), 08 (dashboard) e 09 (segurança e observabilidade); tarefas 10.1 (escopos de chave), 10.2 (privacidade de prompts/respostas) e 10.6 (streaming)
- **Módulos afetados previstos:** `apps/api`, `apps/gateway`, `apps/web`, `packages/contracts`, `packages/database`, `packages/policies`, `packages/finance`, `migrations/`, `tests/`
- **Estado:** Somente documentação. Nenhuma implementação foi iniciada.

## 1. Contexto e Objetivo

Disponibilizar no dashboard um chat administrativo de teste que permita validar, sem revelar o segredo, uma chave virtual existente. O operador escolhe uma chave e testa apenas os provedores e modelos permitidos para aquela chave, com os mesmos controles aplicados a uma chamada normal.

A tarefa também introduz guardrails configuráveis para analisar mensagens:

- **Determinísticos:** regras simples, como termos ou frases proibidos e outros critérios fixos definidos por administradores.
- **Inteligentes em runtime:** uma LLM avaliadora analisa a requisição antes do encaminhamento. O resultado permite ou bloqueia a chamada antes de qualquer conteúdo ser entregue ao modelo de destino.
- **Inteligentes assíncronos:** a requisição segue para o modelo de destino sem aguardar a avaliação; se a análise posterior detectar uma violação, o dashboard recebe um alerta. Um alerta não cancela nem desfaz uma resposta já enviada.

## 2. Chat de Teste e Uso de Chaves

1. **Seleção da chave:** o dashboard lista chaves ativas que o operador está autorizado a testar, incluindo chaves de projeto, equipe e pessoa. O escopo e o alvo são exibidos para evitar confusão sobre a atribuição do consumo.
2. **Modelos e integrações disponíveis:** a interface mostra somente provedores/modelos ativos e permitidos para a chave selecionada. A autorização é revalidada no backend em cada chamada; a lista do frontend não é uma fronteira de segurança.
3. **Impersonificação controlada:** selecionar uma chave significa executar uma chamada atribuída a ela, não entrar na conta do titular nem conceder ao operador as credenciais do titular. O segredo da chave não é exibido, enviado ao navegador nem armazenado novamente em texto puro.
4. **Execução segura:** como os segredos existentes são armazenados de forma não reversível, o backend não deve tentar reconstruir uma chave. A implementação deve usar um fluxo interno autenticado de teste, com autorização explícita do operador e uma delegação curta, vinculada ao operador, à organização, à chave-alvo e à finalidade de teste. Essa delegação não pode ser aceita como credencial pública do Gateway, reutilizada ou alterada para atingir outra chave.
5. **Mesmo pipeline:** a chamada de teste respeita status/revogação da chave, modelos autorizados, políticas, limites cumulativos de orçamento, rate limits, controles de guardrail e comportamento do provedor. A ferramenta não oferece bypass administrativo desses controles.
6. **Ledger e auditoria:** chamadas reais de teste geram os registros de uso e custo correspondentes. Além do alvo e escopo da chave, registrar o operador que iniciou o teste e identificá-lo como tráfego de teste, sem atribuir a ação ao titular humano da chave. Não criar lançamentos duplicados.
7. **Falhas de autorização:** chave revogada/inativa, fora da organização, inacessível ao operador ou sem permissão para o modelo deve ser negada antes de iniciar a inferência.
8. **Streaming:** o chat pode usar o streaming já suportado pelo Gateway. Em modo runtime, a avaliação precisa terminar antes dos headers/chunks da inferência de destino. Em modo assíncrono, a avaliação não pode atrasar os chunks da resposta principal.

## 3. Regras e Escopo dos Guardrails

1. Um guardrail pertence a uma organização e pode ser associado a escopos suportados pelo domínio de governança: organização, projeto, equipe, pessoa ou chave. O backend valida que todos os alvos pertencem à organização.
2. Uma chamada deve avaliar todas as regras ativas aplicáveis aos seus atributos reais. Chaves pessoais e de equipe continuam independentes; não presumir vínculo a projeto. Os snapshots de escopo usados na decisão e no alerta devem refletir a chamada no momento em que ocorreu.
3. A configuração de cada regra inclui nome/descrição, estado ativo, tipo de avaliação, modo (runtime ou assíncrono), ação/resultado esperado, escopo e parâmetros específicos. Alterações relevantes devem ser auditáveis.
4. **Regras determinísticas:** devem permitir cadastrar termos e frases proibidos e critérios fixos bem definidos. A comparação deve ter semântica previsível (por exemplo, sensibilidade a maiúsculas/minúsculas e limites de palavra configuráveis ou documentados). O sistema não deve avaliar expressões fornecidas por usuários como código executável.
5. Uma regra determinística em modo runtime bloqueia a requisição correspondente antes do encaminhamento. Em modo assíncrono, a requisição continua e uma violação gera alerta.
6. **Regras inteligentes:** cada regra referencia um provedor/modelo avaliador ativo e autorizado, um prompt de análise versionável e o formato estruturado de decisão esperado (permitir, violação, inconclusivo/erro e, quando aplicável, justificativa e severidade). A resposta livre da LLM não deve ser interpretada de forma permissiva por padrão.
7. A análise inteligente usa o conteúdo da requisição necessária para a regra e não deve incluir credenciais, cabeçalhos de autorização ou dados sem relação com a análise. A interface de configuração informa que o conteúdo poderá ser enviado ao provedor/modelo avaliador escolhido.
8. **Runtime:** a LLM avaliadora termina antes de a mensagem ser encaminhada ao modelo solicitado pelo usuário. Uma decisão de violação bloqueia a geração; uma decisão permitida deixa a chamada seguir pelos controles normais. Para streaming, nenhum chunk da geração principal pode ser enviado antes dessa decisão.
9. **Assíncrono:** a análise é disparada em paralelo à inferência principal e nunca altera a resposta já entregue. Uma violação cria alerta; falha/timeout da análise deve ser observável e gerar estado de análise não concluída, sem ser registrada como “aprovada”.
10. Resultados de guardrail não substituem autenticação, autorização, filtros de modelo, rate limit, orçamento ou outras políticas do Gateway.

## 4. Privacidade, Custos e Observabilidade

1. A ferramenta não habilita automaticamente a captura de prompts/respostas da tarefa 10.2. O histórico visível durante a sessão do chat de teste deve ser transitório por padrão; qualquer persistência segue o opt-in, autorização, criptografia e retenção daquela tarefa.
2. Alertas exibem por padrão metadados mínimos (regra, data, resultado/severidade, operador/titular conforme autorização, chave e evento de uso). Não copiar o prompt ou a resposta para alertas, logs ou métricas.
3. Se a análise do conteúdo ou a visualização de detalhes do alerta depender de conteúdo persistido, respeitar a política de captura da tarefa 10.2 e a permissão específica de leitura. Auditar toda leitura de conteúdo.
4. Chamadas à LLM avaliadora podem enviar conteúdo a outro provedor e gerar custo adicional. Devem ser identificáveis separadamente das chamadas de destino no ledger/observabilidade, sem criar consumo fictício ou duplicar custo.
5. A implementação deve definir e documentar como o custo da avaliação é atribuído (por exemplo, centro de custo da política/organização), sem presumir que pertence ao titular da chave testada.
6. Métricas devem permitir acompanhar bloqueios, permissões, inconclusivos, falhas/timeout e alertas, sem incluir conteúdo sensível.
7. A fila/execução assíncrona precisa de persistência de estado, retries limitados e idempotência para que duplicações de entrega não gerem alertas duplicados. O Gateway não deve aguardar a conclusão da análise assíncrona.

## 5. Atividades Previstas

- [x] Definir permissões específicas para listar e executar testes de chaves de terceiros, administrar guardrails e consultar alertas/conteúdo: somente owner/admin.
- [x] Definir o mecanismo interno de delegação de teste, incluindo expiração, uso único, vínculo ao operador/alvo e proteção contra replay.
- [x] Definir precedência quando várias regras determinísticas e inteligentes se aplicarem simultaneamente.
- [x] Definir o comportamento de runtime em falha/timeout/inconclusivo do avaliador: fail-closed, com estado/alerta explícito.
- [x] Definir atribuição dos custos de avaliação: organização, em registros separados dos custos de inferência principal.
- [x] Definir retenção de alertas/resultados: 30 dias; conteúdo da conversa não é persistido por guardrails.
- [x] Implementar contratos, armazenamento/migrações, APIs, execução de regras, dashboard e auditoria.
- [x] Implementar o chat de teste para chaves autorizadas, com seleção dos modelos elegíveis, modo streaming e registro financeiro/auditoria.
- [x] Adicionar testes automatizados para bloqueio runtime antes de SSE, delegação de uso único, falha inconclusiva, processamento assíncrono, privacidade e custo; manter os testes existentes de autorização, revogação, streaming e ledger.
- [ ] Substituir o agendamento assíncrono em processo por uma fila durável com retries limitados; a implementação atual persiste estados/resultados, mas marca trabalhos interrompidos como falhos e não os reprocessa.
- [ ] Executar o [guia de teste manual da tarefa 10.7](./testes-manuais/teste-manual-10.7-chat-e-guardrails.md).

## 6. Critérios de Aceitação

- [x] Um operador autorizado consegue testar uma chave existente sem revelar seu segredo; o Gateway revalida políticas e permissões da chave.
- [x] A delegação interna tem uso único, expiração curta e vínculo à organização, operador e chave-alvo.
- [x] A chamada de teste registra o operador e sua origem no ledger, sem criar um segredo reutilizável.
- [x] A violação determinística ou inteligente em runtime bloqueia a inferência antes de enviar headers/chunks SSE.
- [x] Em modo assíncrono, a resposta principal não aguarda a análise e uma violação gera alerta consultável.
- [x] Falhas e decisões inconclusivas de análise são explicitamente representadas; falhas runtime bloqueiam a chamada.
- [x] Custos do avaliador, quando há preço configurado, são registrados separadamente e atribuídos à organização.
- [x] A análise de guardrails não persiste o conteúdo da mensagem; alertas usam razões genéricas.
- [x] Testes automatizados cobrem o fluxo de delegação, privacidade, bloqueio runtime/streaming, inconclusivos, análise assíncrona e atribuição de custo.
- [ ] A fila assíncrona recupera trabalhos interrompidos com retries limitados; ainda não atendido pela execução em processo atual.
- [ ] Executar o guia manual do dashboard e validar a interação completa da UI.

## 7. Decisões Confirmadas para Implementação

1. **Falha/timeout runtime:** fail-closed. Erro, timeout ou resposta inconclusiva do avaliador bloqueia a chamada de destino e gera estado/alerta explícito.
2. **Teste e administração:** somente papéis owner/admin podem testar chaves de terceiros, configurar guardrails e consultar alertas. O backend aplica a autorização; não depende da visibilidade da UI.
3. **Contexto do avaliador:** enviar somente o conteúdo da mensagem atual do usuário, nunca o histórico completo.
4. **Custo:** registrar custos de avaliação separadamente e atribuí-los à organização, não ao titular nem à chave testada.
5. **Retenção:** alertas e resultados de avaliação expiram em 30 dias. Prompts/respostas não são persistidos pela funcionalidade de guardrails.
6. **Precedência:** avaliar regras aplicáveis em ordem de criação e ID; regras runtime são processadas sequencialmente e a primeira decisão diferente de `allowed` bloqueia a chamada. Regras assíncronas aplicáveis são agendadas sem atrasar a inferência.

## 8. Estado da Implementação

Os contratos, migração 009, APIs, telas do dashboard, execução do Gateway e contabilização foram implementados. A suíte completa passou com 20 arquivos e 73 testes; `npm run typecheck` e `npm run build` também passaram. A integração nova verifica bloqueio antes de SSE, ticket de teste de uso único, fail-closed para saída inconclusiva, alerta assíncrono sem conteúdo e custo do avaliador.

A execução assíncrona atual é limitada a oito avaliações inteligentes simultâneas e mantém o estado no banco, mas o agendamento ocorre em processo: se o processo for interrompido, o resultado pendente é marcado como falho na recuperação e não há retry. A fila durável com retries e o roteiro manual da UI continuam pendentes.

## 9. Limites

- O chat de teste não é um console de bypass nem substitui testes automatizados/observabilidade.
- Selecionar uma chave não autentica o operador como seu titular. A identidade do operador deve continuar rastreável.
- A análise assíncrona é posterior ao envio e não pode prometer impedir que conteúdo ou resposta já tenham sido processados.
- A implementação segue as decisões confirmadas acima; alterações de código são rastreadas nesta tarefa.

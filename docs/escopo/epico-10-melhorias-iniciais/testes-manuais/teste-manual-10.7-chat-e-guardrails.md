# Guia de Teste Manual — Tarefa 10.7: Chat de Teste e Guardrails

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa relacionada:** [Tarefa 10.7 — Criar Chat de Teste e Guardrails de Conteúdo](../tarefa-10.7-chat-teste-e-guardrails.md)
- **Estado:** Roteiro planejado; a funcionalidade ainda não foi implementada.

> [!WARNING]
> Quando implementado, valide somente com chaves e conteúdo sintéticos/autorizados. Nunca copie segredos para o chat, logs ou capturas de tela. Chamadas de teste a provedores reais podem gerar custos.

## 1. Pré-requisitos para a futura execução

- Ambiente iniciado conforme o `README.md`, com dashboard, API, Gateway, banco e ao menos um provedor/modelo disponíveis.
- Usuário operador com permissões explícitas para testar a chave escolhida e configurar/consultar guardrails.
- Chaves de teste ativas de projeto, equipe e pessoa, além de uma chave revogada ou sem acesso.
- Modelos permitidos e não permitidos associados às chaves para validar a filtragem.
- Regras determinísticas e um modelo avaliador configurável para testes runtime e assíncronos.
- Conteúdo de teste não sensível; política de captura da tarefa 10.2 configurada conforme o cenário.

## 2. Validar o chat de teste e o isolamento por chave

1. Entre no dashboard como operador autorizado e abra o chat de teste.
2. Selecione uma chave de projeto, uma de equipe e uma pessoal. Confirme que escopo e alvo correspondem à chave selecionada.
3. Para cada chave, confira que somente os modelos/provedores permitidos aparecem e envie uma mensagem sintética.
4. Confirme resposta normal e, se habilitado, streaming progressivo. Verifique no ledger o evento, custo e identificação do operador como iniciador do teste.
5. Confirme que o evento não é atribuído ao operador como titular da chave e não há duplicidade de custo.
6. Inspecione interface, tráfego acessível ao navegador, logs e respostas de erro: o segredo da chave nunca deve ser exibido ou incluído.
7. Tente usar uma chave revogada, de outra organização, sem permissão do operador e um modelo não permitido. Cada tentativa deve ser negada antes da inferência.
8. Verifique que orçamento, rate limit e demais políticas aplicáveis continuam valendo no chat de teste.

## 3. Validar regras determinísticas

1. Configure uma regra de termo/frase proibidos no escopo de teste e associe-a a uma chave.
2. Envie texto que corresponda à regra e confirme que o comportamento respeita o modo selecionado.
3. Envie texto semelhante que não deve corresponder (por exemplo, variação de maiúsculas/minúsculas ou ocorrência como parte de outra palavra) e confira a semântica documentada.
4. Se a regra estiver em runtime, confirme bloqueio antes do provedor e ausência de chunks da inferência principal.
5. Se estiver em modo assíncrono, confirme resposta sem espera adicional e alerta quando a avaliação identificar a violação.
6. Teste outra chave não abrangida pela regra e confirme que ela não é afetada.

## 4. Validar análise inteligente runtime

1. Configure um guardrail runtime com provedor/modelo avaliador autorizado e prompt sintético que produza decisões claras de permitir e violação.
2. Envie uma mensagem permitida e confirme que só então a chamada segue ao modelo de destino.
3. Envie uma mensagem que viole a regra e confirme que a geração principal não começa. Em streaming, nenhum chunk de resposta principal deve preceder a decisão.
4. Simule timeout, indisponibilidade e resposta inválida/inconclusiva do avaliador. Confirme o comportamento de falha aprovado para a política, seu estado explícito e a ausência de aprovação silenciosa.
5. Confira uso/custo separado para avaliação e inferência, além de logs e métricas sem conteúdo sensível.

## 5. Validar análise inteligente assíncrona e alertas

1. Configure um guardrail inteligente assíncrono e envie uma mensagem sintética.
2. Confirme que a inferência principal não aguarda a avaliação e que o resultado do usuário não é alterado retroativamente.
3. Faça a análise detectar uma violação e confirme criação de alerta com chave, regra, evento, resultado/severidade e data.
4. Force a análise a falhar ou expirar. Confirme estado não concluído/falha observável, sem status de aprovado.
5. Repita/entregue novamente o mesmo resultado e confirme idempotência, sem alerta duplicado.
6. Verifique permissões de consulta, isolamento entre organizações, trilha de auditoria e ausência de prompt/resposta no alerta por padrão.
7. Quando a visualização de conteúdo estiver autorizada, confirme que captura, opt-in, retenção e auditoria seguem integralmente a tarefa 10.2.

## 6. Critérios de conclusão do roteiro

- [ ] O operador só testa chaves que está autorizado a usar e modelos permitidos para cada chave.
- [ ] O segredo nunca é exposto e políticas existentes não podem ser contornadas pelo chat.
- [ ] Operador, chave-alvo, evento e custo são rastreáveis sem duplicidade nem atribuição incorreta.
- [ ] Regras determinísticas e inteligentes runtime bloqueiam antes da inferência quando aplicável.
- [ ] A análise assíncrona não atrasa a resposta e gera alertas posteriores, com falhas e duplicidades tratadas explicitamente.
- [ ] Privacidade, isolamento, permissões, streaming e custos de avaliação estão validados.

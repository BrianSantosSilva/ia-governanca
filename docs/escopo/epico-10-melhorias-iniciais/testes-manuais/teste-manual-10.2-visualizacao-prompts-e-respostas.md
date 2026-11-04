# Guia de Teste Manual — Tarefa 10.2: Visualização de Prompts e Respostas

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa Relacionada:** [Tarefa 10.2 — Visualizar Prompts e Respostas do Gateway](../tarefa-10.2-visualizacao-prompts-e-respostas.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!CAUTION]
> Execute apenas com conteúdo sintético e em uma organização de teste. Prompts/respostas podem conter dados sensíveis. Não use credenciais reais, dados pessoais ou informações confidenciais. Não copie conteúdo para logs, tickets ou evidências compartilhadas.

## 1. Pré-requisitos

- Ambiente iniciado conforme o `README.md`; API, Gateway, PostgreSQL, Keycloak, Web e Ollama estão saudáveis.
- Uma organização e um projeto descartáveis, uma chave virtual de teste e um usuário com permissão para administrar privacidade.
- `PROMPT_CONTENT_ENCRYPTION_KEY` configurada com 64 caracteres hexadecimais.
- Uma conta de teste autorizada a visualizar conteúdo e outra conta sem essa permissão.

## 2. Confirmar comportamento padrão sem captura

1. Acesse `http://localhost:3000` e confirme que a captura de prompts/respostas está desativada por padrão para a organização.
2. Faça uma chamada ao Gateway com conteúdo sintético, por exemplo: “Responda apenas: saída de teste”.
3. Confirme que a inferência responde normalmente e que o evento de uso registra seus metadados.
4. Abra o detalhe do evento. O dashboard deve indicar **conteúdo não armazenado**; não deve mostrar prompt nem resposta.
5. Inspecione os logs da API e do Gateway e confirme que o conteúdo sintético não aparece.

## 3. Habilitar captura e consentir em uma chamada

1. Como administrador, habilite a captura para a organização após ler o aviso de retenção e privacidade.
2. Configure um prazo curto de retenção próprio para o teste.
3. Faça uma chamada sintética com `"store": true` no JSON para consentir com o armazenamento daquela requisição.
4. Abra o evento no dashboard como usuário autorizado. Confirme mensagens de entrada e resposta corretas, associadas à chamada e formatadas como texto, sem execução de HTML.
5. Consulte novamente os logs e confirme que não contêm o prompt ou a resposta.

## 4. Validar autorização e auditoria de leitura

1. Entre com o usuário sem permissão específica de leitura de conteúdo e abra o mesmo evento.
2. Confirme que prompt e resposta não são retornados. A API deve responder `403` ao usuário sem a permissão `prompts:read`.
3. Volte à conta autorizada e consulte o evento novamente.
4. Abra **Auditoria** e confirme que a leitura de conteúdo foi registrada com ator, evento e horário, sem replicar o prompt ou a resposta na auditoria.
5. Tente consultar um identificador de evento de outra organização. O conteúdo deve ser negado sem revelar sua existência.

## 5. Validar retenção e integridade financeira

1. Aguarde o prazo configurado ou use o mecanismo administrativo de expurgo previsto para ambiente de teste.
2. Consulte novamente o evento. O conteúdo deve aparecer como expirado/não disponível.
3. Confirme que o evento financeiro, os tokens, o custo e sua proveniência continuam no dashboard e no ledger.
4. Desabilite a captura para a organização e faça outra chamada consentida. A nova chamada não deve armazenar conteúdo.

### Critérios de conclusão do roteiro

- [ ] Captura desativada por padrão; inferência e ledger continuam funcionando sem armazenar conteúdo.
- [ ] Captura habilitada requer consentimento válido e só então permite consultar conteúdo sintético.
- [ ] A permissão específica é verificada no backend e tentativas não autorizadas são negadas.
- [ ] A leitura é auditada sem inserir conteúdo em logs ou na própria auditoria.
- [ ] A retenção remove conteúdo sem apagar evento, custo ou métricas financeiras.
- [ ] A interface apresenta conteúdo como texto não confiável e não permite execução de HTML.

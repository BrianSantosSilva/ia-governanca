# Guia de Teste Manual — Tarefas 11.1 a 11.4: Compatibilidade com Clientes Agentes

- **Épico:** Épico 11 — Compatibilidade do Gateway com Clientes Agentes
- **Tarefas Relacionadas:** [11.1](../tarefa-11.1-contrato-tool-calling.md), [11.2](../tarefa-11.2-adaptadores-e-streaming-tool-calls.md), [11.3](../tarefa-11.3-governanca-chamadas-agentes.md) e [11.4](../tarefa-11.4-integracao-copilot-cli-byok.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!WARNING]
> Use uma chave virtual de teste com orçamento baixo e prompts sintéticos. Não compartilhe chaves. O `providers.json` guarda a chave em texto simples: mantenha o arquivo privado e fora de repositórios.

> [!NOTE]
> Este guia será detalhado conforme as tarefas forem implementadas. Os itens abaixo definem o roteiro mínimo de validação.

## 1. Pré-requisitos

- Gateway, PostgreSQL e o provedor configurado (Foundry ou Ollama com modelo compatível com ferramentas) saudáveis.
- Chave virtual de teste autorizada para o modelo.

## 2. Regressão sem ferramentas (11.1)

Envie uma chamada simples sem `tools`, JSON e SSE. Confirme que o comportamento anterior permanece.

## 3. Ciclo de ferramenta (11.1 e 11.2)

1. Envie uma requisição com `tools` e uma pergunta que exija a ferramenta. Confirme `tool_calls` e `finish_reason: "tool_calls"`.
2. Envie a mensagem `tool` com o `tool_call_id` e confirme a resposta final.
3. Repita com `stream: true`; confirme que os argumentos fragmentados chegam completos.
4. Envie `tools` a um modelo sem suporte e confirme a recusa explícita.

## 4. Governança (11.3)

- Confirme custo, tokens e origem no ledger/dashboard.
- Valide orçamento baixo, rate limit e revogação da chave.
- Valide que guardrails não geram respostas de ferramenta inválidas e que logs não contêm conteúdo.

## 5. Copilot CLI (11.4)

1. Configure o provedor no `providers.json` com `baseUrl` do Gateway, a chave de teste e o modelo.
2. Inicie `copilot --model <provedor>/<modelo>` e peça uma tarefa que leia um arquivo.
3. Confirme o ciclo de ferramentas e o registro no dashboard.
4. Confirme que escolher um modelo hospedado pelo GitHub **não** gera registro no Gateway.

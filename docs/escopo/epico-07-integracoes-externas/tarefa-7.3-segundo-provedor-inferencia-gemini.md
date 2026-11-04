# Tarefa 7.3 — Adicionar Segundo Provedor de Inferência (ex.: Gemini API)

- **Épico:** Épico 07 — Implementar Integrações Externas
- **Fase:** 7 (Integrações Externas)
- **Dependências:** [Tarefa 5.2](../epico-05-gateway-llm/tarefa-5.2-implementar-adaptador-ollama.md), [Tarefa 7.1](./tarefa-7.1-integracao-api-oficial-custos.md)
- **Módulos Afetados:** `apps/gateway`, `.env.example`

## 1. Objetivo
Comprovar a capacidade multi-provedor do Gateway LLM adicionando um segundo adaptador de inferência opcional (como a **Google Gemini API**), sem tornar o protótipo dependente de credenciais externas para funcionar.

## 2. Diretrizes de Implementação e Privacidade
- **Tabela de Preços e Condições da Gemini API:** Consultar https://ai.google.dev/gemini-api/docs/pricing antes de habilitar o conector.
- **Atenção à Privacidade na Faixa Gratuita:**
  > [!CAUTION]
  > As condições da faixa gratuita (*free tier*) podem permitir que o conteúdo enviado seja utilizado pelo provedor para melhorar produtos. Utilize **exclusivamente dados sintéticos ou não sensíveis** nesse ambiente e verifique os termos aplicáveis antes de enviar qualquer informação.
- **Independência do Protótipo:**
  - Controlado pela flag `LLM_EXTERNAL_PROVIDERS_ENABLED=false` por padrão.
  - O protótipo **não deve depender dessa integração externa** para inicializar ou passar na suíte de testes locais padrão.

## 3. Atividades Passo a Passo
- [ ] Implementar o `GeminiAdapter` seguindo a interface `LLMProviderAdapter` em `apps/gateway`.
- [ ] Extrair métricas de tokens (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) da resposta da Gemini API e registrar em `usage_events` e `cost_records`.
- [ ] Configurar roteamento no gateway para selecionar o adaptador correto (`ollama` vs. `gemini`) com base no modelo/provedor solicitado e nas permissões da chave virtual.
- [ ] Criar testes para o adaptador utilizando mocks/fixtures por padrão e execução opcional real quando `GEMINI_API_KEY` estiver configurada.

## 4. Critérios de Conclusão (Fechamento do Épico 07)
- [ ] Existe pelo menos um conector de dados externos ou uma fixture validada.
- [ ] A ingestão preserva a origem e o período.
- [ ] A integração pode ser executada novamente sem duplicação.
- [ ] Erros de autenticação e limites de taxa são tratados adequadamente.
- [ ] O segundo provedor de inferência funciona no gateway quando habilitado, e o sistema continua funcionando 100% offline/local quando desabilitado.
- [ ] A API informa a data/estado da última sincronização para exibição no dashboard.

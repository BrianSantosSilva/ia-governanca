# Guia de Teste Manual — Tarefa 10.4: Custos de LLM por Dimensão

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa Relacionada:** [Tarefa 10.4 — Consolidar Custos de LLM por Modelo, Organização, Projeto, Equipe e Pessoa](../tarefa-10.4-visoes-consolidadas-custos-llm.md)
- **Dependências:** [Tarefa 10.1 — Governança por Equipe e Usuário](../tarefa-10.1-governanca-equipes-e-usuarios.md) para relatórios por pessoa
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!WARNING]
> Use chamadas sintéticas e organizações/projetos de teste. Os testes automatizados de integração podem recriar o schema; use banco descartável. Custos Ollama são estimativas internas, não cobranças reais.

## 1. Pré-requisitos

- Ambiente inicializado; API, Gateway, worker, dashboard, PostgreSQL, Keycloak e Ollama estão saudáveis.
- Existem pelo menos dois eventos de inferência com custos registrados, com preços vigentes e períodos que incluam as chamadas.
- Os eventos de teste estão associados a projetos; para validar equipe, um desses projetos deve estar associado a uma equipe.
- Para testar pessoa, a tarefa 10.1 deve estar implementada e pelo menos uma chamada deve ter chave com proprietário explícito.

## 2. Conferir visão por provedor e modelo

1. Abra `http://localhost:3000` e faça login.
2. Selecione a organização de teste e abra **Custos**.
3. Escolha um período que contenha as chamadas de teste.
4. Confira o custo agregado por provedor/modelo e compare-o com os eventos que compõem o total.
5. Confirme que moeda, categoria e marcador de simulação/estimativa estão visíveis.

## 3. Detalhar por dimensões

1. Filtre por um projeto e confirme que o total corresponde apenas aos custos daquele projeto.
2. Filtre pela equipe associada ao projeto e compare com os custos dos projetos da equipe.
3. Se a atribuição individual estiver habilitada, filtre por pessoa e confirme que apenas chamadas de chaves explicitamente atribuídas aparecem.
4. Selecione eventos sem proprietário e confirme que aparecem como **Não atribuído**, não sob a pessoa que criou a chave.
5. Remova os filtros e confira que o total organizacional permanece consistente.

## 4. Verificar precisão, categorias e ausência de dupla contagem

1. Inclua uma chamada cujo custo seja inferior a `0.01` na moeda do teste; confirme que a interface mostra casas decimais suficientes e não exibe zero arredondado.
2. Compare custos estimados do Gateway com a tabela `cost_records`, filtrando `gateway_estimated`, organização e período.
3. Confira que custos reportados, ajustes financeiros e licenças continuam em categorias distintas.
4. Quando houver mais de uma moeda, confirme que os totais ficam separados por moeda.
5. Compare a soma da organização com a origem financeira; navegar por projeto, equipe ou pessoa não pode criar novos registros nem alterar o total.

## 5. Validar filtros e isolamento

1. Combine período, provedor/modelo, projeto e equipe; confirme que a tela explica o contexto dos resultados.
2. Limpe os filtros e valide o retorno ao escopo da organização.
3. Tente consultar identificadores de outra organização por interface ou endpoint; a API deve negar a consulta.
4. Se não houver registros para o período selecionado, confirme uma mensagem de ausência de dados, diferente de custo zero.

### Critérios de conclusão do roteiro

- [ ] Custos podem ser lidos por provedor/modelo e detalhados por organização, projeto e equipe.
- [ ] A dimensão de pessoa só inclui eventos com atribuição confiável; ausentes ficam não atribuídos.
- [ ] Valores, moedas, origem e simulação são explícitos e precisos.
- [ ] Categorias financeiras permanecem separadas e não há dupla contagem nos drill-downs.
- [ ] Filtros e consultas respeitam isolamento multi-tenant e distinguem ausência de custo zero.

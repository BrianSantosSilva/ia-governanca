# Tarefa 10.4 — Consolidar Custos de LLM por Modelo, Organização, Projeto, Equipe e Pessoa

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Épicos 05 (eventos de uso), 06 (custos e preços), 08 (dashboard) e tarefa [10.1 — Governança por Equipe e Usuário](./tarefa-10.1-governanca-equipes-e-usuarios.md)
- **Módulos Afetados:** `apps/api`, `apps/web`, `packages/contracts`, `packages/finance`, `tests/`

## 1. Contexto e Objetivo

A tela **Custos** apresenta totais por categoria financeira, moeda e indicador de simulação, mas não fornece uma visão consolidada direta de quanto cada provedor/modelo de LLM custou nem permite comparar esses custos em diferentes dimensões de governança.

Esta tarefa adiciona uma visão analítica do custo de inferência por provedor e modelo, com filtros e detalhamento por organização, projeto, equipe e pessoa. O dado deve continuar ligado aos registros financeiros e eventos de uso de origem.

## 2. Regras de Apresentação e Agregação

1. **Dimensões:** apresentar totais por provedor/modelo e permitir detalhar ou filtrar por organização, projeto, equipe e pessoa, além de período.
2. **Pessoa:** a dimensão individual depende da atribuição confiável definida na tarefa 10.1. Eventos sem proprietário permanecem em uma categoria visível como “Não atribuído”; não inferir a pessoa a partir do criador da chave.
3. **Custos:** incluir somente categorias de custo de inferência compatíveis com o filtro selecionado; manter custos estimados locais, tarifas comerciais reportadas, ajustes e custos de licença identificados separadamente.
4. **Proveniência:** indicar moeda, categoria, simulação/estimativa e origem. Não somar moedas diferentes nem misturar custo estimado e reportado como se fossem um único valor.
5. **Precisão:** preservar os valores decimais do ledger, inclusive custos inferiores a um centavo.
6. **Totais e drill-down:** total de uma organização deve corresponder aos seus eventos de origem; subtotais por projeto/equipe/pessoa são visões do mesmo custo e não novos lançamentos.
7. **Filtros e autorização:** filtros devem respeitar o tenant ativo e a autorização do backend, inclusive para seletores e consultas por pessoa.
8. **Dados ausentes:** diferenciar ausência de dados de custo zero e não apresentar uma estimativa como custo real do provedor.

## 3. Atividades Passo a Passo

- [x] Definir consultas/agregações para custo de inferência por provedor/modelo e dimensões, com limites e paginação apropriados.
- [x] Criar endpoint ou estender endpoints analíticos existentes para retornar totais e detalhes por dimensão sem dupla contagem.
- [x] Atualizar a página **Custos** com resumo por provedor/modelo e detalhamento por organização, projeto, equipe e pessoa.
- [x] Adicionar filtros de período, categoria/origem e dimensão, preservando-os na URL junto dos filtros globais.
- [x] Identificar claramente moedas, simulação, custo estimado, custo reportado e ausência de atribuição individual.
- [x] Preservar precisão decimal na API e apresentar custos pequenos sem arredondá-los para zero.
- [x] Adicionar testes de integração para filtros por equipe/pessoa, tenant e consistência dos registros consultados.
- [x] Atualizar o guia manual do dashboard e registrar a dependência da tarefa 10.1 para dimensão de pessoa.

## 4. Critérios de Conclusão

- [x] A tela **Custos** mostra quanto cada provedor/modelo custou no período e contexto selecionados.
- [x] Usuário consegue filtrar os custos por organização, projeto, equipe e pessoa atribuída.
- [x] Totais usam `cost_records` e eventos de uso de origem; filtros dimensionais não criam lançamentos financeiros.
- [x] A visualização não soma moedas diferentes nem combina categorias estimadas, reportadas, ajustadas e de licença sem identificação.
- [x] Custos pequenos mantêm casas decimais suficientes para não aparecerem como zero quando não são zero.
- [x] Dados ausentes são explicitados e custos estimados são identificados como tais.
- [x] A API aplica isolamento e permissões em toda consulta e filtro.
- [x] Testes de integração dos endpoints e filtros passaram; roteiro manual documentado.

## Situação da implementação — 2 de novembro de 2026

Implementação e validação automatizada concluídas. A API `/costs/by-model` agrupa por provedor/modelo, categoria, moeda, projeto, equipe e pessoa, com paginação e filtros; a tela **Custos** apresenta os dados sem misturar moedas ou categorias. Teste PostgreSQL verificou filtro simultâneo por equipe e pessoa. O guia manual permanece disponível para verificação visual com dados da organização.

## 5. Decisões e Limites

- A visão analítica não altera o ledger nem cria custos adicionais; agrega registros financeiros existentes.
- O detalhamento por pessoa não é considerado confiável até que chaves/eventos tenham proprietário explícito segundo a tarefa 10.1.
- Custos de tokens locais, como Ollama, são estimativas internas conforme catálogo, não tarifas comerciais ou faturas efetivamente cobradas.

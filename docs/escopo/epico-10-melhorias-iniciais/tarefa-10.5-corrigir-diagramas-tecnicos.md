# Tarefa 10.5 — Corrigir e Sincronizar os Diagramas Técnicos

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Épicos 05 (Gateway LLM) e 09 (documentação e hardening)
- **Arquivos Afetados:** `docs/desenhos/arquitetura-tecnica.svg`, `docs/desenhos/arquitetura-tecnica.png`, `docs/desenhos/arquitetura-tecnica.jpg`, `README.md`, `docs/escopo/`

## 1. Contexto e Objetivo

Os artefatos gráficos da arquitetura apresentam inconsistências visuais e podem dar a entender que existem duas instâncias ou dois tipos de Gateway. A arquitetura implementada possui um serviço `apps/gateway` para tráfego de inferência e um serviço distinto `apps/api` para operações administrativas e consultas do dashboard.

Esta tarefa corrige o desenho técnico e mantém suas versões SVG, PNG e JPG sincronizadas com o sistema real, evitando ambiguidade na leitura da arquitetura.

> **Situação — 2 de novembro de 2026:** pendente por decisão do usuário. Não foram atualizados nem exportados os diagramas nesta rodada.

## 2. Atividades Passo a Passo

- [ ] Revisar o SVG fonte e os exports raster para localizar duplicações, setas e rótulos divergentes.
- [ ] Representar `apps/gateway` uma única vez, recebendo chamadas de inferência de aplicações/SDKs e encaminhando-as aos provedores LLM.
- [ ] Representar `apps/api` separadamente como API administrativa consumida pelo dashboard, responsável por organizações, projetos, chaves, orçamento, consultas agregadas e conectores.
- [ ] Diferenciar visualmente autenticação de usuário OIDC (Keycloak) de autenticação de cliente por chave virtual no Gateway.
- [ ] Revisar fluxos do Gateway para Ollama/Gemini e PostgreSQL, e fluxo da API para PostgreSQL/worker, sem sugerir chamadas redundantes ou responsabilidades incorretas.
- [ ] Regenerar SVG, PNG e JPG a partir de uma fonte única e atualizar links/documentação se necessário.
- [ ] Validar dimensões, legibilidade, nomes de portas e correspondência com os serviços/scripts atuais.

## 3. Critérios de Conclusão

- [ ] O diagrama contém apenas uma representação de `apps/gateway`.
- [ ] `apps/api` e `apps/gateway` têm funções, consumidores, autenticação e fluxos claramente distintos.
- [ ] SVG, PNG e JPG mostram a mesma arquitetura e estão sincronizados.
- [ ] Cada componente e seta corresponde à implementação e às portas documentadas.
- [ ] A documentação explica qual formato é fonte e como os exports são produzidos.

## 4. Decisões e Limites

- O desenho deve representar a arquitetura atual implementada, não funcionalidades futuras ainda não disponíveis.
- Mudanças futuras de arquitetura devem atualizar primeiro a fonte vetorial e regenerar todos os formatos derivados.

# Guia de Validação Manual — Tarefa 10.5: Diagramas Técnicos

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa Relacionada:** [Tarefa 10.5 — Corrigir e Sincronizar os Diagramas Técnicos](../tarefa-10.5-corrigir-diagramas-tecnicos.md)

## 1. Abrir os formatos publicados

Abra `docs/desenhos/arquitetura-tecnica.svg`, `docs/desenhos/arquitetura-tecnica.png` e `docs/desenhos/arquitetura-tecnica.jpg` no navegador ou visualizador de imagens.

Confirme em cada formato:

1. Há somente um bloco `apps/gateway`, identificado como caminho de inferência das aplicações/SDKs para Ollama ou Gemini.
2. `apps/api` aparece como serviço distinto da interface administrativa e do dashboard.
3. O fluxo de autenticação OIDC de usuários via Keycloak não é confundido com a validação de chaves virtuais no Gateway.
4. As conexões com PostgreSQL, worker, provedores e dashboard estão rotuladas de forma legível e coerente.
5. Os três formatos apresentam os mesmos componentes, nomes, portas e fluxos.

## 2. Conferir os links da documentação

Abra o README e a visão geral/roadmap. Confirme que a imagem exibida e os links para versões vetorial/raster apontam para arquivos existentes e para a mesma revisão do desenho.

### Critérios de conclusão

- [ ] Todos os formatos contêm um único Gateway e distinguem claramente API administrativa de inferência.
- [ ] Os fluxos são consistentes com os serviços e portas documentados.
- [ ] SVG, PNG e JPG estão sincronizados e os links funcionam.

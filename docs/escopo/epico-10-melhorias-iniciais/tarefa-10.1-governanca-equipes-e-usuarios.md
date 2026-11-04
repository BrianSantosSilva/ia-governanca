# Tarefa 10.1 — Implementar Governança de Custos e Orçamentos por Equipe e Usuário

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Épicos 03 (identidade e equipes), 05 (chaves virtuais), 06 (custos e orçamentos) e 08 (dashboard)
- **Módulos Afetados:** `apps/api`, `apps/gateway`, `apps/web`, `packages/contracts`, `packages/finance`, `packages/policies`, `packages/database`, `migrations/`, `tests/`

## 1. Contexto e Objetivo

Uma chave virtual pode pertencer exclusivamente a um projeto, a uma equipe ou a uma pessoa. Projetos são opcionais para chaves de equipe e pessoais. Os custos pessoais são atribuídos à equipe única da pessoa, quando ela pertence a uma; uma pessoa pode não pertencer a equipe alguma.

Esta tarefa evolui o produto para que organizações possam acompanhar consumo e custos por equipe e atribuir exceções de orçamento a pessoas específicas, sem perder a rastreabilidade nem permitir que uma chave compartilhada contorne os limites individuais.

## 2. Regras de Domínio

1. **Escopo exclusivo da chave:** cada chave pertence a exatamente um projeto, equipe ou pessoa. Projeto é obrigatório somente para chaves de projeto; chaves de equipe e pessoa não carregam um projeto implícito.
2. **Equipe:** chamadas com chave de equipe são atribuídas à equipe proprietária. Custos da equipe incluem essas chamadas e as chaves pessoais dos seus membros; cada pessoa pode pertencer a no máximo uma equipe na organização. Uma chave de projeto continua atribuída somente ao projeto e sua equipe relacionada.
3. **Pessoa:** uma chave pessoal pertence a um membro ativo da organização, sem vínculo de projeto. Chamadas são atribuídas à pessoa e, se aplicável, à sua única equipe. Chaves pessoais e de equipe podem coexistir; pessoas sem equipe continuam plenamente suportadas.
4. **Orçamentos cumulativos:** uma chamada respeita todas as políticas ativas aplicáveis (organização, projeto quando houver, chave, equipe quando houver e pessoa quando houver), e não somente a política mais específica.
5. **Integridade multi-tenant:** projeto, equipe, chave e usuário devem pertencer à mesma organização; a associação de uma pessoa a uma equipe é única por organização.
6. **Proveniência:** eventos e custos preservam as dimensões realmente conhecidas. O criador de uma chave não é tratado como proprietário.
7. **Compatibilidade:** chaves antigas sem proprietário permanecem de projeto. Chaves antigas com proprietário migram para escopo pessoal; eventos e custos históricos preservam o projeto original registrado.

## 3. Atividades Passo a Passo

- [x] Definir e documentar o ciclo de vida do proprietário da chave (criação, alteração, revogação e transferência) e impedir associações a usuários inativos ou de outra organização.
- [x] Criar migrações aditivas para armazenar o proprietário individual da chave e a atribuição de usuário/equipe nos eventos financeiros, preservando histórico e chaves existentes.
- [x] Estender contratos e validações de orçamento para aceitar os escopos `team` e `user`, com referências obrigatórias e validação de organização.
- [x] Aplicar reservas atômicas e avaliação cumulativa de todas as políticas ativas aplicáveis à chamada; manter alertas e bloqueios consistentes em caso de concorrência.
- [x] Atualizar a API e o dashboard para atribuir proprietário a uma chave e criar/consultar políticas por equipe e pessoa.
- [x] Atualizar filtros, agregações e detalhamento de consumo/custos para a dimensão de equipe e usuário, sem dupla contagem entre totais e subtotais.
- [x] Adicionar testes de autorização, isolamento multi-tenant, chaves sem proprietário, políticas cumulativas, concorrência e compatibilidade das migrações.
- [x] Documentar o procedimento de validação manual e as limitações restantes.
- [x] Permitir chaves independentes de projeto para equipe e pessoa, com associação pessoal a uma única equipe.

## 4. Critérios de Conclusão

- [x] Custos e consumo de chamadas aparecem agregados à equipe do projeto e podem ser filtrados no dashboard sem duplicar o total organizacional.
- [x] Uma chave com proprietário válido atribui chamadas e custos à pessoa; uma chave sem proprietário permanece sem atribuição individual.
- [x] Uma pessoa não consegue atribuir chaves, projetos ou políticas a outra organização.
- [x] Uma chamada é bloqueada se exceder qualquer política ativa aplicável, incluindo limites simultâneos de equipe e pessoa; reservas continuam corretas sob concorrência.
- [x] Chaves já existentes continuam válidas após a migração e não recebem proprietário presumido.
- [x] O proprietário e as dimensões de equipe/usuário podem ser auditados sem persistir prompts ou segredos.
- [x] Testes automatizados e o guia manual desta tarefa passam em ambiente local.
- [x] Chaves de projeto/equipe/pessoa possuem alvos exclusivos; custos pessoais entram na equipe da pessoa sem duplicação entre equipes.

## Situação da implementação — 2 de novembro de 2026

Implementação concluída na migração 008. A migração foi aplicada ao `ai_spend` após validação em banco descartável; o banco tinha zero pessoas associadas a mais de uma equipe. Os testes completos passaram (68 testes em 19 arquivos), assim como typecheck e build. Chaves antigas com proprietário passam a ser pessoais; eventos/custos históricos permanecem preservados. A migração deve ser precedida pela resolução de eventuais pessoas em múltiplas equipes em outros ambientes.

## 5. Decisões e Limites

- Cada chave tem um único escopo e alvo. Chaves de projeto, equipe e pessoa não se vinculam entre si.
- Pessoas pertencem a no máximo uma equipe por organização. Isso permite incluir consumo pessoal nos custos/orçamentos da equipe sem dupla atribuição.
- Para limites individuais confiáveis, a chave é pessoal e não deve ser compartilhada.
- Políticas cumulativas restringem a chamada em conjunto: uma política individual não aumenta nem substitui automaticamente o limite da equipe. Ajustes de limite devem ser feitos na política do escopo correspondente.
- O custo permanece associado ao evento de uso original; as dimensões de equipe e pessoa são snapshots do vínculo no momento da chamada, não novos lançamentos financeiros.

# Tarefa 10.2 — Visualizar Prompts e Respostas do Gateway

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Épicos 03 (identidade e autorização), 05 (Gateway e ledger), 08 (dashboard) e 09 (segurança e observabilidade)
- **Módulos Afetados:** `apps/api`, `apps/gateway`, `apps/web`, `packages/contracts`, `packages/database`, `migrations/`, `tests/`

## 1. Contexto e Objetivo

O Gateway recebe mensagens de entrada, encaminha-as ao provedor e devolve uma resposta ao cliente. Atualmente, o ledger guarda metadados de uso, como modelo, provedor, tokens, duração e status, mas não persiste o conteúdo das mensagens nem a resposta. Os logs também não devem conter esses conteúdos.

Esta tarefa permite que usuários autorizados consultem no dashboard o prompt enviado e a resposta gerada, associados ao evento de uso, para fins de depuração e governança. Como esses dados podem conter informações pessoais, segredos ou conteúdo confidencial, a captura deve ser explícita, segura e desativada por padrão.

## 2. Regras de Privacidade e Segurança

1. **Opt-in explícito:** a organização deve habilitar a captura de conteúdo; o padrão é desativado. A interface/API deve informar que prompts e respostas serão armazenados.
2. **Consentimento no uso:** a aplicação cliente deve poder indicar que a chamada permite persistência de conteúdo. Se a política organizacional exigir essa indicação e ela não estiver presente, o Gateway processa a chamada sem armazenar conteúdo.
3. **Sem conteúdo nos logs:** prompts, respostas, credenciais e cabeçalhos de autorização nunca são enviados aos logs ou métricas.
4. **Acesso restrito:** somente papéis com permissão específica de auditoria/visualização de conteúdo podem ler prompts e respostas. Toda leitura é registrada em auditoria com ator, evento consultado e horário, sem copiar o conteúdo para a trilha de auditoria.
5. **Isolamento:** consultas sempre validam organização e permissões no backend. É proibido acessar conteúdo de outro tenant.
6. **Minimização e retenção:** a persistência pode ser configurada por organização e deve ter prazo próprio, curto e explícito. A limpeza remove o conteúdo, sem apagar o evento financeiro ou quebrar a proveniência do ledger.
7. **Proteção em repouso:** conteúdo armazenado deve ser cifrado em repouso; segredos conhecidos e credenciais nunca devem ser persistidos como conteúdo de prompt.
8. **Falhas seguras:** indisponibilidade da persistência de conteúdo não pode fabricar sucesso, afetar a integridade do ledger nem transformar conteúdo omitido em uma resposta vazia apresentada como completa. O Gateway deve retornar metadados e indicar claramente quando o conteúdo não foi capturado.
9. **Compatibilidade:** chamadas existentes continuam funcionando sem opt-in, e eventos históricos sem conteúdo permanecem consultáveis como “conteúdo não armazenado”.

## 3. Atividades Passo a Passo

- [x] Definir política de captura por organização, validade do consentimento por requisição e papéis autorizados para consulta.
- [x] Criar armazenamento cifrado e migração aditiva para conteúdo de entrada/saída, associado ao evento de uso e com expiração própria.
- [x] Atualizar o Gateway para capturar conteúdo somente quando todas as opções de privacidade permitirem; manter os logs livres de conteúdo.
- [x] Implementar API de consulta paginada por evento, com isolamento multi-tenant, autorização específica e auditoria de cada leitura.
- [x] Atualizar o dashboard para exibir o estado de captura e, se autorizado, mensagens de entrada e resposta com formatação segura e sem renderizar HTML arbitrário.
- [x] Implementar rotina de expurgo do conteúdo expirado que preserve ledger, custos e eventos de auditoria.
- [ ] Completar a cobertura automatizada de falha de persistência; os testes existentes verificam opt-in, cifra, permissões, isolamento entre organizações, auditoria, expiração e preservação do ledger/custos.
- [x] Documentar os riscos, controles, configuração e procedimento de validação manual.

## 4. Critérios de Conclusão

- [x] Com a captura desativada (padrão), prompt e resposta não são persistidos, exibidos em consultas ou escritos em logs.
- [x] Com a captura habilitada e consentimento válido na chamada, usuário autorizado consegue consultar mensagens de entrada e resposta associadas ao evento.
- [x] Usuário sem a permissão específica não consegue ler conteúdo, mesmo que possa consultar metadados do evento.
- [x] Toda leitura de conteúdo é auditada sem duplicar o conteúdo na auditoria ou nos logs.
- [x] A API bloqueia acesso cross-tenant; conteúdo expirado é removido pelo processo de retenção.
- [x] Remover conteúdo não remove `usage_events`, `cost_records` nem altera os totais financeiros.
- [x] Conteúdo é armazenado cifrado e a interface trata texto como conteúdo não confiável.
- [ ] Cobrir falha de armazenamento em teste automatizado e executar o roteiro manual no dashboard.

## Situação da implementação — 2 de novembro de 2026

Implementação funcional concluída e validada com PostgreSQL em banco descartável: captura desativada por padrão, `store: true` condicionado à política da organização, AES-256-GCM, redação de segredos conhecidos, leitura com `prompts:read`, auditoria, isolamento cross-tenant e expurgo sem apagar uso/custo. O estado de captura também é informado no chunk final SSE. Continua pendente um teste automatizado de falha de persistência e a execução manual do roteiro de interface.

## 5. Decisões e Limites

- A funcionalidade é uma ferramenta de governança/diagnóstico, não um requisito para inferência nem para registro financeiro.
- Opt-in deve ser separado por organização e por chamada; habilitar a política organizacional não substitui a indicação do cliente quando exigida.
- A desativação impede novas capturas; conteúdo já persistido continua sujeito ao prazo de retenção configurado e a uma ação explícita de expurgo.
- A visualização não deve ser oferecida em listagens gerais: o usuário abre o detalhe de um evento específico e a consulta de conteúdo é auditada.

# Tarefa 5.3 — Criar Gestão e Validação de Chaves Virtuais

- **Épico:** Épico 05 — Implementar o Gateway LLM
- **Fase:** 5 (Gateway LLM Local)
- **Dependências:** [Tarefa 2.4](../epico-02-dominio-e-banco-de-dados/tarefa-2.4-gateway-e-financas.md), [Tarefa 3.3](../epico-03-autenticacao-e-autorizacao/tarefa-3.3-implementar-autorizacao-rbac.md)
- **Módulos Afetados:** `packages/identity`, `packages/policies`, `apps/api`, `apps/gateway`
- **Guia de Teste Manual:** [teste-manual-5.1-a-5.5-gateway-llm.md](./testes-manuais/teste-manual-5.1-a-5.5-gateway-llm.md)

## 1. Objetivo
Implementar o ciclo de vida completo e a validação segura de **chaves virtuais (`virtual_keys`)**, permitindo que aplicações clientes consumam o Gateway LLM sem jamais terem acesso às credenciais reais dos provedores externos.

## 2. Requisitos de Segurança e Criptografia
- **Geração Segura:** Gerar chaves com fonte de aleatoriedade criptograficamente segura (`crypto.randomBytes`).
- **Formato com Prefixo:** Utilizar um prefixo legível (ex.: `aisp_live_<prefixo>_<segredo>`) para facilitar identificação visual e busca rápida.
- **Armazenamento Seguro:** Persistir no banco (`virtual_keys`) **somente o hash criptográfico (ex.: SHA-256)** e o prefixo de identificação (`key_prefix`). O segredo completo só é exibido uma única vez no momento da criação.
- **Proteção de Credenciais de Provedores:** A aplicação cliente nunca deve receber a credencial real de um provedor externo.

## 3. Funcionalidades do Ciclo de Vida
Implementar na API administrativa (`apps/api`) e no validador do gateway (`apps/gateway`):
1. **Criação** de chave virtual associada exclusivamente a um projeto, equipe ou pessoa dentro da organização. Projeto é opcional para chaves de equipe e pessoais.
2. **Revogação** imediata (`revoked_at`).
3. **Expiração** automática (`expires_at`).
4. **Escopo exclusivo** de projeto (`project_id`), equipe (`team_id`) ou pessoa (`owner_user_id`), sempre dentro da organização.
5. **Escopos autorizados** (ex.: modelos permitidos, provedores permitidos, operações permitidas).
6. **Limite de utilização** (rate limit / limite de orçamento vinculado à chave).

## 4. Atividades Passo a Passo
- [x] Implementar gerador, hasheador e verificador em tempo constante (`crypto.timingSafeEqual`) para chaves virtuais.
- [x] Criar endpoints em `apps/api` para criar, listar (mostrando apenas prefixo e metadados) e revogar chaves virtuais, gerando registros em `audit_events`.
- [x] Implementar middleware de autenticação de chave virtual em `apps/gateway` verificando hash, revogação, expiração, projeto ativo e escopos de modelo/provedor.
- [x] Escrever testes garantindo que chaves revogadas, expiradas ou fora de escopo sejam bloqueadas.

## 5. Critérios de Conclusão
- [x] Nenhuma chave virtual é persistida em texto puro no PostgreSQL.
- [x] É possível criar, listar, validar e revogar chaves virtuais.
- [x] O gateway bloqueia imediatamente chaves inválidas, expiradas, revogadas ou sem escopo para o modelo solicitado.

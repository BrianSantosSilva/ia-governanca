# Tarefa 3.3 — Implementar Autorização RBAC e Multi-tenant no Backend

- **Épico:** Épico 03 — Implementar a Autenticação e Autorização
- **Fase:** 3 (Identidade e Acesso)
- **Dependências:** [Tarefa 2.1](../epico-02-dominio-e-banco-de-dados/tarefa-2.1-organizacoes-e-identidade.md), [Tarefa 3.2](./tarefa-3.2-configurar-realm-oidc.md)
- **Módulos Afetados:** `packages/identity`, `packages/policies`, `apps/api`, `tests/security/`
- **Guia de Teste Manual:** [teste-manual-3.1-a-3.3-keycloak-oidc-e-rbac.md](./testes-manuais/teste-manual-3.1-a-3.3-keycloak-oidc-e-rbac.md)

## 1. Objetivo
Implementar no backend a resolução de identidade do usuário autenticado, suas associações com organizações (`memberships`), o controle de acesso baseado em papéis (RBAC) e o registro de auditoria para ações administrativas.

## 2. Papéis do Sistema (RBAC)
O sistema deve suportar e impor os seguintes papéis por organização:
- `owner`: Controle total sobre a organização, membros, configurações e exclusões.
- `admin`: Gestão de projetos, equipes, chaves virtuais, conectores e orçamentos.
- `finops`: Gestão de preços, visualização detalhada de custos, reconciliação, importação CSV e políticas de orçamento.
- `security`: Visualização de chaves virtuais, eventos de auditoria, políticas de acesso e identidades.
- `developer`: Visualização de projetos/equipes permitidos, consumo técnico e gerenciamento restrito de chaves de seus projetos.
- `viewer`: Acesso somente leitura aos dashboards e relatórios autorizados na organização.

> [!IMPORTANT]
> A autorização deve ocorrer **obrigatoriamente no backend**, mesmo quando o frontend oculta botões ou páginas.

## 3. Regras de Negócio e Segurança
- **Resolução de Contexto Multi-tenant:** Cada requisição autenticada à API deve resolver o usuário (`users`) e validar sua associação ativa (`memberships`) na organização alvo (`organization_id`).
- **Isolamento Estrito:** Usuários de uma organização jamais podem acessar ou modificar dados de outra organização onde não possuam associação ativa e papel compatível.
- **Trilha de Auditoria:** Ações administrativas (criação/alteração de projetos, membros, papéis, conectores, orçamentos, chaves virtuais) devem gerar registros em `audit_events`.

## 4. Atividades Passo a Passo
- [x] Implementar middleware/hook de autenticação e resolução de tenant no Fastify (`apps/api`) usando `packages/identity`.
- [x] Definir a matriz de permissões por papel (`owner`, `admin`, `finops`, `security`, `developer`, `viewer`) em `packages/policies` / `packages/identity`.
- [x] Implementar helper de gravação automática em `audit_events` para mutações administrativas.
- [x] Criar endpoints administrativos iniciais (organizações, projetos, equipes e membros) protegidos por RBAC.
- [x] Escrever testes automatizados em `tests/security/` validando cada papel e tentativas de acesso cross-tenant (`401 Unauthorized` / `403 Forbidden`).

## 5. Critérios de Conclusão (Fechamento do Épico 03)
- [x] Login OIDC funcionando ponta a ponta.
- [x] Sessão autenticada validada no backend.
- [x] Os 6 papéis (`owner`, `admin`, `finops`, `security`, `developer`, `viewer`) estão aplicados nos endpoints.
- [x] Testes comprovam que usuários de uma organização não acessam dados de outra.
- [x] Ações administrativas geram registros em `audit_events`.

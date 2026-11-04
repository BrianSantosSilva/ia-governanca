# Tarefa 3.2 — Configurar o Realm `ai-spend` e Cliente OIDC

- **Épico:** Épico 03 — Implementar a Autenticação e Autorização
- **Fase:** 3 (Identidade e Acesso)
- **Dependências:** [Tarefa 3.1 — Criar Ambiente Local com Keycloak](./tarefa-3.1-ambiente-local-keycloak.md)
- **Módulos Afetados:** Configuração do Keycloak (realm export/seed), `packages/identity`, `apps/web`, `apps/api`
- **Guia de Teste Manual:** [teste-manual-3.1-a-3.3-keycloak-oidc-e-rbac.md](./testes-manuais/teste-manual-3.1-a-3.3-keycloak-oidc-e-rbac.md)

## 1. Objetivo
Configurar o realm `ai-spend` no Keycloak e registrar o cliente OIDC para a aplicação, garantindo práticas modernas de segurança OAuth2/OIDC.

## 2. Requisitos de Configuração OIDC
1. **Realm:** Criar realm chamado `ai-spend` (exportável em JSON para reprodutibilidade do ambiente local).
2. **Cliente OIDC:** Registrar cliente para a aplicação web.
3. **Parâmetros de Segurança:**
   - **URL de redirecionamento (`Valid Redirect URIs`):** Restrita à URL da aplicação local (`http://localhost:3000/*`).
   - **URL de origem permitida (`Web Origins`):** `http://localhost:3000`.
   - **Fluxo de autorização:** Authorization Code Flow com PKCE (`S256`).
   - **Validação rigorosa:** Validar `issuer` (`iss`) e `audience` (`aud`) no backend.
   - **Claims de identidade:** Incluir `sub`, `email`, ` email_verified`, `preferred_username` / `name`.
   - **Sessão e expiração:** Configurar tempos adequados de expiração de access token e sessão.

> [!CAUTION]
> - **NÃO** utilizar fluxo implícito legado (*Implicit Flow*).
> - **NÃO** colocar *client secrets* em código frontend (`apps/web`).

## 3. Atividades Passo a Passo
- [x] Criar e configurar o realm `ai-spend` e o client OIDC com Authorization Code + PKCE.
- [x] Criar usuários de teste no realm para validar diferentes perfis de acesso.
- [x] Exportar a configuração do realm (sem segredos de produção) ou script de provisionamento para que a inicialização via `README.md` seja reproduzível.
- [x] Implementar a validação de tokens JWT/OIDC (JWKS, `iss`, `aud`, `exp`) em `packages/identity`.

## 4. Critérios de Conclusão
- [x] Realm `ai-spend` configurado e reproduzível.
- [x] Fluxo OIDC Authorization Code + PKCE funcional sem segredos no frontend.
- [x] Validador de token em `packages/identity` rejeita tokens expirados, com `issuer` inválido ou `audience` incorreta.

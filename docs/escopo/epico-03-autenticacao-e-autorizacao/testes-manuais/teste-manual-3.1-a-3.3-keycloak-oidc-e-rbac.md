# Guia de Teste Manual — Tarefas 3.1 a 3.3: Keycloak OIDC, Autorização RBAC e Isolamento Multi-tenant

- **Épico:** Épico 03 — Implementar a Autenticação e Autorização
- **Tarefas Relacionadas:**
  - [Tarefa 3.1 — Criar Ambiente Local com Keycloak](../tarefa-3.1-ambiente-local-keycloak.md)
  - [Tarefa 3.2 — Configurar o Realm `ai-spend` e Cliente OIDC](../tarefa-3.2-configurar-realm-oidc.md)
  - [Tarefa 3.3 — Implementar Autorização RBAC e Multi-tenant no Backend](../tarefa-3.3-implementar-autorizacao-rbac.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

---

## 1. Verificar se o Keycloak Local está Ativo e o Realm `ai-spend` foi Importado

Execute no PowerShell:
```powershell
docker compose ps keycloak
Invoke-RestMethod -Uri "http://localhost:8080/realms/ai-spend/.well-known/openid-configuration" | Select-Object issuer, token_endpoint, jwks_uri
```

### Resultado esperado:
- `issuer`: `http://localhost:8080/realms/ai-spend`
- `token_endpoint`: `http://localhost:8080/realms/ai-spend/protocol/openid-connect/token`
- `jwks_uri`: `http://localhost:8080/realms/ai-spend/protocol/openid-connect/certs`

*(Você também pode acessar o painel administrativo no navegador em `http://localhost:8080` com usuário `admin` e senha `admin_dev_password`).*

---

## 2. Obter um Token OIDC Real para um Usuário de Teste do Realm `ai-spend`

O realm `ai-spend` já vem provisionado com 3 usuários de laboratório:
- `owner@acme.local` (senha: `owner_dev_123`)
- `finops@acme.local` (senha: `finops_dev_123`)
- `viewer@acme.local` (senha: `viewer_dev_123`)

Para solicitar um JWT real ao Keycloak no PowerShell:

```powershell
$tokenResponse = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/realms/ai-spend/protocol/openid-connect/token" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body @{
    client_id  = "ia-governanca-web"
    grant_type = "password"
    username   = "owner@acme.local"
    password   = "owner_dev_123"
    scope      = "openid profile email"
  }

$tokenResponse.access_token.Substring(0, 50) + "..."
```

---

## 3. Executar a Suíte Automatizada de Segurança (OIDC + RBAC + Multi-tenant + Auditoria)

Execute no PowerShell:
```powershell
npm test -- tests/security/auth-rbac-tenant.test.ts
```

### O que este teste valida:
1. Permissões exatas para todos os 6 papéis (`owner`, `admin`, `finops`, `security`, `developer`, `viewer`).
2. Bloqueio `401 Unauthorized` para requisições sem token, com `issuer` incorreto ou com `audience` inválida.
3. Criação de organização, atribuição de membros, permissão de leitura (`viewer`), bloqueio de escrita (`403 Forbidden` para `viewer`), leitura de auditoria por `security` e **bloqueio estrito cross-tenant** (`403 forbidden_tenant` quando o `owner` da Organização B tenta acessar recursos da Organização A).

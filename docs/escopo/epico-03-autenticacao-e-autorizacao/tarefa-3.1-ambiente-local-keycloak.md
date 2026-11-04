# Tarefa 3.1 — Criar Ambiente Local com Keycloak

- **Épico:** Épico 03 — Implementar a Autenticação e Autorização
- **Fase:** 3 (Identidade e Acesso)
- **Dependências:** [Tarefa 1.4](../epico-01-preparacao-ambiente/tarefa-1.4-subir-banco-dados-postgresql.md)
- **Arquivos Afetados:** `docker-compose.yml`, `.env.example`
- **Guia de Teste Manual:** [teste-manual-3.1-a-3.3-keycloak-oidc-e-rbac.md](./testes-manuais/teste-manual-3.1-a-3.3-keycloak-oidc-e-rbac.md)

## 1. Objetivo
Adicionar e configurar o **Keycloak** no ambiente Docker local para testar o fluxo de autenticação corporativa OIDC (OpenID Connect) sem contratar um provedor de identidade pago.

## 2. Diretrizes de Configuração e Segurança
- Referência oficial: https://www.keycloak.org/getting-started/getting-started-docker
- Executar o serviço de desenvolvimento escutando **somente em `localhost`** (`127.0.0.1:8080:8080`).
- Configurar credenciais administrativas exclusivas para o laboratório local via variáveis de ambiente.

> [!WARNING]
> O ambiente Keycloak em modo de desenvolvimento (`start-dev`) não deve ser exposto publicamente nem tratado como configuração pronta para produção.

## 3. Atividades Passo a Passo
- [x] Adicionar o serviço `keycloak` ao `docker-compose.yml` restrito a `127.0.0.1:8080`.
- [x] Documentar as variáveis de ambiente do Keycloak no `.env.example` (`KEYCLOAK_BASE_URL`, `KEYCLOAK_REALM`, credenciais de admin local).
- [x] Iniciar o contêiner (`docker compose up -d keycloak`) e validar o acesso ao console administrativo em `http://localhost:8080` e ao endpoint OIDC discovery (`.well-known/openid-configuration`).

## 4. Critérios de Conclusão
- [x] Serviço do Keycloak sobe via Docker Compose apenas em `localhost`.
- [x] Console administrativo e endpoints OIDC respondem localmente em `http://localhost:8080`.

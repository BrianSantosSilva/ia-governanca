# Guia de Teste Manual — Tarefa 10.8: Login Local e Execução sem Keycloak

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa Relacionada:** [Tarefa 10.8 — Login com Usuário e Senha e Execução sem Keycloak](../tarefa-10.8-login-local-sem-keycloak.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)
- **Estado:** Roteiro previsto; será ajustado (comandos e nomes finais) após a implementação.

> [!WARNING]
> Use apenas contas e senhas de teste. A senha de desenvolvimento do `reset-db.ts` vale somente em ambiente local. Não rode testes automatizados no banco cujos dados deseja preservar; depois deles, execute `npx tsx scripts/reset-db.ts --yes`.

## 1. Pré-requisitos

- PostgreSQL em execução (`docker compose up -d postgres`). **O Keycloak não deve estar em execução.**
- `.env` com `AUTH_MODE=local` e `AUTH_LOCAL_JWT_SECRET` definido; variáveis `KEYCLOAK_*` ausentes ou ignoradas.
- Migrations aplicadas (`npm run migrate:up`) e banco populado (`npx tsx scripts/reset-db.ts --yes`).

## 2. Executar sem Keycloak

1. Confirme que não há container do Keycloak ativo (`docker ps`) e que `http://localhost:8080` não responde.
2. Inicie API, Gateway, worker e dashboard (`scripts\init-all.ps1` ou `npm run dev:*`).
3. **Esperado:** nenhum serviço falha por falta do Keycloak; os logs não mostram tentativas de conexão a ele; o `init-all.ps1` não exige nem aguarda o Keycloak.
4. Chame `GET http://localhost:3001/auth/config`. **Esperado:** apenas o modo `local` habilitado.

## 3. Login válido

1. Abra o dashboard. **Esperado:** tela de e-mail e senha, sem botão de SSO e sem redirecionamento ao Keycloak.
2. Entre como `owner@acme.local` com a senha de desenvolvimento informada pelo `reset-db.ts`.
3. **Esperado:** acesso à organização "Acme Gateway" com permissões de owner; entre também como `finops` e `viewer` e confirme as permissões de cada papel.
4. No navegador (ferramentas de desenvolvedor), confirme que o token está em `sessionStorage` e que não há requisições ao Keycloak.

## 4. Credenciais inválidas e bloqueio

1. Tente entrar com senha errada, com e-mail inexistente e com usuário sem senha local. **Esperado:** a mesma mensagem genérica e `401 invalid_credentials` nos três casos.
2. Erre a senha 5 vezes seguidas para o mesmo usuário. **Esperado:** bloqueio temporário (mesmo com a senha correta durante o período) e evento `auth.account.locked` na auditoria.
3. Aguarde o fim do bloqueio ou limpe `locked_until` por meio do reset do banco e confirme que o login volta a funcionar.

## 5. Sessão, renovação e logout

1. Com o login ativo, force a expiração do access token (aguarde 15 minutos ou use a configuração de teste de expiração curta). **Esperado:** renovação automática sem pedir senha.
2. Clique em Sair. **Esperado:** retorno à tela de login; o refresh token anterior passa a ser recusado (`401`).
3. Reutilize um refresh token já rotacionado. **Esperado:** recusa e revogação da sessão.

## 6. Senhas e permissões

1. Como `owner`, defina uma nova senha para `viewer`. **Esperado:** `viewer` é obrigado a trocar a senha no próximo login; as sessões antigas dele são revogadas.
2. Tente senha com menos de 12 caracteres ou comum. **Esperado:** recusa com mensagem clara.
3. Tente definir a senha de um usuário de outra organização. **Esperado:** `403`/`404`, sem revelar a existência do usuário.
4. Como `viewer`, tente definir a senha de outro usuário. **Esperado:** `403` por permissão insuficiente.

## 7. Primeiro administrador

1. Em um banco vazio (somente migrations), crie o primeiro usuário: `npm run auth:create-user -- --email admin@exemplo.local --role owner` (senha digitada no terminal).
2. **Esperado:** login local funciona sem edição manual do banco e sem Keycloak.

## 8. Coexistência com SSO (opcional)

1. Suba o Keycloak (`docker compose --profile sso up -d`) e defina `AUTH_MODE=both` com as variáveis `KEYCLOAK_*`.
2. **Esperado:** a tela mostra os dois caminhos; entrar por SSO e por senha com o mesmo e-mail resolve o mesmo usuário e a mesma organização.
3. Com `AUTH_MODE=oidc`, **esperado:** comportamento atual, sem tela de senha, e `POST /auth/login` recusado.

## 9. Verificações de segurança

- Os logs da API, as métricas e `audit_events` não contêm senha, hash, access token nem refresh token.
- A resposta do login traz `Cache-Control: no-store`.
- Um token local não é aceito como token OIDC (e vice-versa) quando os dois emissores estão ativos.

## 10. Resultado

| Item | Resultado | Observações |
|---|---|---|
| 2. Execução sem Keycloak | | |
| 3. Login válido | | |
| 4. Credenciais inválidas e bloqueio | | |
| 5. Sessão, renovação e logout | | |
| 6. Senhas e permissões | | |
| 7. Primeiro administrador | | |
| 8. Coexistência com SSO | | |
| 9. Segurança | | |

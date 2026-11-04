# Tarefa 10.8 — Login com Usuário e Senha e Execução sem Keycloak

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Planejada; documentação criada antes do início da implementação
- **Dependências:** Épico 03 (identidade e autorização), Épico 08 (dashboard) e Épico 09 (segurança e observabilidade); tarefa 10.1 (usuários, equipes e papéis)
- **Módulos afetados previstos:** `apps/api`, `apps/web`, `packages/identity`, `packages/contracts`, `packages/database`, `migrations/`, `scripts/`, `docker-compose.yml`, `.env.example`, `README.md`, `tests/`
- **Estado:** Somente documentação. Nenhuma implementação foi iniciada.

## 1. Contexto e Objetivo

Hoje o dashboard e a API administrativa só aceitam login via SSO (OIDC/Keycloak). O Keycloak precisa estar instalado e em execução (hoje, via Docker) para qualquer pessoa entrar, o que dificulta testes locais, demonstrações em outros computadores e ambientes sem Docker.

Esta tarefa entrega:

1. **Login por usuário e senha**, mantido pela própria plataforma, sem depender de SSO.
2. **Execução do projeto sem Keycloak**: API, dashboard e scripts de inicialização funcionam com apenas PostgreSQL (e o provedor de LLM escolhido). O SSO passa a ser opcional e pode coexistir com o login local.

O Gateway não é afetado: ele continua autenticando por chave virtual, não por login de usuário.

## 2. Modos de Autenticação

Variável `AUTH_MODE` (validada na inicialização; valor inválido impede a API de subir):

| Valor | Comportamento |
|---|---|
| `local` | Somente usuário e senha. Keycloak não é consultado nem exigido. |
| `oidc` | Somente SSO (comportamento atual). Exige as variáveis `KEYCLOAK_*`. |
| `both` | O dashboard oferece os dois caminhos; a API aceita tokens dos dois emissores. |

Regras:

1. O valor padrão é `local` quando as variáveis `KEYCLOAK_*` não estão definidas e `both` quando estão: o login local fica sempre disponível e o SSO é oferecido automaticamente a quem configurar o Keycloak. Quem quiser impor somente SSO define `AUTH_MODE=oidc` (o comportamento atual); ambientes existentes que já usam `KEYCLOAK_*` devem fixar `AUTH_MODE=oidc` se não quiserem o login local.
2. Em `local`, as variáveis `KEYCLOAK_*` e `VITE_KEYCLOAK_*` deixam de ser obrigatórias, e nenhuma chamada de rede ao Keycloak é feita (nem JWKS, nem redirecionamento).
3. Em `NODE_ENV=production`, o modo `local` exige habilitação explícita (`AUTH_LOCAL_ALLOW_IN_PRODUCTION=true`), com aviso nos logs de inicialização.
4. O dashboard descobre os modos disponíveis por um endpoint público e sem dados sensíveis (`GET /auth/config`) e exibe apenas as opções habilitadas.

## 3. Credenciais, Sessão e Tokens

1. **Armazenamento da senha:** somente hash com `scrypt` (módulo `node:crypto`, sem dependência nativa nova), com sal aleatório por usuário e parâmetros de custo versionados no próprio hash, para permitir migração futura. A senha nunca é armazenada, registrada em log, auditada ou devolvida pela API.
2. **Política de senha:** mínimo de 12 caracteres, máximo de 128, sem exigir composição arbitrária. Senhas triviais comuns (lista curta embutida) são recusadas.
3. **Tokens da plataforma:** após login válido, a API emite um *access token* JWT curto (15 minutos), assinado por um segredo/chave própria (`AUTH_LOCAL_JWT_SECRET`, mínimo de 32 bytes, obrigatório em `local`/`both`), com emissor `ia-governanca-local` e audiência própria, distintos dos do Keycloak. Um token local nunca é aceito como token OIDC e vice-versa.
4. **Renovação:** *refresh token* opaco, aleatório, armazenado apenas como hash em tabela de sessões, com rotação a cada uso, expiração absoluta (8 horas) e detecção de reuso (token já rotacionado revoga a sessão).
5. **Logout e revogação:** o logout revoga a sessão no servidor. Desativar o usuário, trocar a senha ou redefini-la revoga todas as sessões dele.
6. **Dashboard:** o token fica em `sessionStorage`, como no fluxo OIDC atual. O refresh token não é exposto a `localStorage`.
7. **Verificação na API:** `authenticateRequest` identifica o emissor pelo cabeçalho/claims do token e valida com o mecanismo correspondente. O restante (usuário ativo, `memberships`, papéis e permissões) permanece igual.

## 4. Modelo de Dados

Nova migration `012_local_authentication.sql`:

- `users`: novas colunas `password_hash TEXT`, `password_changed_at TIMESTAMPTZ`, `must_change_password BOOLEAN NOT NULL DEFAULT FALSE`, `failed_login_attempts INTEGER NOT NULL DEFAULT 0`, `locked_until TIMESTAMPTZ`.
- Nova tabela `auth_sessions`: `id`, `user_id`, `refresh_token_hash` (único), `created_at`, `expires_at`, `revoked_at`, `rotated_from_id`, `user_agent` (truncado) e `ip` (opcional, conforme política de privacidade).
- Usuários existentes via SSO continuam sem senha (`password_hash` nulo) e só entram por SSO, a menos que um administrador defina uma senha.
- A migration tem *down* reversível e não apaga dados de usuários.

## 5. Proteções contra Abuso

1. **Mensagem genérica:** credenciais inválidas, usuário inexistente, sem senha local ou inativo retornam a mesma resposta (`401 invalid_credentials`) e levam tempo semelhante (hash de comparação fictício para usuário inexistente).
2. **Limite de tentativas:** rate limit por IP e por e-mail no endpoint de login; após 5 falhas consecutivas, bloqueio temporário da conta por 15 minutos (`locked_until`), com contador zerado em login bem-sucedido.
3. **Comparação em tempo constante** do hash.
4. **Auditoria:** eventos `auth.login.succeeded`, `auth.login.failed`, `auth.account.locked`, `auth.logout`, `auth.password.changed` e `auth.password.reset` em `audit_events`, sem senha, token ou hash. Logs e métricas seguem o padrão existente (sem dados sensíveis) e ganham contadores por resultado.
5. **Cabeçalhos e CORS:** o endpoint de login responde com `Cache-Control: no-store`, mantém a política de CORS atual e não aceita credenciais em query string.

## 6. Endpoints e Gestão de Usuários

- `GET /auth/config` — público; informa `modes` (`local`, `oidc`) e dados mínimos do SSO quando habilitado.
- `POST /auth/login` — `{ email, password }` → `{ accessToken, refreshToken, expiresIn, mustChangePassword }`.
- `POST /auth/refresh` — rotaciona o refresh token.
- `POST /auth/logout` — revoga a sessão atual.
- `POST /auth/change-password` — usuário autenticado informa a senha atual e a nova; revoga as demais sessões.
- `POST /v1/organizations/:orgId/users/:userId/password` — owner/admin define ou redefine a senha de um membro da própria organização; a senha definida marca `must_change_password`. Respeita o isolamento entre organizações; o alvo não pode pertencer a outras organizações (evita tomada de conta entre organizações), e somente o owner define a senha de owner/admin; não se aplica à própria conta (use `/auth/change-password`).
- Primeiro administrador: variáveis opcionais `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` (usadas só se não houver nenhum usuário com senha) **ou** o comando `npm run auth:create-user -- --email ... --role owner` (senha digitada no terminal, sem eco). Sem usuário inicial, a API sobe normalmente e informa no log como criá-lo.

## 7. Dashboard

1. Tela de login com e-mail e senha quando `local`/`both` estiver habilitado; botão "Entrar com SSO" apenas em `oidc`/`both`.
2. O cliente OIDC (`oidc-client-ts`) só é inicializado quando o SSO está habilitado; em `local`, a página carrega sem requisições ao Keycloak.
3. Renovação silenciosa do token via `/auth/refresh` e retorno à tela de login quando a sessão expira ou é revogada.
4. Tela de troca de senha (obrigatória quando `mustChangePassword`), e ação "Definir senha" na gestão de usuários para owner/admin.
5. Mensagens de erro genéricas; o campo de senha usa `autocomplete` adequado e nunca exibe a senha.

## 8. Execução sem Keycloak

1. `docker-compose.yml`: o serviço `keycloak` passa para um *profile* opcional (`sso`). `docker compose up -d postgres` sobe apenas o banco; `docker compose --profile sso up -d` inclui o Keycloak.
2. `scripts/init-all.ps1`: só inicia/aguarda o Keycloak quando `AUTH_MODE` for `oidc` ou `both`; em `local`, não exige Docker para o Keycloak. O script informa como criar o primeiro usuário.
3. `.env.example` e a validação de ambiente (`loadEnvConfig`): `KEYCLOAK_*` e `VITE_KEYCLOAK_*` tornam-se opcionais conforme o modo; `AUTH_MODE`, `AUTH_LOCAL_JWT_SECRET` e as variáveis de bootstrap são documentadas.
4. `scripts/reset-db.ts`: os usuários de teste (`owner@acme.local`, `finops@acme.local`, `viewer@acme.local`) passam a receber uma senha **fixa de desenvolvimento**, para o login local funcionar logo após o reset. A senha é exibida na saída do script, vale apenas para ambiente local e o script continua recusando rodar em produção.
5. `README.md`: guia de início rápido sem Keycloak, e seção separada para habilitar o SSO.
6. Os testes automatizados não podem exigir o Keycloak em execução (a verificação OIDC já usa chaves injetadas nos testes).

## 9. Atividades Previstas

- [x] Aprovar as decisões desta tarefa (seção 11).
- [x] Criar a migration `012_local_authentication.sql` (colunas em `users`, tabela `auth_sessions`) e atualizar o teste de integridade.
- [x] Implementar em `packages/identity` o hash/verificação de senha (`scrypt`), a emissão/validação do JWT local e a rotação de refresh tokens.
- [x] Implementar em `apps/api` os endpoints de autenticação local, `GET /auth/config`, a validação de dois emissores em `authenticateRequest` e a definição de senha por owner/admin.
- [x] Implementar limite de tentativas, bloqueio temporário, mensagens genéricas e auditoria.
- [x] Criar o comando de criação do primeiro usuário e o bootstrap por variáveis de ambiente.
- [x] Adaptar o dashboard: tela de login, inicialização condicional do OIDC, renovação de sessão e troca de senha.
- [x] Tornar o Keycloak opcional em `docker-compose.yml` (profile), `init-all.ps1`, `.env.example` e na validação de ambiente.
- [x] Atualizar `scripts/reset-db.ts` com a senha de desenvolvimento.
- [x] Atualizar README, diagramas técnicos afetados (se houver) e o roadmap.
- [x] Adicionar testes automatizados: hash e política de senha, login válido/inválido com resposta idêntica, bloqueio após falhas, rotação e reuso de refresh token, revogação ao trocar senha/desativar usuário, isolamento entre organizações, rejeição de token local como OIDC e vice-versa, `AUTH_MODE` (`local`, `oidc`, `both`), ausência de segredos em logs e API sem Keycloak disponível.
- [ ] Executar o [guia de teste manual da tarefa 10.8](./testes-manuais/teste-manual-10.8-login-local-sem-keycloak.md).

## 10. Critérios de Aceitação

- [ ] Com o Keycloak parado ou não instalado e `AUTH_MODE=local`, API, Gateway, worker e dashboard iniciam e um usuário entra com e-mail e senha.
- [ ] Nenhuma requisição ao Keycloak é feita no modo `local`.
- [ ] Com `AUTH_MODE=oidc`, o fluxo SSO atual continua funcionando sem alteração; em `both` (padrão quando o Keycloak está configurado), SSO e senha funcionam lado a lado e resolvem o mesmo usuário pelo e-mail. Quem usa SSO nunca é impedido de entrar por não ter senha local.
- [ ] Senhas são armazenadas apenas como hash `scrypt` com sal; nenhuma senha, hash ou token aparece em logs, auditoria, métricas ou respostas.
- [ ] Credenciais inválidas retornam resposta idêntica para usuário inexistente, sem senha local, inativo ou senha errada; há limite de tentativas e bloqueio temporário.
- [ ] Refresh tokens são rotacionados, o reuso revoga a sessão, e logout, troca/redefinição de senha e desativação do usuário revogam as sessões.
- [ ] Owner/admin define a senha de membros da própria organização, e não de outras organizações; os papéis e permissões existentes permanecem inalterados.
- [ ] O primeiro administrador pode ser criado sem Keycloak e sem editar o banco manualmente.
- [ ] `scripts/reset-db.ts` deixa os três usuários de teste prontos para login local.
- [ ] A migration é reversível, e as suítes existentes continuam passando.
- [ ] A documentação explica os três modos, as variáveis de ambiente e as limitações.

## 11. Decisões Propostas (a confirmar antes da implementação)

| Tema | Proposta | Alternativa |
|---|---|---|
| Algoritmo de senha | `scrypt` nativo do Node | `argon2` (nova dependência nativa; pior portabilidade no Windows) |
| Sessão | Access token de 15 min + refresh opaco rotativo | Token único de 8 h (mais simples, revogação menos precisa) |
| Padrão de `AUTH_MODE` | `local` sem `KEYCLOAK_*`, `both` com elas (SSO sempre permitido quando configurado) | Sempre `local` ou sempre `oidc` |
| Primeiro usuário | Comando `auth:create-user` e bootstrap por variável | Somente o script de seed |
| Recuperação de senha por e-mail | **Fora do escopo** (não há serviço de e-mail); redefinição feita por owner/admin | Fluxo de e-mail em tarefa futura |
| MFA | **Fora do escopo**; permanece possível via SSO | Tarefa futura |

## 12. Riscos e Limitações

- Login local não oferece MFA nem política corporativa centralizada; para ambientes corporativos, o SSO continua recomendado.
- O segredo `AUTH_LOCAL_JWT_SECRET` precisa ser gerado por ambiente; trocá-lo invalida os access tokens em circulação.
- A senha de desenvolvimento fixa do `reset-db.ts` é pública no repositório; não deve existir fora de ambiente local.
- Sem recuperação por e-mail, o bloqueio do único owner exige redefinição pelo comando de linha de comando.

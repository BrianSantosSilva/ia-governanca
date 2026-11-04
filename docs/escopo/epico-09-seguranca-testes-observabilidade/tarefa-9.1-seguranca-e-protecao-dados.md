# Tarefa 9.1 — Implementar e Validar Controles de Segurança

- **Épico:** Épico 09 — Segurança, Testes e Observabilidade
- **Fase:** 9 (Hardening, Segurança, Observabilidade e Testes Finais)
- **Dependências:** Épicos 02 a 08 concluídos
- **Módulos Afetados:** `apps/api`, `apps/gateway`, `apps/worker`, `packages/identity`, `packages/policies`, `tests/security/`

## 1. Objetivo
Consolidar, revisar e testar todos os controles de segurança, privacidade, proteção de segredos e isolamento multi-tenant da plataforma.

## 2. Controles de Segurança Obrigatórios
Implementar e testar:
1. **Autenticação de usuários** (validação estrita de JWT/OIDC via Keycloak).
2. **Autorização por papel (RBAC)** em todos os endpoints administrativos.
3. **Isolamento multi-tenant** em todas as rotas e queries SQL.
4. **Hash das chaves virtuais** (nunca persistir nem logar a chave completa).
5. **Proteção de segredos** de conectores externos (criptografia em repouso / mascaramento em respostas de API).
6. **Validação de entradas** (schemas Zod estritos para body, query e params).
7. **Limites de requisições (Rate Limiting)** nos endpoints do Gateway e da API administrativa.
8. **Auditoria** (`audit_events` para todas as operações sensíveis).
9. **Minimização de dados** (coletar e persistir apenas os metadados estritamente necessários para governança financeira).
10. **Política de retenção** configurável para eventos e logs.

> [!CAUTION]
> **Regra de Redação de Logs:** **NUNCA** registrar tokens de acesso (JWT), chaves virtuais, credenciais de provedores ou conteúdo sensível de prompts/respostas nos logs da aplicação.

## 3. Atividades Passo a Passo
- [x] Configurar filtro de redação automática (`redact`) no logger do Fastify para mascarar headers `authorization`, `api_key`, `secret`, `password` e conteúdo de `messages`.
- [x] Configurar rate limiting em `apps/api` e `apps/gateway`.
- [x] Implementar rotina/configuração de política de retenção e minimização de dados.
- [x] Executar e expandir a suíte `tests/security/` cobrindo os controles de autenticação, RBAC, tenant, chaves/segredos, validação, rate limit, auditoria e minimização.

## 4. Critérios de Conclusão
- [x] Todos os 10 controles de segurança estão implementados e cobertos por testes em `tests/security/`.
- [x] Logs inspecionados não contêm tokens, credenciais ou conteúdo de prompts.

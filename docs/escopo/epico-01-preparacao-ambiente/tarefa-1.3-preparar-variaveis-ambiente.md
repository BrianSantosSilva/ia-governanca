# Tarefa 1.3 — Preparar Variáveis de Ambiente

- **Épico:** Épico 01 — Preparar o Ambiente
- **Fase:** 1 (Ambiente Local e Estrutura)
- **Dependências:** [Tarefa 1.1 — Criar o Repositório e Estrutura de Monorepo](./tarefa-1.1-criar-repositorio-monorepo.md)
- **Arquivos Afetados:** `.env.example`, `.gitignore`, módulo de configuração
- **Guia de Teste Manual:** [teste-manual-1.3-e-1.4-env-e-postgresql.md](./testes-manuais/teste-manual-1.3-e-1.4-env-e-postgresql.md)

## 1. Objetivo
Padronizar e documentar todas as variáveis de ambiente necessárias para o funcionamento local dos serviços, mantendo segredos e configurações fora do código-fonte.

## 2. Conteúdo do `.env.example`

```dotenv
NODE_ENV=development

DATABASE_URL=postgres://app:app_dev_password@localhost:5432/ai_spend

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

LLM_DEFAULT_PROVIDER=ollama
LLM_EXTERNAL_PROVIDERS_ENABLED=false

APP_BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:3001

KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM=ai-spend
```

> [!WARNING]
> Os valores acima são exclusivos para desenvolvimento local. Nunca utilize essas credenciais em um ambiente público.

## 3. Atividades Passo a Passo
- [x] Criar o arquivo `.env.example` na raiz do repositório com as variáveis especificadas.
- [x] Garantir que o arquivo `.env` real esteja listado no `.gitignore`.
- [x] Criar a cópia `.env` local para desenvolvimento.
- [x] Implementar um validador de variáveis de ambiente (usando Zod) para carregar e validar as configurações na inicialização dos serviços.

## 4. Critérios de Conclusão
- [x] Arquivo `.env.example` criado e documentado no `README.md`.
- [x] Arquivo `.env` ignorado pelo Git.
- [x] As variáveis de ambiente estão isoladas do código e validadas na inicialização.

# Tarefa 1.4 — Subir e Validar o Banco de Dados PostgreSQL

- **Épico:** Épico 01 — Preparar o Ambiente
- **Fase:** 1 (Ambiente Local e Estrutura)
- **Dependências:** [Tarefa 1.2](./tarefa-1.2-configurar-dependencias.md), [Tarefa 1.3](./tarefa-1.3-preparar-variaveis-ambiente.md)
- **Arquivos Afetados:** `docker-compose.yml`, `packages/database`
- **Guia de Teste Manual:** [teste-manual-1.3-e-1.4-env-e-postgresql.md](./testes-manuais/teste-manual-1.3-e-1.4-env-e-postgresql.md)

## 1. Objetivo
Configurar o serviço do PostgreSQL 17 no `docker-compose.yml` com healthcheck e persistência em volume, e validar a conectividade a partir da camada `packages/database`.

## 2. Especificação do `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: ai_spend
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app_dev_password
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d ai_spend"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres_data:
```

## 3. Comandos de Inicialização e Validação

Iniciar o banco:
```bash
docker compose up -d postgres
docker compose ps
```

Validar saúde do serviço:
```bash
docker compose exec postgres pg_isready -U app -d ai_spend
```

## 4. Atividades Passo a Passo
- [x] Criar o `docker-compose.yml` com o serviço `postgres:17` escutando apenas em `127.0.0.1:5432`.
- [x] Subir o contêiner e verificar se o status fica `healthy`.
- [x] Implementar o pool de conexão PostgreSQL em `packages/database` utilizando a variável `DATABASE_URL`.
- [x] Criar e executar o primeiro teste de conexão com o PostgreSQL (`SELECT 1`).

## 5. Critérios de Conclusão (Fechamento do Épico 01)
- [x] O repositório foi criado.
- [x] O TypeScript compila sem erros.
- [x] O PostgreSQL está em execução e saudável (`healthy`).
- [x] A aplicação consegue abrir uma conexão real com o banco e executar uma query de verificação.
- [x] As variáveis de ambiente estão separadas do código.

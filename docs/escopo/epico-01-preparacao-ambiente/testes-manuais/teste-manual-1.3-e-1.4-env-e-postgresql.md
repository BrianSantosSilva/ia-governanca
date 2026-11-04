# Guia de Teste Manual — Tarefas 1.3 e 1.4: Variáveis de Ambiente e Banco PostgreSQL

- **Épico:** Épico 01 — Preparar o Ambiente
- **Tarefas Relacionadas:**
  - [Tarefa 1.3 — Preparar Variáveis de Ambiente](../tarefa-1.3-preparar-variaveis-ambiente.md)
  - [Tarefa 1.4 — Subir e Validar o Banco de Dados PostgreSQL](../tarefa-1.4-subir-banco-dados-postgresql.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

---

## 1. Validar se o `.env` está protegido pelo `.gitignore`

Execute no PowerShell:
```powershell
git check-ignore -v .env
```

- **Resultado esperado:** Deve exibir `.gitignore:... .env`, comprovando que o arquivo `.env` real não será versionado no Git.

---

## 2. Validar a Saúde do Contêiner PostgreSQL 17

Verifique se o contêiner está rodando e com status `healthy`:
```powershell
docker compose ps
docker compose exec postgres pg_isready -U app -d ai_spend
```

- **Resultado esperado:**
  ```text
  /var/run/postgresql:5432 - accepting connections
  ```

---

## 3. Executar uma Query Manual no PostgreSQL via Terminal

Para abrir uma conexão SQL direta no contêiner e consultar a versão do banco e o banco atual:
```powershell
docker compose exec postgres psql -U app -d ai_spend -c "SELECT current_database() AS db, current_user AS usuario, version();"
```

---

## 4. Executar o Teste Automatizado de Ambiente e Conexão (`Vitest`)

Para validar o `EnvSchema` (Zod) e o pool de conexão (`packages/database`) abrindo uma conexão real com o PostgreSQL:
```powershell
npm test
```

- **Resultado esperado:** O arquivo `tests/integration/environment-db.test.ts` deve passar (`2 passed`).

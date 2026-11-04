# Guia de Teste Manual — Tarefas 1.1 e 1.2: Monorepo, Workspaces e Compilação TypeScript

- **Épico:** Épico 01 — Preparar o Ambiente
- **Tarefas Relacionadas:**
  - [Tarefa 1.1 — Criar o Repositório e Estrutura de Monorepo](../tarefa-1.1-criar-repositorio-monorepo.md)
  - [Tarefa 1.2 — Configurar as Dependências Base](../tarefa-1.2-configurar-dependencias.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

---

## 1. Validar o Reconhecimento dos Workspaces pelo npm

Para verificar se todos os 10 módulos (`4 apps` + `6 packages`) são reconhecidos pelo `npm workspaces`:

```powershell
npm query .workspace | ConvertFrom-Json | Select-Object name, location
```

### Resultado esperado:
Deve listar os 10 pacotes internos:
- `@ia-governanca/api` (`apps/api`)
- `@ia-governanca/gateway` (`apps/gateway`)
- `@ia-governanca/web` (`apps/web`)
- `@ia-governanca/worker` (`apps/worker`)
- `@ia-governanca/connectors` (`packages/connectors`)
- `@ia-governanca/contracts` (`packages/contracts`)
- `@ia-governanca/database` (`packages/database`)
- `@ia-governanca/finance` (`packages/finance`)
- `@ia-governanca/identity` (`packages/identity`)
- `@ia-governanca/policies` (`packages/policies`)

---

## 2. Validar a Compilação TypeScript (`typecheck` e `build`)

Execute na raiz do projeto:

```powershell
npm run typecheck
npm run build
```

- **Resultado esperado:** Ambos os comandos devem finalizar com código de saída `0` (sem erros de compilação) e gerar a pasta `dist/` dentro dos pacotes e aplicações.

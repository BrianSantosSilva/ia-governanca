# Guia de Teste Manual — Tarefa 0.2: LLM Local (Ollama e Modelo `llama3.2`)

- **Épico:** Épico 00 — Pré-requisitos e Validação da LLM Local
- **Tarefa Relacionada:** [Tarefa 0.2 — Instalação e Validação da LLM Local (Ollama)](../tarefa-0.2-validacao-llm-local-ollama.md)
- **Ambiente:** Windows (PowerShell)

---

## Objetivo deste Guia
Permitir que você teste manualmente a instalação do **Ollama**, a presença do modelo **`llama3.2`**, a conversa interativa via terminal e a chamada HTTP na API local (`http://localhost:11434/api/chat`) verificando os metadados de consumo de tokens.

> [!TIP]
> Se você instalou o Ollama recentemente e ainda não reiniciou o terminal, o comando `ollama` pode ser chamado diretamente ou pelo caminho padrão do Windows: `"$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"`.

---

## 1. Verificar a Versão do Ollama e Modelos Baixados

No PowerShell, execute:
```powershell
ollama --version
ollama list
```
*(Caso o terminal atual ainda não tenha recarregado o `PATH`, use `& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" list`).*

- **Resultado esperado:**
  - Versão do Ollama exibida (ex.: `0.40.5`).
  - Na listagem de modelos, deve constar `llama3.2:latest` (aprox. `2.0 GB`).
- **Se aparecer `Warning: could not connect to a running Ollama instance`:**
  Inicie o servidor do Ollama executando em outro terminal (ou abrindo o app **Ollama** no Menu Iniciar):
  ```powershell
  & "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" serve
  ```

---

## 2. Teste Interativo pelo Terminal (Chat no Console)

Para conversar diretamente com a LLM local no terminal:

```powershell
ollama run llama3.2
```

1. Digite qualquer pergunta, por exemplo:
   ```text
   Olá! Responda em uma frase curta quem é você.
   ```
2. Observe a resposta gerada localmente.
3. Para sair do modo interativo, digite:
   ```text
   /bye
   ```

---

## 3. Teste da API HTTP Local e Métricas de Consumo (PowerShell)

O Gateway do projeto depende dos metadados de uso retornados pela API HTTP do Ollama (`prompt_eval_count`, `eval_count` e `total_duration`).

Para testar a chamada HTTP diretamente no PowerShell, copie e cole o bloco abaixo:

```powershell
$body = @{
  model    = "llama3.2"
  messages = @(
    @{
      role    = "user"
      content = "Responda apenas: ambiente local funcionando"
    }
  )
  stream   = $false
} | ConvertTo-Json -Depth 4

$resposta = Invoke-RestMethod -Uri "http://localhost:11434/api/chat" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))

$resposta | ConvertTo-Json -Depth 5
```

### O que conferir no JSON retornado:
```json
{
  "model": "llama3.2",
  "created_at": "2026-10-18T...",
  "message": {
    "role": "assistant",
    "content": "Ambiente local funcionando."
  },
  "done": true,
  "done_reason": "stop",
  "total_duration": 1523456700,
  "load_duration": 23456700,
  "prompt_eval_count": 34,
  "prompt_eval_duration": 450000000,
  "eval_count": 6,
  "eval_duration": 890000000
}
```

### Checklist de Validação Manual do Retorno:
- [ ] `done` é `true`?
- [ ] `message.content` contém a resposta gerada pelo modelo?
- [ ] `prompt_eval_count` (tokens de entrada) é um número maior que `0`?
- [ ] `eval_count` (tokens de saída) é um número maior que `0`?
- [ ] `total_duration` (duração em nanossegundos) está presente?

---

## 4. Alternativa usando `curl.exe` no Windows

Caso prefira testar com `curl.exe` (usando `curl.exe` em vez do alias `curl` do PowerShell):

```powershell
curl.exe -s http://localhost:11434/api/chat -H "Content-Type: application/json" -d "{\"model\":\"llama3.2\",\"messages\":[{\"role\":\"user\",\"content\":\"Responda apenas: ok\"}],\"stream\":false}"
```

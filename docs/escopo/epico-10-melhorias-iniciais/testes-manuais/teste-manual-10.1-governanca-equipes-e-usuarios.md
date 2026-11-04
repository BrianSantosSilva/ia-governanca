# Guia de Teste Manual — Tarefa 10.1: Governança por Equipe e Usuário

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa Relacionada:** [Tarefa 10.1 — Implementar Governança de Custos e Orçamentos por Equipe e Usuário](../tarefa-10.1-governanca-equipes-e-usuarios.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!WARNING]
> Execute em uma organização, projeto, equipe e chaves descartáveis. Não rode testes de integração contra um banco que contenha dados importantes: algumas suítes revertem e recriam as migrações. Nunca compartilhe chaves virtuais ou tokens OIDC.

## 1. Pré-requisitos

- Ambiente iniciado conforme o `README.md`; API, Gateway, worker, Web, PostgreSQL, Keycloak e Ollama estão saudáveis.
- Usuário de teste com permissão para gerenciar projetos, equipes, chaves, custos e orçamentos.
- Organização com uma equipe e um projeto vinculado a essa equipe.
- Modelo local `llama3.2` disponível.

Abra `http://localhost:3000`, entre com o usuário autorizado e selecione a organização de teste. Na página **Projetos e equipes**, confirme que o projeto está associado à equipe esperada.

## 2. Criar chaves nos três escopos

1. Acesse **Chaves virtuais**.
2. Crie uma chave com escopo **Projeto**, selecione um projeto da equipe e informe `ollama` e `llama3.2`.
3. Crie uma chave com escopo **Equipe**, selecione a equipe e não selecione projeto.
4. Crie uma chave com escopo **Pessoa** para um usuário sem equipe e não selecione projeto.
5. Para outro usuário, associe-o a uma única equipe, crie chave pessoal e confirme que ele também pode usar uma chave da equipe.
6. Copie os segredos exibidos somente na criação e confirme que a listagem mostra o escopo exclusivo, sem revelar segredos.

Confirme que pessoa sem equipe tem seus custos individuais sem serem atribuídos a equipe. Custos de chave pessoal de membro devem aparecer na pessoa e na equipe.

## 3. Criar orçamentos para equipe e usuário

1. Acesse **Orçamentos** e crie uma política de escopo **Equipe**, selecionando a equipe de teste, modo `block`, moeda `USD` e limite baixo.
2. Crie outra política de escopo **Usuário**, selecionando o proprietário da chave, também em modo `block`, com um limite de teste.
3. Defina períodos que incluam o horário atual e confirme que ambas aparecem na listagem com escopo e limites corretos.
4. Se a interface permitir, crie também uma política organizacional ou de projeto para confirmar que os escopos são cumulativos.

Uma chamada deve ser limitada por cada política aplicável. A política de usuário não aumenta nem substitui o limite da equipe.

## 4. Fazer chamadas e verificar bloqueios

No PowerShell, atribua à variável a chave pessoal copiada e envie uma chamada:

```powershell
$virtualKey = "COLE_A_CHAVE_PESSOAL_AQUI"
$requestId = "epic10-team-user-" + [guid]::NewGuid().ToString("N")

$response = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3002/v1/chat/completions" `
  -Headers @{
    Authorization = "Bearer $virtualKey"
    "X-Request-Id" = $requestId
  } `
  -ContentType "application/json" `
  -Body (@{
    model = "llama3.2"
    messages = @(@{ role = "user"; content = "Responda apenas: teste de atribuição" })
    max_tokens = 20
    stream = $false
  } | ConvertTo-Json -Depth 5)

$response.usage
```

Repita chamadas com identificadores novos até atingir o limite. Quando qualquer política aplicável for excedida, espera-se bloqueio HTTP `429`, registro de uso bloqueado e nenhuma chamada adicional ao Ollama. Evite imprimir ou registrar o valor de `$virtualKey`.

Tente adicionar a mesma pessoa a uma segunda equipe e confirme o bloqueio. Chaves de projeto não são pessoais; chaves pessoais/de equipe não exigem projeto.

## 5. Conferir os dados no dashboard e no ledger

1. Acesse **Consumo de APIs** e filtre pela equipe e pelo usuário de teste. Compare os eventos de sucesso e bloqueados com os `requestId` usados.
2. Acesse **Custos** e confira que custos associados aos eventos aparecem na equipe e, quando houver proprietário, no usuário correto.
3. Compare o total da organização com os subtotais; os valores agregados por equipe/usuário não podem criar lançamentos financeiros duplicados.
4. Acesse **Auditoria** e confira os eventos de criação/alteração de chave e política, sem exposição do segredo ou do prompt.
5. Verifique que chaves e projetos de outra organização não podem ser selecionados ou consultados.

### Critérios de conclusão do roteiro

- [ ] Chaves de projeto, equipe e pessoa usam alvos exclusivos e segredo completo é exibido somente na criação.
- [ ] Pessoas podem estar sem equipe, mas não podem pertencer a duas equipes da mesma organização.
- [ ] Custos das chaves de equipe e das pessoas associadas aparecem na equipe sem lançamentos duplicados no total organizacional.
- [ ] Políticas de equipe e usuário são aplicadas, e todas as políticas ativas aplicáveis são respeitadas.
- [ ] Consumo e custos podem ser filtrados por equipe e usuário sem duplicação dos totais financeiros.
- [ ] Eventos e auditoria não expõem prompts, tokens ou segredos.

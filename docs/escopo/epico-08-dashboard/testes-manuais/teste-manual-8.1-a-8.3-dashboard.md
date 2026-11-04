# Guia de Teste Manual — Tarefas 8.1 a 8.3: Dashboard, Indicadores e Filtros

- **Épico:** Épico 08 — Construir o Dashboard
- **Tarefas Relacionadas:**
  - [Tarefa 8.1 — Implementar as Páginas do Dashboard](../tarefa-8.1-implementar-paginas-dashboard.md)
  - [Tarefa 8.2 — Implementar os Indicadores da Visão Geral](../tarefa-8.2-implementar-indicadores-visao-geral.md)
  - [Tarefa 8.3 — Criar Filtros Globais e Garantir Autorização](../tarefa-8.3-criar-filtros-e-autorizacao.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!WARNING]
> Use uma organização e dados de teste. Os testes de integração automatizados revertem e recriam todas as migrações; rode-os apenas contra um banco descartável. A validação manual do dashboard não precisa de credenciais de APIs externas.

---

## 1. Inicializar a aplicação

Na raiz do projeto, instale as dependências, inicie PostgreSQL/Keycloak e aplique as migrações:

```powershell
npm install
docker compose up -d
npm run migrate:up
```

Inicie API, Gateway e aplicação Web em terminais PowerShell separados:

```powershell
npm run dev:api
```

```powershell
npm run dev:gateway
```

```powershell
npm run dev:web
```

Abra `http://localhost:3000`. Entre pelo SSO usando um usuário de desenvolvimento provisionado no Keycloak. Se o usuário ainda não tiver uma organização, crie uma pela tela inicial. O perfil e a organização ativa aparecem na navegação.

---

## 2. Validar as nove páginas

Use a navegação lateral e confirme que cada página carrega sem erro:

1. **Visão geral:** cards de custos, consumo por provedor/modelo, projeto/equipe, orçamento, licenças ociosas, saúde das fontes e reconciliação.
2. **Consumo de APIs:** histórico com tokens de entrada/saída, latência, modelo, provedor e estado.
3. **Custos:** categorias financeiras separadas, moeda e indicador simulado; consulte também as reconciliações.
4. **Licenças e assentos:** contratos, atribuídos/contratados, sem atividade, atividade desconhecida e identidades pendentes.
5. **Projetos e equipes:** consulte listas e, com permissão, crie um projeto/equipe, convide um membro e associe-o à equipe.
6. **Chaves virtuais:** crie uma chave para um projeto autorizado. Copie o segredo mostrado uma única vez; consulte a lista e confirme que só o prefixo aparece. Revogue a chave de teste.
7. **Orçamentos:** crie uma política de teste em `observe`, `alert` ou `block`, com período e moeda; altere o modo e confirme a atualização.
8. **Conectores e sincronizações:** execute primeiro a validação de um CSV usando `fixtures/csv/api-costs-valid.csv` ou `fixtures/csv/licenses-valid.csv` e a opção **dry run**. Confira o histórico antes de importar de verdade. Para APIs, cadastre uma credencial autorizada somente se for necessário validar uma sincronização real.
9. **Auditoria:** filtre eventos pela ação e pelo usuário; confirme o horário e os detalhes da operação realizada nas etapas anteriores.

### Resultado esperado

- As páginas e ações visíveis correspondem às permissões do perfil atual. A API continua validando cada ação, independentemente do que a interface mostra.
- O segredo da chave virtual aparece somente na resposta de criação.
- Quando não há dados de uma fonte, a tela informa que os dados estão indisponíveis ou aguardando sincronização em vez de afirmar consumo financeiro zero.
- Valores financeiros exibem sua moeda original. Dados simulados, estimados, reportados e contratados permanecem identificados separadamente.

---

## 3. Validar filtros globais e isolamento multi-tenant

Na barra superior, selecione um intervalo, projeto, equipe, provedor, modelo, categoria de custo e origem. Confirme que a URL mantém os filtros ao navegar entre as páginas de consumo, custos, visão geral, orçamento, licenças, conectores e auditoria. Limpe os filtros e confira que a URL e as consultas retornam ao escopo da organização ativa.

Verifique combinações sem resultados. Tabelas devem mostrar estado vazio, sem transformar valores ausentes em zero. Selecione um período com eventos e compare consumo/custos com o ledger e as fontes cadastradas.

Para validar a proteção tenant, consulte o endpoint com uma organização diferente da rota. Use um UUID de teste no parâmetro `organizationId`:

```powershell
$orgId = "<ORG_ID_AUTORIZADA>"
$otherOrgId = "<OUTRA_ORGANIZACAO>"
$oidcToken = "<OIDC_TOKEN>"
Invoke-WebRequest `
  -Uri "http://localhost:3001/v1/organizations/$orgId/dashboard/overview?organizationId=$otherOrgId" `
  -Headers @{ Authorization = "******" }
```

O resultado esperado é HTTP `403` (`forbidden_tenant`). Também teste um intervalo invertido; a API deve responder HTTP `400` sem consultar dados.

---

## 4. Validar o controle por papel

Use contas de teste com papéis diferentes, por exemplo `viewer`, `finops` e `developer`, e repita o login em uma sessão separada:

- `viewer` deve consultar custos, orçamentos, conectores e projetos, mas não deve receber controles de escrita.
- `finops` pode gerenciar custos, orçamentos e conectores, mas não deve receber ações de administração de membros ou chaves.
- `developer` pode consultar/criar e revogar chaves virtuais, conforme as permissões já definidas, mas não deve ver páginas fora do seu escopo.
- `owner` ou `admin` pode validar gestão de projetos/equipes, membros e auditoria.

Mesmo que uma ação seja chamada manualmente fora da interface, a API deve retornar `403` se o papel não tiver a permissão necessária.

---

## 5. Testes automatizados relacionados (opcional)

Os testes de integração revertem as migrações; **execute somente contra um banco descartável**:

```powershell
npm test -- tests/unit/dashboard-filters.test.ts tests/integration/external-integrations.test.ts tests/integration/gateway-ollama.test.ts
```

### Critérios de conclusão do roteiro

- [ ] As nove páginas carregam dados da organização ativa e ações de escrita respeitam o perfil.
- [ ] Período, projeto, equipe, provedor, modelo, categoria e origem filtram os dados aplicáveis e permanecem na URL.
- [ ] Consulta com organização diferente da sessão/rota é rejeitada pela API.
- [ ] Moeda, proveniência e estado de simulação são explícitos; dados ausentes não são substituídos por zero.
- [ ] Custos, tokens, licenças, orçamento, sincronizações e auditoria podem ser comparados com seus registros de origem.

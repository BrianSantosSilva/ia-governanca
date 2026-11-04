# Guia de Teste Manual — Tarefa 10.3: Clareza de Formulários e Campos

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa Relacionada:** [Tarefa 10.3 — Melhorar a Clareza de Formulários e Campos do Dashboard](../tarefa-10.3-clareza-formularios-e-campos.md)
- **Ambiente:** Navegador em `http://localhost:3000`

## 1. Preparação

- Inicie o ambiente seguindo o `README.md` e entre no dashboard com usuário de teste autorizado.
- Use uma organização e dados de laboratório. Não informe chaves ou credenciais reais em formulários de teste.

## 2. Revisar formulários

Percorra as páginas **Projetos e equipes**, **Chaves virtuais**, **Orçamentos**, **Conectores** e **Custos**. Para cada campo:

1. Confirme que há um rótulo visível mesmo depois de preencher o campo.
2. Clique no rótulo; o foco deve ir para o campo correto.
3. Verifique que placeholder é apenas um exemplo, e não a única indicação do campo.
4. Confira se a ajuda explica unidade, formato, opcionalidade ou efeito quando isso não for óbvio.
5. Navegue pelos controles usando `Tab` e `Shift+Tab`; a ordem deve acompanhar a ordem visual.

## 3. Validar o formulário de orçamento

Na página **Orçamentos**, inicie a criação de uma política e confira:

- **Limite:** indica explicitamente que representa o máximo de gastos no período e está expresso na moeda escolhida.
- **Limiar de alerta (%):** explica que é a porcentagem do limite que gera alerta, não outro valor monetário.
- **Início/Fim:** explica a janela temporal coberta pela política.
- **Modo:** descreve se a chamada apenas é observada, gera alerta ou é bloqueada.
- **Escopo:** deixa claro se a política vale para organização, projeto, chave, equipe ou pessoa, com os campos condicionais correspondentes.

Envie o formulário sem preencher um campo obrigatório e informe um valor fora do formato esperado. Confirme que o erro identifica o campo e dá orientação; valores já preenchidos devem continuar no formulário.

## 4. Validar acessibilidade e responsividade

1. Repita os passos principais somente com teclado.
2. Confira que o foco está visível e não salta inesperadamente.
3. Reduza a largura da janela; rótulos, ajuda e erros devem continuar legíveis, sem sobreposição ou corte.

### Critérios de conclusão do roteiro

- [ ] Os campos têm rótulos visíveis e associados.
- [ ] Unidades, moeda, opcionalidade e consequências são compreensíveis antes do envio.
- [ ] Limite e limiar de alerta são claramente diferenciados.
- [ ] Erros identificam o campo e preservam os outros valores preenchidos.
- [ ] Fluxos principais permanecem utilizáveis por teclado e em janela estreita.

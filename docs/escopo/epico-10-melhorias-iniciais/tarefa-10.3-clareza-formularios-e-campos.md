# Tarefa 10.3 — Melhorar a Clareza de Formulários e Campos do Dashboard

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Épico 08 (Dashboard)
- **Módulos Afetados:** `apps/web`, `tests/`

## 1. Contexto e Objetivo

Vários formulários do dashboard dependem de placeholders ou da ordem visual dos campos, sem rótulos persistentes e explicações suficientes. Isso dificulta entender o que preencher e pode levar a configurar políticas incorretas. Na tela de orçamentos, por exemplo, o campo do limite e o campo de percentual de alerta não deixam claro o que cada valor controla.

Esta tarefa torna os formulários autoexplicativos, acessíveis e consistentes, preservando a lógica e os contratos atuais da API.

## 2. Escopo

1. Revisar todos os formulários e filtros editáveis do dashboard, incluindo projetos/equipes, membros, chaves virtuais, orçamentos, conectores, importação CSV, preços e ajustes financeiros.
2. Adicionar rótulo visível e associado programaticamente a cada campo. Placeholder pode dar exemplo, mas não deve ser o único nome/instrução do campo.
3. Adicionar texto auxiliar curto quando o campo exigir contexto, formato, unidade ou consequência.
4. No formulário de orçamento:
   - **Limite:** explicar que é o valor máximo de gastos no período e apresentar a moeda selecionada.
   - **Limiar de alerta (%):** explicar que dispara alerta ao atingir o percentual do limite, não define um segundo orçamento.
   - **Período:** indicar início e fim da janela de contabilização.
   - **Modo:** diferenciar observação, alerta e bloqueio, incluindo se chamadas serão permitidas ou recusadas.
   - **Escopo:** explicar a entidade à qual a política se aplica; mostrar somente seletores relevantes ao escopo.
5. Erros de validação devem apontar o campo e a correção necessária; valores preenchidos não devem desaparecer em caso de erro.
6. Usar termos consistentes em português e indicar unidades, moedas, limites opcionais e exibição única de segredos.

## 3. Atividades Passo a Passo

- [x] Inventariar campos de entrada e filtros interativos nas páginas afetadas pela melhoria.
- [x] Definir texto de rótulos e ajuda conciso, sem duplicar nem conflitar com validações do backend.
- [x] Atualizar componentes para rótulos associados e mensagens de ajuda contextual.
- [x] Atualizar o formulário de orçamento para explicar limite, limiar percentual, período, modo e escopo.
- [ ] Revisar responsividade, foco e navegação por teclado manualmente.
- [ ] Adicionar testes automatizados para rótulos, associação label/campo, ajuda contextual e erros dos principais formulários.
- [x] Atualizar o guia de testes manuais do dashboard.

## 4. Critérios de Conclusão

- [x] Os formulários revisados têm rótulos visíveis e associados aos controles; nenhum depende somente de placeholder.
- [x] O formulário de orçamento deixa inequívoco o significado de limite, percentual do alerta, período, modo e escopo.
- [x] Unidades, moedas, obrigatoriedade e opcionalidade estão indicadas nos fluxos revisados.
- [ ] Validar manualmente mensagens de erro, navegação por teclado, foco e layout em telas menores.
- [x] Os fluxos existentes e contratos de API permanecem compatíveis.

## Situação da implementação — 2 de novembro de 2026

Rótulos e ajudas foram atualizados nos fluxos do dashboard, com destaque para limite, limiar percentual, moeda, período, modo e escopo de orçamento. Typecheck e build passaram. Revisão manual de acessibilidade/responsividade e testes automatizados específicos de interface ainda não foram executados; use o roteiro abaixo antes de encerrar esses critérios.

## 5. Decisões e Limites

- Textos de ajuda explicam o comportamento do sistema; não substituem validação no backend.
- O trabalho não altera permissões ou regras financeiras; mudanças de regra devem ser tratadas nas tarefas de domínio correspondentes.

# Base de Conhecimento do candidato

## Projeção Experience V2

A interface organiza Perfil, Competências, Experiência, Formação, Projetos, Preferências, Respostas ATS e Pendências. Chaves internas não são títulos de cartões; nome completo substitui cartões redundantes de primeiro e último nome; fatos sensíveis continuam protegidos. Reuse policy e confirmação são preservadas no contrato.

A área **Conhecimento** mostra informações humanas por seção: identidade e contato, disponibilidade, experiências, formação, competências, certificações, idiomas, projetos, preferências e respostas de candidatura.

Arrays agregados, objetos JSON, chaves `PROFILE.*` e IDs de implementação não aparecem na camada principal. Skills usam chips pesquisáveis; experiências, formação e projetos preservam estrutura; ausência de dados usa empty states, sem `[]` ou `{}`.

## Estados visíveis

- **Confirmado** descreve verificação pelo candidato.
- **Confiança de extração** descreve somente a normalização automática. Um item pode estar confirmado e ainda mostrar 72% de confiança de extração.
- **Origem** informa Perfil, currículo importado, ResumeSpec, resposta de candidatura, migração ou sistema somente quando registrada.
- **Reutilização** informa se o Career Unified pode reutilizar, deve confirmar, limita o uso à candidatura ou nunca deve reutilizar automaticamente.
- **Último uso** muda somente quando um consumidor usa de fato a unidade; abrir a página não conta.

Informações sensíveis aparecem como **Informação protegida** na visão geral e seguem `SENSITIVE_CONFIRM_EACH_TIME`. Rejeitar preserva histórico e evita que uma sincronização reative o item. Arquivar remove a unidade da visão ativa sem apagar a auditoria.

O botão **Adicionar informação** abre um formulário por tipo; não existe editor JSON. Veja [Candidate Knowledge V2 — modelo e autoridade](./candidate-knowledge-model.md) para contratos, migração e consumidores.

No Discovery V4, Candidate Knowledge continua autoritativo para evidências do candidato. ResumeVersion é projeção/snapshot: um fato ausente do currículo não vira automaticamente `NO_MATCH`; o matcher consulta fatos ativos e mantém `UNKNOWN` quando nenhuma evidência existe.

Na V4.1, esse contrato tem teste explícito com Grafana confirmado no Candidate Knowledge e ausente no currículo. O fato sustenta `MATCH` ou `PARTIAL_MATCH`, sem fabricar experiência profissional.

## Candidate Knowledge V3

A área Conhecimento agora é o Inventário Profissional. Fatos V2 permanecem válidos, enquanto `knowledge_evidence` acrescenta contexto, depth, uso, datas, entidade vinculada, proveniência e claims. Experiências/projetos/formações estruturados V2 são backfilled como entidades; skills legadas entram em contexto `LEGACY`, depth `UNKNOWN`, sem inflação.

Veja [Candidate Knowledge V3](./candidate-knowledge-v3.md), [Career Evidence Graph](./career-evidence-graph.md) e [Depth Model](./evidence-depth-model.md).

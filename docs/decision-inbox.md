# Decision Inbox

## Experience V2

Hoje apresenta uma fila compacta com razão e próxima ação, além de painéis laterais de contexto. Itens abrem diretamente oportunidade, currículo, candidatura ou Autopilot. HMAC, n8n, IDs e estados internos só aparecem quando necessários para diagnóstico.

`GET /api/today` compõe, em tempo de leitura, itens das fontes autoritativas existentes: oportunidades prioritárias, currículos em revisão, perguntas obrigatórias, candidaturas bloqueadas ou prontas para revisão, follow-ups, alertas com falha e fontes indisponíveis.

Cada item tem chave estável, categoria, `inboxPriority` interno, justificativa e CTA. Esse número ordena atenção e nunca é exibido como prioridade da vaga. Dispensar da caixa grava somente a chave em `decision_inbox_dismissals`; não equivale a `NOT_FOR_ME` e não altera vaga, candidatura ou integração. A dispensa vale para a triagem do dia corrente: no próximo dia a pendência reaparece se o estado autoritativo continuar exigindo ação. Uma mudança de estado também pode produzir outra chave e tornar uma nova decisão visível.

Ordem: pergunta obrigatória, `READY_TO_SUBMIT`, `WAITING_USER`, currículo relevante em revisão, falha crítica do Autopilot, oportunidade e follow-up antigo. A caixa nunca executa candidatura por conta própria.

## Triagem diária

O read model inclui `daily`, com data local, estado geral, ação principal e contagens de ações urgentes e de alto impacto. A interface mostra a primeira ação em destaque e toda a sequência restante, sem criar metas ou estados paralelos. Perguntas obrigatórias da mesma candidatura são consolidadas em um único próximo passo que abre a primeira pergunta pendente.

Hoje pode ser atualizado explicitamente e confere mudanças periodicamente enquanto a tela está visível ou quando o usuário retorna à aba. A atualização apenas recompõe as fontes autoritativas; ela não inicia busca, análise, preparação ou candidatura.

No máximo cinco oportunidades aparecem. Elas precisam ser recentes ou explicitamente interessantes e superar filtros de Opportunity Priority, match técnico, confiança e o `considerThreshold` de uma política aplicável. Vagas com candidatura, fechadas ou marcadas `NOT_FOR_ME` ficam fora. O card mostra somente dados da oportunidade: Technical Match, Opportunity Priority, confiança, atualidade e correspondências/lacunas reais quando disponíveis.

## Experience V2.1

A caixa também produz deep link para a pergunta obrigatória exata, follow-up vencido somente após submissão, entrevista próxima e problemas de provider/WhatsApp relevantes. Contato, resposta, adiamento, conclusão, entrevista e outcome são eventos append-only e não inventam transições técnicas da candidatura.

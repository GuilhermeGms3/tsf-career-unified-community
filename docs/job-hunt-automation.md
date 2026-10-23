# Job Hunt automatizado

Um perfil define consultas, localizações, política remoto/presencial, providers, watchlists, match mínimo, elegibilidades aceitas, horário e política de notificação. Perfis novos ficam desativados por padrão.

Cada execução:

1. chama o `DiscoveryService` existente;
2. canonicaliza e deduplica vagas;
3. executa o matcher ATS determinístico contra a base padrão aprovada (as demais fontes continuam alimentando o acervo factual);
4. elimina vaga fechada, candidatura já existente, blocker, score baixo e elegibilidade não permitida;
5. deduplica alerta por profile/vaga/conteúdo/status/canal;
6. opcionalmente prepara, valida e renderiza uma versão específica, sem substituir a base;
7. aplica a política global à nota ATS final: AutoApply com qualidade aprovada, revisão no WhatsApp ou análise na plataforma;
8. limita alertas WhatsApp instantâneos e agrupa o restante em digest. O orçamento de alertas não limita o AutoApply autorizado por nota.

Execução manual funciona mesmo com o perfil desativado. A agendada roda a cada minuto apenas para perfis vencidos, usando o mesmo `JobHuntService` do Mass Hunt. A próxima janela parte da conclusão, evitando repetição imediata de uma rodada longa. Targets explícitos são persistidos; sem eles, os boards habilitados das watchlists ativas alimentam a busca. O orçamento intercala providers para que muitos boards de uma fonte não monopolizem a rodada.

Alertas com PDF `READY` adiados por quiet hours voltam à entrega depois da janela. Falhas de entrega desses pedidos recebem até cinco tentativas persistidas, com intervalo de cinco minutos e limite de três itens por tick. `deliveryAttempts` e `nextDeliveryAt` expõem esse estado; nova busca não reabre pedidos encerrados nem antecipa o intervalo. Alertas sem PDF pronto e digests legados não são enviados por esse worker; continuam observáveis na fila de eventos. Pausar a busca impede novas rodadas, mas não cancela decisões nem entregas já pendentes.

Uma execução ativa pode ser pausada por `POST /api/job-hunt/runs/:id/pause`. A pausa preserva o relatório parcial, encerra a rodada como `SKIPPED` com `USER_PAUSED` e impede as etapas seguintes. Se o perfil automático continuar habilitado, a próxima janela é recalculada; falhas e recuperações após interrupção também avançam a janela em vez de repetir imediatamente a mesma execução vencida.

O timer automático usa exclusivamente os perfis do Job Hunt. Agendas do contrato
legado `search_schedules` continuam disponíveis para execução manual e
compatibilidade de dados, mas não são disparadas silenciosamente no boot nem no
intervalo do servidor.

Falhas de preparação preservam a vaga e o diagnóstico; uma notificação simples não equivale à entrega de um PDF pronto. O fluxo automático só avança pelos gates de evidência, qualidade, disponibilidade, sessão, formulário e consentimento. O clique final depende de adapter compatível e `CAREER_SUBMISSION_ENABLED`; sucesso exige recibo externo.

## Autoridade dos limites

Com a política global habilitada, seus limites de encaminhamento têm precedência sobre os limiares mais restritivos de considerar/preparar/notificar do perfil. O piso efetivo é o menor entre o limite salvo e a menor faixa global, sem sobrescrever a configuração original. A tela Automação expõe `effectiveThresholds` por perfil; o relatório completo registra a mesma fotografia usada na rodada. Com a política desligada, valem os limites salvos no perfil.

Os limiares de descoberta usam match preliminar; o encaminhamento usa a nota ATS da versão final. Opportunity Priority ordena a fila e não é a nota de autorização de AutoApply. Desmarcar preparação de currículo, canais ou classes de decisão continua sendo respeitado.

A migration aditiva `054_job_hunt_targets.sql` persiste targets e tentativas de entrega, com índice da fila. Rollback de código pode manter essas colunas; para rollback de dados, restaure o backup consistente anterior. Não remova colunas ou histórico em produção.

## Mass Discovery V4

O Search Composer acrescenta execução ad hoc com famílias, termos livres, senioridade, três prioridades de localização, modelo de trabalho, escopo remoto, classes de fonte, thresholds e orçamento. `Preview` não consulta fontes; `Test Search` reduz o orçamento; `Mass Hunt` amplia o orçamento dentro dos limites. O relatório separa fontes solicitadas, operacionais, consultadas, com erro, dependentes de configuração e não suportadas, além das métricas `raw`, `structured`, `web`, `community`, `leads`, `signals`, `duplicates`, `canonical`, `relevant` e `priority`.

Fontes estruturadas continuam usando o pipeline canônico existente. Web pública gera somente leads revisáveis. Comunidades consultam apenas o backlog minimizado gerado por eventos novos de grupos explicitamente autorizados. A origem não autoriza candidatura: somente a política de encaminhamento e os gates descritos acima permitem avanço.
# Atualização R2 — filtro barato auditável

O Job Hunt avalia cada oportunidade canônica com PreMatchPlausibility antes do Matcher V2. `REJECT` não chama o matcher naquela execução, mas a vaga continua persistida e a razão fica no `job_hunt_run`. `PASS`, `PASS_WITH_WARNINGS` e `REVIEW` seguem para análise; candidatura e currículo continuam dependendo dos gates já existentes.

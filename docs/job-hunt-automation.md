# Job Hunt automatizado

Um perfil define consultas, localizações, política remoto/presencial, providers, watchlists, match mínimo, elegibilidades aceitas, horário e política de notificação. Perfis novos ficam desativados por padrão.

Cada execução:

1. chama o `DiscoveryService` existente;
2. canonicaliza e deduplica vagas;
3. executa o matcher ATS determinístico contra currículos existentes;
4. elimina vaga fechada, candidatura já existente, blocker, score baixo e elegibilidade não permitida;
5. deduplica alerta por profile/vaga/conteúdo/status/canal;
6. limita alertas instantâneos e agrupa o restante em digest;
7. opcionalmente cria versão de currículo com `source=AUTOMATION` e estado `REVIEW_REQUIRED`;
8. emite evento para o outbox, sem qualquer `submit`.

Execução manual funciona mesmo com o perfil desativado. A agendada roda a cada minuto apenas para perfis vencidos e calcula a próxima janela local. Quiet hours não descartam o alerta: registram `QUIET_HOURS` para observabilidade, sem envio imediato nesta versão.

Uma execução ativa pode ser pausada por `POST /api/job-hunt/runs/:id/pause`. A pausa preserva o relatório parcial, encerra a rodada como `SKIPPED` com `USER_PAUSED` e impede as etapas seguintes. Se o perfil automático continuar habilitado, a próxima janela é recalculada; falhas e recuperações após interrupção também avançam a janela em vez de repetir imediatamente a mesma execução vencida.

O timer automático usa exclusivamente os perfis do Job Hunt. Agendas do contrato
legado `search_schedules` continuam disponíveis para execução manual e
compatibilidade de dados, mas não são disparadas silenciosamente no boot nem no
intervalo do servidor.

Falhas de preparação do currículo não bloqueiam o alerta. Versões automatizadas não são renderizadas ou aprovadas sem ação explícita do usuário.

## Mass Discovery V4

O Search Composer acrescenta execução ad hoc com famílias, termos livres, senioridade, três prioridades de localização, modelo de trabalho, escopo remoto, classes de fonte, thresholds e orçamento. `Preview` não consulta fontes; `Test Search` reduz o orçamento; `Mass Hunt` amplia o orçamento dentro dos limites. O relatório separa fontes solicitadas, operacionais, consultadas, com erro, dependentes de configuração e não suportadas, além das métricas `raw`, `structured`, `web`, `community`, `leads`, `signals`, `duplicates`, `canonical`, `relevant` e `priority`.

Fontes estruturadas continuam usando o pipeline canônico existente. Web pública gera somente leads revisáveis. Comunidades consultam apenas o backlog minimizado gerado por eventos novos de grupos explicitamente autorizados. Nenhuma modalidade envia candidatura ou mensagem automaticamente.
# Atualização R2 — filtro barato auditável

O Job Hunt avalia cada oportunidade canônica com PreMatchPlausibility antes do Matcher V2. `REJECT` não chama o matcher naquela execução, mas a vaga continua persistida e a razão fica no `job_hunt_run`. `PASS`, `PASS_WITH_WARNINGS` e `REVIEW` seguem para análise; candidatura e currículo continuam dependendo dos gates já existentes.

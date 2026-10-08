# Discovery V4.1 — verdade funcional

A V4.1 corrige a integração da V4 sem criar uma geração paralela. O Test Search continua leve; o Mass Hunt chama `JobHuntService.runManual()`, que cria ou atualiza um perfil manual pausado e reutiliza `run()` para discovery, canonicalização, deduplicação, filtros, Candidate Knowledge, Matcher V2, prioridade, limiares e persistência.

Só há `CONSULTED` quando o provider foi chamado. Ausência de chave, alvo ou adapter vira `CONFIG_REQUIRED`, `NO_TARGETS` ou `UNSUPPORTED`. Os limiares `consider`, `prepareResume`, `notify` e `priority` são independentes e nunca aprovam candidatura ou envio.

## Homologação real — 17 evidências

1. Test Search chama apenas o provider esperado.
2. Mass Hunt registra `job_hunt_run` e discovery runs.
3. Score abaixo de `consider` fica filtrado.
4. Score acima de `priority` entra em prioridade.
5. Ausência de skill vira `UNKNOWN`.
6. Grafana confirmado no Candidate Knowledge aparece como evidência.
7. Análise sem currículo persiste `resume_id = NULL`.
8. Documento sem currículo fica `NOT_EVALUATED`.
9. Mudança de parseabilidade não altera Technical Match.
10. Mensagem comunitária relevante cria um único lead.
11. Pergunta irrelevante não cria lead.
12. Replay do `messageId` é idempotente.
13. Lead comunitário e Ashby oficial reconciliam em uma oportunidade.
14. Chave Brave está no container `app` e não no frontend.
15. Webhook Evolution está habilitado, com evento e header corretos.
16. n8n diferencia container, configuração local e atividade não comprovada.
17. ZIP de auditoria passa sem dados, CVs ou segredos.

Evidência local não substitui quota Brave real, pareamento WhatsApp, workflow n8n ativo ou modelo Ollama instalado.

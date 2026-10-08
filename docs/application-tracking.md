# Application Tracking

O tracking usa `/applications` como pipeline e `/applications/:id` como workspace auditável.

## Vínculos obrigatórios

- `application.jobId` identifica a oportunidade.
- `application.resumeId` identifica a base.
- `application.resumeVersionId` identifica o documento exato usado.
- `application_events` registra transições e eventos de domínio.
- `application_attempts` registra tentativas reais, adaptador, modo, erros e evidência.
- `resume_upload_audits` registra o artefato efetivamente anexado.

## Estados humanos

Estados técnicos são traduzidos, mas não escondidos do histórico. `WAITING_USER`, `BLOCKED`, `FAILED` e `RETRYABLE` geram ação de resolução; `READY_TO_SUBMIT` significa revisão final manual, nunca envio já realizado.

Outcomes, entrevistas, contatos, respostas, conclusão e adiamentos são registrados como eventos append-only. Follow-up só existe depois de envio registrado, vence sete dias após a última interação significativa, respeita adiamento e termina em `REJECTED`, `WITHDRAWN` ou `ACCEPTED`. A Experience V2.1 não envia email e não integra Gmail/Calendar de forma completa.

# Workflows n8n para documentos

## Autoridade

O Hub e a unica fonte de verdade para ResumeSpec, versoes, evidencia, aprovacao, render, artefatos e candidatura. n8n somente recebe eventos minimizados ou solicita acao pela API autenticada; nunca acessa o SQLite.

Eventos: `RESUME_TAILORING_STARTED`, `RESUME_TAILORING_REVIEW_REQUIRED`, `RESUME_VERSION_APPROVED`, `RESUME_RENDER_STARTED`, `RESUME_RENDER_READY`, `RESUME_RENDER_FAILED`, `RESUME_EXPORTED` e `COVER_LETTER_READY`.

Payloads contem apenas IDs, template, status e scores ATS/parseabilidade. O EventBus remove email, telefone, endereco, texto, ResumeSpec, respostas, evidencias, segredos e tokens. A outbox SQLite faz retry; falha/offline do n8n nao altera uma versao `READY`.

## Receber eventos no n8n

O dispatcher envia `x-career-event-id`, `x-career-timestamp` e `x-career-signature: sha256=<HMAC>`. A assinatura cobre `<timestamp>.<corpo-json-exato>` usando a variavel definida em `secretEnvName`.

## Solicitar acao ao Hub

Use `POST /api/automation/resume-documents/jobs`. Defina `CAREER_N8N_ACTION_SECRET` somente no ambiente do Hub e no credential store do n8n. Assine o corpo exato com HMAC-SHA-256 e envie event ID unico e timestamp ISO-8601. O Hub rejeita assinatura ausente/invalida, timestamp fora de cinco minutos e replay persistido.

Jobs permitidos: `BUILD_SPEC`, `RENDER`, `EXPORT`. Eles reutilizam EvidenceGuard, review gate e politicas da UI. O endpoint nao aprova versoes, nao altera fatos e nao envia candidatura.

```json
{"jobType":"RENDER","resumeVersionId":"resume-version-..."}
```

- Evento n8n offline: fica `RETRYABLE`; a versao permanece inalterada.
- Acao duplicada: retorna `AUTOMATION_REPLAY_REJECTED`.
- Render repetido da mesma versao `READY`: reutiliza o PDF valido.
- n8n desativado: nenhuma entrega e nenhum impacto no Hub.

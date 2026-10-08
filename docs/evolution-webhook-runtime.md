# Evolution webhook runtime

A Evolution API 2.3.7 possui `POST /webhook/set/{instance}` e `GET /webhook/find/{instance}`. O schema da versão aceita `enabled`, `url`, `headers`, `byEvents`, `base64` e `events`. O Career Unified configura, somente por ação explícita, `MESSAGES_UPSERT` para o endpoint interno e envia o segredo em `x-career-webhook-secret`.

O diagnóstico retorna apenas estado, evento habilitado, correspondência de destino e presença do header; nunca devolve o valor do header.

## Retenção

`DATABASE_SAVE_DATA_NEW_MESSAGE=true` e `DATABASE_SAVE_MESSAGE_UPDATE=true` são opções oficiais da Evolution e permanecem habilitadas para a persistência operacional dela no Postgres. Isso é separado do Hub: o Career Unified descarta payload bruto e persiste apenas hashes, fatos mínimos e proveniência minimizada. Desabilitar essas flags sem política testada poderia quebrar o runtime e não é, isoladamente, uma política de privacidade.

Fontes oficiais: [router 2.3.7](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.router.ts), [schema 2.3.7](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.schema.ts) e [.env oficial](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/.env.example).

# WhatsApp Group Discovery

Fluxo: Evolution API 2.3.7 → webhook Career específico → validação de segredo, evento, instância e allowlist → exclusão de `fromMe`, privado e histórico → detector determinístico barato → lead/sinal → revisão/promoção.

Eventos aceitos para ingestão de mensagem: somente `MESSAGES_UPSERT`. `GROUPS_UPSERT` e `GROUPS_UPDATE` podem apoiar sincronização futura, mas não criam leads. `MESSAGES_SET` é histórico e sempre ignorado. Idempotência usa `instanceName + hash(messageId)`.

O endpoint é `POST /api/discovery-v4/webhooks/evolution`, protegido exclusivamente pelo header `X-Career-Webhook-Secret` e por rate limit local. Configure `CAREER_EVOLUTION_WEBHOOK_SECRET` com valor imprevisível; segredos em query string são rejeitados para evitar vazamento em logs. n8n não classifica mensagens: continua responsável apenas por integração outbound/delivery.

## Seleção no produto

O opt-in acontece em **Autopilot → Fontes → WhatsApp Groups**. A tela consulta a lista real da Evolution sem participantes, permite pesquisa por nome, seleção de um ou vários grupos e filtros adicionais compactos. Grupos novos começam desmarcados; salvar persiste somente os selecionados. Um grupo anteriormente monitorado que for desmarcado permanece como `enabled=false`, preservando a proveniência histórica.

`groupJid` é a identidade estável exposta como `externalId`; `displayName` é apresentação e pode mudar sem criar outra fonte. O provider público é `EVOLUTION_WHATSAPP`. O Search Intent global continua sendo a autoridade e filtros por grupo — famílias, senioridades, localizações, termos adicionais e excluídos — funcionam apenas como restrições extras.

A tela cobre carregamento, vazio, Evolution offline, WhatsApp desconectado, erro, lista conectada, salvamento e erro de salvamento. Nenhuma conversa antiga é consultada; somente eventos futuros `MESSAGES_UPSERT` passam pelo allowlist.

# Community Sources

`CommunitySource` representa uma origem comunitária opt-in. Em V4, o único tipo é `WHATSAPP_GROUP` e a identidade estável é `groupJid`; `displayName` é mutável. Novos grupos sempre começam desativados.

Persistem apenas JID/configuração da fonte, filtros opcionais, hashes de idempotência e leads relevantes minimizados. Não persistem listas de participantes, presença, fotos, áudio, stickers, documentos, histórico, payload bruto ou mensagens irrelevantes.
# Atualização V4.1.1

Cada grupo pode restringir famílias/termos, senioridades, hints de localização, termos incluídos e excluídos. O filtro do grupo é adicional ao Search Intent global. Mensagens descartadas deixam somente receipt minimizado, sem corpo bruto ou participantes.

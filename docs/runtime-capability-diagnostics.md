# Runtime Capability Diagnostics

Configurações → Diagnóstico verifica Discovery, Career Engine, inteligência local (Ollama ou LM Studio), n8n, Evolution, WhatsApp, Public Web e providers. Segredos nunca são retornados.

Estados de rede e configuração são independentes. n8n acessível sem integração configurada aparece como `ONLINE_CONFIG_INCOMPLETE`; Public Web sem chave aparece como `CONFIG_REQUIRED`.

A V4.1 também separa container n8n online, workflow empacotado, existência runtime não comprovada, ativação declarada, alvo do webhook, HMAC e prontidão outbound da Evolution. O provider local é opcional; o diagnóstico expõe provider, perfil de hardware e context budget, e LOW_VRAM implica concorrência 1 sem download automático.
# Atualização V4.1.1

Evolution API online não implica WhatsApp conectado. O diagnóstico consulta `connectionState()` e expõe separadamente transporte Evolution, instância WhatsApp, webhook inbound e prontidão outbound. Instância ausente/desconectada fica `PAIRING_REQUIRED` ou `DISCONNECTED`, mesmo com webhook configurado.

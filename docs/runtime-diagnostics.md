# Runtime Diagnostics

O Source Center consulta o estado real no momento do request. Brave usa lookup dinâmico do cofre com fallback para `BRAVE_SEARCH_API_KEY`, portanto uma conexão in-app muda `CONFIG_REQUIRED` para `CONNECTED` sem restart. WhatsApp continua vindo do Evolution runtime e Community Source; providers ATS continuam usando seus diagnósticos persistidos.

Um estado `CONNECTED` prova onboarding/capability específica, não sucesso de uma busca futura. `DEGRADED` e `ERROR` preservam o último diagnóstico; analytics exibem apenas contagens de runs reais.

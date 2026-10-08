# Source Connection Center V2

O Source Center é a porta única de onboarding. Ele não executa discovery e não substitui `ProviderRegistry` nem `AdapterRegistry`.

Fluxo: `GET /api/source-center` entrega DTO server-authoritative; credenciais usam `POST /api/source-center/credentials/:provider/validate`, `POST` para testar e salvar e `DELETE` para remover. Empresas usam busca conhecida, preview SSRF-safe, monitoramento explícito e pausa não destrutiva sob `/api/source-center/companies`.

O frontend nunca decide se uma fonte está conectada e nunca recebe segredo completo. Estados de loading, erro, rate limit, vazio e limitação são derivados do erro/status retornado. A área WhatsApp reutiliza o gerenciador existente e não aceita JID manual.

Compatibilidade: `/api/source-configurations` continua disponível para integrações anteriores; novas telas consomem `/api/source-center`.

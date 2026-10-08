# Source Connection Center V2 — preflight

| Área | Estado anterior | Autoridade | Duplicação/problema | Target V2 |
|---|---|---|---|---|
| Catálogo de setup | `ProviderSetupCatalog` misturava onboarding, env vars e execução | `provider-setup-catalog.mjs` | Estados técnicos e instruções para editar `.env` | `SourceOnboardingRegistry` decide somente onboarding; catálogo legado continua compatível |
| Execução de discovery | Providers e `DiscoveryService` | `provider-registry.mjs` | Não deve ser reimplementada | Intacta; o Source Center somente entrega target/credentialRef |
| Application adapters | ATS Adapter Registry | `adapter-registry.mjs` | Confusão potencial com conexão de fonte | Intacto e fora do escopo |
| Empresas | Company Radar + `company_watchlists` + `company_ats_boards` | `CompanyRadarService` | Formulário técnico exigia ATS/organizationKey | Busca conhecida, URL detectada e opt-in explícito; identidade técnica automática |
| Credenciais | Somente variáveis de ambiente | runtime | Exigia arquivo/restart e não havia rotação in-app | AES-256-GCM fora do SQLite, key separada, referência opaca e teste antes de salvar |
| Brave | `BRAVE_SEARCH_API_KEY` capturada no startup | `BraveSearchProvider` | Diagnóstico não refletia conexão nova | lookup dinâmico com fallback de ambiente |
| WhatsApp | Manager de grupos já funcional | Evolution/Community Source | Não deve pedir JID ou duplicar pareamento | deep-link/gerenciador existente preservado |
| UI | Cards técnicos e modal genérico | Autopilot | Misturava target, credential e unsupported | Cards por tarefa, requisitos humanos, detalhes recolhidos e estados honestos |

Escopo excluído: novos adapters brasileiros, Candidate Knowledge V3, LinkedIn, Controlled Submission, Gupy/Workday completos, Discovery V5, Matcher V3 e reescrita global do frontend.

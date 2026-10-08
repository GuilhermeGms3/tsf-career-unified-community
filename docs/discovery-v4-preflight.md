# Discovery V4 — preflight de arquitetura e fontes

Data da verificação: 2026-08-22.

## Decisão de arquitetura

O Discovery V4 evolui o pipeline V3 existente. `SearchIntentService`, `ProviderRegistry`, `DiscoveryService`, os repositórios SQLite e a Central de Fontes continuam sendo os pontos de extensão. Não será criado um segundo motor, um segundo catálogo de providers ou uma representação concorrente de `Job`.

A migration 014 é estritamente aditiva. Ela persiste somente configuração opt-in de grupos, recibos idempotentes minimizados, `OpportunityLead`, `HiringSignal` e campos de auditoria V4. Mensagens irrelevantes, payloads brutos, participantes, presença, mídia e histórico do WhatsApp não são persistidos.

## Mapa auditado

| Área | Implementação vigente | Extensão V4 |
|---|---|---|
| Intent e budget | `src/discovery/search-intent/*` | taxonomia versionada de intenção de contratação, classes de fonte e composição geográfica |
| Providers | `src/discovery/provider-*` | Public Web legítima via Brave quando configurada; ausência de chave é `CONFIG_REQUIRED` |
| Normalização/dedup | `src/discovery/discovery-service.mjs` | resolução de autoridade, trust, risco e promoção controlada de leads |
| Persistência | migrations 001–013 e `repositories/*` | migration 014 e repositório V4 aditivo |
| Evolution | cliente e serviço em `src/integrations/evolution` | listagem de grupos e ingestão autenticada/allowlisted |
| API | rotas extraídas em `server/routes` | `discovery-v4-routes.mjs`; sem aumentar o handler monolítico |
| Produto | Opportunities, Autopilot e Settings | Search Composer, WhatsApp Groups e diagnósticos de capacidade |

## Classes de fonte e disponibilidade honesta

| Classe | Situação inicial | Restrição |
|---|---|---|
| `STRUCTURED_ATS` | operacional conforme adapters V3 configurados | fonte oficial estruturada tem maior autoridade |
| `JOB_BOARD` | dependente do provider V3 | não inventar API ou alegar cobertura universal |
| `OFFICIAL_CAREER_PAGE` | parcial/manual ou ATS detectado | HTML genérico não é interpretado como vaga sem fatos mínimos |
| `PUBLIC_WEB` | `CONFIG_REQUIRED` sem `BRAVE_SEARCH_API_KEY` | somente API oficial; nenhum scraping de buscador |
| `PUBLIC_SOCIAL_SIGNAL` | manual/link-out | sem login, cookie, crawling ou automação de LinkedIn |
| `RECRUITER_PUBLIC_SIGNAL` | manual/link-out | trecho mínimo e proveniência obrigatória |
| `COMMUNITY_WHATSAPP_GROUP` | opt-in e configuração necessária | apenas grupos allowlisted e eventos novos |
| `INTERNSHIP_PORTAL` | declarada; adapter ausente | não operacional até provider legítimo ser implementado |
| `CONSULTANCY_STAFFING` | declarada; adapter ausente | não operacional até provider legítimo ser implementado |
| `NEWS_BLOG_HIRING_SIGNAL` | Public Web/manual | sinal não vira vaga sem dados suficientes |
| `EXTERNAL_FORM` | suportado como método de candidatura | nunca enviado automaticamente |
| `MANUAL_LEAD_CAPTURE` | operacional | usuário fornece URL ou texto; fatos desconhecidos permanecem desconhecidos |

## Pesquisa oficial

| Fonte oficial | Capacidade confirmada | Restrição observada |
|---|---|---|
| Brave Search API — `https://api.search.brave.com/app/documentation/web-search/get-started` | busca web via `GET /res/v1/web/search`, token em `X-Subscription-Token` | quota, planos e direitos de armazenamento dependem do contrato; consulta limitada pelo serviço |
| Microsoft Lifecycle — `https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement` | confirma a retirada das Bing Search APIs em 11/08/2025 | Bing Web Search legado não será implementado |
| LinkedIn User Agreement — `https://www.linkedin.com/legal/user-agreement` | uso humano e integrações autorizadas | proíbe crawlers, scripts, plugins e cópia não autorizada do serviço |
| LinkedIn Help — `https://www.linkedin.com/help/linkedin/answer/a1340567` | política contra software de terceiros que raspa ou automatiza atividade | V4 aceita somente URL/texto manual, API oficial futura ou resultado público de provider legítimo |
| Evolution API 2.3.7 — `https://github.com/EvolutionAPI/evolution-api/releases/tag/2.3.7` | versão fixada no Compose | contrato deve permanecer compatível com 2.3.7 |
| Evolution Webhooks — `https://github.com/EvolutionAPI/evolution-api/blob/main/Docs/en/Webhooks.md` | eventos `MESSAGES_UPSERT`, `GROUPS_UPSERT`, `GROUPS_UPDATE` | `MESSAGES_SET`/histórico não é ingerido |
| Evolution group controller — `GET /group/fetchAllGroups/{instance}` | enumeração dos grupos da instância | alguns retornos podem omitir `subject`; UI precisa de rótulo seguro |

## Invariantes

- Candidate Knowledge é a fonte de verdade do candidato; currículo é projeção. Ausência no currículo não implica `NO_MATCH` quando há evidência ativa na base.
- Trust da fonte, confiança, match, prioridade, elegibilidade e completude documental são eixos separados.
- `HiringSignal` incompleto permanece sinal/lead para revisão. Somente fatos suficientes promovem um `Job` canônico.
- Nenhum fluxo V4 envia candidatura, mensagem, e-mail ou contato automaticamente.
- Conflito factual estruturado é resolvido a favor de ATS/carreira oficial, preservando a alegação comunitária na proveniência.
- Risco usa estados conservadores (`VERIFIED`, `LIKELY_LEGITIMATE`, `UNVERIFIED`, `REVIEW_REQUIRED`, `RISKY`) e nunca acusa fraude automaticamente.

## Fora de escopo

LinkedIn OAuth/Profile Alignment, Controlled Submission, outreach automático, bypass de CAPTCHA/MFA, scraping autenticado, adapters novos de Gupy/Workday, Candidate Knowledge V3 e qualquer reestruturação visual ampla.

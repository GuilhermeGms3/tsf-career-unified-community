# Provider routing

| Classe | Rota operacional | Sem configuração ou alvo |
|---|---|---|
| `JOB_BOARD` | JobSpy e agregadores selecionados | `ERROR` se o engine falhar |
| `STRUCTURED_ATS` | Greenhouse, Lever, Ashby, SmartRecruiters ou Workable por board | `NO_TARGETS` |
| `OFFICIAL_CAREER_PAGE` | Company Radar; board detectado vai ao ATS e página genérica ao inspector JSON-LD | `NO_TARGETS` |
| `PUBLIC_WEB` | Brave Search server-side | `CONFIG_REQUIRED` |
| `COMMUNITY_WHATSAPP_GROUP` | Backlog minimizado de eventos novos e allowlisted | `CONFIG_REQUIRED` |

Cada report informa `sourceClass`, `provider`, `status`, `queries`, `targets`, `durationMs`, `rawResults`, `newResults`, `duplicates` e `errors`. Um report nunca é compartilhado artificialmente entre classes.

No modo Mass, a verdade é registrada por provider: `requested`, `called`, `requestCount`, `rawResults`, `candidateResults`, `newResults`, `duplicates` e erros próprios. Um provider solicitado mas não chamado por esgotamento do Query Budget recebe `BUDGET_SKIPPED`, não `ERROR`; agregados do run não são replicados para todos os providers.
# Atualização V4.1.1

`providerTargets` é preservado pela normalização do perfil e encaminhado ao Test Search e Mass Hunt. Greenhouse, Lever e Ashby recebem `organizationKey` do target selecionado; não há fallback silencioso para JobSpy quando a classe solicitada é ATS estruturado.

Boards inferidos de oportunidades históricas somente viram target automático quando estão ligados a uma Company Radar watchlist ativa. A mera presença de uma URL Ashby/Greenhouse/Lever/SmartRecruiters/Workable no histórico não equivale a configuração do provider.

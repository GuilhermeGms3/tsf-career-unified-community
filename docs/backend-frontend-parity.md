# Backend/frontend parity

| Capability | Backend | Frontend | E2E | Status |
|---|---|---|---|---|
| Inventário e overview | `GET /inventory` | Conhecimento/Visão geral | jornada 1/5 | COMPLETE |
| Experiência/projeto | entities create/update/detail | listas, formulário, detalhe, editar/encerrar | jornada 1 | COMPLETE |
| Enriquecimento | proposal + review | wizard e revisão por item | jornada 1 | COMPLETE |
| Skill detail | `GET /skills/:key` | filtros, card e timeline | jornada 5 | COMPLETE |
| Claims | validador interno/API | resultado via EvidenceGuard no review | jornadas 3/4 | COMPLETE |
| Gap | list/resolve | Opportunity CTA e Revisões | jornada 2 | COMPLETE |
| Matcher/Coverage/Confidence | consumidor interno | Opportunity Analysis | jornada 2 | COMPLETE |
| Resume projection | consumidor interno | provenance no tailoring | jornadas 3/4 | COMPLETE |
| Anos por skill em Application | consumidor interno | pergunta existente mostra review quando desconhecida | unitário 35 | INTERNAL CONSUMER |

O teste `backend-frontend-parity-v3.test.mjs` exige consumidor para os contratos user-facing e os estados loading, vazio, erro e feedback. Repositórios, normalizadores, indexação e projeção interna não exigem tela própria.

## Application Engine V2

| Contrato | Backend | Frontend | Estado |
|---|---|---|---|
| SubmissionPreflight | `POST /submission/preflight` | aba Preflight | COMPLETE |
| Snapshot/consent | `POST /submission/consent` | Revisão final + dialog explícito | COMPLETE |
| Submit/idempotência | `POST /submission/submit` | ação separada com UUID | COMPLETE para Greenhouse; switch off por padrão |
| Uncertainty/reconciliation | `POST /submission/verify` e `/reconcile` | alerta sem retry + abrir site + resolução explícita | COMPLETE |
| Handoff | session provider em memória | estado/expiração na Revisão final | COMPLETE; sem cookies persistidos |
| Receipt | workspace details | comprovante pós-confirmação | COMPLETE com sanitização/allowlist |

`tests/application-v2-parity.test.mjs` impede que rota, migration e UI divirjam.

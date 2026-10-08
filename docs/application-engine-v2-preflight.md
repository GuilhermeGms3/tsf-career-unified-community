# Application Engine V2 — preflight

Data da auditoria: 2026-08-23. Autoridade atual: schema 18 e commit `810a208`.

| Current capability | Current authority | Problem | V2 decision | Backend impact | Frontend impact |
|---|---|---|---|---|---|
| Estados da candidatura | `domain/application-status.mjs` + `ApplicationRepository` | `SUBMITTING` não distingue resultado pós-clique incerto | adicionar `SUBMISSION_UNCERTAIN` sem substituir os estados V1 | transições conservadoras e sem retry cego | estado e ação de verificação explícitos |
| Planner/policy | `ApplicationPlanner` e `PolicyEngine` | decisão de oportunidade não prova readiness de envio | manter APPLY/REVIEW/SKIP/BLOCKED e adicionar dimensão de submission | policy snapshot com kill switch/rate policy | explicar que boa oportunidade não significa candidatura pronta |
| Preflight V1 | `ApplicationPreflight` | cobre preparação/fill, não todos os gates de submit | criar `SubmissionPreflight` central e versionado | avaliação única com gates explícitos | checklist humano, blockers e warnings |
| Perguntas | `application_questions` + Candidate Answer Memory | estados V1 não separam sensível, draft e escopo específico | derivar estados V2 sem invalidar registros V1 | unknown required e sensitive bloqueiam | origem, evidência e ação humana por pergunta |
| Candidate Knowledge | CK V3 + Career Evidence Graph | unknown global não deve bloquear tudo | consultar apenas gaps/perguntas ligados à vaga | evidence refs e gaps no gate | deep link para resolução existente |
| Currículo | `resume_versions`, artifacts e `validateResumeArtifact` | seleção exata ainda não é gate de submit persistido | exigir versão `READY`, PDF/hash e EvidenceGuard | pin e hash no snapshot/consent | mostrar versão, arquivo e integridade |
| Duplicata | planner por `jobId` | insuficiente perto do envio | revalidar identidade canônica e receipts | gate por job/provider/reference | motivo de bloqueio visível |
| Vaga aberta | lifecycle/status local | pode estar desconhecido ou stale | CLOSED bloqueia; UNKNOWN exige review | gate com autoridade e checkedAt | indicar autoridade e recência |
| Adapter/DOM | `AdapterRegistry` + `application_inspections` | health não é submission boundary | exigir adapter, health e DOM confidence explícitos | gate por capability/inspection | diagnóstico traduzido, técnico em detalhes |
| Auth/challenge | `detectChallenge` | handoff existe apenas durante run | persistir resultado sanitizado no snapshot | LOGIN/MFA/CAPTCHA nunca são resolvidos | continuar manualmente e depois revalidar |
| Preview | inexistente | usuário não vê payload final consolidado | criar snapshot sanitizado e hash reproduzível | preview server-side | aba Revisão final |
| Consentimento | perguntas consent + review geral | não existe consentimento final application-specific | token aleatório, hash server-side, TTL, escopo e consumo único | consent repository/service | confirmação inequívoca, sem checkbox pré-marcada |
| Idempotência/lock | fila de fill | não cobre duplo submit/retry HTTP | tentativa e lock específicos de submission | idempotency key única e transação | botão desabilitado e mesmo resultado no retry |
| Receipt | inexistente | envio não é comprovável | modelo mínimo, sanitizado e ligado à tentativa | receipt append-only | comprovante e histórico |
| Transport | adapters não possuem submit | clicar com a sessão V1 seria frágil e perigoso | boundary injetável; real submit desligado por padrão | fake transport nos testes; nenhum submit externo neste marco | kill switch explicado |
| Greenhouse/Lever/Ashby | FILL_ONLY até `READY_TO_SUBMIT` | Controlled Submit limitado | passam pelo mesmo preflight, consentimento, idempotência e receipt | capabilities honestas | envio depende de runtime e gates habilitados |
| Generic | inspect conservador | boundary desconhecida | nunca ganha submit genérico | `SUBMIT_PROHIBITED` | handoff manual |
| Gupy | detecção/canonicalização | SPA, conta/sessão, componentes dinâmicos e challenges variáveis | adapter V1 dentro do registry, fixtures e handoffs; sem bot paralelo | detect/inspect/fill/validate quando DOM suportado | status real e ação manual quando necessário |
| Browser evidence | `BrowserManager` | trace pode conter PII e browser aberto não é sessão durável | mascarar campos ampliados, retention documentada, fechar com segurança | nenhum token/cookie em audit/receipt | apenas referências sanitizadas |
| Decision Inbox | `DecisionInboxService` | não conhece uncertainty/consent | reutilizar inbox existente | novos itens derivados | sem nova inbox paralela |

## Limites do marco

Inclui foundation controlado, migration aditiva, Gupy V1 conservador, paridade frontend/backend, fixtures, validator, QA e documentação. Não inclui submit externo real, LinkedIn, Workday, crawler autenticado, CAPTCHA/MFA solving, stealth, mensagens, outreach, Brazilian Sources P1 ou post-application intelligence.

## Evidência pública Gupy

A página pública atual usa URLs `*.gupy.io/jobs/{jobId}` e direciona para `*.gupy.io/candidates/jobs/{jobId}/apply`. O formulário de candidatura é uma SPA dependente de JavaScript e o uso completo exige conta individual do candidato. Isso justifica autenticação interativa e capability conservadora; não autoriza capturar credenciais, cookies ou contornar challenges.

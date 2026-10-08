# Mass Discovery V4.1.1

O V4.1.1 fecha divergências semânticas do Discovery V4 sem criar um novo motor. O pipeline mantém o Discovery canônico, Matcher V2, Opportunity Priority V2, Search Intent, Source Center e staging de leads já existentes.

## Contratos corrigidos

- `Technical Match` representa somente a aderência nos requisitos que puderam ser avaliados.
- `Evidence Coverage` mostra a proporção ponderada de requisitos com evidência conhecida.
- `Match Confidence` parte da cobertura e recebe penalidade adicional por requisito obrigatório `UNKNOWN`.
- requisito obrigatório `UNKNOWN` mantém score nulo, exige `REVIEW_REQUIRED` e não vira `NO_MATCH`.
- relevância usa Technical Match mais política mínima de cobertura/confiança; prioridade e notificação usam `OpportunityPriority.score`.
- preparo de currículo exige oportunidade relevante/elegível, evidência mínima e sempre termina em `REVIEW_REQUIRED`.

## Funil canônico

Os estágios são `rawDiscoveries`, `candidateDiscoveries`, `hiringRelevantSignals`, `opportunityLeads`, `hiringSignals`, `canonicalOpportunities`, `matchEvaluated`, `relevantOpportunities`, `priorityOpportunities`, `duplicates`, `filteredOut`, `backlogConsidered`, `needsReview`, `risky` e `errors`.

Um sinal público de contratação não é uma oportunidade relevante ao candidato. Web pública, notícias e WhatsApp criam sinais/leads; somente promoção, canonicalização, matching e política podem produzir uma oportunidade relevante.

## Fontes e execução

- Job Board usa JobSpy e aparece como `JOB_BOARD`, inclusive no modo MASS.
- ATS estruturados preservam `providerTargets`; Greenhouse, Lever, Ashby, SmartRecruiters e Workable continuam por identidade de board.
- Career Page ingere `JobPosting` JSON-LD no Discovery canônico e, no Mass, executa matching/prioridade.
- News/Blog usa Brave com estratégia de hiring signal ou fica `CONFIG_REQUIRED`; nunca é no-op operacional.
- WhatsApp é event-driven. Backlog antigo é informado separadamente e não vira descoberta do run atual.

## Leads e reconciliação

`LeadPromotionService` preserva a origem: Evolution/WhatsApp, Brave/Public Web ou captura manual. A reconciliação oficial é source-agnostic e só funde confiança alta por alvo exato ou assinatura coerente. Confiança intermediária marca possível duplicata para revisão; campos oficiais permanecem autoritativos.

## Runtime e UX

Evolution transport, estado da instância WhatsApp, webhook inbound e prontidão outbound são diagnósticos diferentes. O Composer só pré-seleciona classes prontas: Job Board quando disponível, ATS apenas com target, Brave apenas com chave, Career Page com watchlist e comunidade somente após opt-in.

## Limites

Não houve migration 016. Análises históricas são preservadas. Não há auto-submit, scraping/login LinkedIn, bypass CAPTCHA/MFA, Gupy completo, Workday adapter, outreach automático nem promoção de fatos de currículo para Candidate Knowledge confirmado.

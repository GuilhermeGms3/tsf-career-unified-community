# Mass Hunt funnel

O funil canônico contém `rawDiscoveries`, `structuredDiscoveries`, `publicWebDiscoveries`, `communityDiscoveries`, `opportunityLeads`, `hiringSignals`, `duplicates`, `canonicalOpportunities`, `filteredOut`, `matchEvaluated`, `relevant`, `priority`, `needsReview`, `risky` e `errors`.

As contagens vêm dos eventos da execução. Em uma fixture com 10 descobertas brutas e 4 duplicatas, há 6 canônicas; se 3 superarem `consider` e uma superar `priority`, os contadores são 3 relevantes e 1 prioritária. `prepareResume` exige currículo real e sempre produz revisão. `notify` enfileira alerta com quiet hours e idempotência.
# Atualização V4.1.1

O funil é run-scoped e distingue sinais de contratação, leads, oportunidades canônicas, avaliações, relevância ao candidato e prioridade. Os nomes canônicos são documentados em `discovery-v4-1-1.md`; `relevant` não é mais usado para contar sinais de Web/Comunidade.

Relatórios MASS carregam `executionMode: MASS`, `sourceClass` real e provider real. Community/WhatsApp é `EVENT_DRIVEN`/`LISTENING`, e backlog anterior aparece somente como disponibilidade, não como descoberta nova.

# Atualização R2

Antes do Matcher, o funil passa por `preMatchEvaluated`. Rejeições são discriminadas em `roleMismatch`, `locationMismatch`, `seniorityMismatch`, `stale` e `nonJob`; `passedPreMatch` segue ao Matcher. `REVIEW` preserva recall. A UI resume encontradas, únicas, descartadas, analisadas, relevantes e prioritárias e mantém o breakdown em detalhes.

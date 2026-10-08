# Candidate Knowledge V3 — preflight

Auditoria realizada antes da migration 018. O schema de entrada é 17 e a migration 012 permanece imutável.

| CURRENT CONCEPT | CURRENT MODEL | PROBLEM | V3 DECISION | MIGRATION IMPACT | FRONTEND IMPACT |
|---|---|---|---|---|---|
| Knowledge Unit | `candidate_facts` por canonical key | skill não explica onde/como foi usada | permanece nó canônico | nenhuma reescrita | competência ganha detalhe contextual |
| Experiência/projeto | valor estruturado dentro de fact | vínculo skill-contexto é implícito | `career_entities` unifica entidades de carreira | aditiva | cadastro e detalhe próprios |
| Evidência | `candidateEvidence` derivada no Matcher | não é persistida como relação de carreira | `knowledge_evidence` liga fact e entidade | backfill conservador | timeline, depth e uso visíveis |
| Profundidade | strength genérica do Matcher | curso e produção podem parecer equivalentes | depth `AWARENESS` até `LED`; `UNKNOWN` só para legado | aditiva | badges com semântica humana |
| Claim | EvidenceGuard valida termos por texto/ID | não verifica contexto/depth | claim persistida e guard contextual | aditiva | motivo de suporte/overstatement |
| Enrichment | somente edição manual de fact | narrativa não vira proposta revisável | proposal sempre `REVIEW_REQUIRED` | nova tabela | wizard completo sem depender de Ollama |
| Evidence Gap | `unknownRequirements` no snapshot ATS | sem resolução direcionada | gap run/analysis-scoped e resposta estruturada | nova tabela | CTA direto na análise |
| Provenance | source/provenance em fact | não existe por uso contextual | provenance por evidência | aditiva | origem e verificação no detalhe |
| Resume import | fact extraída pode ser não confirmada | risco de promoção sem contexto | resume gera somente proposal/review | nenhuma promoção | inbox de revisões |
| Histórico | análise e fact history | difícil explicar mudança do match | eventos mínimos + nova análise append-only | aditiva | before/after real após reanálise |

## Limites do marco

Inclui Evidence Graph relacional, experiências/projetos, enrichment, gaps, Matcher V2, Resume/EvidenceGuard e paridade frontend. Exclui LinkedIn, Controlled Submission, Gupy/Workday completos, Discovery novo, Matcher V3, autoaprovação e qualquer fabricação de fatos.

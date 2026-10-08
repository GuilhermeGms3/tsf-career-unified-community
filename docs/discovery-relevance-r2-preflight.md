# Discovery Relevance R2 — preflight

Data: 2026-08-23. Escopo: melhorar precisão antes do Matcher V2, sem novas fontes, taxonomia paralela, ML, Matcher V3 ou Controlled Submission.

## Arquitetura atual e mudança mínima

| STAGE | CURRENT INPUT | CURRENT RULE | CURRENT FAILURE MODE | FIX | MEASUREMENT |
|---|---|---|---|---|---|
| Search Intent | famílias, termos, senioridades, location policy | normalização em `SearchIntentService` | intenção correta perde contexto durante a execução | preservar intent e query provenance até o run | replay e inspeção do report |
| Job Family taxonomy | catálogo canônico com dez famílias e aliases PT/EN | usado somente para expandir queries | nenhuma família é classificada no resultado | reutilizar o catálogo como autoridade do classificador | family accuracy |
| Query Expansion | custom terms, aliases e sufixos de senioridade | ordem de inserção + dedup | termo amplo pode consumir budget antes de alias preciso | tiers T1/T2/T3, contexto e provenance | FP por query/tier |
| Provider query | query, location, provider, target | produto cartesiano até o budget | ATS de board recebe query redundante; metadado da query é descartado | comportamento source-aware e query detail no report | requests/provider e query provenance |
| Normalization | `normalizeDiscoveryJob` | strings e lifecycle básico | location/work model/remote scope ficam inconsistentes | classificação canônica sem substituir o raw persistido | location accuracy |
| Location filter | job + `locationPolicy` | modelo por regex; localização por substring | remoto US pode casar com Brasil; `DF` é ambíguo | country/remote-scope explícitos e aliases geográficos conservadores | location accuracy/FN |
| Work model | `workModel + location` | remote/hybrid/onsite por regex | ausência vira onsite; escopo remoto inexistente | `UNKNOWN` revisável e remote scope separado | decision breakdown |
| Seniority | título/seniority/jobType | estágio/júnior/pleno/sênior por regex | senior terms incompletos; unknown passa sem explicação | classificador explícito, unknown revisável | seniority accuracy |
| Role/family | inexistente no pre-match | não há regra | skill overlap e token “técnico/estágio” promovem outra ocupação | evidência positiva por família + domínio ocupacional contrário | family accuracy/FPR |
| Freshness | lifecycle e `datePosted` persistidos | somente lifecycle diferente de OPEN é filtrado | título antigo/edital 2021 passa | source-aware freshness; data ausente em ATS OPEN não é stale | freshness accuracy |
| Opportunity type | `jobType` livre | não há classificação | curso, evento, edital, bolsa e talent pool parecem vaga normal | JOB/INTERNSHIP/TALENT_POOL/COOP/NON_JOB etc. | type accuracy/FPR |
| Internship | seniority regex | estágio/intern | estágio de qualquer área parece aderente | seniority separada de família | family recall + accuracy |
| Dedup | canonical resolver + ID único no run | canonicalização antes do Job Hunt | correto, mas query causadora fica opaca | preservar fontes e query provenance | duplicates e provenance |
| Pre-Matcher filters | lifecycle/work model/seniority/location/application | booleanos e um contador agregado | sem explicação e sem distinção review/reject | `PreMatchPlausibility` PASS/WARN/REVIEW/REJECT | reasons/run e matcher avoided |
| `JobHuntService.run()` | canônicas persistidas + perfil | filtros baratos → Matcher por currículo | Matcher não roda em alguns casos, mas não se sabe por quê | uma avaliação run-scoped antes do Matcher | filter funnel |
| Thresholds | Technical/coverage/confidence/priority | depois do Matcher | relevance ocupacional chega tarde ou nunca é medida | preservar thresholds, adicionar somente plausibility anterior | regressões Matcher |
| Matcher invocation | job, profile, resume | Matcher V2 determinístico | recebe ruído ocupacional/geográfico | chamar somente PASS/WARN/REVIEW conforme política | matchEvaluated delta |
| Opportunity Priority | job + análise + preferências | ranking pós-Matcher | não corrige família errada de forma confiável | não alterar; melhorar entrada | precision/nDCG top-k |
| Source differences | provider/source trust | routing e trust separados | freshness/estrutura tratadas quase iguais | ATS OPEN mais confiável; board/web/community conservadores | métricas por source class |
| Frontend | funil agregado + detalhes JSON | cinco métricas principais | descarte não é humano/explicável | resumo de únicas/descartadas/analisadas e breakdown progressivo | Playwright/a11y |

## Boundaries

### Deve mudar

- classificação determinística de família, geografia/remote scope, senioridade, tipo e freshness;
- decisão barata e explicável antes do Matcher;
- reasons e breakdown por run sem apagar a vaga;
- replay R1, métricas before/after e UI incremental.

### Pode mudar somente se necessário

- contrato do resultado Mass e read model de oportunidade;
- persistência: preferir `report_json` run-scoped; migration somente se a consulta real exigir.

### Não muda

- Matcher V2, Eligibility e Document ATS Compatibility;
- Candidate Knowledge, adapters de candidatura, fontes, WhatsApp/n8n/Ollama;
- arquitetura visual, rotas principais e taxonomia canônica.

## Trust boundaries

Título, descrição, localização, datas e metadata de providers são entrada externa não confiável. As classificações são limitadas em tamanho, determinísticas, não executam conteúdo e não registram PII. Decisão de relevance permanece separada de eligibility e nunca dispara candidatura.

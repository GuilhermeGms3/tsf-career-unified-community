# Cobertura backend/frontend

## Regra

Todo contrato HTTP pertence a uma destas classes:

1. **Interface**: leitura ou ação iniciada por uma pessoa e conectada à superfície canônica do domínio.
2. **Arquivo**: download aberto pela interface por link normal, sem conversão para JSON.
3. **Integração**: webhook, callback, handoff ou API autenticada consumida por outro processo.
4. **Interno/compatibilidade**: contrato mantido para workers, ferramentas locais ou migração; não deve virar controle de produto sem uma Story própria.

“Conectar todos os endpoints” significa que todo contrato de interface tem consumidor e que os demais têm classificação explícita. Não significa mostrar callbacks e webhooks como botões.

## Superfícies canônicas

| Domínio | Contratos | Frontend |
| --- | --- | --- |
| Hoje | `/api/today*`, `/api/product/onboarding` | `public/features/today/page.js` |
| Oportunidades | `/api/opportunities*`, `/api/unified/jobs/search`, `/api/discovery-v4/search/*`, `/api/unified/ats` | `public/features/opportunities/page.js`, `public/features/analyze-job/page.js` |
| Busca automática e fontes | `/api/job-hunt*`, `/api/source-center*`, `/api/source-configurations*`, `/api/discovery-v3*`, `/api/discovery-v4*`, `/api/whatsapp*` | `public/features/autopilot/page.js`, `public/features/connections/page.js` |
| Currículos | `/api/experience/resumes`, `/api/resume-documents*`, `/api/resume-archetypes*`, `/api/resume-batches*`, `/api/unified/resume` | `public/features/resumes/page.js`, `public/features/resume-batches/page.js` |
| Candidaturas | `/api/experience/applications*`, `/api/unified/applications*`, `/api/applications/*/submission/*`, `/api/application-batches*`, `/api/application-drafts*` | `public/features/applications/page.js`, `public/features/application-batches/page.js` |
| Conhecimento | `/api/candidate-knowledge*` | `public/features/knowledge/page.js` |
| Qualidade | `/api/quality-lab*`, `/api/coverage-benchmark*`, `/api/ats/recalculate` | `public/features/quality-lab/page.js`, `public/features/settings/page.js` |
| Configuração e dados | `/api/profile*`, `/api/intelligence*`, `/api/runtime-diagnostics`, `/api/engine/status`, `/api/unified/backup*`, `/api/unified/sync-legacy` | `public/features/settings/page.js` |
| Integrações e observabilidade | `/api/integrations/n8n*`, `/api/connections*`, `/api/observability*`, `/api/logs` | `public/features/settings/page.js`, `public/features/connections/page.js`, `public/features/observability/page.js` |

## Contratos deliberadamente sem controle direto

| Classe | Contratos | Motivo |
| --- | --- | --- |
| Integração | `/api/discovery-v4/webhooks/evolution` | Entrada autenticada da Evolution; não é ação humana. |
| Integração | `/api/connections/handoff/*` | Comunicação do runner de autenticação com o Hub. |
| Integração | `/api/automation/resume-documents/jobs` | API HMAC para n8n; a UI usa os contratos normais de documentos. |
| Integração | `/api/integrations/n8n/dispatch` | Worker/outbox; teste humano usa `/api/integrations/n8n/test`. |
| Arquivo | `/api/resume-documents/artifacts/*/download`, `/api/resume-batches/*/export`, `/api/observability/export`, `/api/unified/backup` | Downloads ligados por `<a>` nas telas donas. |
| Interno | `/api/candidate-knowledge/claims/validate` | Consumido pelo `EvidenceGuard`, conforme a política de paridade existente. |
| Compatibilidade | `/api/projects`, `/api/run`, `/api/preset/run`, `/api/processes`, `/api/careerops`, `/api/preparation*`, `/api/pipeline/add` | Contratos do shell legado preservados para ferramentas locais. A Experience V2 usa os workspaces canônicos. |
| Compatibilidade | `/api/discovery/providers`, `/api/discovery/runs`, `/api/discovery/watchlists*` | Contratos Discovery V2 mantidos; V3/V4 e Source Center são as superfícies atuais. |
| Compatibilidade | `/api/unified/search-schedule*`, `/api/unified/alerts`, `/api/unified/generated` | Agendador legado; perfis e runs do Job Hunt são a superfície atual. |
| Diagnóstico especializado | `/api/unified/greenhouse/live-inspect` | Ferramenta técnica protegida por configuração; não deve sugerir suporte universal ao usuário. |

## Ligações corrigidas nesta rodada

- Configuração do Ollama usa o campo `endpoint` aceito pelo backend.
- Atualização de modelos e benchmark de inteligência ficam em Configurações.
- Configuração e teste explícito do n8n ficam em Integrações.
- Saúde do compilador, métricas e benchmarks aparecem em Currículos > Modelos.
- Recomendações de base por arquétipo podem ser preparadas, aprovadas ou rejeitadas.
- Recálculo ATS fica em Diagnóstico.
- Exportações para CareerOps e AutoApply usam `POST /api/profile/export` com destinos válidos.
- Sincronização legada fica em Dados e backup.

# Discovery V4.1.1 — preflight de correção semântica

Levantamento em 2026-08-22, antes das alterações deste marco. O escopo fica restrito ao fechamento do Discovery V4.1 existente; não inclui novos motores, novos ATS de candidatura, auto-submit ou Candidate Knowledge V3.

| Issue | Caminho atual | Comportamento encontrado | Comportamento esperado | Causa raiz | Correção delimitada | Teste de regressão |
|---|---|---|---|---|---|---|
| UNKNOWN infla o match | `src/matching/scoring-engine.mjs` | Itens com `score=null` saem do denominador e o score conhecido pode parecer completo | Match conhecido, cobertura e confiança separados | O contrato só retornava score dos itens avaliados | Calcular cobertura ponderada e confiança, preservando UNKNOWN | Terraform obrigatório desconhecido versus confirmado |
| Threshold de prioridade | `src/automation/job-hunt-service.mjs` | `priorityThreshold` compara `analysis.overallScore` | Comparar `OpportunityPriority.score` | Uma variável `policyScore` era reutilizada para todas as decisões | Separar match técnico, relevância, preparo, notificação e prioridade | Match 92 / prioridade 70 não é prioritário com limiar 85 |
| Funil ambíguo | `mass-hunt-funnel.mjs` e `DiscoveryV4Service` | `relevant` podia significar hiring signal ou vaga relevante ao candidato | Sinais, leads, canônicas, avaliadas, relevantes e prioritárias distintos | Contadores de fontes diferentes eram somados sob o mesmo nome | Contrato único de estágios | Fixture 10 sinais, 5 leads, 4 canônicas, 2 relevantes, 1 prioritária |
| Backlog contado como execução | `DiscoveryV4Service.runCommunity` | Todos os leads históricos entram no Mass atual | Somente eventos do run ou backlog explicitamente reconsiderado | Não havia janela/run scope na consulta | Filtrar por início da execução e reportar backlog elegível separado | Lead de ontem não incrementa descoberta nova |
| Fonte consultada omitida | relatório `MASS_HUNT` | `consulted` exclui o pseudo source class `MASS_HUNT` | Modo MASS separado da classe real consultada | Modo de execução foi usado como classe de fonte | Relatórios por provider/classe real com `executionMode` | JobSpy chamado produz `consulted=1` |
| Target ATS perdido | `normalizeJobHuntProfile` | `providerTargets` não sobrevive à normalização/persistência em memória do run | Identidade de board preservada | Campo fora do contrato normalizado | Normalizar targets canônicos e usá-los por provider | Ashby `organizationKey` round-trip e chamada real |
| Career Page só conta | `runCareerPages` | JSON-LD retorna jobs, mas não entra no Discovery/persistência/matcher | Job oficial canônico persistido e avaliado | Inspector estava fora do pipeline canônico | Ingerir jobs inspecionados via Discovery canônico | JobPosting persistido e avaliado no Mass |
| News/blog no-op | `source-classes.mjs` | Pode aparecer operacional, mas `run` não possui handler | Handler real ou indisponibilidade explícita | Capability e execução divergiram | Reusar busca web com estratégia de news/hiring signal | Seleção isolada nunca fica operacional silenciosa |
| Promoção community-hardcoded | rota `/leads/:id/promote` | Todo lead vira `community-whatsapp` | Proveniência da classe/provider original | Rota chama `communityService.promote` | Serviço genérico de promoção | Public Web continua Brave; manual continua manual |
| Reconciliação limitada | `DiscoveryV4Repository.reconcileOfficialJob` | Somente `COMMUNITY_WHATSAPP_GROUP` | Reconciliar qualquer lead legítimo com confiança alta | Filtro fixo pela classe | Estratégias URL/empresa+título/local/fingerprint com merge conservador | WhatsApp/Ashby, Web/Ashby e Manual/Greenhouse |
| WhatsApp READY incorreto | `RuntimeCapabilityService` | Evolution online + webhook configurado pode virar configurado sem instância conectada | Estado real de `connectionState` separado do transporte/webhook/outbound | Diagnóstico não consultava a instância | Consultar `EvolutionConnectionService.connectionState()` | Instância close => DISCONNECTED/PAIRING_REQUIRED |
| Defaults ruins | `public/features/opportunities/page.js` | ATS e Web vêm marcados mesmo sem target/key; Job Board vem desligado | Marcar apenas classes READY | Defaults fixos no HTML | Defaults derivados das capabilities | JobSpy READY é default; demais indisponíveis ficam off |
| Filtros comunitários ignorados | `CommunityDiscoveryService.ingest` | `filters_json` é persistido, mas não aplicado | Restrição adicional por família/senioridade/local/include/exclude | Wiring ausente | Filtro mínimo determinístico por source | Senior Sales descartado; NOC Jr aceito |
| Audit incompleto | `scripts/export-audit.ps1` | `server.mjs` e `db/database.mjs` ficam fora | Código seguro suficiente para imports/testes em extração limpa | Allowlist só incluía migrations no root `db` | Incluir entrypoint e código DB, manter dados proibidos fora | Conteúdo do ZIP e imports em pasta limpa |

## Limites preservados

- Sem migration 016: os metadados novos cabem nos JSONs e contratos existentes.
- Sem reprocessar análises históricas ou alterar `ResumeVersion` imutável.
- Sem auto-submit, CAPTCHA/MFA bypass, stealth, LinkedIn OAuth, Gupy completo ou Workday adapter.
- Sem promover automaticamente fatos extraídos de currículo a Candidate Knowledge confirmado.
- Sem homologação externa declarada sem credencial, pareamento e evidência real.

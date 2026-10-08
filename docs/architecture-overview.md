# Arquitetura do Career Unified

## Camada Experience V2

O frontend permanece sem framework e usa ES Modules. `public/index.html` é somente o shell; `public/app.js` delega o bootstrap; cada domínio vive em `public/features`. A API mantém os contratos existentes e adiciona read models em `ExperienceService` para compor workspaces sem persistência lateral.

`NextActionEngine` é determinístico: recebe o estado persistido e recomenda a próxima ação. Ele não executa transições e não chama LLM. Regras de match, elegibilidade, currículo e candidatura continuam em seus engines canônicos. Rotas profundas são servidas pelo fallback do shell no servidor HTTP e restauradas pelo roteador no cliente.

O frontend continua em HTML/CSS e módulos ES vanilla. `public/app.js` delega o bootstrap, e as áreas atuais vivem exclusivamente em `public/features/`; `public/views` foi removido após a auditoria de paridade V2.1. O servidor Node ESM continua sendo o ponto de composição; rotas extraídas em `server/routes/` recebem serviços e repositórios explicitamente, sem framework novo.

SQLite é a fonte autoritativa para vagas, análises, candidaturas, conhecimento, feedback, execuções e outbox. O JSON legado permanece apenas no contrato de compatibilidade já existente. A migration 012 transforma `candidate_facts` em unidades tipadas. A migration 013 adiciona Search Intent versionado, queries expandidas, métricas do Mass Hunt, Company Radar, ApplicationMethod, capabilities/diagnósticos e somente metadados não secretos da conexão WhatsApp.

## Limites

- UI não acessa SQLite ou segredos diretamente.
- Candidate Knowledge é a memória factual; ResumeSpec é uma representação, ResumeVersion é snapshot e EvidenceGuard continua decidindo se um claim tem suporte;
- rotas validam entrada e chamam domínio/repositórios;
- Technical Match, Opportunity Priority e Inbox Attention Priority têm contratos e responsabilidades distintos;
- Decision Inbox agrega estados existentes, sem criar um segundo workflow;
- n8n recebe eventos minimizados e não decide nem submete;
- Evolution é acessada diretamente pelo Hub apenas para instance/QR/state/test explícito; alertas usam outbox e n8n;
- QR, API keys, targets integrais e segredos HMAC não são persistidos nem retornados ao browser;
- Ollama pode enriquecer tarefas, mas o fallback determinístico permanece.

As rotas de Hoje, oportunidades, conhecimento, fontes e Autopilot vivem em módulos separados de `server/routes/`. Candidate Knowledge possui service, policy, normalizer e migrator próprios em `src/candidate-knowledge/`; `OpportunityService`, `DecisionInboxService` e `JobHuntService` concentram as demais regras de domínio; `server.mjs` apenas os compõe.

Veja [architecture-overview.mmd](./architecture-overview.mmd) para a fonte editável e [architecture-overview.svg](./assets/architecture-overview.svg) para o artefato visual versionado.

O V4 acrescenta módulos em `src/discovery/v4`, `src/discovery/public-web` e `src/discovery/community`, um repositório/migration aditivos e uma rota extraída. `OpportunityLead` e `HiringSignal` entram no normalizador existente somente após revisão/promoção; não existe segundo registry ou modelo de vaga.

## Candidate Knowledge V3

A migration 018 acrescenta `career_entities`, `knowledge_evidence`, `evidence_claims`, `experience_enrichment_proposals`, `evidence_gaps` e `knowledge_audit_events`. `CandidateKnowledgeService` preserva a API V2 e orquestra o novo `CareerEvidenceRepository`. Matcher e Application recebem projeções em lote; Resume Tailor e EvidenceGuard recebem IDs e metadata contextual. `ExperienceService` apenas compõe gaps no workspace. O frontend continua em `public/features/knowledge/page.js`, sem store ou framework paralelo.
# Discovery Relevance R2

Entre canonicalização e Matcher V2 existe agora o `PreMatchPlausibility`, determinístico e run-scoped. Query tiers/provenance entram no Discovery e permanecem na proveniência da vaga; as decisões ficam no report do Job Hunt, evitando estado global contraditório.
# Source Connection Center V2

`SourceOnboardingRegistry` é autoridade de onboarding e não substitui `ProviderRegistry` (discovery) nem `AdapterRegistry` (application). `SourceConnectionService` combina registry, runtime e metadata; `CredentialVault` mantém ciphertext fora do SQLite; `CompanyRecommendationService` reutiliza Company Radar, watchlists, boards, Search Intent e PreMatch R2.

# Application Engine V2

A migration 019 adiciona avaliações de preflight, consentimentos hashed, tentativas/locks e receipts, sem tabelas por ATS. `SubmissionPreflight` compõe as autoridades existentes; `ControlledSubmissionService` coordena idempotência e estado; `AdapterRegistry` continua a única matriz de capability. A V2.1 reutiliza esse schema: dados fresh vivem nos gates/snapshot existentes, portanto não foi criada migration 020. O servidor injeta transporte Greenhouse com política deny-by-default.

# Controlled Submit Production Path V2.1

O caminho de produção é `Final Review -> consentimento específico -> preflight final fresh -> lock/idempotência -> action armed -> um clique -> confirmação/uncertain -> receipt/reconciliação`. Todas as autoridades são resolvidas no backend.

Greenhouse, Lever, Ashby, SmartRecruiters e Workable possuem `canSubmit=true`. O runtime externo exige simultaneamente `NODE_ENV=production` e `CAREER_SUBMISSION_ENABLED=true`; o Compose usa `false` por padrão. A URL precisa pertencer ao job board oficial do provider e corresponder à identidade persistida. Testes loopback usam uma permissão separada que não existe no servidor de produção. Workday permanece fora desse transporte e usa handoff assistido por etapa.

Não existe retry após o clique. A observabilidade deriva do audit log: preflight iniciado/bloqueado, ação armada/disparada, confirmação, incerteza, receipt e reconciliação manual, sem valores de formulário ou PII.

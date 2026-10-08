# Controlled Submission

Controlled submission exige simultaneamente candidatura em estado permitido, elegibilidade, perguntas resolvidas, currículo exato íntegro, ausência de duplicata, vaga aberta, adapter e DOM saudáveis, sessão sem challenge, limite por hora, kill switch e consentimento vigente.

O comando usa `X-Idempotency-Key`. Uma chave já conhecida retorna a tentativa existente. Um lock por candidatura impede concorrência. Falha antes da ação é `FAILED`; timeout/crash depois da ação é `SUBMISSION_UNCERTAIN` e nunca dispara retry automático.

O servidor registra `AdapterSubmissionTransport`, que autoriza Greenhouse, Lever, Ashby, SmartRecruiters e Workable em `NODE_ENV=production` quando `CAREER_SUBMISSION_ENABLED=true`. O padrão Docker é `false`. Generic e Workday continuam sem submit por esse transporte; Gupy usa seu Application Batch controlado. Fixtures loopback precisam de autorização explícita no próprio teste e exercitam o mesmo domínio/transport/adapter sem acessar ATS comercial.

Imediatamente antes do clique, o backend repete job check oficial, inspection, assinatura/estrutura do DOM, perguntas e artefato. `SUBMIT_ACTION_ARMED` é registrado antes da boundary final e `SUBMIT_ACTION_TRIGGERED` no instante do único clique.

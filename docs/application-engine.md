# Application Engine

O Application Engine preserva inspeção, mapeamento e preenchimento até `READY_TO_SUBMIT` e acrescenta preflight fresh, preview, consentimento, idempotência, lock, estados incertos e receipts. Somente Greenhouse declara `canSubmit=true`; o transporte externo continua desabilitado por padrão e exige produção mais kill switch explícito.

No Candidate Knowledge V3, perguntas como “Quantos anos de Java?” recebem uma semantic key por competência e consultam intervalos profissionais/freelance confirmados no Career Evidence Graph. Intervalos sobrepostos são unidos. Se datas ou evidências forem insuficientes, a resposta permanece `USER_REQUIRED/REVIEW_REQUIRED`; o sistema não usa anos gerais nem inventa um número. IDs das evidências permanecem na proveniência interna do draft.

Candidate Answer Memory continua separada para preferências, consentimentos e respostas específicas.

Consulte [Application Engine V2](./application-engine-v2.md), [Submission Preflight](./submission-preflight.md) e [Controlled Submission](./controlled-submission.md).

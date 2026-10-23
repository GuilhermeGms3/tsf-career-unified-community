# Application Engine V2

O V2 acrescenta a fundação de envio controlado ao Application Engine existente. Ele não cria um segundo robô: planner, Application, ResumeVersion, perguntas, inspeções, fila e eventos continuam sendo as autoridades anteriores.

## Fluxo canônico

`READY_TO_SUBMIT → preflight server-side → preview final → consentimento específico → lock/idempotência → transporte → receipt ou SUBMISSION_UNCERTAIN`.

O runtime instala `AdapterSubmissionTransport`. Greenhouse, Lever, Ashby, SmartRecruiters e Workable podem atravessá-lo, apenas com `NODE_ENV=production` e `CAREER_SUBMISSION_ENABLED=true`; a configuração Docker continua desligada por padrão. O switch sozinho não cria capability para outro provider.

## Estados e autoridades

- `SubmissionPreflight` é a única autoridade dos gates finais.
- `submission_consents` guarda somente hash, escopo, validade e hashes dos snapshots.
- `submission_attempts` fornece idempotência, lock e classificação da fase.
- `submission_receipts` só nasce após confirmação positiva do provider.
- `application_events` permanece append-only e registra a jornada.
- `SUBMISSION_UNCERTAIN` impede retry cego quando o clique pode ter ocorrido.
- `auto_apply_runs` torna o despacho anterior ao submit idempotente entre reinicios do Hub.
- Cada consentimento guarda a origem e a referencia da autorizacao, vinculadas por hash a candidatura e a `ResumeVersion` exata.
- Na inicializacao, tentativa interrompida em `PRE_ACTION` falha de modo recuperavel; depois da acao externa vira `UNCERTAIN`; recibo existente prevalece como `SUBMITTED`.

## Capability real

Greenhouse, Lever, Ashby, SmartRecruiters, Workable e Nerdin chegam a `CONTROLLED_SUBMIT` com `canSubmit=true`. O Nerdin usa seu formulário público nativo em três etapas. Gupy V1 chega a `READY_TO_SUBMIT_MANUAL`, enquanto o Application Batch dedicado da Gupy aplica seus próprios gates de submit. Generic não submete. Workday inspeciona e preenche a etapa corrente, mas exige handoff para autenticação, transições e envio final.

Validação: `npm run application:v2:validate`.

## Continuidade operacional

A migration 053 adiciona proveniencia verificavel ao consentimento e o claim persistente do AutoApply. O lease exclusivo do `dataDir` garante um unico Hub escritor; a recuperacao de inicializacao ocorre antes de novos workers aceitarem trabalho. Essa protecao nao transforma capability declarada em homologacao externa: cada portal ainda exige comprovacao real do formulario e recibo antes de ser descrito como envio confirmado.

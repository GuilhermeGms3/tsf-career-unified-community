# Discovery Query Planner V2

O planner transforma a Search Intent persistida em um plano pequeno, determinístico e auditável antes do Discovery. O catálogo de famílias continua sendo a única taxonomia; o planner não mantém uma lista paralela de cargos.

## Fluxo e contrato

`SearchIntentService` gera e persiste o conjunto completo de candidatos por família. O `DiscoveryQueryPlanner` normaliza caixa, diacríticos e espaços, remove duplicatas literais, agrupa candidatos pelas famílias ativas e entrega itens com `query`, `familyId`, prioridade, motivo da expansão, motivo da seleção, round e índice de rotação.

O orçamento configurado não é aumentado. O orçamento efetivo é `min(maxQueries, maxRequests)`, porque uma query sem ao menos uma tentativa de request não conta como cobertura executável. O runtime intercala a primeira tentativa de cada query antes de combinações adicionais de provider/localização.

## Fairness e estado

A migration 020 persiste por perfil e versão da Search Intent: round, cursor familiar, offsets de aliases e contagens de seleção. Uma nova versão da intenção reinicia a rotação. Mesma entrada e mesmo estado produzem a mesma saída.

Com `N` famílias e orçamento efetivo `B`, todas as famílias com candidatos recebem um slot em no máximo `ceil(N / B)` rounds. Para cinco famílias e budget 2:

- round 1: SUPPORT, INFRASTRUCTURE;
- round 2: NETWORK_NOC, DEVOPS_SRE;
- round 3: BACKEND, SUPPORT.

A sequência não é hardcoded: ela deriva da ordem persistida e do cursor. Capacidade acima do número de famílias usa primeiro um termo customizado e depois aliases adicionais em rotação. Uma família com muitos aliases não monopoliza a primeira passagem.

Quando há mais de uma geografia, a unidade de fairness é a combinação família ×
geografia. O relatório de cada rodada expõe combinações planejadas, executadas e
adiadas, além de ciclos concluídos e rodadas restantes. Com três famílias, duas
geografias e orçamento efetivo 1, as seis combinações completam um ciclo em seis
rodadas e o cursor sobrevive ao restart.

## Limites e providers estruturados

JobSpy e fontes query-aware aplicam a query. Greenhouse, Ashby e outros boards estruturados listam o board completo uma única vez por target; nesses casos a proveniência registra `ATS_BOARD_LIST` e não afirma que o provider aplicou a string da query. Classificação, localização, senioridade, PreMatch, requisitos e Match continuam posteriores à descoberta.

Perfil `enabled=false` bloqueia apenas execução `SCHEDULED`; uma execução manual explícita continua permitida. O planner nunca altera esse estado, thresholds ou a política de submission.

Se um perfil v7 recuperado tiver `expanded_queries` legadas incompletas, o runtime complementa somente as famílias ausentes usando a própria Search Intent/taxonomia v7 antes de planejar. Uma execução Mass Hunt que muda apenas o target/provider reutiliza a versão semanticamente idêntica da Search Intent; não cria v8 artificialmente. Alterações semânticas reais continuam criando uma nova versão e reiniciando o cursor.

A homologação Greenhouse definitiva de 2026-08-24 executou cinco rounds com `maxRequests=1`: SUPPORT, INFRASTRUCTURE, NETWORK_NOC, DEVOPS_SRE e BACKEND. Cada round registrou uma chamada `CONSULTED`; o estado final ficou em round 5/cursor 0, com uma seleção por família. Detalhes em `docs/database-forensic-recovery-20260824.md`.

Validação dedicada: `npm run discovery:planner:v2:validate`.

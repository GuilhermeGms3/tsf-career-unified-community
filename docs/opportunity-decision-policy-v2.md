# Opportunity Decision Policy V2.1

## Autoridade

`src/opportunities/opportunity-decision-policy-v2.mjs` é a autoridade derivada que transforma fatos já existentes — Job, PreMatch, Matcher V2, evidências, feedback e Search Intent — em uma decisão de produto. Ela não altera `Technical Match`, `Evidence Coverage`, `Confidence`, Opportunity Priority ou o threshold de considerar 70.

O resultado público contém `disposition`, bloqueadores, alertas, family fit, resumo de gaps, visibilidade, razões estruturadas, explicação causal, instante da avaliação e versões de entrada. Os estados são `BLOCKED`, `SKIP`, `STRETCH`, `REVIEW`, `RECOMMENDED` e `PREPARE_ELIGIBLE`.

## Ordem de decisão

1. Bloqueadores confirmados vencem qualquer score: vaga encerrada ou stale, localização incompatível, profissão não relacionada, senioridade sênior/lead/manager, exigência forte de 5+ anos e gaps operacionais explicitamente incompatíveis.
2. `NOT_FOR_ME` suprime superfícies normais sem apagar a oportunidade.
3. Lacuna material ou nível pleno vira `STRETCH` quando não há bloqueador.
4. Informação insuficiente, cobertura/confiança fraca ou match abaixo de 70 vira `REVIEW`, não desaparecimento.
5. Match suficiente vira `RECOMMENDED`; atingir o gate existente de preparo pode virar `PREPARE_ELIGIBLE`.

`INTERESTED` pode resgatar um `SKIP` para revisão humana. Nunca remove hard blocker nem torna a vaga elegível para preparo.

## Criticidade e gaps

Requisitos são classificados deterministicamente como `MUST_HAVE`, `IMPORTANT`, `NICE_TO_HAVE` ou `UNKNOWN_CRITICALITY`. A resolução produz `MATCHED`, `TRANSFERABLE`, `LEARNABLE_GAP`, `NON_MATERIAL_GAP`, `MATERIAL_GAP` ou `BLOCKING_GAP`. Criticidade explícita e resolução de evidência são eixos independentes: ausência de evidência não torna automaticamente um requisito inferido em lacuna material.

`required=false` com importância indefinida permanece `UNKNOWN_CRITICALITY`. Um requisito só vira material quando sua obrigatoriedade ou importância está estruturadamente comprovada. O texto original longo não é revarrido nesta etapa, evitando que palavras incidentais alterem a classificação já extraída. A proveniência distingue requisito explícito, inferência de título/descrição, contexto classificatório e inferência de ontologia.

Transferibilidade é semântica e explícita. GitHub Actions sustenta experiência transferível de CI/CD/GitLab CI; AWS e Azure são fundações cloud transferíveis, sem equivalência exata; Terraform sustenta IaC; Docker é uma fundação aprendível para Kubernetes. Terraform e Ansible não são equivalentes. Search Intent e alinhamento de família podem remover uma contradição de contexto, mas nunca criam evidência do candidato. Ausência de evidência continua ausência, nunca experiência inventada.

## Explicação da decisão

`primaryDecisionReason` registra a causa que efetivamente escolheu a disposição. `supportingReasons` contém apenas contexto auxiliar. `decisionExplanation` oferece códigos estruturados, resumo humano e contagem de gaps por materialidade. Assim, uma vaga `STRETCH` informa se a causa foi requisito material ou distância de senioridade, sem despejar texto bruto do anúncio nem confundir família adjacente com gatilho automático.

## Família, senioridade e frescor

Family fit distingue alinhamento primário, secundário, adjacente, não relacionado e desconhecido. Uma família secundária BACKEND pode resgatar um anúncio primariamente FULLSTACK. Estágio de software pode usar sinais reais de backend/DevOps. Sinais ocupacionais negativos de recrutamento, vendas, business development e laboratório clínico permanecem bloqueadores defensivos.

Estágio e júnior são compatíveis com o alvo atual. Pleno fica em revisão/stretch; senior/staff/principal/lead/manager/director é bloqueado. Anos explícitos fortes (5+, 7+, 8+) também bloqueiam o alvo júnior. Ano histórico explícito no anúncio tem precedência sobre `firstSeenAt` recente.

## Consumidores

- `/api/opportunities` e o workspace expõem `decision` junto dos scores crus.
- Hoje usa somente `decision.visibility.today`; um PreMatch incompatível não é promovido por prioridade alta.
- Oportunidades mantém Descobrir, Prioridade, Todas, Empresas e Histórico e adiciona Recomendadas, Vale revisar e Stretch.
- O funil mantém os campos legados e reserva contadores de decisão V2 sem reinterpretar os antigos.

Não há migration: a decisão é uma projeção determinística dos dados vigentes. `CAREER_SUBMISSION_ENABLED=false` continua sendo a configuração segura; esta política não cria, preenche, autoriza nem envia candidatura.

# Discovery Relevance R2

## Objetivo e limite

O R2 reduz ruído antes do Matcher V2 sem transformar o Discovery em um segundo matcher. A ordem canônica passa a ser:

`query tier/provenance -> discovery -> normalização -> deduplicação -> PreMatchPlausibility -> Matcher V2 -> prioridade`.

O PreMatch decide somente se a oportunidade é plausível para a intenção da execução. Ele não avalia competências do candidato, não altera Candidate Knowledge, não envia candidatura e não remove o registro canônico.

## Contrato run-scoped

Cada decisão contém `decision`, `reasons`, `score`, família primária/secundárias, geografia, modalidade, escopo remoto, senioridade, tipo de oportunidade, freshness e versão do algoritmo. O relatório do `job_hunt_run` mantém até 1.000 decisões compactas por `jobId`; isso permite explicar por que uma vaga foi ignorada naquela busca sem gravar a decisão globalmente no job.

| Decisão | Efeito |
| --- | --- |
| `PASS` | segue para o Matcher V2 |
| `PASS_WITH_WARNINGS` | segue, mantendo cautela explícita |
| `REVIEW` | segue para preservar recall e aparece como revisão |
| `REJECT` | não consome Matcher nessa execução; a vaga permanece persistida |

Razões determinísticas: vaga encerrada, família, localização ou senioridade incompatível, anúncio antigo, conteúdo que não é vaga e informação insuficiente. UNKNOWN não é convertido em incompatibilidade.

## Queries source-aware

- `TIER_1`: aliases da taxonomia canônica de famílias.
- `TIER_2`: termos específicos ou termos amplos contextualizados por família.
- `TIER_3`: termos amplos crus, executados depois dos tiers mais precisos.

ATS estruturado é listado uma vez por target porque seu endpoint de board não usa a query. JobSpy continua sendo consultado por query e localização. A query, tier, motivo, fonte e família seguem como `provenance.discoveryQuery` até a oportunidade, sem substituir a proveniência do provider.

## Funil R2

Além dos campos legados, o run reporta `normalizedDiscoveries`, `preMatchEvaluated`, `roleMismatch`, `locationMismatch`, `seniorityMismatch`, `stale`, `nonJob` e `passedPreMatch`. `matchEvaluated` é contado somente depois do PreMatch. As contagens são da execução atual e não do estoque histórico.

## Segurança e privacidade

Classificação é local, determinística e bounded. O relatório não contém segredo, payload bruto de WhatsApp, participante, currículo ou Candidate Knowledge. Proveniência de query é limitada em tamanho. Nenhuma capability externa ou autorização foi ampliada.

## Fora do escopo

Source Connection Center V2, novas fontes brasileiras, Candidate Knowledge V3, LinkedIn automatizado, Controlled Submission, Gupy/Workday, Discovery V5 e Matcher V3 permanecem fora deste marco.
# Source Center V2

O mesmo `PreMatchPlausibility` R2 agrega PASS, PASS_WITH_WARNINGS, REVIEW e REJECT por empresa. Volume bruto sem nenhuma vaga plausível é penalizado e não sobe no ranking.

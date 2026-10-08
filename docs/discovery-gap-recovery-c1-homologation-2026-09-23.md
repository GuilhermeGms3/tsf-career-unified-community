# Homologação da Story C1 - 2026-09-23

## Benchmark preservado

O mesmo ground truth de 26 vagas da Story B foi executado sem troca de
referências.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Encontradas automaticamente | 17 | 21 |
| Encontradas por outra origem | 2 | 2 |
| Encontradas no total | 19 | 23 |
| Perdidas | 7 | 3 |
| Cobertura | 73,08% | 88,46% |

- run anterior: `coverage-run-b8496b28-5876-47f2-9123-8dce2d67a9ec`;
- run C1: `coverage-run-f2ba5cb5-61b8-42da-837d-5984b4390c51`;
- `MISSED_PAGINATION`, `MISSED_PROVIDER_LIMIT` e
  `MISSED_PLANNER_BUDGET` caíram para zero;
- as três perdas restantes são LinkedIn Posts manual, Catho não implementada e
  InfoJobs não implementada, deliberadamente fora do escopo C1.

## Quatro gaps comprovados

| Referência | Causa anterior | Resultado C1 |
| --- | --- | --- |
| Remotar 163927 | `MISSED_PAGINATION` | `FOUND_BUT_FILTERED`, posição 19 |
| Remotar 163914 | `MISSED_PAGINATION` | `FOUND_BUT_FILTERED`, posição 83 |
| Nerdin 99059 | `MISSED_PROVIDER_LIMIT` | `FOUND_BUT_FILTERED`, posição 191 |
| Nerdin 99058 | `MISSED_PLANNER_BUDGET` | `FOUND_BUT_FILTERED`, posição 353 |

As quatro vagas possuem vaga canônica e proveniência automática. A
classificação final não foi forçada para `FOUND_AUTOMATICALLY`: os filtros e o
ranking atuais continuam preservados para a Story seguinte.

## Evidência operacional

### Remotar

- `Suporte Cliente Junior`: 2 páginas e 97 registros examinados;
- `DevOps SRE Senior`: 1 página e 31 registros examinados;
- total da homologação: 3 páginas e 128 registros;
- nenhuma resposta de rate limit;
- cada referência foi persistida uma única vez.

### Nerdin

- 790 URLs candidatas no catálogo observado;
- 180 URLs únicas confirmadas no checkpoint;
- 610 URLs ainda pendentes após a busca dirigida de QA Lead;
- orçamento mantido em 30 URLs por execução;
- a busca dirigida processou 30 URLs em 5,454 s;
- o endpoint completo respondeu em 154,122 s por latência posterior à consulta
  do provider. Essa latência não foi corrigida no C1.

Durante a homologação foi detectado e corrigido um salto de cursor: seleção
prioritária e varredura sequencial compartilhavam um avanço baseado na
quantidade escolhida, embora nem todas as posições tivessem sido examinadas.
O cursor agora usa a ordem estável do sitemap, e o score afeta somente a fila
prioritária.

### Planner

- 3 famílias x 2 geografias = 6 combinações;
- ciclo completo em 6 rodadas;
- 1 requisição por rodada, preservando `maxRequests=1`;
- cada combinação foi executada exatamente uma vez;
- a sexta rodada registrou `completedCycles=1`, cursor 0 e nenhuma combinação
  restante.

As seis rodadas reconciliaram 51 observações repetidas no pipeline canônico.
Não surgiu duplicação dos quatro alvos: cada `provider_job_id` possui um único
registro.

## Restart

Após reconstrução e restart do container:

- Nerdin preservou cursor 157, ciclo 0 e 610 URLs restantes;
- Remotar preservou os dois checkpoints no ciclo 1;
- planner preservou rodada 6, cursor 0 e as seis contagens unitárias;
- os quatro alvos permaneceram únicos;
- app e engine voltaram saudáveis.

Nenhuma candidatura externa, login, preenchimento ou envio foi executado.

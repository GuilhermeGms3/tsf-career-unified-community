# Coverage Benchmark

O Coverage Benchmark responde se uma vaga de referência conhecida pelo usuário
foi encontrada pelo discovery e, quando não foi, qual causa pode ser comprovada
pelos dados persistidos. Ele não estima chance de contratação e não altera
matcher, ranking, providers ou orçamento de busca.

## Uso

Abra `Laboratório de qualidade -> Coverage Benchmark` ou acesse
`/quality-lab?section=coverage`.

1. Cadastre uma URL individual ou importe uma lista de URLs, CSV ou JSON.
2. Informe cargo, empresa, fonte, localização e modalidade quando conhecidos.
3. Use `Por que o TSF não encontrou esta vaga?` para uma análise pontual.
4. Execute `Rodar benchmark` para gravar um snapshot imutável das classificações.
5. Em referências não encontradas, use `Importar e analisar` para passar pelo
   pipeline canônico de normalização, deduplicação, validação, matching e ranking.

CSV aceita os campos `url`, `cargo`, `empresa`, `fonte`, `localizacao`,
`modalidade`, `data`, `interesse`, `observacoes`, `pagina` e `posicao`. JSON
aceita os mesmos campos em português ou os nomes da API.

## Classificação

Cada referência recebe exatamente um estado principal:

- `FOUND_AUTOMATICALLY`: encontrada pela superfície declarada.
- `FOUND_BY_OTHER_SOURCE`: a identidade foi encontrada por outra superfície.
- `FOUND_BUT_FILTERED`: encontrada, mas retirada da fila pela política.
- `FOUND_BUT_RANKED_LOW`: encontrada abaixo da posição 25.
- `MISSED_QUERY`: as consultas executadas não cobriram o cargo de referência.
- `MISSED_PLANNER_BUDGET`: a combinação de família e geografia não coube no orçamento.
- `MISSED_PAGINATION`: a vaga estava em página posterior à consultada.
- `MISSED_PROVIDER_LIMIT`: a posição conhecida excedeu o limite observado.
- `MISSED_PARSER`: houve itens brutos, mas nenhum item parseado.
- `MISSED_LOCATION`: existe evidência explícita de descarte geográfico.
- `MISSED_DEDUPLICATION`: existe equivalente semântico sem vínculo da URL.
- `MISSED_SOURCE`: a superfície é deliberadamente manual.
- `SOURCE_BLOCKED`: a consulta foi bloqueada.
- `SOURCE_NOT_CONFIGURED`: a fonte depende de configuração ausente.
- `SOURCE_NOT_IMPLEMENTED`: não existe discovery para a superfície.
- `UNKNOWN`: os registros não provam uma causa específica.

As causas de paginação e limite requerem `pagina` ou `posicao` conhecida na
referência e telemetria compatível da fonte. O sistema não infere esses estados
somente porque uma vaga está ausente.

## Evidência e histórico

O diagnóstico consulta URL canônica, possíveis duplicatas, proveniência,
execuções de discovery e Job Hunt, queries, planner, paginação, limites,
parsing, filtros, localização, deduplicação e ranking. A resposta inclui uma
timeline legível e evidências estruturadas.

Uma execução de benchmark grava os itens e o resumo de forma append-only. O
dashboard atual pode mudar à medida que novas vagas são descobertas; o snapshot
histórico da execução permanece reproduzível.

Importações manuais usam `MANUAL_IMPORT`, preservam a URL original e não criam
observações de Source Health. Texto de LinkedIn Post pode fornecer empresa,
cargo, localização, descrição, link externo e contato quando esses dados
estiverem explícitos; não há crawling autenticado do LinkedIn.

## API

- `GET /api/coverage-benchmark`
- `POST /api/coverage-benchmark/references`
- `POST /api/coverage-benchmark/import`
- `POST /api/coverage-benchmark/diagnose`
- `POST /api/coverage-benchmark/runs`
- `POST /api/coverage-benchmark/references/:id/import`

## Evolução após a Story B

A Story C1 usa o mesmo ground truth para medir a recuperação das perdas por
paginação, limite e planner. A implementação está documentada em
`docs/discovery-gap-recovery-c1.md`. Providers adicionais, crawling autenticado
e mudanças no matcher continuam fora do escopo.

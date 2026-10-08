# Benchmark de relevância R2

## Dataset

O replay usa 20 anúncios sanitizados em `tests/fixtures/discovery/relevance-r1.json`: dez derivados das falhas observadas na homologação R1 e dez regressões de fronteira. Empresas e URLs são fictícias; não há PII, segredo, corpo de WhatsApp ou currículo.

Esta amostra é um regression benchmark pequeno, não um estudo estatístico representativo do mercado. Seu objetivo é impedir o retorno dos falsos positivos conhecidos e preservar exemplos relevantes.

## Resultado reproduzível

Execute `npm run discovery:relevance:validate`.

| Métrica | Baseline R1 | R2 |
| --- | ---: | ---: |
| Precision@5 | 0,4000 | 1,0000 |
| Precision@10 | 0,4000 | 0,7000 |
| Recall | 1,0000 | 1,0000 |
| nDCG@5 | 0,2672 | 0,9763 |
| nDCG@10 | 0,3873 | 0,9795 |
| False-positive rate | 0,4167 | 0,0000 |
| False-negative rate | 0,0000 | 0,0000 |

As quatro dimensões anotadas — família, localização, senioridade e freshness — atingem 1,0 nessa fixture. O gate exige Precision@5 >= 0,8, recall sem regressão, nDCG@10 maior e redução da taxa de falsos positivos.

## Shadow e busca real limitada

O shadow read-only sobre 701 oportunidades já persistidas classificou 7 como `PASS`, 9 como `PASS_WITH_WARNINGS`, 146 como `REVIEW` e 539 como `REJECT`. O estoque inclui duplicatas e scores históricos; o shadow não altera esses registros.

A homologação externa limitada consultou um board Ashby público da TELUS Digital uma única vez. O adapter recebeu 50 itens e, após a correção da URL canônica de candidatura, preservou 50 oportunidades distintas. A primeira execução ainda deixou quatro itens seguirem ao Matcher; a auditoria revelou geografia norte-americana compacta e cargos comerciais. Esses casos viraram regressões antes do gate final.

O replay final do mesmo run (`npm run discovery:relevance:shadow -- --run-id <id>`) classificou os 50 itens como `REJECT`: 34 por localização, 11 por família, 38 por senioridade e 1 por freshness, com razões acumuláveis. Portanto, esse board não produziu top 10 relevante para o intent avaliado; promover dez itens só para preencher um ranking seria um falso resultado.

Uma consulta JobSpy limitada também foi tentada, mas terminou em `ENGINE_TIMEOUT` e zero item bruto. A falha foi mantida explícita, sem fallback silencioso. Brave/Public Web não foi executado porque `BRAVE_SEARCH_API_KEY` não estava configurada.

## Limitações

O benchmark não calibra probabilidade, não mede fairness e não substitui auditoria humana de resultados reais. Mudanças futuras na taxonomia exigem ampliar a fixture com positivos e negativos reais sanitizados antes de alterar os thresholds.

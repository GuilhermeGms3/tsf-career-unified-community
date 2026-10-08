# Homologação inicial do Coverage Benchmark

Snapshot executado em 23/09/2026 sobre 26 vagas públicas reais. Este documento
registra o estado daquele benchmark; os números do dashboard podem mudar com
novas descobertas, decisões, filtros e alterações no ranking.

## Resultado

1. Ground truth: **26 vagas**.
2. Encontradas automaticamente: **17**. Destas, 2 permaneceram no estado
   `FOUND_AUTOMATICALLY`, 6 foram filtradas e 9 ficaram abaixo da posição 25.
3. `coverage_rate`: **73,08%** (19 de 26).
4. Encontradas por outra fonte: **2**.
5. Perdidas: **7**.
6. Motivos: paginação 2, source não implementada 2, planner budget 1, limite do
   provider 1 e fonte somente manual 1.
7. Maior perda absoluta: empate entre Nerdin e Remotar, com 2 referências cada.
8. Paginação: **sim**, duas vagas reais da página 2 do Remotar.
9. Provider limit: **sim**, uma URL na posição 31 do sitemap Nerdin, após o cap 30.
10. Planner budget: **sim**, uma combinação `INFRASTRUCTURE:LOCAL_DF` permaneceu
    fora da rodada com budget efetivo 1.
11. Parsing: **não houve perda comprovada por parsing** nesta amostra.
12. Encontrada mas filtrada: **sim, 6**.
13. Encontrada mas mal ranqueada: **sim, 9**.
14. Importação manual: **sim**. Duas referências entraram no pipeline canônico
    com proveniência `MANUAL_IMPORT`.
15. LinkedIn Posts: **sim**, por URL e texto público, sem crawling autenticado.
16. O diagnóstico é reproduzível: **sim**. A execução e seus itens são
    append-only e guardam status, evidência e timeline.

`duplicate_rate` e `invalid_job_rate` ficaram em 0%. O `top_10_recall` e o
`top_25_recall` foram 10,53% no snapshot final; imports
manuais são excluídos do recall de descoberta.

## Casos A-F

| Caso | Referência real | Resultado e evidência |
| --- | --- | --- |
| A | Nerdin, Analista de Operações de Segurança Júnior | `FOUND_AUTOMATICALLY`; URL canônica e proveniência Nerdin persistidas; posição 6. |
| B | Página InHire da Vitru Educação | `FOUND_BY_OTHER_SOURCE`; a identidade havia sido descoberta via Remotar. |
| C | Remotar 163914; Nerdin 99059; Nerdin 99058 | `MISSED_PAGINATION`, `MISSED_PROVIDER_LIMIT` e `MISSED_PLANNER_BUDGET`, respectivamente. |
| D | Catho 238107254 e InfoJobs 11852782 | `SOURCE_NOT_IMPLEMENTED`, de acordo com Source Authority. |
| E | InfoJobs, Analista de Suporte N3 | Importada, normalizada, deduplicada, avaliada e ranqueada com `MANUAL_IMPORT`. |
| F | LinkedIn Post da Telebit Brasil | Cargo, empresa, localização, descrição e e-mail extraídos do texto; importado pelo mesmo pipeline. |

## Limites observados

- O dashboard frio levou aproximadamente 9,8 segundos com 26 referências,
  porque cada leitura reconstrói o contexto atual de oportunidades e ranking.
- O benchmark mede cobertura de descoberta, não qualidade profissional nem
  chance de contratação.
- A Story não corrige paginação, limite de provider, orçamento do planner,
  providers ausentes ou decisões de matcher/ranking.

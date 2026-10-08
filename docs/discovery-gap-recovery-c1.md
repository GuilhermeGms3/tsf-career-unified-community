# Discovery Gap Recovery C1

A Story C1 recupera apenas perdas de discovery comprovadas pelo Coverage
Benchmark. Ela não adiciona providers nem altera matcher, ranking, currículo,
AutoApply ou WhatsApp.

## Continuação persistida

A migration `034_discovery_provider_checkpoints.sql` mantém cursores por
provider e escopo. O checkpoint é confirmado somente depois que o
`DiscoveryService` persiste os resultados no pipeline canônico. Se o processo
for interrompido antes disso, a página ou URL pode ser lida novamente e será
deduplicada, em vez de ser silenciosamente perdida.

### Remotar

- percorre duas páginas por execução por padrão;
- aceita de uma a cinco páginas com `CAREER_REMOTAR_PAGES_PER_RUN`;
- aguarda 250 ms entre páginas por padrão, configurável por
  `CAREER_REMOTAR_PAGE_DELAY_MS`;
- mantém cursor separado por consulta;
- remove IDs repetidos entre páginas;
- para ao receber página vazia, sem IDs novos ou ao chegar à última página;
- em rate limit parcial, mantém o cursor na página que falhou.

### Nerdin

- preserva prioridade das URLs relacionadas à consulta;
- mantém a ordem estável do sitemap para o cursor e usa score somente na fila
  prioritária, evitando saltos quando a consulta muda;
- processa até 30 URLs por execução por padrão, configurável entre 1 e 60 por
  `CAREER_NERDIN_URLS_PER_RUN`;
- usa URL e `lastmod` como fingerprint;
- não reabre URL inalterada já confirmada;
- mantém cursor global do catálogo e continua por URLs ainda não processadas;
- inclui URLs sem match textual depois das prioritárias para atingir cobertura
  eventual do conjunto elegível.

## Planner

O planner mantém `maxRequests` e a rotação persistida existente. O relatório
agora expõe `plannedCombinations`, `executedCombinations`,
`deferredCombinations` e `cycleProgress`. Com três famílias, duas geografias e
`maxRequests=1`, um ciclo completo exige seis rodadas.

## Source Health

As observações append-only incluem:

- Remotar: `pagesScanned`, `recordsExamined`, total disponível e checkpoint;
- Nerdin: `candidateUrls`, `processedUrls`, `remainingUrls` e checkpoint;
- rate limit comprovado, quando ocorrer.

O relatório de Job Hunt guarda o progresso do ciclo do planner. Leituras da
Central de Fontes não executam consultas externas.

## Limites preservados

Catho e InfoJobs continuam sem discovery implementado. LinkedIn Posts continua
manual. Nenhum peso, threshold ou fórmula de ranking foi alterado. Nenhuma
candidatura é criada ou enviada por este fluxo.

## Homologação

Os resultados reais da Story C1 estão registrados em
`discovery-gap-recovery-c1-homologation-2026-09-23.md`. O mesmo ground truth
de 26 referências passou de 73,08% para 88,46% de cobertura.

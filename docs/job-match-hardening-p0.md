# Hardening P0 de Discovery e Job Matching

## Escopo

Esta rodada endurece a entrada textual, a extração de requisitos, a confiança do score, a apresentação do resultado, a qualidade por provider e a infraestrutura de benchmark. Elegibilidade, bloqueios, revisão humana e segurança de candidatura continuam com seus contratos anteriores.

## Texto canônico e seções

`normalizeJobDescription` converte HTML em texto estruturado antes da extração. Títulos viram linhas terminadas em dois-pontos; itens de lista, parágrafos e quebras mantêm fronteiras. Scripts, estilos, comentários e tags restantes são removidos, e entidades HTML comuns são decodificadas.

O extrator usa estados explícitos:

- `REQUIRED`: requisitos obrigatórios;
- `PREFERRED`: diferenciais;
- `CONTEXT`: responsabilidades e contexto, sem herdar obrigatoriedade;
- `IGNORE`: benefícios, apresentação da empresa e conteúdo não avaliável;
- `UNSPECIFIED`: texto fora de seção reconhecida.

Cada heading reconhecido substitui o estado anterior. Skills conhecidas têm precedência sobre o fallback genérico, evitando requisitos duplicados e nomes contaminados por gramática.

## Score calibrado

O match conhecido usa somente dimensões independentes avaliadas. `hardRequirements` permanece disponível para diagnóstico e elegibilidade, mas não entra novamente na média geral.

O score exibido é calibrado em direção ao ponto neutro 50 quando a evidência é incompleta:

```text
reliability = sqrt(coverage * confidence)
calibrated = 50 + (knownEvidenceMatch - 50) * reliability
```

`coverage` e `confidence` entram como valores entre 0 e 1. A confiança considera cobertura, qualidade da evidência conhecida e proporção de obrigatórios `UNKNOWN`. A UI apresenta separadamente:

- compatibilidade estimada calibrada;
- match conhecido;
- cobertura de evidências;
- confiança numérica e faixa `LOW`, `MEDIUM` ou `HIGH`.

Cobertura abaixo de 50% gera aviso explícito. Elegibilidade continua separada e não é um componente do match.

## Qualidade por provider

Uma vaga é analisável quando possui título, fonte identificável, descrição canônica com ao menos 120 caracteres e ao menos um requisito extraível que não seja apenas contexto classificatório. A projeção de leitura reutiliza requisitos persistidos e, quando eles ainda não existem, usa apenas sinais determinísticos leves de qualificação e skills conhecidas; a análise e o benchmark podem executar a extração completa.

Por provider são medidos volume, unicidade, duplicação, disponibilidade de descrição, comprimento médio, localização, data, URL canônica, confirmação de vaga aberta, analisabilidade, cobertura média, baixa cobertura e desatualização. Taxas de sucesso, timeout e erro só são preenchidas quando há tentativas reais registradas.

O score de qualidade semântica pondera analisabilidade, descrição, URL canônica, localização e confirmação de vaga aberta. O ranking combina essa medida com a qualidade do anúncio dentro do peso de qualidade que já existia; ela não substitui match, preferência, frescor ou elegibilidade.

O funil observado é: `FOUND -> UNIQUE -> OPEN_VALID -> ANALYZABLE -> ANALYZED -> RELEVANT -> HIGH_CONFIDENCE_MATCH -> RECOMMENDED -> APPLIED`.

## Benchmark

`npm run benchmark:jobs` coleta de 100 a 300 vagas reais da API local e gera snapshot, arquivo de anotação e relatório. A amostra é determinística e alternada por provider.

Nenhum gold label é inferido pelo sistema. Campos ainda não revisados permanecem `null`, e métricas supervisionadas ficam como `AWAITING_LABELS`. O relatório também distingue análises antigas das que possuem `scoringModelVersion: confidence-calibrated-v1`.

Metas iniciais e o processo de anotação estão em `benchmarks/README.md`.

## Compatibilidade

Os novos campos são aditivos e persistidos dentro de `dimensions.evidenceQuality`, portanto não exigem migration. Leituras antigas recebem fallback para `overallScore`; uma nova análise é necessária para obter calibração real em registros históricos.

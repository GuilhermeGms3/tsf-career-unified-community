# Matcher — confiança e cobertura de evidência

## Três sinais independentes

1. **Technical Match**: média ponderada somente dos requisitos conhecidos. Responde “entre o que foi possível avaliar, qual a aderência?”.
2. **Evidence Coverage**: peso avaliado dividido pelo peso total dos requisitos. Responde “quanto do anúncio possui evidência comparável?”.
3. **Match Confidence**: cobertura penalizada pela participação de requisitos obrigatórios desconhecidos. Responde “quão seguro é agir sobre o Technical Match?”.

O sistema não imputa zero para ausência de evidência. Isso evita afirmar uma lacuna que o candidato nunca negou. Em contrapartida, o `UNKNOWN` permanece visível na cobertura/confiança e um requisito obrigatório desconhecido produz `REVIEW_REQUIRED`.

## Exemplo

Uma vaga exige Linux e Terraform. Linux está comprovado e Terraform está `UNKNOWN`. O Technical Match conhecido pode ser alto, mas Coverage fica abaixo de 100%, Confidence é menor e a oportunidade não tem a mesma aparência de uma avaliação integralmente comprovada. Se Terraform for confirmado, Coverage e Confidence sobem.

## Uso nas decisões

- `consider`: Technical Match, cobertura mínima, confiança mínima, elegibilidade e blockers.
- `prepareResume`: oportunidade já relevante, Technical Match no limiar de preparo, cobertura e confiança suficientes, currículo existente e revisão humana obrigatória.
- `priority`: `OpportunityPriority.score`.
- `notify`: `OpportunityPriority.score`, quiet hours, deduplicação e política outbound.

O score é uma heurística de recuperação/triagem explicável, não uma avaliação psicométrica validada de desempenho profissional. Não deve ser usado para excluir pessoas ou tomar decisão de emprego sem revisão humana e validação apropriada ao uso.

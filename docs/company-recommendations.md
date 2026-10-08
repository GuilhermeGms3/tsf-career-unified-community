# Recomendações de empresas

A autoridade é `KNOWN_TARGETS_AND_PERSISTED_PROVENANCE`. Cada grupo provider+empresa é avaliado pelo `PreMatchPlausibility` R2 contra o Search Intent ativo.

O ranking usa evidência operacional, não volume bruto: PASS vale 12, PASS com alertas 7, REVIEW 2 e REJECT penaliza 2. Assim, uma fonte com 50 vagas e zero plausíveis fica abaixo de uma empresa com 8 vagas, quatro PASS e uma com alertas. A interface mostra contagens e uma justificativa, não um “match percentual” enganoso.

Isso é pré-seleção de onde procurar, não Matcher V3, recomendação científica universal nem garantia de vaga adequada. Resultados dependem da cobertura real das vagas persistidas e da qualidade do Search Intent.

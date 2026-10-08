# Matcher V2 — semântica de evidência

- `MATCH`: evidência suficiente e alinhada.
- `PARTIAL_MATCH`: evidência real, porém fraca ou parcial.
- `NO_MATCH`: existe evidência negativa ou conflitante.
- `UNKNOWN`: não há evidência suficiente. O item sai do denominador técnico, reduz confiança e pode exigir revisão; não vira zero.

O `overallScore` é o **Technical Match**. `resumeAts` permanece somente como **Document ATS Compatibility**. Sem currículo, seu estado é `NOT_EVALUATED`.
# Atualização V4.1.1

Technical Match, Evidence Coverage e Match Confidence são sinais separados. `UNKNOWN` obrigatório continua com score nulo, reduz cobertura/confiança e força `REVIEW_REQUIRED`. A especificação detalhada está em `matcher-confidence-and-coverage.md`.
# Limite do PreMatch R2

PreMatchPlausibility é um filtro de plausibilidade da oportunidade para a intenção e ocorre antes deste matcher. Ele não usa Candidate Knowledge para elevar família, não altera os estados `MATCH/PARTIAL_MATCH/NO_MATCH/UNKNOWN` e não compõe Technical Match, Evidence Coverage ou Confidence.

# Candidate Knowledge V3

Evidência do grafo tem prioridade sobre menção plana. Contexto profissional com depth de produção/entrega é mais forte que curso, lab ou awareness; a metadata de cada resultado preserva evidence ID, entidade, contexto, depth, verificação e reuso. Múltiplas evidências não são colapsadas pelo texto. Negativa confirmada pode gerar `NO_MATCH`; nenhuma evidência continua `UNKNOWN`.

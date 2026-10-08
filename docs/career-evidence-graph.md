# Career Evidence Graph

O grafo é relacional e vive no SQLite:

`candidate_facts` → `knowledge_evidence` → `career_entities` → `evidence_claims`.

`candidate_facts` preserva canonical key, taxonomia e compatibilidade V2. Cada `knowledge_evidence` individualiza contexto, uso, atividades, profundidade, datas, verificação, confiança de extração, reuso, origem e eventual sinal negativo. A mesma skill pode estar ligada a várias entidades e contextos; `highestConfirmedDepth`, anos e melhor evidência são derivados, não uma verdade global simplificada.

Consultas do Matcher carregam as evidências em lote por `fact_key`, evitando uma consulta por requisito. Índices cobrem fact, entidade, contexto, verificação, depth, gap e eventos. Evidência negativa explícita pode sustentar `NO_MATCH`; ausência continua `UNKNOWN`.

## Proveniência e auditoria

Origens incluem `USER_ENTERED`, `USER_CONFIRMED`, `RESUME_IMPORTED`, `SYSTEM_EXTRACTED`, `DOCUMENT_IMPORTED`, `APPLICATION_CONFIRMED`, `PROJECT_IMPORTED` e `LEGACY`. Eventos registram IDs e metadados estruturais, nunca a narrativa integral.

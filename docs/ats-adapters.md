# ATS Application Adapters

`AdapterRegistry` é a autoridade única de capability.

| Adapter | Detect | Inspect | Fill | Validate | Submit |
|---|---:|---:|---:|---:|---:|
| Greenhouse | sim | sim | sim | sim | Controlled Submit V2.1, condicionado aos gates e kill switch |
| Lever | sim | sim | sim | sim | Controlled Submit, condicionado aos gates e kill switch |
| Ashby | sim | sim | sim | sim | Controlled Submit, condicionado aos gates e kill switch |
| SmartRecruiters | sim | sim | sim | sim | Controlled Submit, condicionado aos gates e kill switch |
| Workable | sim | sim | sim | sim | Controlled Submit, condicionado aos gates e kill switch |
| Gupy V1 | sim | sim | sim | sim | manual/não homologado |
| Generic | conservador | sim | sim | sim | proibido |
| Workday | sim | sim | sim, por etapa | sim, por etapa | manual |

Detectar URL não concede permissão para preencher ou enviar. Challenges sempre param o fluxo.

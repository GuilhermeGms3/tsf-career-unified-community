# Discovery V4

O Mass Discovery V4 amplia o Discovery V3 sem criar um motor paralelo.

![Fluxo do Discovery V4](assets/discovery-v4-flow.svg)

```mermaid
flowchart LR
  I[Search Composer] --> B[Query Budget]
  B --> S[ATS e boards]
  B --> W[Public Web API]
  G[WhatsApp group opt-in] --> D[Detector barato]
  M[Captura manual] --> L[OpportunityLead]
  W --> L
  D --> L
  S --> N[Job normalizado]
  L --> R{Fatos suficientes?}
  R -- não --> H[HiringSignal / revisão]
  R -- sim + revisão --> N
  N --> C[Dedup e autoridade]
  C --> K[Candidate Knowledge + Matcher]
```

O resumo de uma execução separa classes solicitadas, operacionais, consultadas, com erro, que exigem configuração e não suportadas. Contagens de funil separam raw, structured, web, community, leads, signals, duplicates, canonical, relevant e priority.

Não há candidatura, outreach, e-mail, mensagem ou submissão automática.

## Correção V4.1

A V4.1 substitui o roteamento genérico por classe e faz Mass Hunt reutilizar o pipeline integral do Job Hunt. Consulte [discovery-v4-1.md](discovery-v4-1.md) e [provider-routing.md](provider-routing.md).

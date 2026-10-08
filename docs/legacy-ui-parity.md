# Consolidação da UI legada

## Módulos removidos

Foram removidos `public/views/autopilot.js`, `candidate-knowledge.js`, `discovery.js`, `opportunities.js`, `sources.js`, `today.js` e `whatsapp.js`. Eles pertenciam ao shell anterior e já não eram alcançáveis pelo bootstrap Experience V2.

## Destinos canônicos

| Legado | Destino atual |
| --- | --- |
| Hoje | `public/features/today/page.js` |
| Oportunidades/Discovery | `public/features/opportunities/page.js` |
| Autopilot/Fontes/WhatsApp | `public/features/autopilot/page.js` |
| Conhecimento | `public/features/knowledge/page.js` |
| Currículos | `public/features/resumes/page.js` |
| Candidaturas | `public/features/applications/page.js` |

Componentes compartilhados continuam em `public/features/shared` e `public/app`. Não há fallback para a UI removida: ausência de capability deve aparecer como estado indisponível, não como link legado.

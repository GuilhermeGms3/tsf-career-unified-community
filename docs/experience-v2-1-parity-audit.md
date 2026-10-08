# Experience V2.1 — auditoria de paridade

## Resultado

A Experience V2.1 consolida as capacidades úteis na arquitetura atual, sem criar uma segunda aplicação. O bootstrap usa exclusivamente `public/features`; os antigos módulos de `public/views` foram removidos depois de confirmar ausência de imports e de deep links dependentes.

| Área | Antes | V2.1 | Autoridade |
| --- | --- | --- | --- |
| Autopilot | editor resumido | Policy Builder, preview e Test Search | `JobHuntService` + Search Intent |
| Fontes | cards e wizard separados | setup, detecção, salvar/testar e busca curta na mesma área | Source Configuration Center |
| Empresas | empresa encontrada confundida com watchlist | “Empresa encontrada” e “Empresa monitorada” são conceitos separados | `CompanyRadarService` |
| ATS de candidatura | labels duplicados no frontend | matriz única do `AdapterRegistry` | `GET /api/experience/application-capabilities` |
| Currículos | versões sem fluxo produtivo completo | importação, revisão compartilhada, render, retry, download e histórico | Resume Document Engine |
| Candidaturas | estados técnicos e heurística temporal | versão exata, perguntas, outcomes, entrevistas e follow-up por evento | Application Engine + `application_events` |
| WhatsApp | pareamento básico | serviços separados, polling controlado, expiração, reconexão e teste opt-in | Evolution Connection Service |

Não foi necessária migration: outcomes, entrevistas, contatos e adiamentos são eventos append-only na tabela existente `application_events`. Nenhum estado anterior foi reclassificado silenciosamente.

## Prova de consolidação

- `public/app/bootstrap.js` importa somente módulos de `public/features`.
- busca estática não encontra imports de `public/views`.
- os testes V2.1 verificam contratos reais, capability ATS, semântica de empresas e follow-up.
- a remoção não altera rotas públicas; deep links continuam resolvidos pelo router atual.

## Fora do escopo

Controlled Submission, auto-apply, bypass de CAPTCHA/MFA, adapters completos de Gupy/Workday e integrações completas de Gmail/Calendar continuam fora deste marco.

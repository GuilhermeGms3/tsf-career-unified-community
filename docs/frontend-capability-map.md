# Frontend Capability Map — Experience V2

Este mapa liga cada superfície da experiência às capacidades reais do backend. Ele é a referência para evitar botões fictícios, pontuações sem proveniência e estados inventados.

| Área                       | Capacidade real                                                 | Contrato/read model                                                                             | Estado na Experience V2                                                    |
| -------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Hoje                       | Caixa determinística de decisões                                | `GET /api/today`                                                                                | Exposta como fila priorizada e painéis de contexto                         |
| Oportunidades              | Listagem persistida, feedback e prioridade                      | `GET /api/opportunities`, `PUT/DELETE /api/opportunities/:id/feedback`                          | Lista paginada no cliente; sem ação obsoleta “Salvar vaga”                 |
| Workspace da oportunidade  | Job, análise, requisitos, currículo, candidatura e proveniência | `GET /api/opportunities/:id/workspace`                                                          | Read model novo, sem duplicar regra de domínio                             |
| Análise                    | Matcher V2, confiança, elegibilidade e evidência                | `POST /api/unified/ats`; repositórios de análise e requisitos                                   | Sinais separados; ausência de análise nunca aparece como 0%                |
| Compatibilidade documental | Extração, seções, estrutura e validações locais                 | `resumeParseability` e artefatos                                                                | Nomeada “Compatibilidade do documento com ATS”; não é score do fornecedor  |
| Recomendação de currículo  | `ResumeSelector` + `ResumeArchetypeSelector`                    | projeção no workspace                                                                           | Exibe base, arquétipo, cobertura e razões                                  |
| Tailoring                  | `ResumeTailor` + `EvidenceGuard`                                | `POST /api/resume-documents/tailor`                                                             | Inicia job e mantém revisão humana obrigatória                             |
| Versões de currículo       | Produção, review, render e artefatos                            | `/api/resume-documents/versions*`                                                               | Biblioteca, versão e downloads reais                                       |
| Candidatura                | Planner, preflight, perguntas e Fill Only                       | `/api/unified/applications/:id/*`                                                               | Traduz estados técnicos; não oferece submit automático                     |
| Workspace da candidatura   | Plano, versão exata, tentativas, uploads e eventos              | `GET /api/experience/applications/:id`                                                          | Abas Resumo, Formulário, Perguntas, Currículo, Tentativas e Linha do tempo |
| Tracking                   | Status, outcomes, entrevistas, contatos e `application_events` | `POST /api/experience/applications/:id/actions`                                                  | Pipeline e timeline; follow-up pós-envio é recomendação, não envio de email |
| Autopilot                  | Policy Builder, preview/teste, fontes, radar, alertas e runs    | `/api/job-hunt/*`, `/api/source-configurations`, `/api/discovery-v3/company-radar`               | Área modular com detalhes técnicos secundários                             |
| WhatsApp                   | Estado Evolution, pareamento e teste                            | `/api/whatsapp/*`                                                                               | Estado humano; credenciais nunca retornam ao browser                       |
| Candidate Knowledge        | Fatos, projeções, confirmação e reuse policy                    | `/api/candidate-knowledge*`                                                                     | Navegação humana; chaves internas e valores sensíveis não são mostrados    |
| Inteligência local         | Configuração, saúde e benchmark Ollama ou LM Studio             | `/api/intelligence/*`                                                                           | Provider local explícito; LLM não controla transições                      |
| Backup e diagnóstico       | Perfil, estado unificado, engine e integrações                  | `/api/profile*`, `/api/unified`, `/api/engine/status`                                           | Em Configurações, com internos em `details`                                |

## Limites deliberados

- Não existe provider-native match para Greenhouse, Gupy, Workday ou outro ATS sem retorno oficial e acessível.
- `Technical Match` é o matcher do Career Unified; `Opportunity Priority` serve somente para ordenação interna.
- Elegibilidade e knockouts não são médias do match.
- `Fill Only` não aciona o botão final. CAPTCHA, MFA e consentimentos sempre pausam o fluxo.
- Email, Calendar, Controlled Auto Submit e adapters completos de Gupy/Workday não fazem parte da Experience V2.

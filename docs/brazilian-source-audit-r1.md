# Auditoria de fontes brasileiras — R1

Data da pesquisa: 2026-08-23. Esta é uma análise de acesso legítimo e prioridade, não autorização para scraping. Termos e interfaces mudam; a implementação futura deve revalidá-los.

## Matriz definitiva da R1

`Sim` em descoberta pública significa que uma pessoa pode ver uma vitrine ou página sem automatizar login; não implica API nem autorização para coleta em massa.

| SOURCE | VALUE_FOR_BRAZIL | PUBLIC_DISCOVERY | PUBLIC_API | PARTNER_API | ACCOUNT_REQUIRED | AUTH_REQUIRED | PUBLIC_PAGE | APPLICATION_SUPPORT | TERMS_CONSTRAINT | CURRENT_CAREER_SUPPORT | RECOMMENDED_IMPLEMENTATION | PRIORITY |
|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| Gupy | Muito alto; ATS dominante | Por tenant/agregador | Não irrestrita | Sim | Para candidatura | API/candidatura | Sim | ATS Gupy | API oficial contratual; sem varredura global presumida | Agregador/canonicalização | Detectar tenant e URL; API só com escopo oficial | P2 |
| Vagas.com.br | Muito alto; generalista | Sim | Não confirmada para candidato | Sim | Sim | Sim | Sim | Portal/ATS | Feeds e APIs são empresariais | Credential/partner required | Public Web permitido; negociar feed | P2 |
| InfoJobs | Muito alto; generalista | Parcial | Não confirmada | Não confirmada | Sim | Sim | Sim | Portal | Sem login scraping; diligência de termos | Credential required | Descoberta pública + handoff manual | P2 |
| Catho | Muito alto; generalista | Limitada | Condicionada | Sim | Sim | Sim | Parcial | Portal | Condições restringem replicação/automação | Auth required | Parceria/API autorizada | P2 |
| CIEE | Muito alto em estágio/aprendiz | Sim, vitrine | Não confirmada | Não confirmada | Para mais vagas/candidatura | Sim | Sim | Portal | Não automatizar sessão do estudante | Não implementado | Adapter público conservador ou Public Web | P1 |
| Nube | Alto em estágio/aprendiz | Sim | Não confirmada | Não confirmada | Provável | Para candidatura | Sim | Portal | Revalidar termos/robots | Não implementado | Public Web e parceria | P3 |
| IEL Carreiras | Alto, regional | Sim | Não confirmada | Não confirmada | Para candidatura | Sim | Sim | Portal IEL | Respeitar regionalização e frequência | Não implementado | Piloto público por UF, começando no DF | P0 |
| 99jobs/Eleven | Alto em estágio/trainee | Sim | Não confirmada | Produto empresarial | Para candidatura | Sim | Sim | Portal/WhatsApp por programa | Sem candidatura massiva | Não implementado | Página pública + parceria para feed | P1 |
| Eureca | Alto em early career | Sim, inclusive deslogado | Não confirmada | Serviço empresarial | Para processo | Sim | Sim | Portal/programa | Não automatizar avaliações | Não implementado | Adapter de discovery público | P0 |
| Trampos | Alto em tech/digital | Sim | Não confirmada | Produto empresarial | Para candidatura | Sim | Sim | Portal | Termos coíbem inscrições massivas | Não implementado | Public Web limitado; handoff manual | P1 |
| GeekHunter | Alto no nicho tech | Sim | Não confirmada | Produto empresarial | Provável | Para candidatura | Sim | Portal | Revalidar termos; sem automação de conta | Não implementado | Public Web/links oficiais | P1 |
| ProgramaThor | Alto no nicho dev | Sim, filtros públicos | Não confirmada | Não confirmada | Para candidatura | Sim | Sim | Portal | Limitar frequência e preservar origem | Não implementado | Adapter público conservador | P0 |
| Remotar | Alto para remoto | Sim | Não confirmada | Não confirmada | Para recursos exclusivos | Parcial | Sim | Redirect/portal | Deduplicar contra ATS original | Não implementado | Public Web + reconciliação por URL original | P1 |
| SINE/Emprega Brasil | Alto e nacional | Perfilada após login | Não confirmada | Governamental/convênios | Sim | gov.br | Institucional | Portal/app/posto | Dados pessoais e acesso autenticado | Não implementado | Handoff autenticado; buscar canal oficial | P2 |
| Portais universitários/IFs | Alto localmente | Sim, páginas/PDFs | Raro | Varia | Varia | Varia | Sim | Email/form/portal | Freshness, LGPD e cauda longa | Manual/Public Web | Domínios curados + revisão humana | P3 |
| Consultorias/staffing | Alto complementar | Varia | Varia | Frequente | Frequente | Frequente | Sim | ATS/portal/email | Política por empresa/ATS | Company Radar parcial | Radar por domínio e adapter ATS detectado | P1 |
| Sólides/Recrutei | Alto como ATS indireto | Por tenant | Não confirmada | Provável | Para candidatura | Sim | Sim | ATS | Revalidar contrato por tenant | Detecção parcial | Detectar/canonicalizar antes de adapter | P0 |

## Matriz detalhada

| Source | Market relevance | Discovery access | Public API | Partner API | Public page | Auth required | Robots/terms constraint | Application method | Difficulty | Expected coverage | Recommended strategy | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Gupy | Muito alta; ATS frequente no Brasil | Boards públicos por empresa e resultados agregados | API oficial existe, com Bearer token | Sim/contratual | Sim, boards e vagas | API sim; candidatura normalmente sim | Não presumir licença para varredura global; respeitar board e contrato | ATS Gupy | Média para discovery; alta para candidatura | Muito alta | Canonicalizar URLs já descobertas; integrar API somente com credencial/escopo legítimo; manter candidatura manual | PARTNER_REQUIRED |
| Vagas.com | Muito alta e generalista | Busca/site e páginas de empresas | Não foi confirmada API pública de candidato | APIs empresariais de feed/publicação/exportação | Sim | Candidatura e recursos completos sim | APIs são orientadas a clientes/parceiros; revisar contrato antes de coletar | ATS/site autenticado | Média/alta | Alta | Public Web e páginas públicas; buscar parceria para feed estruturado | PARTNER_REQUIRED |
| InfoJobs | Muito alta e generalista | Páginas públicas indexáveis e busca do portal | Não confirmada | Não confirmada publicamente | Sim | Candidatura sim | Sem API pública confirmada; revisar robots/termos, sem login scraping | Portal autenticado/redirect | Média/alta | Alta | Public Web para descoberta e handoff manual; diligência legal antes de adapter | LEGAL_REVIEW_REQUIRED |
| Catho | Muito alta e generalista | Portal e páginas públicas limitadas | Há documentação/termos de API, com condições de uso | Sim/contratual | Parcial | Sim para funções centrais | Termos da API restringem replicação/uso automatizado da base | Portal autenticado | Alta | Alta | Parceria/API autorizada ou descoberta por sinais públicos com handoff manual | PARTNER_REQUIRED |
| CIEE | Muito alta para estágio/aprendiz | Vitrine pública com filtros; mais vagas na área logada | Não confirmada | Não confirmada | Sim | Mais oportunidades/candidatura sim | Não automatizar sessão de estudante; revalidar endpoint/termos | Portal autenticado | Média/alta | Alta no early career | Indexar apenas vitrine pública permitida ou Public Web; candidatura manual | AUTH_REQUIRED |
| Nube | Alta para estágio/aprendiz | Portal público institucional e oportunidades | Não confirmada | Não confirmada | Parcial | Provável para candidatura/detalhes | Revalidar termos e robots; sem automação de login | Portal autenticado | Média/alta | Alta no early career | Public Web/links oficiais primeiro; avaliar parceria | LEGAL_REVIEW_REQUIRED |
| IEL Carreiras | Alta para estágio, regionalizada por estado | Listagens públicas estruturadas por UF | Não confirmada | Não confirmada | Sim | Candidatura sim | Respeitar regionalização e termos; evitar coleta agressiva | Portal IEL | Média | Média/alta regional | Adapter público somente após revisão; P0 para piloto Brasília/DF se a instância tiver dados | READY_TO_IMPLEMENT |
| 99jobs/Eleven | Alta para estágio, trainee e operações | Busca e listagens públicas | Não confirmada | Produto empresarial/ATS | Sim | Candidatura sim | Termos governam conteúdo e mensagens; sem candidatura massiva | Portal/ATS/WhatsApp conforme programa | Média | Alta em programas | Public Web/página pública; parceria para integração estável | PUBLIC_WEB_DISCOVERABLE |
| Eureca | Alta para estágio/trainee/aprendiz | Listagem declaradamente aberta, inclusive deslogada | Não confirmada | Serviço empresarial | Sim | Candidatura/processo pode exigir | Não automatizar avaliações/processos; revalidar termos | Portal/programa | Média | Alta no early career | Adapter de discovery público após revisão; handoff manual para candidatura | READY_TO_IMPLEMENT |
| Trampos | Média/alta para digital, comunicação e tecnologia | Listagem pública | Não confirmada | Produto empresarial | Sim | Candidatura sim | Termos reservam bloqueio de inscrições massivas | Portal | Média | Média | Public Web/discovery limitada; nunca mass-apply | PUBLIC_WEB_DISCOVERABLE |
| GeekHunter | Alta no nicho tech | Vagas públicas visíveis | Não confirmada | Plataforma de recrutamento empresarial | Sim | Recursos/candidatura podem exigir | Revalidar termos; não automatizar conta | Portal especializado | Média | Média/alta em tech | Public Web e links públicos; candidatura manual | PUBLIC_WEB_DISCOVERABLE |
| ProgramaThor | Média no nicho dev | Busca pública com filtros e detalhes | Não confirmada | Não confirmada | Sim | Candidatura/recursos podem exigir | Revalidar termos/robots e limitar frequência | Portal especializado | Baixa/média | Média em dev | Adapter público conservador ou Public Web, após revisão | READY_TO_IMPLEMENT |
| Remotar | Média/alta para remoto | Páginas públicas que agregam origem (Gupy, Sólides, Recrutei etc.) | Não confirmada | Não confirmada | Sim | Vagas exclusivas/recursos exigem cadastro | Preservar fonte original e evitar dupla contagem; revalidar termos | Redirect/portal | Média | Média/alta remoto | Public Web + reconciliação pela URL ATS original | PUBLIC_WEB_DISCOVERABLE |
| Consultorias (Adecco, Randstad, Manpower, Luandre etc.) | Alta, volume distribuído | Sites próprios, páginas públicas e ATS variados | Varia | Frequentemente contratual | Sim | Frequentemente sim | Política por consultoria e ATS; nada de automação autenticada | ATS/portal/email legítimo | Alta pela fragmentação | Alta complementar | Company Radar por domínio/ATS e Public Web; parceria caso a caso | PUBLIC_WEB_DISCOVERABLE |
| Portais universitários e de institutos federais | Alta localmente, cauda longa | Editais, murais, PDFs e páginas públicas | Raro | Varia | Sim | Varia | PDFs podem estar desatualizados; verificar prazo, origem e LGPD | Email/formulário/portal | Média/alta | Média local | Public Web com confiança, freshness e revisão humana; lista curada de domínios | MANUAL_ONLY |
| Sólides/Recrutei e outros ATS brasileiros | Alta como infraestrutura indireta | Career pages e links encontrados em agregadores | Varia/não confirmada para candidato | Provável | Sim em muitos tenants | Candidatura sim | Detectar tenant e canonicalizar antes de qualquer adapter | ATS | Média/alta | Alta incremental | Primeiro detecção/canonicalização; adapter somente com contrato e testes por tenant | READY_TO_IMPLEMENT |

## Evidências públicas principais

- A [Gupy documenta o endpoint Find Jobs](https://developers.gupy.io/reference/findjobs) sob API oficial autenticada; isso não equivale a uma API pública irrestrita para candidatos.
- A área [Vagas.com para desenvolvedores](https://forbusiness.vagas.com.br/developers) descreve integrações empresariais de publicação/feed/exportação.
- O [CIEE mantém vitrine pública](https://portal.ciee.org.br/quero-uma-vaga/estagio/), mas informa que mais oportunidades aparecem na área logada.
- O [IEL Carreiras](https://carreiras.iel.org.br/RN) expõe listagens e filtros públicos regionalizados.
- A [Eureca declara a listagem aberta mesmo sem login](https://intercom.help/eureca_central/pt-BR/articles/15520237-onde-encontrar-as-vagas).
- A [99jobs possui busca pública](https://www.99jobs.com/opportunities/filtered_search?utf8=) e programas de entrada.
- A [Trampos publica vagas](https://trampos.co/vervagas), mas seus [termos](https://trampos.co/legal/termos-uso-condicoes-legais) preveem bloqueio de contas que se inscrevem massivamente.
- A [GeekHunter expõe vagas tech](https://www.geekhunter.com.br/pt), o [ProgramaThor publica busca filtrável](https://programathor.com.br/jobs?accepts_outer_candidates=true) e a [Remotar expõe detalhes e origem](https://remotar.com.br/job/157522/cresol-oficial/desenvolvedor-de-sistemas-or-fullstack-or-java-e-react-or-sistemas-1-or-credito-3-or-cresol-confederacao-%28remoto%29).

## Backlog priorizado

### P0 — acesso público legítimo e ganho imediato

1. IEL Carreiras por UF, iniciando por DF se houver listagem pública real.
2. Eureca para estágio/trainee, com discovery deslogado e candidatura manual.
3. ProgramaThor para tech, com orçamento baixo, cache e respeito aos termos.
4. Detecção/canonicalização de Sólides e Recrutei a partir de URLs já encontradas.

### P1 — alto valor, exige reconciliação e diligência

1. Remotar, preservando a fonte ATS original e eliminando duplicatas.
2. 99jobs, GeekHunter e Trampos via páginas públicas/Public Web.
3. CIEE apenas na vitrine pública, sem automação de sessão.
4. Consultorias selecionadas por Company Radar e ATS detectado.

### P2 — parceria ou contrato

1. Gupy API oficial para discovery por escopo autorizado.
2. Vagas.com APIs empresariais.
3. Catho API/parceria.
4. 99jobs/Eleven e plataformas de estágio para feeds estáveis.

### P3 — manual/Public Web com revisão

1. Portais universitários, editais e PDFs.
2. Sinais sociais públicos de recrutadores.
3. Nube até haver clareza documental de acesso estruturado.

Nenhuma prioridade autoriza login scraping, CAPTCHA/MFA bypass, browser stealth, coleta de cookies ou rotação de proxy.

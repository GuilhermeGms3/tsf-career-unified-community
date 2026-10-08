# Discovery Source Matrix

Esta matriz e a fonte de verdade de suporte do Discovery Engine V2. `SUPPORTED` significa integracao direta implementavel com interface publica documentada. `CONFIG_REQUIRED` exige identidade da empresa ou credencial fornecida pelo usuario. `AGGREGATOR_ONLY` aceita descoberta indireta e canonicalizacao, mas nao automatiza coleta direta. `UNSUPPORTED` permanece desabilitado.

| Provider | Categoria | Base/identidade | Metodo | Auth | Escopo | ID canonico | Limites/observacoes | Application adapter | Status |
|---|---|---|---|---|---|---|---|---|---|
| Indeed | AGGREGATOR | JobSpy | busca do motor Python | nao no Hub | global do agregador | provider id/URL | sujeito ao comportamento do JobSpy | nao | SUPPORTED |
| LinkedIn | AGGREGATOR | JobSpy | busca do motor Python | nao no Hub | global do agregador | provider id/URL direta | API oficial e de parceiros de publicacao, nao usada como busca publica | nao | SUPPORTED |
| Glassdoor | AGGREGATOR | JobSpy | busca do motor Python | nao no Hub | global do agregador | provider id/URL | bloqueado por 403 e localizacao brasileira nao reconhecida na homologacao de 2026-09-16; diagnostico permanece isolado | nao | DEGRADED |
| Google Jobs | AGGREGATOR | JobSpy | busca do motor Python | nao no Hub | resultados do agregador | provider id/URL direta | nao confundir com Cloud Talent Solution de um projeto | nao | SUPPORTED |
| Greenhouse | ATS | `boards-api.greenhouse.io/v1/boards/{board}` | GET Job Board API | publica para GET | board de empresa | board + job id | cache, timeout e budget por board | Controlled Submit limitado | SUPPORTED |
| Lever | ATS | `api.lever.co/v0/postings/{site}` | GET Postings API | publica para GET | site de empresa | site + posting id | somente postings publicados | Controlled Submit limitado | SUPPORTED |
| Ashby | ATS | `api.ashbyhq.com/posting-api/job-board/{name}` | GET Public Job Posting API | publica | job board de empresa | board + job URL/id | `includeCompensation` opcional | Controlled Submit limitado | SUPPORTED |
| Workable | ATS | subdominio/account | GET publico ou SPI v3 | publico/config conforme rota | conta de empresa | account + shortcode | sem pesquisa global | nao | CONFIG_REQUIRED |
| SmartRecruiters | ATS | `api.smartrecruiters.com/v1/companies/{id}/postings` | GET Posting API | publica para postings | company identifier | company + posting id | rate limit/backoff | nao | SUPPORTED |
| Gupy | ATS/BRASIL | tenant/career page ou API v1 | GET legitimo | Bearer na API | tenant/empresa | tenant + job id/URL | nenhuma API global e nenhuma credencial em SQLite | deteccao apenas | CONFIG_REQUIRED |
| InfoJobs | BRASIL | `api.infojobs.net` | API oficial | client id/secret | aplicacao registrada | provider job id | credenciais por ambiente/secret store | nao | CONFIG_REQUIRED |
| Vagas.com.br | BRASIL | feed/API empresarial | feed/publicacao | comercial/config | vagas da empresa cliente | feed id/URL | nao e busca publica global | nao | CONFIG_REQUIRED |
| Catho | BRASIL | portal de desenvolvedores | API empresarial | obrigatoria | recrutador/empresa | provider id/URL | nao e busca publica global | nao | CONFIG_REQUIRED |
| Nerdin | BRASIL | sitemap público + páginas `JobPosting` | sitemap e detalhes públicos | n/a | n/a | ID da vaga, formulário público e URL reconhecidos | Controlled Submit nativo sujeito a gates e confirmação observável | sim | READY |
| ProgramaThor | BRASIL | pagina publica | somente reconhecimento | n/a | indireto | URL canonica | API/feed oficial permitido nao verificado | nao | AGGREGATOR_ONLY |
| GeekHunter | BRASIL | pagina publica | nenhuma coleta automatica | n/a | n/a | URL reconhecida | termos vedam bots/scraping sem autorizacao | nao | UNSUPPORTED |
| Remotar | BRASIL | catálogo público `api.remotar.com.br/jobs` | GET público | n/a | busca global remota | ID da vaga + URL canônica | endpoint operacional sem contrato público de developer API | link externo para ATS original | READY |

## Referencias oficiais

- Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html
- Lever Postings API: https://github.com/lever/postings-api
- Ashby Public Job Posting API: https://developers.ashbyhq.com/docs/public-job-posting-api
- Workable Recruiting API: https://help.workable.com/hc/en-us/articles/115012771647-Workable-Recruiting-API
- SmartRecruiters Posting API: https://developers.smartrecruiters.com/docs/posting-api
- Gupy Developer Hub: https://developers.gupy.io/
- InfoJobs Developers: https://developer.infojobs.net/
- LinkedIn Job Posting API: https://learn.microsoft.com/linkedin/talent/job-postings/api/create-jobs
- JobSpy: https://github.com/speedyapply/JobSpy

As fontes sem interface direta confirmada ficam desabilitadas por padrao. A matriz nao autoriza contornar termos, login, CAPTCHA, rate limit ou controles anti-automacao.

No V4, Brave Search API é o provider oficial de `PUBLIC_WEB`; Bing Search legado foi descartado por retirada oficial. LinkedIn permanece `MANUAL_ONLY`, sem scraping. `COMMUNITY_WHATSAPP_GROUP` exige Evolution configurada e allowlist. Desde Brazilian Sources P0, `INTERNSHIP_PORTAL` possui o adapter público do IEL; `CONSULTANCY_STAFFING` continua sem adapter.

## Brazilian Sources P0

| Provider | Classe | Modo | Discovery | Candidatura |
|---|---|---|---|---|
| IEL | `INTERNSHIP_PORTAL` | `PUBLIC_FEED` | sitemap + `JobPosting`, regional por UF | link-out `CAREER_PAGE` |
| ProgramaThor | `JOB_BOARD` | `PUBLIC_FEED` | sitemap + `JobPosting` | link-out `CAREER_PAGE` |
| Sólides | `JOB_BOARD` | `PUBLIC_API` operacional | endpoint público do portal | link-out `CAREER_PAGE`/URL externa |
| Recrutei | `JOB_BOARD` | `PUBLIC_FEED` | sitemap + `JobPosting`; nenhuma chamada a `/api/` | link-out `CAREER_PAGE` |
| Nerdin | `JOB_BOARD` | `PUBLIC_FEED` | sitemap + `JobPosting` | formulário nativo em três etapas ou ATS externo resolvido |
| Remotar | `JOB_BOARD` | `PUBLIC_API` operacional | catálogo público com busca textual | link-out para o ATS original |
| Eureca | `INTERNSHIP_PORTAL` | `PUBLIC_WEB_DISCOVERABLE` | sem catálogo/feed atual comprovado | `MANUAL_ONLY` |

Os providers P0 são selecionáveis individualmente e nunca vêm marcados por default. Detalhes completos da diligência estão em `docs/brazilian-sources-p0-preflight.md`.

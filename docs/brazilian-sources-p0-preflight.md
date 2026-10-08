# Brazilian Sources P0 — preflight

Auditoria executada em 23/08/2026 antes da implementação. O escopo é somente descoberta pública, sem login, candidatura, envio de currículo ou contorno de proteção. `robots.txt`, sitemaps e páginas públicas foram tratados como limites operacionais; rotas explicitamente bloqueadas não são usadas.

| Source | Discovery access | Public API | Public page | Auth required | Company targeted | Global search | Application method | Legal/terms notes | Proposed strategy | Decision |
|---|---|---:|---:|---:|---:|---:|---|---|---|---|
| IEL | sitemap nacional com URLs regionalizadas + `JobPosting` nas páginas de vaga | não usada | sim | somente para candidatar | não | catálogo nacional regionalizado | `CAREER_PAGE` + evidência de plataforma | `robots.txt` permite páginas e sitemap e bloqueia `/api/`; o adapter nunca chama `/api/` | ler sitemap com budget, selecionar URLs por intenção/UF e normalizar o `JobPosting` público | IMPLEMENT |
| Eureca | site institucional e páginas públicas de programas/cases; nenhum catálogo atual de oportunidades ou feed de vagas foi encontrado | não comprovada | parcial | varia por programa | não comprovado | não comprovada | `UNKNOWN` | WordPress e sitemap institucional disponíveis; cases históricos não são vagas abertas | manter link-out/captura manual e permitir descoberta pela web pública configurada, sem converter cases, eventos ou cursos em vagas | MANUAL / PUBLIC_WEB_DISCOVERABLE |
| ProgramaThor | sitemap público + páginas de vaga com `JobPosting`; página global pública de vagas | não documentada | sim | somente para candidatura pela plataforma | não | sim | `CAREER_PAGE` + evidência de plataforma | `robots.txt` permite `/jobs` e bloqueia áreas de usuário/empresa/admin | ler sitemap com cache e budget, selecionar vagas por intenção e normalizar o `JobPosting` público | IMPLEMENT |
| Sólides | endpoint JSON público usado pelo portal global + página de vaga com `JobPosting` | pública operacional, sem contrato de developer API | sim | somente para candidatar | também oferece boards por empresa | sim | `CAREER_PAGE` com evidência de plataforma ou externo conforme URL pública | `robots.txt` permite páginas públicas; nenhum token/cookie é enviado | busca global limitada no endpoint do portal, normalização server-side e URL pública canônica; health check mínimo | IMPLEMENT |
| Recrutei | sitemap de vagas + páginas de vaga com `JobPosting`; portal global público | `/api/` deliberadamente não usada | sim | somente para candidatura | também oferece boards por empresa | sim | `CAREER_PAGE` + evidência de plataforma ou método público indicado | `robots.txt` permite sitemap/páginas, bloqueia `/api/` e parâmetros de busca `q`/`keyword`; o adapter usa apenas o sitemap | ler sitemap de vagas com cache e budget, selecionar URLs por intenção e normalizar o `JobPosting` público | IMPLEMENT |

## Arquitetura preservada

Os adapters entram no `ProviderRegistry`, retornam `normalizeDiscoveryJob`, atravessam `DiscoveryService`, resolução canônica, deduplicação, PreMatch R2, Candidate Knowledge/Matcher e persistência existentes. Não existe um domínio paralelo de vagas.

As fontes são separadas tecnicamente. Sólides e Recrutei têm portais, contratos e estruturas distintas. IEL preserva a UF presente na URL e no `JobPosting`; `DF`, `Distrito Federal` e `Brasília` são normalizados sem apagar a informação original.

## Limites operacionais

- Busca controlada: no máximo os candidatos necessários para o `limit`, com sitemap/API em cache e detalhes em concorrência limitada.
- Apenas `GET`, sem cookies, credenciais ou dados de candidato.
- Timeouts, limite de resposta, redirects seguros e retries limitados vêm de `SafeHttpClient`.
- Conteúdo HTML é convertido para texto antes da persistência; logs e erros não incluem corpos externos nem URLs com query sensível.
- Remoto só recebe escopo Brasil quando a própria fonte declara Brasil; ausência de escopo permanece desconhecida.
- Aplicação continua sendo link-out/manual. Nenhuma ação de candidatura é adicionada neste marco.

## Blocker Eureca

O site oficial atual descreve programas de estágio/trainee e mantém cases, mas a auditoria não encontrou uma listagem atual, sitemap de oportunidades abertas, feed ou API pública sustentável. Um case histórico não é promovido a `Job`. A fonte permanece `MANUAL_ONLY`, com link oficial e possibilidade de `PUBLIC_WEB` quando o Brave estiver configurado.

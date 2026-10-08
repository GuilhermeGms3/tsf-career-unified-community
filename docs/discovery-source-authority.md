# Discovery Source Authority

`src/discovery/source-authority.mjs` is the canonical inventory for discovery sources and surfaces. It does not grant application capabilities. Application inspection and filling remain governed by `src/automation/ats/adapter-registry.mjs`.

## Operational states

- `OPERATIONAL_REAL`: a real query completed in the last seven days and produced at least one valid job.
- `SUCCESS_EMPTY`: a real query completed without an operational error and produced no valid job.
- `DEGRADED`: the latest query failed partially, timed out, or a previously operational observation is stale.
- `BLOCKED`: authentication, challenge, robots, forbidden access, or rate limiting blocked the query.
- `NOT_CONFIGURED`: a required board, credential, pairing, or optional runtime is absent.
- `NOT_IMPLEMENTED`: no direct discovery adapter exists.
- `MANUAL_ONLY`: the current product supports only manual capture or opening the portal.
- `DISABLED`: the surface is explicitly disabled.
- `UNKNOWN`: no real query evidence exists yet.

Provider health probes are configuration diagnostics. They do not produce `OPERATIONAL_REAL`. Only `DiscoveryService` writes real-query observations to `discovery_source_health_history`.

## Inventory

The technical registry contains 18 providers. The canonical catalog contains 30 surfaces because JobSpy is split into LinkedIn Jobs, Indeed, Glassdoor, and Google Jobs, and the catalog also names manual, indirect, optional, evidence, and community surfaces shown by the product.

Greenhouse, Lever, Ashby, SmartRecruiters, Workable, and Gupy are `COMPANY_BOARD` surfaces. They require a known board or company identity and are not global search engines. Gupy discovery reads the public company career page and does not use the authenticated employer API or the candidate session.

Catho, InfoJobs, and Vagas.com do not have direct candidate discovery in this build. LinkedIn Posts, Eureca, GeekHunter, and generic career pages are manual. CIEE, Nube, and CIDE are declared as not implemented. Brave is optional and not configured until its credential is available.

## Persisted evidence

Migration `032_discovery_source_authority.sql` adds append-only `discovery_source_health_history`. Each observation stores query/location, timestamps, raw/parsed/valid/new/duplicate/discarded counts, pages, current result limit, publication range, latency, errors, rate limits, and sample URLs. Updates and deletes are rejected by database triggers.

## Current limits

| Area | Current limit | Origin | Classification | Pagination / continuation | Coverage risk |
| --- | ---: | --- | --- | --- | --- |
| Nerdin | 30 URLs por execução por padrão, configurável entre 1 e 60 | `SitemapJobProvider.search` | orçamento técnico limitado | cursor e fingerprints persistidos avançam por URLs inalteradas; prioridades relacionadas à consulta vêm primeiro | risco decrescente ao longo das execuções |
| IEL, ProgramaThor, Recrutei | at most 30 candidate job URLs per query; returned jobs remain capped by the requested limit, at most 50 | `SitemapJobProvider.search` | technical safety and bounded network work | sitemap is read once; selected job pages are fetched in batches of 3; no continuation after the selected 30 | high when relevant URLs score outside the selected set |
| Remotar | duas páginas por execução por padrão, configurável entre 1 e 5 | `RemotarProvider.search` | orçamento técnico limitado | cursor persistido por consulta, deduplicação entre páginas e retomada após restart | risco decrescente ao longo das execuções |
| Sólides | one API response; at most 50 normalized jobs | `SolidesProvider.search` | provider result cap | no continuation in the adapter | medium to high for broad terms |
| Direct ATS boards | usually at most 50 jobs; Lever request accepts up to 100 but the caller limit still applies | direct ATS providers and discovery input | bounded company-board request | targets are rotated across Mass Hunt rounds; truncated listings never close unseen jobs | medium for very large boards |
| JobSpy portals | 1 to 50 requested results per portal | engine `SearchRequest.results_wanted` | engine safety boundary | pagination is managed internally by JobSpy and not exposed as page-by-page evidence | unknown per portal; the dashboard reports the result limit, not invented page counts |
| Provider test search | at most 3 queries, first 5 providers, 10 jobs per request | `JobHuntService.testSearch` | deliberate small-test safety budget | no continuation | intentionally high; this is not Mass Hunt |
| Source Center “Buscar agora” | at most 20 results | `ProviderTestService.searchNow` | deliberate interactive safety budget | provider-specific | medium; intended as validation, not exhaustive discovery |
| Mass Hunt request | 50 jobs per provider/query request | `JobHuntService.run` | bounded execution | provider-specific | depends on provider pagination and query budget |
| Profile query budget | defaults: 24 queries, 12 queries per provider, 80 requests; configurable within 60/30/240 | `QueryBudgetPolicy` | explicit operational policy | planner rotates combinations across runs | low with default budget, potentially high when reduced |
| Company preview | 20 jobs and one request | `CompanyRecommendationService.previewUrl` | deliberate preview safety budget | none | high; preview is not a full board crawl |

The observed `1/6` profile coverage was caused by `maxRequests = 1`. The planner computes six active family-by-geography combinations, limits the effective query budget to `min(maxQueries, maxRequests)`, executes one, and advances its persisted rotation cursor for later runs. Reports expose planned, executed and deferred combinations plus cycle progress. With the current profile, a complete cycle takes six rounds.

## UI and API

- `GET /api/source-center` includes canonical surfaces, latest observation, and the five most recent observations.
- `GET /api/source-center/health/:surfaceId?limit=20` returns recent persisted history.
- Autopilot > Fontes shows operational state separately from setup state.
- Autopilot > Execuções expands the persisted run report into planned/executed queries, providers, combinations, results, filters, duplicates, and errors.

Story C1 added bounded continuation for Remotar and Nerdin without adding a provider. No external application action or WhatsApp behavior was added.

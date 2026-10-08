# Gupy Application Pipeline + Application Batch

Current integrity contract: [targeted authority/state hardening](targeted-authority-state-hardening.md) adds migration 028, historical attempts after cancellation, repository transition/CAS enforcement and shared local mutation security. The historical validation below describes the original pipeline phase, not the final hardening suite.

## Scope and architecture

Baseline: `cbc1a6d`, clean `main`. Node 24.11.1 host / Node 22 container, ESM, Playwright 1.61.0 and existing SQLite owner lease. Migration 025 is additive. No Python, dependency, policy, threshold, geography, Candidate Knowledge, GitHub, ResumeVersion, tailoring, EvidenceGuard, document renderer, discovery or route-mounting changes.

`ApplicationBatchService` consumes approved Resume Batch outputs. `GupyApplicationAdapter` extends the existing V1 adapter, separating identification, public page parsing, normalized fields, browser policy, filling and final boundary. Generic ApplicationEngine and its legacy capability gates remain unchanged. The preparation adapter contract is `identify`, `configureSession`, `validatePageTarget`, `inspect`, `fillResolved`, `validateResolved`, `controlledSubmit`; only Gupy is provided in this phase. No new Workday, Lever or Ashby adapter.

Drafts are not submitted Applications. They retain job/provider/canonical destination/version/adapter/answers/provenance/schema/readiness. Application materialization happens only on explicit final authorization. Submission reuses the existing consent, preflight, attempt, lock, event and receipt repositories and ControlledSubmissionService.

## Workflow and safety

Opportunities selection or ready Resume Batch outputs → Application Batch → DRY_RUN → answer unresolved questions → FILL_ONLY → READY_TO_SUBMIT. Missing approved PDF redirects to Resume Batch. Different job/version contexts never select the latest global PDF. Resume ID, JOB_SPECIFIC purpose, approved timestamp, READY artifact, content hash, storage boundary and approved EvidenceGuard lineage are checked again before filling/submitting.

States include PREPARATION_REQUIRED, PREPARING, WAITING_USER, READY_TO_FILL, FILLING, FILLED, VALIDATING, READY_TO_SUBMIT, SUBMITTING, SUBMITTED, SUBMISSION_UNCERTAIN, FAILED, BLOCKED and CANCELLED. Per-item failures do not discard ready siblings. Batch membership and work survive navigation/restart. A replacement approved version creates a new contextual draft; earlier history is preserved.

Fields separate semantic meaning from selectors. Resolution priority: explicit application answer → explicitly saved compatible answer → Candidate Profile → reusable Candidate Knowledge → approved version → WAITING_USER. Salary, availability, legal declarations, work authorization and sensitive questions are never inferred. Consent and sensitive answers require confirmation for each application. Only an explicit opt-in saves eligible answers for future applications; semantic identity includes input type/options and narrowly normalized expected-salary aliases. No LLM supplies personal facts.

DRY_RUN does not mutate form controls and blocks non-GET/HEAD browser requests. FILL_ONLY requires exactly one recognized resume upload, known required answers, a supported final boundary, matching schema and validation of visible values. The Gupy adapter can traverse up to five ordinary stages when each stage has one unambiguous next action, every required field is resolved and the DOM signature changes after navigation. It never uses the final submit action while preparing. Unknown/custom components, ambiguous progression, missing upload, repeated stages, challenges or schema drift stop for human review.

Preparation uses the existing BoundedStageWorker, two slots and the primary SQLite connection. Browser sessions are limited to two including held interactive sessions. Runtime defaults follow existing AUTOMATION_HEADLESS: Docker is headless and cannot offer interactive login. Native interactive execution can retain an ephemeral session for human authentication and resume on explicit prepare; no browser cookies, profiles or credentials are imported. Traces and screenshots are not captured by this pipeline. Only Gupy HTTPS hosts are allowed; unsupported third-party resources/authentication remain a limitation, not a bypass target.

## Preparation policy

The Application Batch list exposes a persistent mode, stored in existing app_metadata:

- OFF: default, no automatic work.
- PREPARE_ONLY: every minute, at most 25 already-persisted eligible Gupy jobs with approved versions enter DRY_RUN.
- APPROVAL_REQUIRED: eligible work enters FILL_ONLY, never submit.
- AUTO_SUBMIT_ELIGIBLE: rejected/disabled.

Current Decision Policy eligibility and hard blockers remain authoritative. Repeated ticks reuse contextual drafts/batches. No discovery or GitHub sync is triggered. Manual prepare is not final submission authorization.

## Controlled Submit

Requires production submission flag, explicit selected-item action, READY_TO_SUBMIT, current eligible context, approved job-specific artifact/EvidenceGuard lineage, no duplicate, matching current schema/answers/artifact, healthy final stage, positively open job and no challenge. The server revalidates immediately before transport. Final-click intent is persisted before interacting; absent new visible confirmation results in SUBMISSION_UNCERTAIN, never a blind retry. Receipts carry existing application/version/answer fingerprint plus adapter version and job ID. Runtime stays disabled; all successful and uncertain submission examples are synthetic fixtures.

New HTTP routes accept only local hosts and same-origin JSON mutations. Browser configuration, credentials and arbitrary selectors are not accepted from API callers. UI uses existing cache/SWR, domain-specific invalidation and generation guards; polling only runs while work is active.

## Bounded real validation — 2026-08-27

LinkedIn: query Analista de Suporte, Brasília, remote=false, one requested result. Exactly one provider HTTP request returned one raw/canonical metadata result in 838 ms. One enrichment HTTP request returned HTTP 301; the job remained available. Two LinkedIn HTTP requests total in this phase; no broad discovery. Overall experiment 1,652 ms. Successful enrichment caching and failure preservation passed fixtures; real enrichment cache hit was not established.

Ollama: configured model names empty, configured local endpoint unavailable. Three local gate examples: one deterministic job, one rejection, one ambiguous eligible, zero actual model calls/cache hits/timeouts/invalid outputs/recovered jobs, one unavailable fallback. Real model accuracy was not measured. Existing LinkedIn-focused tests: 21/21.

Recruiter posts: MANUAL_CAPTURE. Official APIs require OAuth and access authorization; no sustainable unauthenticated feed mechanism was established. Existing explicit URL/text capture remains. References: https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access and https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview .

Gupy: one existing opportunity, `job-749f3b93-7a84-46ee-b36a-d8d9b8715eff`, HowBe 12145202, https://howbe.gupy.io/jobs/12145202 . Persisted encoded `/job/…` URL decoded to this identity without creating another Opportunity. The public page parser ran against the real browser DOM: title ANALISTA DE ATIVAÇAO, OPEN, description 1,105 characters, requirements 580, responsibilities 1,568, five public stages. Company/location/work model were not fabricated when absent from parser-supported metadata. The observed application link led to `/candidates/signin`: adapter DRY_RUN detected login and four controls, zero mutations. FILL_ONLY was not attempted against the real site because authentication was required. Two browser navigations; subresource HTTP count was not measured.

## Verification

Reproduce focused coverage with `node --test --test-concurrency=1 tests/application-batch-gupy.test.mjs tests/application-batch-frontend.test.mjs tests/gupy-adapter-v1.test.mjs`. Fixtures exercise safe fill, correct upload, wrong-job/invalid-lineage protection, salary opt-in, idempotency, actual database restart, bounded concurrency, policy modes, flag/approval gates, stale schema, receipt and uncertain final click. Frontend fixtures exercise live mounted-node mutations and widths 390/768/1366. Final complete validation is recorded below after execution.

## Proven limitations

- Real Gupy access stops at AUTH_REQUIRED; live authenticated fill/submit is not homologated.
- Custom Gupy widgets, flows beyond five stages and external-resource dependencies remain deliberately fail-closed. Ordinary multi-step forms are covered only when every intermediate transition is deterministic and independently validated.
- Real configured Ollama model is unavailable; no model benchmark claims.
- LinkedIn description enrichment returned 301 with redirects disabled; no broader redesign in this phase.
- Docker build-cache/resource-layer inefficiency remains technical debt outside this scope.

## Final validation outcome

- Focused representative regression: 85/85. Final dedicated Gupy/UI set: 20/20; legacy Gupy V1 set also passed.
- One complete suite: 796 tests, 793 passed, 3 failed, 200,576.8821 ms. All three failures were obsolete schema-24 expectations in intelligence/document tests. Expectations updated to migration 025; targeted rerun 3/3 passed. No production code changed after the complete run and no second complete suite was run.
- JS syntax: 359 files passed. No Python changed in this phase.
- Live UI smoke: Application Batch → Applications → Application Batch, no console errors; new modes visible with OFF selected. Fixture UI mutations remained on the mounted tree and fit 390/768/1366 widths.
- Docker app rebuilt once, career-engine not rebuilt; both healthy. Tectonic warm-up CACHED; resource clone layer 11.7 s remains existing build debt.
- Runtime schema 25, integrity_check=ok, foreign_key_check empty. Applications, drafts, batch runs, submission attempts, receipts and SUBMITTED all zero. CAREER_SUBMISSION_ENABLED=false, LIVE_INSPECT=false, automatic preparation OFF.
- Pipeline SHA-256 in image equals local source: 27d690ff7e7d844232700e88d8a9fec14786b3ceed55c32bf22bca34a61c435d.
- Diff whitespace check passed. Secret-pattern scan found no credentials in changed source/docs; excludes runtime data and .env by design.

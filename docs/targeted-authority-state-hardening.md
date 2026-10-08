# Candidate authority and application state hardening

Scope: candidate knowledge authority, GitHub support lifecycle, external autofill, application draft identity/state, render infrastructure failure, local submission HTTP security and artifact portability. No discovery/ranking/threshold changes, no dependency upgrades and no enabled real submission.

## Candidate knowledge authority and autofill

`candidate-knowledge-policy.mjs` owns confirmed authority: USER_CONFIRMED > IMPORTED_CONFIRMED > SYSTEM_EXTRACTED. CandidateFactRepository rejects lower-authority replacement even if the caller does not request conflict detection. A differing lower-authority value records the existing REVIEW_REQUIRED conflict instead. GitHub adds contextual graph evidence without replacing confirmed value, source or verification.

Analysis reuse remains ACTIVE + REUSABLE + non-sensitive + non-rejected. This is not authorization to write an external form. Application autofill additionally requires USER_CONFIRMED or IMPORTED_CONFIRMED, a compatible field policy and no explicit-confirmation requirement. SYSTEM_EXTRACTED stays available for analysis/review but never becomes confirmed by inference. Both legacy mapping and the final GenericAdapter write boundary enforce authority; V2 resolution carries that authority through its adapter projection. Sensitive/consent fields require a per-application human answer. An approved file selection retains its separate validated upload contract. Previously persisted KNOWN answers without explicit human provenance cannot bypass the resolver.

## GitHub and profile reconciliation

GitHub projection and archival reconcile the affected canonical skill across the complete active graph, not just the repository being processed. Removing repo A does not deactivate a skill still supported by repo B. With no remaining positive support, only a pure GITHUB/SYSTEM_EXTRACTED fact is archived; confirmed facts and other supporting provenance remain. Evidence/history is not deleted. The Matcher defensive check for unsupported GitHub facts is unchanged.

Existing candidate_fact_history stores actor and snapshot durably. PROFILE_SYNC can restore an archived profile fact only when the latest history entry is an ARCHIVED event by PROFILE_RECONCILIATION and the source remains CANDIDATE_PROFILE. Unknown/older archive provenance, explicit rejection, user archive and LEGACY_READ_ONLY remain conservative. GitHub similarly restores only its own reconciliation archives. No lifecycle-reason migration was needed.

## Draft attempts, idempotency and state

Migration 028 preserves historical identity_key values, backfills canonical_identity_key, and adds attempt_no/state_revision. New operation identity is deterministic: canonical fingerprint + attempt number. Unique indexes enforce one attempt number and one non-cancelled operation per canonical fingerprint. The fingerprint retains job/provider/canonical destination/resume version/adapter version. Creation runs in a BEGIN IMMEDIATE transaction.

An active, waiting, blocked or failed equivalent operation is reused. FAILED/BLOCKED keep the existing explicit retry policy; a submission attempt can retry only after a PRE_ACTION failure. CANCELLED is immutable history; a subsequent creation makes attempt N+1. SUBMITTING, SUBMITTED and SUBMISSION_UNCERTAIN block another automatic operation even across resume/adapter versions for the same provider and canonical destination/job.

`application-draft-state.mjs` is the repository-authoritative graph:

- PREPARING → READY_TO_FILL or FILLING, or a contextual failure/wait/block state.
- FILLING → FILLED → VALIDATING → READY_TO_SUBMIT.
- READY_TO_SUBMIT → SUBMITTING → SUBMITTED / SUBMISSION_UNCERTAIN / WAITING_USER (pre-action failure).
- PREPARATION_REQUIRED / WAITING_USER / BLOCKED / FAILED and ready states support only their declared retry/edit/cancel edges.
- SUBMITTED / SUBMISSION_UNCERTAIN / CANCELLED have no ordinary outgoing edges, including same-state payload mutation.

Transitions use expected status plus state_revision in the UPDATE and check affected rows. Workers carry their revision across awaits; revisions also prevent same-status ABA overwrites. Stale completion reports DRAFT_STATE_CONFLICT. Claims advance revision and owner-scoped release cannot release another worker. Restart recovery is a dedicated operation: interrupted fill returns to PREPARING, interrupted submit becomes SUBMISSION_UNCERTAIN, and terminal states never regress merely because an old lock remains. Uncertain submissions remain blocked until the existing human reconciliation workflow is resolved; no automatic new submit path is introduced.

## Render failure integrity

The complete execution after render-run creation is guarded, including work directory creation, source writing, compiler, validation and artifact registration. Infrastructure failure marks the owned RUNNING run FAILED and changes only its still-RENDERING version when it remains the latest execution. It cannot overwrite READY or a newer run. In-memory slots/locks release through finally; cleanup validates the exact .render-* directory under the artifact root. A failed approved version remains retryable; successful artifacts are not removed. Successful render-run/version persistence is transactional. Existing restart recovery is preserved.

## Gupy capability truth and GitHub permissions

`gupy-capability-truth.mjs` distinguishes legacy V1 (canSubmit=false, READY_TO_SUBMIT_MANUAL) from Application V2 (CONTROLLED_SUBMIT=SUPPORTED_LIMITED). The source catalog projects this to its existing persisted PARTIAL vocabulary; session-required operations project to CREDENTIAL_REQUIRED. Provider readiness projects the same V2 values. Capability never enables the runtime flag or replaces consent, fresh preflight, correct artifact, health and final-stage gates. Real Gupy submission remains unhomologated.

GitHub OAuth still requests only read:user; no repo scope or permission was added. Existing UI says authorized repositories and existing documentation explicitly conditions private access on actual grants, so no UI change was necessary. Connection does not guarantee private-repository coverage.

## Local mutation and artifact security

Both application-batch/draft mutations and /api/applications/:id/submission/* use requireLocalJsonMutation before reading a body or invoking a service. It validates localhost/127.0.0.1/[::1], the actual socket port, matching request URL, exact Origin when present, same-origin/none fetch context and application/json. Absent browser headers are allowed for local internal clients. GET/HEAD/OPTIONS do not receive mutation-only restrictions. This is a local browser/DNS-rebinding boundary, not new login authentication.

Batch filename segments strip separators and unsafe characters, bound length, remove trailing dots/spaces, and prefix Windows reserved basenames (including extensions). Deterministic per-item suffixes remain. ZIP construction additionally rejects absolute paths, traversal, drive syntax, control characters and case-insensitive duplicate entries.

## Reproduction

`node --test --test-concurrency=1 tests/candidate-authority-hardening.test.mjs tests/application-integrity-hardening.test.mjs`

These deterministic tests prove probes A–K using isolated fixture databases and fake form boundaries. Broader affected tests cover real local Playwright forms, approved PDF selection, consent/receipts, batch workers, GitHub evidence integration and existing resume behavior. Production runtime data is never a fixture.

## Final validation — 2026-08-28

- New adversarial regressions: 34/34, also 34/34 in the Node 22 Docker image with `--network none`. Final combined probes/application group: 52/52. Affected legacy autofill/application/resume group: 65/65. Counts overlap and must not be summed.
- Broader affected group: 291/292; the sole missing-Host fixture was corrected to model a real HTTP request and its file passed 2/2.
- First complete suite: 845/849 in 394383.0894 ms. Four failures classified STALE_EXPECTATION: old Gupy capability declaration, direct multiselect and checkbox fixtures lacking authority, and a work-authorization radio relying on profile reuse. Tests now use explicit confirmed answers through the resolver; affected rerun 4/4. No production source changed after that complete run.
- Final complete suite: **849/849**, zero failures/skips, 429794.3554 ms. No further full suite is required for documentation-only updates.
- `npm run check:syntax`: PASS, 375 JS/ESM files; the three subsequently adjusted test files also passed `node --check`. Python unchanged. `git diff --check` passed; changed-file and added-diff secret/path scans found no credentials or new personal paths.
- Fresh database and representative schema-27 upgrade to 28 passed, including preserved cancelled history/batch links, attempt 2, active uniqueness and submitted protection. Both returned integrity_check=ok and zero foreign_key_check violations.
- One Docker app build. Isolated runtime smoke, external network disabled: app HTTP200, malicious Origin HTTP403, SQLite28 integrityok/FK0, applications/receipts0, CAREER_SUBMISSION_ENABLED=false, LIVE_INSPECT=false. Four central source hashes match the host. The persistent user database/Compose stack was not redeployed; no runtime-data migration was performed on the user's database.
- Tectonic warm-up was CACHED. Existing resources clone layer took 10.3s and remains out-of-scope technical debt.
- No real external applications, receipts, form submissions, discovery runs, LinkedIn login/cookie automation, paid APIs, Brave calls or Ollama work. Local synthetic submissions in isolated regression fixtures are not real applications.

# Daily Operations P0

## Objective

The Today screen provides a fast, decisive daily queue without rebuilding the
entire opportunity projection on every request. A manual renewal runs the
existing discovery pipeline, verifies stale prioritized opportunities and
publishes a new persisted inbox snapshot.

## Daily inbox

`GET /api/today` returns the latest persisted snapshot immediately. When the
snapshot is older than 120 seconds, the service serves it and rebuilds in the
background. `GET /api/today?fresh=true` forces a synchronous rebuild for flows
that have just changed a decision.

The decision summary separates:

- up to five opportunities to apply to today;
- up to five opportunities worth reviewing;
- opportunities awaiting availability confirmation;
- opportunities excluded by explicit policy, geography, closure or user
  feedback.

The best opportunity appears only once, at the head of its corresponding lane.

The top command bar keeps the daily actions immediately available: start or
resume Mass Hunt, open the current recommendations, review uncertain matches
and continue pending applications. Starting Mass Hunt opens a non-modal panel
on the right. The panel follows the persisted run, so navigation does not stop
the search, and shows the current stage, source health, discovery counts and up
to six recent canonical opportunities.

The Mass Hunt panel can be minimized instead of dismissed. Its compact launcher
is shared by Today and Opportunities and always reopens the persisted active
run; it is hidden when no run is active and never starts a duplicate run. The
panel can pause the active run while preserving its partial report. If the application restarts during Mass
Hunt, the run is finalized as `PROCESS_INTERRUPTED` and keeps its partial
report. Opportunities History presents recent Mass Hunt funnels and
availability checks separately.

## Daily renewal

`POST /api/today/refresh` starts an asynchronous run and returns its identifier.
`GET /api/today/refresh/:id` exposes its persisted progress. A run has the
following stages: `SEARCHING`, `VERIFYING`, `REBUILDING`, `COMPLETED` or
`FAILED`.

The refresh reuses `JobHuntService` with a `MANUAL` trigger. It then verifies at
most 30 stale, potentially relevant opportunities with concurrency 3. Closed
pages are removed from the actionable queue. Inconclusive checks remain
pending; they are never converted into closure. The final status is `PARTIAL`
when a source fails, a check is inconclusive or stale candidates remain.

`POST /api/opportunities/verify` reuses only the availability and inbox rebuild
stages. It does not start discovery. Its persisted progress is available at
`GET /api/opportunities/verify/:id`; inconclusive responses never close a job.

## Persistence

Migration `030_daily_operations_p0.sql` adds:

- `daily_inbox_snapshots`, the single current Today projection;
- `daily_refresh_runs`, the auditable progress and result of each renewal.

An interrupted `RUNNING` refresh is recovered as `PARTIAL` with
`PROCESS_INTERRUPTED` on startup.

Legacy direct search results, history and portal reports are stored as a small
metadata projection. Updating this projection does not resynchronize every
job, resume, application and analysis or rewrite the complete legacy JSON
file. Canonical discovery data continues to be persisted by the existing
repositories and discovery pipeline.

## Boundaries

- No application is submitted by this flow.
- Existing discovery sources, ranking thresholds and decision policy remain
  authoritative.
- Duplicate grouping first uses normalized company, title and location, then a
  normalized final URL when semantic identity is incomplete.
- Source availability and network limitations remain visible in the run result.

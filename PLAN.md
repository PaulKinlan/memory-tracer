# Plan

Goal: a repeatable loop that, for any URL, produces a list of *actionable*
memory findings — and scales from "demo one site live" to "survey the top
1,000 sites and tell us what the web's most common leaks are."

## What already exists (don't rebuild)

- `chrome-devtools-mcp` exposes the browser: input tools, navigation,
  `take_heapsnapshot` + heap analysis tools (enable with `--memory-debugging`),
  `--isolated`/`--headless` for clean repeatable sessions.
- Its `memory-leak-debugging` skill encodes the methodology: baseline
  snapshot → perform the suspect interaction ~10× to amplify growth → post
  snapshot → revert to original state → final snapshot → analyze with memlab
  (never read raw `.heapsnapshot` files — too large). It also ships a
  `common-leaks.md` pattern reference and a fallback `compare_snapshots.js`.
- Distribution: `/plugin install chrome-devtools-mcp@chrome-devtools-plugins`
  bundles server + skills for Claude Code.

This project is the layer above: test-plan generation, structured output,
batch execution, aggregation, and ground-truth evals.

## Phase 0 — Skeleton (this commit)

- [x] Repo layout, `.mcp.json`, report schema, runner/aggregator stubs.
- [x] Playground with seeded leaks + `expected-findings.json` ground truth.
- [x] `memory-audit` skill draft.

## Phase 1 — Single-URL loop, validated against ground truth

- Run `/memory-audit http://localhost:8080` until it reliably finds **all**
  seeded playground leaks with correct categories, and finds **none** in
  `?mode=fixed`. That false-positive check matters as much as recall.
- Tune: snapshot timing (GC pressure, `queryObjects`/forced GC before
  snapshots), iteration counts, memlab invocation, token budget.
- Decide severity thresholds (KB growth per iteration) empirically from
  playground numbers.
- Exit criteria: 100% recall on playground, 0 findings on fixed mode, report
  validates against `schema/report.schema.json`.

## Phase 2 — Test-plan generation quality

- Recon step: snapshot the page, classify the app (SPA? framework? auth
  wall? cookie banner?), enumerate candidate scenarios:
  - idle baseline (does memory grow doing nothing? timers/analytics)
  - SPA route cycle (nav A → B → A, ×10)
  - open/close overlays (modals, menus, drawers)
  - infinite scroll / list virtualization
  - media play/pause, canvas/webgl views
  - form fill + clear
- Persist plans to `testplans/<host>.json` so they're reviewable, editable,
  and reused on re-runs (plan generation is the expensive/flaky step).
- Validate on 5–10 real sites we know well before going wide.

## Phase 3 — Batch runner over real sites

- Source URLs: HTTP Archive / CrUX (BigQuery, rank ≤ 1000), or Tranco as a
  zero-setup fallback — see `urls/README.md`.
- `runner/run-batch.mjs` fans out headless `claude -p "/memory-audit <url>"`
  runs, one isolated browser profile each, bounded concurrency, per-site
  report directory, resumable (skip sites with existing reports).
- Practical hardening: cookie-consent dismissal, bot detection / blocked
  pages (record and skip), per-site time + token budget, retries.
- Cost model: measure tokens + wall-clock per site on a 20-site pilot before
  committing to 1,000.

## Phase 4 — Cross-site study

- `aggregate/aggregate.mjs` merges `reports/*/report.json` →
  category frequency, growth distributions, offending libraries (memlab
  retainer traces often name the library), per-framework breakdowns.
- Output: a "State of web memory leaks" summary — the headline artifact for
  helping thousands of developers.

## Phase 5 (stretch) — From findings to fixes ("Mythos-style")

- For open-source sites/apps: map a finding's retainer trace to source (via
  source maps or repo search), generate a patch, verify by re-running the
  audit against a locally built fixed version, file an issue/PR.
- The playground is the rehearsal space: the demo flow is
  *find leak → explain retainer trace → edit playground source → re-audit →
  show it's gone*.

## Open questions (to discuss)

1. **Ethics/scope of third-party snapshots** — heap snapshots of public,
   logged-out pages should contain only public content, but we should keep
   raw `.heapsnapshot` files local, publish only aggregates, and respect
   robots/ToS for the batch run. Worth a written policy before Phase 3.
2. **Headed vs headless** — some leaks (and some bot-detection paths) differ
   headless. Pilot both?
3. **Determinism** — ads/analytics churn memory constantly; do we need
   network blocking of third-party requests for a "first-party only" mode?
4. **Where does Mythos-style issue filing live** — same repo or a separate
   campaign tool once Phases 1–4 are solid?

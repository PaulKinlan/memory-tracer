---
name: memory-audit
description: Audit a URL for memory leaks. Generates (or reuses) a per-site interaction test plan, runs each scenario through the heap-snapshot methodology via chrome-devtools-mcp, analyzes snapshots with memlab, and writes a structured findings report. Use when asked to memory-audit, leak-check, or memory-trace a site.
---

# Memory audit

Audit `$ARGUMENTS` (a URL; optional `--plan-only` to stop after the test plan,
`--scenario <id>` to run a single scenario, `--out <dir>` to override the
report directory).

You need the `chrome-devtools` MCP server (this repo's `.mcp.json` starts it
with `--isolated --memory-debugging`) and `memlab` on PATH (`npm i -g memlab`).
If the chrome-devtools-mcp `memory-leak-debugging` skill is installed, follow
its methodology and pattern references; the loop below is the same approach
specialized for producing structured reports.

Throughout: NEVER read a raw `.heapsnapshot` file into context. They are tens
of MB. Always analyze with memlab or the fallback comparison script.

Drive the browser through the chrome-devtools MCP tools — do not write your
own puppeteer/CDP automation. If you need an ad-hoc helper script, screenshot,
or other temporary artifact, write it under `scratch/` (gitignored), never the
repo root; deliverables belong only in the report directory and `testplans/`.

## Phase 1 — Recon and test plan

Reuse `testplans/<host>.json` if it exists (regenerate only on `--replan`).
Otherwise:

1. `new_page` → navigate to the URL. Dismiss cookie/consent banners if
   present. If the page is blocked (bot wall, login required), record that in
   the report and stop.
2. Take a DOM snapshot + screenshot. Classify the app: SPA or MPA, framework
   if detectable, major interactive surfaces (nav, modals, search,
   infinite-scroll feeds, media, tabs/accordions).
3. Write `testplans/<host>.json`: an array of scenarios, each with
   `id`, `description`, `setup` (how to reach the start state), `action`
   (the interaction to repeat — must return the page to the same visual
   state so it's repeatable), `revert` (how to undo, often a no-op), and
   `iterations` (default 10). Always include:
   - `idle-baseline`: load page, wait 60s, no interaction (catches timer /
     analytics / websocket accumulation).
   - If SPA: `route-cycle`: navigate to a secondary view and back.
   - One scenario per overlay (modal/menu open+close) and per repeatable
     widget interaction discovered in recon.
   Cap at ~6 scenarios; prefer the highest-traffic interactions.

Stop here if `--plan-only`.

## Phase 2 — Snapshot loop (per scenario)

For each scenario:

1. Fresh navigation to the start state. Wait for network idle. Run `setup`.
2. **Baseline**: `take_heapsnapshot` → `baseline.heapsnapshot`.
3. Perform `action` × `iterations` (10 unless the plan says otherwise) —
   repetition amplifies real leaks above noise.
4. **Target**: `take_heapsnapshot` → `target.heapsnapshot`.
5. Run `revert`, then **final**: `take_heapsnapshot` → `final.heapsnapshot`.
6. Store snapshots under `reports/<host>/<scenario-id>/` and
   `close_heapsnapshot` to free the browser.

## Phase 3 — Analysis

Per scenario, run memlab over the snapshot triple (`memlab find-leaks` with
baseline/target/final as SBP-style input; see memlab docs) and capture leak
traces. If memlab is unavailable, fall back to a two-snapshot object-count
diff (baseline vs target) and say so in the report (lower confidence).

Classify each leak trace into the taxonomy (one of):
`detached-dom`, `event-listener`, `timer-interval`, `unbounded-cache`,
`observer`, `closure-retention`, `global-accumulation`, `worker-or-socket`,
`library`, `other`.

Severity from growth per iteration (total retained growth ÷ iterations):
`low` < 100 KB, `medium` < 1 MB, `high` ≥ 1 MB, plus `critical` if growth is
unbounded on the idle scenario. Caveat from the upstream skill: detached DOM
nodes are *sometimes intentional caches* — mark confidence accordingly rather
than asserting a bug.

## Phase 4 — Report

Write two files in `reports/<host>/`:

- `report.json` — MUST validate against `schema/report.schema.json`. Every
  finding needs: category, severity, scenario id, growth numbers, a trimmed
  retainer-trace excerpt (≤ 20 lines), and a concrete `suggestedFix` (the
  code pattern to apply, e.g. "pass an AbortController signal to
  addEventListener and abort on teardown" — not "fix the leak").
- `REPORT.md` — human-readable summary: page profile, scenarios run, findings
  table, fix suggestions with code sketches, and anything skipped or
  low-confidence.

Finish your reply with a one-paragraph TLDR: leak count by severity and the
single most impactful fix.

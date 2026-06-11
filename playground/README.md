# Memory Leak Playground

Six deliberately seeded leaks, each retaining instances of a uniquely named
class (~1 MB each) so heap snapshots are unambiguous:

| Scenario | Class in snapshots | Leak pattern |
|---|---|---|
| `#detached-dom` | `DetachedCardBatch` | JS refs to removed DOM nodes |
| `#event-listeners` | `TooltipScratchpad` | window listeners never removed |
| `#timers` | `PollerBuffer` | `setInterval` never cleared |
| `#unbounded-cache` | `SearchResultCacheEntry` | Map cache with no eviction |
| `#observers` | `PanelMetrics` | `ResizeObserver` never disconnected |
| `#spa-views` | `DashboardModel` | event-bus subscriber leaks per route visit |

**Modes:** default is leaky. Append `?mode=fixed` to run the corrected
implementations — the audit loop must find *nothing* in fixed mode (the
false-positive check).

```sh
npm run playground   # http://localhost:8080
```

## Demo script (live)

1. Open `http://localhost:8080#spa-views` in leaky mode.
2. Ask the agent: `/memory-audit http://localhost:8080`.
3. Watch it: recon the page → write a test plan → run route cycles and button
   interactions ×10 with heap snapshots around them → memlab the snapshots →
   report each leak with its retainer trace and fix.
4. The payoff: have the agent apply the suggested fix to the scenario source
   (or just switch to `?mode=fixed`), re-run the audit, show zero findings.

## As an eval

[expected-findings.json](expected-findings.json) is the ground truth: compare
the audit's `report.json` against it — recall on leaky mode, false positives
on fixed mode.

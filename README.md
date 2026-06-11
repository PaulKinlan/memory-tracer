# memory-tracer

Agent-driven memory leak auditing for websites, built on the
[Chrome DevTools MCP server](https://github.com/ChromeDevTools/chrome-devtools-mcp)
and its `memory-leak-debugging` skill.

The DevTools MCP server already provides the *engine*: `take_heapsnapshot`,
interaction tools (`click`, `navigate_page`, `fill`), and a skill that encodes
the snapshot methodology (baseline → repeat interaction ~10× → post snapshot →
revert → analyze with [memlab](https://facebook.github.io/memlab/) — never read
raw `.heapsnapshot` files). This project adds the *orchestration* around that
engine:

1. **Per-site test plans** — analyze a URL, enumerate the interactions worth
   exercising (SPA route cycles, modals, infinite scroll, forms), and persist
   the plan so it's reviewable and re-runnable.
2. **A single-URL audit loop** — run every scenario in the test plan through
   the snapshot methodology and emit structured, actionable findings
   (see [schema/report.schema.json](schema/report.schema.json)).
3. **A batch runner** — point it at a list of URLs (e.g. HTTP Archive /
   Tranco top sites) and fan out headless audits.
4. **Aggregation** — merge per-site reports into a study of the most common
   leak patterns across the web.
5. **A leak playground** — a small site with deliberately seeded, labelled
   leaks. It's both the demo (watch the agent find and fix each one) and the
   eval suite (the audit loop is correct iff it finds everything in
   [playground/expected-findings.json](playground/expected-findings.json)).

## Layout

```
.claude/skills/memory-audit/   The orchestration skill (test plan → audit → report)
.mcp.json                      chrome-devtools-mcp config (isolated + memory tools)
playground/                    Seeded leak demos, leaky vs fixed mode, ground truth
schema/                        Findings/report JSON schema
runner/                        Batch runner (headless `claude -p` per URL)
aggregate/                     Merge reports into a cross-site summary
urls/                          URL lists + notes on sourcing top-site lists
testplans/                     Generated per-site test plans (committed, reviewable)
reports/                       Audit output, one directory per site (gitignored)
```

## Quickstart

```sh
# 1. Get the DevTools MCP server + its skills (one of):
#    a) Claude Code plugin (server + skills bundled):
#       /plugin install chrome-devtools-mcp@chrome-devtools-plugins
#    b) Or rely on this repo's .mcp.json (server only; the memory-leak-debugging
#       skill methodology is referenced from the memory-audit skill).

# 2. memlab for snapshot analysis
npm install -g memlab

# 3. Run the playground
npm run playground          # serves playground/ on http://localhost:8080

# 4. Audit it — /memory-audit works inside Claude Code, Codex, Gemini CLI,
#    and Antigravity when run from this repo (see runner/README.md)
/memory-audit http://localhost:8080

# 5. Batch mode — runs with Claude Code by default; also supports
#    --agent gemini | antigravity | codex (see runner/README.md for setup).
#    Reports land in reports/<agent>/<site>/ for cross-agent comparison.
node runner/run-batch.mjs --urls urls/sample.txt --concurrency 2
node runner/run-batch.mjs --urls urls/sample.txt --agent gemini

# 6. Aggregate findings across reports
node aggregate/aggregate.mjs
```

See [PLAN.md](PLAN.md) for the roadmap and open questions.

## License

[Apache 2.0](LICENSE)

# PR Report Agent

Local TypeScript agent that collects merged GitHub PRs for configured W&B repositories, scopes them to Weave-owned CODEOWNERS areas, runs one analyzer agent per PR over the full patch, and aggregates the cards into JSON and Markdown reports for engineering and product leads.

## Current Scope

- Repositories: `wandb/core`, `wandb/weave`, `wandb/docs`.
- Interval field: `mergedAt`.
- Timezone: `America/Los_Angeles` for daily and weekly presets.
- Bot-authored PRs: excluded by default.
- Scoping rule: a PR qualifies when at least one changed file's last matching CODEOWNERS rule includes `@wandb/weave-team`.
- GitHub data source: local `gh` CLI auth plus local clones under `~/crwv`.
- Output: durable JSON plus Markdown under `runs/<interval-label>/`.

`wandb/docs` is intentionally included in config even though its current `.github/CODEOWNERS` only assigns `@wandb/docs-team`. With the current owner-only scope it will usually produce zero qualifying PRs unless docs ownership changes or a separate docs path heuristic is added.

## Run

Install dependencies:

```bash
bun install
```

Collect scoped PR inputs without model calls:

```bash
bun run collect
```

Run the full manual trigger for the previous day:

```bash
OPENAI_API_KEY=... bun run run -- --preset previous-day
```

Run an explicit interval. The end is exclusive.

```bash
OPENAI_API_KEY=... bun run run -- --start 2026-06-08 --end 2026-06-09
```

Run the previous week:

```bash
OPENAI_API_KEY=... bun run run -- --preset previous-week
```

## Completion Rubric

- Manual trigger resolves explicit, previous-day, and previous-week intervals in Pacific time.
- Schedule trigger type exists in code so a cron/automation wrapper can call the same run path later.
- Config declares CoreWeave/W&B context, repos, local clone paths, models, GitHub filters, diff limits, and output paths.
- Collector uses `gh` to find merged PRs and filters by `mergedAt` exactly.
- Bot-authored PRs are excluded.
- CODEOWNERS scoping uses last-match-wins ownership and requires `@wandb/weave-team`.
- Scoped PR records include title, author, labels, comments, reviews, commits, changed files, matching ownership evidence, and full patch text.
- One PR analyzer agent is instantiated per scoped PR.
- Analyzer agents can inspect full diff chunks and local file contents at the PR revision.
- Analyzer output is typed JSON cards with purpose, impact, files, themes, tags, risk, and evidence.
- Orchestrator agent receives all cards and produces a typed JSON report plus Markdown.
- Artifacts are written to disk and can be re-read by publishing channels later.
- Deterministic tests cover interval logic, CODEOWNERS matching, bot filtering, and artifact rendering helpers.

## Notes

The analyzer model defaults to `gpt-5.4-mini`; the orchestrator defaults to `gpt-5.5`. Both are configurable in `config/coreweave-weave.config.json`.

## Agent Memory

Future agent sessions should start with `AGENTS.md`. Supporting context lives in:

- `docs/PROJECT_MEMORY.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNBOOK.md`
- `docs/PRODUCT_CONTEXT.md`
- `docs/BACKLOG.md`

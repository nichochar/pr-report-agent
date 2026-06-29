# Agent Instructions

Read this file first in future sessions. This repo is a standalone local TypeScript agent project for producing Weave-focused pull request reports.

## Project Purpose

Build and maintain a local PR-reporting agent for CoreWeave / Weights & Biases Weave work. The agent:

- Collects merged GitHub PRs over a day or week.
- Scopes noisy repos down to files whose last matching CODEOWNERS rule includes `@wandb/weave-team`.
- Excludes bot-authored PRs.
- Captures full PR diffs.
- Runs one analyzer agent per scoped PR.
- Aggregates all PR cards into JSON and Markdown reports for engineering and product leads.

## Current Repository

- Project root: `/Users/ncharriere/dev/pr-report-agent`
- Package manager/runtime: Bun
- Language: TypeScript
- Agent SDK: `@openai/agents`
- Local UI stack: Vite React TypeScript, Tailwind CSS v4, shadcn/ui-style checked-in components.
- shadcn/ui reference version: `shadcn` CLI `4.11.0`. Components live under `web/src/components/ui`, use `class-variance-authority`, `tailwind-merge`, and `lucide-react`, and should follow the same checked-in component pattern rather than being generated into a separate design system.
- Config: `config/coreweave-weave.config.json`
- Generated run artifacts: `runs/` and ignored by git
- Local source repos expected by config:
  - `/Users/ncharriere/crwv/core`
  - `/Users/ncharriere/crwv/weave`
  - `/Users/ncharriere/crwv/docs`

## Important Context

- CoreWeave owns Weights & Biases.
- The monitored product area is Weave.
- The initial repos are `wandb/core`, `wandb/weave`, and `wandb/docs`.
- `wandb/core` is large and noisy. Do not broaden collection to all PRs unless explicitly asked.
- `wandb/docs` is configured but currently filters to zero when CODEOWNERS has no `@wandb/weave-team` ownership.
- "PST" in user language should be implemented as Pacific local time with the IANA zone `America/Los_Angeles`, so daylight saving offsets are handled correctly.
- User prefers CLI boundaries for external systems when possible. For Notion product context, prefer the new Notion `ntn` CLI over hand-written direct API clients.

## Verification Commands

Run these from the project root:

```bash
bun install
bun run typecheck
bun test
```

Collect real PR data without model calls:

```bash
bun run run -- --start 2026-06-09 --end 2026-06-10 --collect-only
```

Run full model-backed report generation:

```bash
bun run run -- --start 2026-06-09 --end 2026-06-10
```

Use exact dates for verification in reports. Always state whether an interval is local Pacific time or UTC.

## Known Live Verification

On 2026-06-09 PDT, a full real-data run succeeded for:

- Local interval: `2026-06-09 00:00:00 America/Los_Angeles` to `2026-06-10 00:00:00 America/Los_Angeles`
- Scoped PRs: 30 total
- `wandb/core`: 16 scoped of 68 merged
- `wandb/weave`: 14 scoped of 14 merged
- `wandb/docs`: 0 scoped of 1 merged
- Generated files: `scoped-prs.json`, `scoped-prs-with-diffs.json`, `cards.json`, `report.json`, `report.md`

## Memory Map

- `docs/PROJECT_MEMORY.md`: current facts, decisions, and verification history.
- `docs/ARCHITECTURE.md`: system shape and module responsibilities.
- `docs/RUNBOOK.md`: setup, run, troubleshoot, and validate.
- `docs/PRODUCT_CONTEXT.md`: planned Notion/`ntn` product-context integration.
- `docs/BACKLOG.md`: likely next steps.

## Working Rules

- Keep generated artifacts out of git unless the user explicitly asks to preserve a report snapshot.
- Do not commit unless the user asks.
- Do not switch this project back into the Workshop repo.
- When changing behavior, add or update focused tests first or in the same change.
- When touching GitHub collection, verify against a small explicit interval before running a full day.
- When adding product-context ingestion, keep the raw fetched context in run artifacts for reproducibility.

# Project Memory

Last updated: 2026-06-11.

## What This Project Is

This is a standalone local TypeScript project for a CoreWeave / Weights & Biases PR report agent. It lives at `/Users/ncharriere/dev/pr-report-agent`.

It was originally scaffolded inside `/Users/ncharriere/oss/workshop/examples/pr-report-agent`, then moved here so it would be its own repo. The Workshop repo was cleaned afterward.

## User Preferences Captured So Far

- Keep this as a standalone repo under `~/dev`.
- Use TypeScript.
- Use a manual trigger first, but model triggers as multiple types so scheduled execution can be added later.
- Use `gh` for GitHub access because the user's machine is authenticated.
- Use local clones under `~/crwv` for repo context.
- Scope by CODEOWNERS ownership for `@wandb/weave-team` to avoid monorepo noise.
- Inspect full PR diffs.
- Exclude bot-authored PRs, but do not exclude humans using AI under their own GitHub identity.
- Output JSON and Markdown.
- Audience is engineering and product leads.
- Let the aggregator infer themes and tags from evidence.
- Use the best orchestrator model in config (`gpt-5.5`) and a cheaper analyzer model (`gpt-5.4-mini`) by default.
- Prefer CLI tool boundaries for external context systems, especially Notion `ntn`, over custom API code when practical.

## Current Implementation Summary

- `src/index.ts`: CLI entry point.
- `src/trigger.ts`: manual and schedule trigger interval resolution.
- `src/github.ts`: `gh`-backed merged PR collection, exact `mergedAt` filtering, bot exclusion, details, diffs.
- `src/codeowners.ts`: CODEOWNERS parsing and last-match-wins path ownership matching.
- `src/local-repo.ts`: local git revision/file access for analyzer tools.
- `src/agents.ts`: OpenAI Agents SDK PR analyzer and orchestrator.
- `src/artifacts.ts`: JSON and Markdown artifact writing.
- `src/types.ts`: config, PR, card, report schemas.
- `config/coreweave-weave.config.json`: repo list, owner filters, models, output paths, limits.
- CLI supports `--max-prs N` to stop collection after N scoped PRs for cheaper full-path smoke tests.

## Verified Behavior

The new standalone repo has been verified with:

```bash
bun install
bun run typecheck
bun test
```

Test coverage currently includes:

- CODEOWNERS last-match behavior.
- CODEOWNERS owner filtering.
- Bot-author filtering.
- Pacific interval calculation.
- Schedule trigger mapping.
- Artifact writing.

Real data verification:

- `gh auth status` succeeded earlier as user `nichochar` with `repo` and `read:org` scopes.
- A full real-data run for the 2026-06-09 Pacific day succeeded.
- The run generated 30 analyzer cards and a final Markdown report.

## Current Limitations

- The collection phase is slow for `wandb/core` because changed-file metadata is fetched per candidate PR before owner filtering can discard unrelated PRs.
- Analyzer progress is not surfaced per PR yet.
- Product-context ingestion is planned but not implemented.
- `ntn` was not installed locally when last checked.
- There is no scheduler yet, only schedule trigger typing.
- No initial git commit has been made.

## Important Paths

- Latest real report from 2026-06-09 PDT:
  - `runs/manual_2026-06-09T000000_to_2026-06-10T000000/report.md`
  - `runs/manual_2026-06-09T000000_to_2026-06-10T000000/cards.json`
  - `runs/manual_2026-06-09T000000_to_2026-06-10T000000/scoped-prs.json`

Generated `runs/` are ignored by git and may not exist in a fresh clone.

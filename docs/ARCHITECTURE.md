# Architecture

## Pipeline

```text
Trigger
  -> Resolve interval in America/Los_Angeles
  -> Load config
  -> Collect merged PR candidates with gh
  -> Fetch PR details and changed files
  -> Apply CODEOWNERS owner scope
  -> Fetch full patch for accepted PRs
  -> Optionally stop after --max-prs scoped PRs for smoke tests
  -> Write scoped PR inputs
  -> Run one analyzer agent per PR
  -> Aggregate cards into report
  -> Write JSON and Markdown artifacts
```

## Trigger Model

The code already models multiple trigger types:

- Manual preset: `previous-day`, `previous-week`
- Manual explicit interval: `--start`, `--end`
- Schedule trigger type: daily or weekly, mapped onto the same interval resolver

Scheduling itself is intentionally not implemented yet. A cron job, launchd job, GitHub Action, or future hosted sandbox should call the same CLI path.

## GitHub Collection

GitHub collection uses `gh`, not a direct GitHub SDK:

- `gh pr list` finds merged candidates.
- JavaScript applies exact end-exclusive `mergedAt` filtering.
- `gh pr view` fetches files, comments, reviews, commits, base/head refs.
- CODEOWNERS filtering runs locally.
- `gh pr diff --patch` fetches full patch text only after the PR passes owner scope.

This keeps authentication delegated to the user's existing `gh` setup.

## CODEOWNERS Scope

The core rule is:

> A PR qualifies when at least one changed file's last matching CODEOWNERS rule includes one of the repo's configured `includeOwners`.

Current configured owner:

```json
["@wandb/weave-team"]
```

This is deliberately strict to keep `wandb/core` from flooding the report with unrelated monorepo work.

## Agent Split

The implementation uses a MapReduce shape:

- One analyzer agent per scoped PR.
- Analyzer receives PR metadata, comments, reviews, files, ownership evidence, and patch text.
- Analyzer has tools to read diff chunks, search the diff, list metadata, and read local files at the PR revision.
- Orchestrator receives all analyzer cards and decides grouping/theme/importance for the final report.

The analyzer output schema is `PrCardSchema`. The orchestrator output schema is `ReportSchema`.

## Artifacts

Each run writes to:

```text
runs/<interval-label>/
  scoped-prs.json
  scoped-prs-with-diffs.json
  cards.json
  report.json
  report.md
```

`scoped-prs.json` avoids embedding diffs and records diff size. `scoped-prs-with-diffs.json` stores the full collected input.

## Product Context Direction

Product context should become an input stage before PR analysis:

```text
Product context sources
  -> Normalize priorities/tickets/docs
  -> Write product-context.json
  -> Provide compact context bundle to PR analyzers
  -> Provide full context bundle to orchestrator
```

The preferred Notion integration boundary is the first-party `ntn` CLI.

# Runbook

## Setup

From `/Users/ncharriere/dev/pr-report-agent`:

```bash
bun install
```

Expected external tools:

```bash
gh auth status
git --version
bun --version
```

The full model-backed run also needs:

```bash
test -n "$OPENAI_API_KEY"
```

## Test

```bash
bun run typecheck
bun test
```

## Collect Without Model Calls

Use this first when testing a new interval:

```bash
bun run run -- --start 2026-06-09 --end 2026-06-10 --collect-only
```

This verifies live GitHub access, exact `mergedAt` filtering, bot exclusion, CODEOWNERS scope, and full patch capture for scoped PRs.

## Full Report Run

```bash
bun run run -- --start 2026-06-09 --end 2026-06-10
```

The interval is interpreted in `America/Los_Angeles`. The end is exclusive.

For faster model-backed smoke tests, stop after a small number of scoped PRs:

```bash
bun run run -- --preset previous-day --max-prs 3
```

Output path shape:

```text
runs/manual_YYYY-MM-DDT000000_to_YYYY-MM-DDT000000/
```

## Useful Checks

Count scoped PRs:

```bash
jq '.scopedPrs | length' runs/<run>/scoped-prs.json
```

Count generated cards:

```bash
jq '. | length' runs/<run>/cards.json
```

Show repo breakdown:

```bash
jq -r '.scopedPrs[] | .repo' runs/<run>/scoped-prs.json | sort | uniq -c
```

Preview report:

```bash
sed -n '1,180p' runs/<run>/report.md
```

## Troubleshooting

### `gh` is not authenticated

Run:

```bash
gh auth status
gh auth login
```

The user previously had `repo` and `read:org` scopes, which were enough for the tested repos.

### Local clone missing

The config expects:

```text
/Users/ncharriere/crwv/core
/Users/ncharriere/crwv/weave
/Users/ncharriere/crwv/docs
```

Update `config/coreweave-weave.config.json` if the clones move.

### `OPENAI_API_KEY` missing

Use `--collect-only` for collection tests, or set `OPENAI_API_KEY` for full analyzer/orchestrator runs.

### Collection is slow

This is expected for `wandb/core`. GitHub does not give complete changed-file ownership data from the initial list query, so the collector fetches PR details before it can discard non-Weave PRs.

### `wandb/docs` returns zero scoped PRs

That is expected when its CODEOWNERS file does not assign changed files to `@wandb/weave-team`.

## Safe Development Loop

1. Edit code.
2. Run `bun run typecheck`.
3. Run `bun test`.
4. Run a narrow collect-only interval.
5. Run a capped full interval with `--max-prs 3` if agent changes were made.
6. Run a full day only after the narrow interval succeeds.

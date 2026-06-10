# Backlog

## High Value

- Add Notion `ntn` product-context ingestion.
- Add per-PR analyzer progress logging.
- Add a `--use-existing-run <run-dir>` mode so full report generation can reuse collected PRs without hitting GitHub again.
- Add a `--limit` or `--pr` smoke-test option for cheaper end-to-end model tests.
- Add run metadata with versions: `gh --version`, `ntn --version`, `bun --version`, git SHAs for local clones, model names.
- Add report quality checks that verify `cards.json` length matches scoped PR count and every report PR link exists in cards.

## Scheduling

- Add a small wrapper for manual, daily, and weekly triggers.
- Consider launchd first for local scheduling on macOS.
- Later, consider hosted sandbox execution once local behavior is stable.

## GitHub Collection Improvements

- Cache `gh pr view` detail responses per run.
- Add retry/backoff around `gh` calls.
- Add better progress logs for analyzer fanout.
- Explore whether local merge commits can provide faster file lists for merged PRs in `wandb/core`.
- Add config to include or exclude specific CODEOWNERS files if repos change layout.

## Product Report Improvements

- Add explicit "priority alignment" section once Notion context exists.
- Add "unmapped but important" section.
- Add "high-risk changes" section based on comments, reviews, changed-file count, migrations, infra paths, and test coverage.
- Add "questions for leads" section.
- Add Slack publishing later, using generated `report.md` as the source.

## Testing

- Add fixture tests for `gh` JSON normalization.
- Add tests for product-context normalization.
- Add tests for ntn missing/auth failure behavior.
- Add a snapshot-style test for report Markdown rendering if deterministic rendering helpers are introduced.

## Developer Experience

- Add `README` quick links to docs.
- Add `--help` output.
- Add command examples for previous day and previous week.
- Add `.env.example` guidance for OpenAI and Notion environment variables.

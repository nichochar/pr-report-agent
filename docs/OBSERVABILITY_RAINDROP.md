# Raindrop Observability Experiment

This branch instruments the PR report agent with Raindrop's OpenAI Agents SDK integration.

## What Changed

- Added `@raindrop-ai/openai-agents`.
- Registered `createRaindropOpenAIAgents().processor` only when `RAINDROP_WRITE_KEY` is set.
- Defaulted `convoId` to `pr-report:<interval-label>` so all analyzer/orchestrator traces for one report are grouped as one conversation.
- Added stable OpenAI Agents `workflowName`, `groupId`, and trace metadata for analyzer and orchestrator runs.
- Flushed and shut down the Raindrop client before the Bun CLI exits.
- Added `PR_REPORT_TRACE_INCLUDE_SENSITIVE_DATA=false` support for structure-only traces.
- Added env-gated PR analyzer chaos failures for comparing failed trace rendering.
- Added env-gated analyzer tool-call chaos failures for comparing tool-error rendering.

## Interesting Discoveries

- Raindrop has the most direct TypeScript fit for this repo: its package implements the OpenAI Agents `TracingProcessor` interface directly.
- The processor creates Raindrop events from OpenAI Agents traces and emits OTLP-style spans for agent, generation/response, function/tool, and handoff activity.
- The package uses a static `convoId` option for event grouping. This branch sets it from the resolved report interval unless `RAINDROP_CONVO_ID` overrides it.
- OpenAI Agents trace metadata is capped at 16 properties, so this branch keeps only compact high-value metadata on each run.
- Analyzer failure injection is implemented as an OpenAI Agents output guardrail. That places the failure inside the analyzer trace instead of throwing before or after tracing.

## Challenges

- `@raindrop-ai/openai-agents` is young (`0.0.3` in this branch). The public surface is small and should be verified in Raindrop Cloud after any upgrade.
- The current processor does not copy OpenAI Agents `traceMetadata` into Raindrop event properties; the important visible grouping knobs are `eventName` from `workflowName` and `convoId`.
- `collect-only` cannot verify Raindrop model/tool spans because it skips every OpenAI Agents run.
- Report prompts include full PR diffs, comments, and reviews. Tracing with sensitive data enabled can send proprietary code and review text to Raindrop Cloud.

## Run With Cloud

```bash
OPENAI_API_KEY=... \
RAINDROP_WRITE_KEY=... \
bun run run -- --start 2026-06-09 --end 2026-06-10
```

For structure-only traces:

```bash
PR_REPORT_TRACE_INCLUDE_SENSITIVE_DATA=false bun run run -- --start 2026-06-09 --end 2026-06-10
```

For deterministic pseudo-random analyzer failures:

```bash
PR_REPORT_ANALYZER_FAILURE_RATE=0.1 \
PR_REPORT_ANALYZER_FAILURE_SEED=demo \
bun run run -- --start 2026-06-09 --end 2026-06-10
```

When a chaos guardrail trips, that PR analyzer fails instead of returning a card. The analyzer trace is explicitly closed with a `chaos_pr_analyzer_failure ...` errored span so observability UIs can render the failure. The report run continues with the remaining analyzer cards, writes `analyzer-failures.json`, and appends a `Failed PRs not included in review` section to `report.md`. Reuse the same seed across observability branches to fail the same PR analyzers in each product.

For deterministic pseudo-random analyzer tool-call failures:

```bash
PR_REPORT_TOOL_FAILURE_RATE=0.1 \
PR_REPORT_TOOL_FAILURE_SEED=demo \
bun run run -- --start 2026-06-09 --end 2026-06-10
```

When tool chaos selects a PR analyzer, the first analyzer tool call throws an injected error. This is separate from analyzer guardrail chaos and is intended to exercise observability UI surfaces for failed tool/function spans.

## Verification

- `bun run typecheck`
- `bun test`
- `bun run run -- --start 2026-06-09 --end 2026-06-10 --collect-only`

Cloud trace verification still requires a real `RAINDROP_WRITE_KEY`. During local model-backed testing, OpenAI Agents exposed a metadata limit of 16 properties per trace. The branch keeps trace metadata under that cap.

## Sources

- https://www.raindrop.ai/docs/integrations/openai-agents/
- https://www.raindrop.ai/docs/sdk/typescript/
- https://openai.github.io/openai-agents-js/guides/tracing/

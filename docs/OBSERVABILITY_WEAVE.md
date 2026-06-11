# Weave Observability Experiment

This branch instruments the PR report agent with W&B Weave's current OpenAI Agents SDK integration.

## What Changed

- Added `weave`.
- Initialized Weave only when `WEAVE_PROJECT` is set.
- Registered `createOpenAIAgentsTracingProcessor()` explicitly with `@openai/agents`.
- Added stable OpenAI Agents trace grouping with `groupId = pr-report:<interval-label>`.
- Added Weave/thread-oriented metadata, including `wandb.thread_id` and `wandb.is_turn`.
- Flushed both the OpenAI Agents processor and Weave OTel pipeline before the Bun CLI exits.
- Added `PR_REPORT_TRACE_INCLUDE_SENSITIVE_DATA=false` support for structure-only traces.
- Added env-gated PR analyzer chaos failures for comparing failed trace rendering.
- Added env-gated analyzer tool-call chaos failures for comparing tool-error rendering.

## Interesting Discoveries

- The current Weave docs and TypeScript package include `createOpenAIAgentsTracingProcessor()`, `instrumentOpenAIAgents()`, and GenAI session APIs such as `startSession`, `startTurn`, `startLLM`, and `startTool`.
- This branch does not use `op` or `weave.op`; those are the older function-call tracing path and are not the best fit for comparing agent spans.
- Weave's automatic TypeScript instrumentation path relies on Node module loader hooks. This project runs with Bun, so explicit processor registration is safer and easier to reason about.
- The installed processor captures OpenAI Agents trace/span lifecycle events and maps agent/function/handoff spans into Weave calls. Response spans are intentionally skipped because Weave expects its OpenAI SDK integration to capture those provider calls.
- OpenAI Agents trace metadata is capped at 16 properties, so this branch keeps only compact high-value metadata on each run.
- Analyzer failure injection is implemented as an OpenAI Agents output guardrail. That places the failure inside the analyzer trace instead of throwing before or after tracing.

## Challenges

- Bun support is the main unknown. The code compiles, but a model-backed run is still needed to verify that Weave receives model/message spans under Bun.
- Weave has both an OpenAI Agents processor and GenAI session/turn APIs. Using both manually could double-log high-level spans, so this branch keeps the runtime path to the processor plus metadata.
- Report prompts include full PR diffs, comments, and reviews. Tracing with sensitive data enabled can send proprietary code and review text to W&B.

## Run

```bash
OPENAI_API_KEY=... \
WANDB_API_KEY=... \
WEAVE_PROJECT=your-team-name/pr-report-agent \
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

## Sources

- https://docs.wandb.ai/weave/guides/integrations/openai_agents
- https://docs.wandb.ai/weave/reference/typescript-sdk/functions/createopenaiagentstracingprocessor
- https://docs.wandb.ai/weave/guides/tracking/trace-agents
- https://docs.wandb.ai/weave/guides/tracking/otel
- https://docs.wandb.ai/weave/guides/integrations/js

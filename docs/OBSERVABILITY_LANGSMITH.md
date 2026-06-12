# LangSmith Observability Experiment

This branch instruments the PR report agent with LangSmith's OpenAI Agents SDK integration.

## What Changed

- Added `langsmith`.
- Registered `OpenAIAgentsTracingProcessor` when `LANGSMITH_API_KEY` is set.
- Added stable OpenAI Agents trace grouping with `groupId = pr-report:<interval-label>`.
- Added thread metadata with `conversation_id` and `thread_id`.
- Added per-run trace metadata for analyzer and orchestrator runs.
- Flushed the LangSmith processor before the Bun CLI exits.
- Added `PR_REPORT_TRACE_INCLUDE_SENSITIVE_DATA=false` support for structure-only traces.
- Added env-gated PR analyzer chaos failures for comparing failed trace rendering.
- Added env-gated analyzer tool-call chaos failures for comparing tool-error rendering.

## Interesting Discoveries

- LangSmith has a current JavaScript integration for `@openai/agents`; it does not require rewriting this project around LangChain primitives.
- Installing `OpenAIAgentsTracingProcessor` is the tracing opt-in. The docs state it posts traces even if `LANGSMITH_TRACING` is unset.
- `traceable()` is still useful inside custom tool handlers, but the processor already captures OpenAI Agents runs, model calls, tool calls, and handoffs.
- The cleanest grouping boundary for this CLI is one trace per analyzer/orchestrator call, linked by the same OpenAI Agents `groupId`.
- OpenAI Agents trace metadata is capped at 16 properties, so this branch keeps only compact high-value metadata on each run.
- Analyzer failure injection is implemented as an OpenAI Agents output guardrail. That places the failure inside the analyzer trace instead of throwing before or after tracing.

## Challenges

- The OpenAI Agents JS SDK only accepts `workflowName`, `groupId`, and `traceMetadata` on `Runner` construction, not per `runner.run()` call.
- Report prompts include full PR diffs, comments, and reviews. Tracing with sensitive data enabled can send proprietary code and review text to LangSmith.
- LangSmith and the OpenAI Agents default trace exporter both use global processors. This branch uses `setTraceProcessors()` so LangSmith is the sole explicit processor for comparison.

## Run

```bash
OPENAI_API_KEY=... \
LANGSMITH_API_KEY=... \
LANGSMITH_PROJECT=pr-report-agent \
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

- https://docs.langchain.com/langsmith/trace-with-openai-agents-sdk
- https://docs.langchain.com/langsmith/annotate-code
- https://docs.langchain.com/langsmith/trace-with-opentelemetry
- https://openai.github.io/openai-agents-js/guides/tracing/

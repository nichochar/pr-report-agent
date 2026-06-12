# Weave Observability Experiment

This branch instruments the PR report agent with W&B Weave's current OpenAI Agents SDK integration plus the newer Weave Agents session/turn/tool APIs.

## What Changed

- Added `weave`.
- Initialized Weave only when `WEAVE_PROJECT` is set.
- Registered `createOpenAIAgentsTracingProcessor()` explicitly with `@openai/agents`.
- Added Weave Agents instrumentation with one report run modeled as one `pr-report-agent` session and one `invoke_agent` turn.
- Modeled each PR analyzer invocation as a delegated `pr-analyzer` sub-agent inside the report turn.
- Wrapped analyzer tools with Weave `execute_tool` spans, including error status when chaos or local file reads throw.
- Replaced Weave's default GenAI OTLP Node HTTP exporter with a fetch-based OTLP protobuf exporter for Bun.
- Added stable OpenAI Agents trace grouping with `groupId = pr-report:<interval-label>`.
- Added Weave/thread-oriented metadata, including `wandb.thread_id` and `wandb.is_turn`.
- Flushed both the OpenAI Agents processor and Weave OTel pipeline before the Bun CLI exits.
- Added `PR_REPORT_TRACE_INCLUDE_SENSITIVE_DATA=false` support for structure-only traces.
- Capped Weave Agents tool payloads before OTLP export so large diff/file-read spans do not make short-lived CLI flushes time out.
- Added env-gated PR analyzer chaos failures for comparing failed trace rendering.
- Added env-gated analyzer tool-call chaos failures for comparing tool-error rendering.

## Interesting Discoveries

- The current Weave docs and TypeScript package include `createOpenAIAgentsTracingProcessor()`, `instrumentOpenAIAgents()`, and GenAI session APIs such as `startSession`, `startTurn`, `startLLM`, and `startTool`.
- This branch does not use `op` or `weave.op`; those are the older function-call tracing path and are not the best fit for comparing agent spans.
- Weave's automatic TypeScript instrumentation path relies on Node module loader hooks. This project runs with Bun, so explicit processor registration is safer and easier to reason about.
- The installed processor captures OpenAI Agents trace/span lifecycle events and maps agent/function/handoff spans into Weave calls. Response spans are intentionally skipped because Weave expects its OpenAI SDK integration to capture those provider calls.
- The Weave Agents tab is driven by the GenAI data model, not only the OpenAI Agents trace processor. It expects sessions grouped by `gen_ai.conversation.id`, root `invoke_agent` turns, `chat` LLM spans, and `execute_tool` tool spans.
- For this CLI, one generated report is the closest equivalent to one user-agent exchange. The analyzer fanout is delegated work inside that exchange, so it is represented as sub-agent spans rather than one turn per PR.
- Under Bun, the stock `@opentelemetry/exporter-trace-otlp-proto` Node HTTP transport repeatedly failed the Weave GenAI flush with `Request timed out`. A synthetic reproduction with no OpenAI calls and only generated GenAI spans failed the same way, which isolated the issue to the exporter transport rather than the model workload or PR data volume.
- OpenAI Agents trace metadata is capped at 16 properties, so this branch keeps only compact high-value metadata on each run.
- Analyzer failure injection is implemented as an OpenAI Agents output guardrail. That places the failure inside the analyzer trace instead of throwing before or after tracing.

## Why This Was Confusing

This was easy to get wrong because Weave currently has two similarly named but different instrumentation surfaces:

- The OpenAI Agents integration accepts OpenAI Agents SDK trace events and sends them to Weave's normal trace/call system. That made the Traces tab look healthy, with agent-looking names, spans, inputs, outputs, and tool spans.
- The newer Weave Agents tab is driven by the GenAI agent data model. It expects session, turn, LLM, tool, and sub-agent spans with semantic attributes such as `gen_ai.conversation.id`, `gen_ai.agent.name`, and `gen_ai.operation.name`.

The initial implementation confused those surfaces. Seeing populated OpenAI Agents traces made it tempting to assume the Agents tab would be derived from those same records. It was not. The missing signal was in the Agents tab empty-state text: "traces with agent metadata" meant Weave GenAI agent metadata, not arbitrary trace metadata attached through the OpenAI Agents processor.

The documentation also splits the relevant facts across pages. The OpenAI Agents integration docs explain how to register `createOpenAIAgentsTracingProcessor()`, while the Agents docs explain `startSession()`, `startTurn()`, `startTool()`, and the session/turn model. A coding agent that searches for "Weave OpenAI Agents" can reasonably land on the first page, implement it, see traces, and stop too early.

The word "agent" is overloaded in three places:

- OpenAI Agents SDK agents and runners.
- Weave's OpenAI Agents trace processor.
- Weave's Agents product surface and GenAI semantic convention model.

That overload also led to a weak first attempt at metadata. Adding keys such as `wandb.thread_id` and `wandb.is_turn` was useful for filtering traces, but it was not equivalent to emitting `invoke_agent`, `execute_tool`, and `gen_ai.conversation.id` spans through the GenAI SDK path.

The app shape adds another modeling ambiguity. This CLI is not a normal chat product with many user turns. A daily report run is closer to one user request that delegates work to many specialist PR analyzers. Modeling every PR analyzer as its own turn would technically create Agents data, but it would overstate the conversation structure and make the report harder to reason about. The better mapping is one report session, one report turn, and many analyzer sub-agent invocations inside that turn.

Finally, the installed TypeScript SDK surface is still catching up with the ideal hierarchy. `Turn` exposes `startSubagent()` and `startTool()`, but `SubAgent` only exposes `end()` in the installed package. That means this branch can truthfully record analyzer sub-agent spans and tool spans, but the tool spans are currently attached under the report turn rather than nested directly under each sub-agent.

## Challenges

- Bun support for loader-hook autopatching is the main unknown, so this branch avoids the hook path and uses explicit SDK calls.
- Weave has both an OpenAI Agents processor and GenAI session/turn APIs. This branch now uses both intentionally: the processor keeps the detailed Traces table behavior, while the GenAI APIs populate the Agents product surface.
- The current TypeScript `SubAgent` class can be started and ended, but it does not expose `startTool()` or `startLLM()` methods. Analyzer tools are therefore recorded as tool spans under the report turn, not as direct children of the sub-agent spans.
- The real LLM calls are hidden behind the OpenAI Agents SDK runner. This branch does not wrap whole agent executions in fake `chat` spans because that would misrepresent provider-call boundaries.
- The GenAI OTel exporter sends tool args/results as span attributes. Large PR diffs and local file reads can make the final CLI flush slow or timeout, so this branch limits Weave Agents tool payload size separately from model prompt size.
- Weave's `genai.batchOptions.exportTimeoutMillis` controls the batch processor wait, but the underlying OTLP HTTP exporter also has its own request timeout. The OpenTelemetry default is 10000 ms. This branch now bypasses the stock Node HTTP exporter with a fetch-based exporter, but still copies `PR_REPORT_WEAVE_OTEL_EXPORT_TIMEOUT_MS` into `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` for transparency and future compatibility.
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

For Weave Agents payload and flush tuning:

```bash
PR_REPORT_WEAVE_AGENT_PAYLOAD_MAX_CHARS=2000 \
PR_REPORT_WEAVE_OTEL_EXPORT_TIMEOUT_MS=120000 \
PR_REPORT_WEAVE_OTEL_MAX_EXPORT_BATCH_SIZE=32 \
bun run run -- --start 2026-06-09 --end 2026-06-10
```

`PR_REPORT_WEAVE_OTEL_EXPORT_TIMEOUT_MS` is applied both to Weave's batch processor timeout and, when `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` is unset, to the OTLP HTTP request timeout.

Telemetry flush failures fail the CLI by default because this branch is meant to compare observability products, and a successful report with missing spans is misleading. Set `PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR=false` only for artifact-only runs where telemetry loss is acceptable.

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
- https://docs.wandb.ai/weave/guides/tracking/trace-sub-agents
- https://docs.wandb.ai/weave/reference/typescript-sdk/functions/startsession
- https://docs.wandb.ai/weave/reference/typescript-sdk/functions/startturn
- https://docs.wandb.ai/weave/reference/typescript-sdk/functions/startsubagent
- https://docs.wandb.ai/weave/reference/typescript-sdk/functions/starttool
- https://docs.wandb.ai/weave/guides/tracking/otel
- https://docs.wandb.ai/weave/guides/integrations/js

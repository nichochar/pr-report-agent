import { describe, expect, test } from "bun:test";
import {
  buildAnalyzerTraceMetadata,
  buildOrchestratorTraceMetadata,
  buildReportTraceContext,
} from "../src/trace-context.js";
import type { AppConfig, PrCard, PullRequestRecord } from "../src/types.js";

describe("trace context", () => {
  test("builds Weave-friendly report and PR metadata", () => {
    const config = {
      name: "Test",
      repos: [{ slug: "wandb/weave" }, { slug: "wandb/core" }],
    } as AppConfig;
    const context = buildReportTraceContext(
      config,
      {
        startIso: "2026-06-09T07:00:00Z",
        endIso: "2026-06-10T07:00:00Z",
        timezone: "America/Los_Angeles",
        label: "manual_2026-06-09_to_2026-06-10",
      },
      "weave",
    );
    const pr = {
      repo: "wandb/weave",
      number: 123,
      title: "Trace reports",
      url: "https://github.com/wandb/weave/pull/123",
      author: { login: "human", isBot: false },
      mergedAt: "2026-06-09T12:00:00Z",
      changedFiles: 2,
      ownership: { includeOwners: ["@wandb/weave-team"], matchedFiles: [{ path: "a.ts" }] },
      diff: "diff",
    } as PullRequestRecord;
    const metadata = buildAnalyzerTraceMetadata(pr, context);

    expect(context.groupId).toBe("pr-report:manual_2026-06-09_to_2026-06-10");
    expect(metadata).toMatchObject({
      telemetry_library: "weave",
      "wandb.thread_id": context.groupId,
      "wandb.is_turn": "true",
      stage: "analyze_pr",
      repo: "wandb/weave",
      pr_number: "123",
    });
  });

  test("summarizes orchestrator metadata", () => {
    const context = {
      groupId: "pr-report:manual",
      baseMetadata: { app: "pr-report-agent", telemetry_library: "weave" },
    };
    const cards = [{ repo: "wandb/weave" }, { repo: "wandb/core" }, { repo: "wandb/weave" }];

    expect(buildOrchestratorTraceMetadata(cards as PrCard[], context)).toMatchObject({
      stage: "aggregate_report",
      "wandb.thread_id": "pr-report:manual",
      pr_cards: "3",
      failed_pr_analyzers: "0",
      repos_with_cards: "wandb/core,wandb/weave",
    });

    expect(
      buildOrchestratorTraceMetadata(cards as PrCard[], context, [
        {
          repo: "wandb/weave",
          number: 123,
          title: "Trace failures",
          url: "https://github.com/wandb/weave/pull/123",
          mergedAt: "2026-06-09T12:00:00Z",
          errorName: "Error",
          errorMessage: "Output guardrail triggered",
          failedAt: "2026-06-09T12:01:00Z",
        },
      ]),
    ).toMatchObject({
      failed_pr_analyzers: "1",
    });
  });
});

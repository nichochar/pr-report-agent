import { describe, expect, test } from "bun:test";
import {
  buildAnalyzerTraceMetadata,
  buildOrchestratorTraceMetadata,
  buildReportTraceContext,
  reportTraceGroupId,
} from "../src/trace-context.js";
import type { AppConfig, PrCard, PullRequestRecord, ResolvedInterval } from "../src/types.js";

describe("trace context", () => {
  test("builds Raindrop report and PR metadata", () => {
    const interval: ResolvedInterval = {
      startIso: "2026-06-09T07:00:00Z",
      endIso: "2026-06-10T07:00:00Z",
      timezone: "America/Los_Angeles",
      label: "manual_2026-06-09_to_2026-06-10",
    };
    const config = {
      repos: [{ slug: "wandb/weave" }, { slug: "wandb/core" }],
    } as AppConfig;
    const context = buildReportTraceContext(config, interval, "raindrop");
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

    expect(reportTraceGroupId(interval)).toBe("pr-report:manual_2026-06-09_to_2026-06-10");
    expect(buildAnalyzerTraceMetadata(pr, context)).toMatchObject({
      telemetry_library: "raindrop",
      conversation_id: context.groupId,
      stage: "analyze_pr",
      repo: "wandb/weave",
      pr_number: "123",
      pr_matched_files: "1",
      pr_diff_chars: "4",
    });
  });

  test("summarizes orchestrator metadata", () => {
    const context = {
      groupId: "pr-report:manual",
      baseMetadata: { app: "pr-report-agent", telemetry_library: "raindrop" },
    };
    const cards = [{ repo: "wandb/weave" }, { repo: "wandb/core" }, { repo: "wandb/weave" }];

    expect(buildOrchestratorTraceMetadata(cards as PrCard[], context)).toMatchObject({
      stage: "aggregate_report",
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

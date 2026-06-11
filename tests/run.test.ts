import { describe, expect, test } from "bun:test";
import { testExports } from "../src/run.js";
import type { PullRequestRecord } from "../src/types.js";

describe("run orchestration helpers", () => {
  test("settled concurrency preserves order and keeps running after mapper failures", async () => {
    const results = await testExports.mapSettledWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) {
        throw new Error("synthetic analyzer failure");
      }
      return value * 10;
    });

    expect(results).toEqual([
      { status: "fulfilled", item: 1, value: 10 },
      { status: "rejected", item: 2, reason: expect.any(Error) },
      { status: "fulfilled", item: 3, value: 30 },
    ]);
  });

  test("builds a compact analyzer failure artifact record", () => {
    const pr = {
      repo: "wandb/weave",
      number: 7126,
      title: "Improve trace rendering",
      url: "https://github.com/wandb/weave/pull/7126",
      mergedAt: "2026-06-10T12:00:00Z",
    } as PullRequestRecord;

    expect(
      testExports.buildPrAnalysisFailure(
        pr,
        new Error("Output guardrail triggered"),
        new Date("2026-06-10T12:01:00Z"),
      ),
    ).toEqual({
      repo: "wandb/weave",
      number: 7126,
      title: "Improve trace rendering",
      url: "https://github.com/wandb/weave/pull/7126",
      mergedAt: "2026-06-10T12:00:00Z",
      errorName: "Error",
      errorMessage: "Output guardrail triggered",
      failedAt: "2026-06-10T12:01:00.000Z",
    });
  });
});

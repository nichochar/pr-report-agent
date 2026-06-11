import { describe, expect, test } from "bun:test";
import {
  createToolChaosController,
  readToolChaosConfig,
  shouldFailAnalyzerTool,
} from "../src/tool-chaos.js";

describe("tool chaos", () => {
  test("is disabled by default", () => {
    expect(readToolChaosConfig({})).toEqual({
      failureRate: 0,
      seed: "default",
    });
  });

  test("validates failure rate", () => {
    expect(() => readToolChaosConfig({ PR_REPORT_TOOL_FAILURE_RATE: "1.2" })).toThrow(
      "PR_REPORT_TOOL_FAILURE_RATE",
    );
  });

  test("supports deterministic all-or-none failure rates", () => {
    const pr = { repo: "wandb/weave", number: 7091 };
    expect(shouldFailAnalyzerTool(pr, { failureRate: 0, seed: "demo" })).toBe(false);
    expect(shouldFailAnalyzerTool(pr, { failureRate: 1, seed: "demo" })).toBe(true);
  });

  test("uses a stable seed for pseudo-random failures", () => {
    const pr = { repo: "wandb/weave", number: 7091 };
    const config = { failureRate: 0.1, seed: "demo" };

    expect(shouldFailAnalyzerTool(pr, config)).toBe(shouldFailAnalyzerTool(pr, config));
  });

  test("throws only once for a selected analyzer", () => {
    const controller = createToolChaosController(
      { repo: "wandb/weave", number: 7091 },
      { failureRate: 1, seed: "demo" },
    );

    expect(() => controller.maybeFail("list_pr_metadata")).toThrow("list_pr_metadata");
    expect(() => controller.maybeFail("read_diff_chunk")).not.toThrow();
  });
});

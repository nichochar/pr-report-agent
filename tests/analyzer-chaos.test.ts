import { describe, expect, test } from "bun:test";
import {
  readAnalyzerChaosConfig,
  shouldFailAnalyzer,
} from "../src/analyzer-chaos.js";

describe("analyzer chaos", () => {
  test("is disabled by default", () => {
    expect(readAnalyzerChaosConfig({})).toEqual({
      failureRate: 0,
      seed: "default",
    });
  });

  test("validates failure rate", () => {
    expect(() => readAnalyzerChaosConfig({ PR_REPORT_ANALYZER_FAILURE_RATE: "1.2" })).toThrow(
      "PR_REPORT_ANALYZER_FAILURE_RATE",
    );
  });

  test("supports deterministic all-or-none failure rates", () => {
    const pr = { repo: "wandb/weave", number: 7091 };
    expect(shouldFailAnalyzer(pr, { failureRate: 0, seed: "demo" })).toBe(false);
    expect(shouldFailAnalyzer(pr, { failureRate: 1, seed: "demo" })).toBe(true);
  });

  test("uses a stable seed for pseudo-random failures", () => {
    const pr = { repo: "wandb/weave", number: 7091 };
    const config = { failureRate: 0.1, seed: "demo" };

    expect(shouldFailAnalyzer(pr, config)).toBe(shouldFailAnalyzer(pr, config));
  });
});

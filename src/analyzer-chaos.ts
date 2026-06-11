import type { OutputGuardrail } from "@openai/agents";
import type { PullRequestRecord } from "./types.js";

export interface AnalyzerChaosConfig {
  failureRate: number;
  seed: string;
}

export function readAnalyzerChaosConfig(
  env: Record<string, string | undefined> = process.env,
): AnalyzerChaosConfig {
  const rawRate = env.PR_REPORT_ANALYZER_FAILURE_RATE ?? "0";
  const failureRate = Number(rawRate);
  if (!Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1) {
    throw new Error("PR_REPORT_ANALYZER_FAILURE_RATE must be a number from 0 to 1.");
  }

  return {
    failureRate,
    seed: env.PR_REPORT_ANALYZER_FAILURE_SEED ?? "default",
  };
}

export function createAnalyzerChaosGuardrails(
  pr: PullRequestRecord,
  config: AnalyzerChaosConfig = readAnalyzerChaosConfig(),
): OutputGuardrail<any>[] {
  if (config.failureRate === 0) {
    return [];
  }

  const shouldFail = shouldFailAnalyzer(pr, config);
  return [
    {
      name: "chaos_pr_analyzer_failure",
      async execute() {
        return {
          tripwireTriggered: shouldFail,
          outputInfo: {
            injectedFailure: shouldFail,
            repo: pr.repo,
            prNumber: pr.number,
            failureRate: config.failureRate,
            seed: config.seed,
          },
        };
      },
    },
  ];
}

export function shouldFailAnalyzer(
  pr: Pick<PullRequestRecord, "repo" | "number">,
  config: AnalyzerChaosConfig,
): boolean {
  if (config.failureRate <= 0) {
    return false;
  }
  if (config.failureRate >= 1) {
    return true;
  }

  return hashToUnitInterval(`${config.seed}:${pr.repo}#${pr.number}`) < config.failureRate;
}

function hashToUnitInterval(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

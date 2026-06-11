import type { PullRequestRecord } from "./types.js";

export interface ToolChaosConfig {
  failureRate: number;
  seed: string;
}

export interface ToolChaosController {
  maybeFail(toolName: string): void;
}

export function readToolChaosConfig(
  env: Record<string, string | undefined> = process.env,
): ToolChaosConfig {
  const rawRate = env.PR_REPORT_TOOL_FAILURE_RATE ?? "0";
  const failureRate = Number(rawRate);
  if (!Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1) {
    throw new Error("PR_REPORT_TOOL_FAILURE_RATE must be a number from 0 to 1.");
  }

  return {
    failureRate,
    seed: env.PR_REPORT_TOOL_FAILURE_SEED ?? "default",
  };
}

export function createToolChaosController(
  pr: Pick<PullRequestRecord, "repo" | "number">,
  config: ToolChaosConfig = readToolChaosConfig(),
): ToolChaosController {
  const shouldFail = shouldFailAnalyzerTool(pr, config);
  let triggered = false;

  return {
    maybeFail(toolName: string): void {
      if (!shouldFail || triggered) {
        return;
      }
      triggered = true;
      throw new Error(
        `Injected PR analyzer tool failure: ${JSON.stringify({
          injectedFailure: true,
          repo: pr.repo,
          prNumber: pr.number,
          toolName,
          failureRate: config.failureRate,
          seed: config.seed,
        })}`,
      );
    },
  };
}

export function shouldFailAnalyzerTool(
  pr: Pick<PullRequestRecord, "repo" | "number">,
  config: ToolChaosConfig,
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

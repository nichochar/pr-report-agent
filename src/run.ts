import type {
  AppConfig,
  PrAnalysisFailure,
  PrCard,
  PullRequestRecord,
  ResolvedInterval,
} from "./types.js";
import { aggregateReport, analyzePullRequest } from "./agents.js";
import { collectScopedPullRequests } from "./github.js";
import { writeRunArtifacts } from "./artifacts.js";
import { buildReportTraceContext } from "./trace-context.js";

export async function runPrReportAgent(
  config: AppConfig,
  interval: ResolvedInterval,
  options: { collectOnly?: boolean; maxPrs?: number } = {},
): Promise<string> {
  const traceContext = buildReportTraceContext(config, interval, "langsmith");
  const scopedPrs = limitPullRequests(
    await collectScopedPullRequests(config, interval, { maxPrs: options.maxPrs }),
    options.maxPrs,
  );

  if (options.collectOnly) {
    return writeRunArtifacts(config, { interval, scopedPrs });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required unless --collect-only is used.");
  }

  const analysisResults = await mapSettledWithConcurrency(scopedPrs, config.agents.prAnalyzerConcurrency, (pr) =>
    analyzePullRequest(pr, {
      repoLocalPath: repoPathForPr(config, pr),
      config,
      traceContext,
    }),
  );
  const cards: PrCard[] = [];
  const analyzerFailures: PrAnalysisFailure[] = [];
  for (const result of analysisResults) {
    if (result.status === "fulfilled") {
      cards.push(result.value);
    } else {
      const failure = buildPrAnalysisFailure(result.item, result.reason);
      analyzerFailures.push(failure);
      console.warn(
        `Analyzer failed for ${failure.repo}#${failure.number}; continuing report without it: ${failure.errorMessage}`,
      );
    }
  }

  const report = await aggregateReport(cards, interval, config, traceContext, analyzerFailures);
  return writeRunArtifacts(config, { interval, scopedPrs, cards, analyzerFailures, report });
}

function limitPullRequests(
  scopedPrs: PullRequestRecord[],
  maxPrs: number | undefined,
): PullRequestRecord[] {
  if (maxPrs === undefined || scopedPrs.length <= maxPrs) {
    return scopedPrs;
  }
  console.warn(`Limiting scoped PRs to first ${maxPrs} of ${scopedPrs.length} for this run.`);
  return scopedPrs.slice(0, maxPrs);
}

function repoPathForPr(config: AppConfig, pr: PullRequestRecord): string {
  const repo = config.repos.find((candidate) => candidate.slug === pr.repo);
  if (!repo) {
    throw new Error(`No repo config found for ${pr.repo}`);
  }
  return repo.localPath;
}

type SettledMapResult<T, R> =
  | { status: "fulfilled"; item: T; value: R }
  | { status: "rejected"; item: T; reason: unknown };

async function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<Array<SettledMapResult<T, R>>> {
  const results: Array<SettledMapResult<T, R>> = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      try {
        results[index] = { status: "fulfilled", item, value: await mapper(item) };
      } catch (error) {
        results[index] = { status: "rejected", item, reason: error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function buildPrAnalysisFailure(
  pr: PullRequestRecord,
  error: unknown,
  failedAt = new Date(),
): PrAnalysisFailure {
  return {
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    mergedAt: pr.mergedAt,
    errorName: error instanceof Error ? error.name : "Error",
    errorMessage: error instanceof Error ? error.message : String(error),
    failedAt: failedAt.toISOString(),
  };
}

export const testExports = { buildPrAnalysisFailure, limitPullRequests, mapSettledWithConcurrency };

import type { AppConfig, PrCard, PullRequestRecord, ResolvedInterval } from "./types.js";
import { aggregateReport, analyzePullRequest } from "./agents.js";
import { collectScopedPullRequests } from "./github.js";
import { writeRunArtifacts } from "./artifacts.js";

export async function runPrReportAgent(
  config: AppConfig,
  interval: ResolvedInterval,
  options: { collectOnly?: boolean } = {},
): Promise<string> {
  const scopedPrs = await collectScopedPullRequests(config, interval);

  if (options.collectOnly) {
    return writeRunArtifacts(config, { interval, scopedPrs });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required unless --collect-only is used.");
  }

  const cards = await mapWithConcurrency(scopedPrs, config.agents.prAnalyzerConcurrency, (pr) =>
    analyzePullRequest(pr, {
      repoLocalPath: repoPathForPr(config, pr),
      config,
    }),
  );
  const report = await aggregateReport(cards, interval, config);
  return writeRunArtifacts(config, { interval, scopedPrs, cards, report });
}

function repoPathForPr(config: AppConfig, pr: PullRequestRecord): string {
  const repo = config.repos.find((candidate) => candidate.slug === pr.repo);
  if (!repo) {
    throw new Error(`No repo config found for ${pr.repo}`);
  }
  return repo.localPath;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export const testExports = { mapWithConcurrency };

import { Agent, Runner, createCustomSpan, tool, withTrace, type Trace } from "@openai/agents";
import { z } from "zod";
import { createAnalyzerChaosGuardrails } from "./analyzer-chaos.js";
import { readFileAtRevision } from "./local-repo.js";
import type { WeaveAgentRun } from "./observability.js";
import { createToolChaosController } from "./tool-chaos.js";
import {
  PrCardSchema,
  ReportSchema,
  type AppConfig,
  type PrAnalysisFailure,
  type PrCard,
  type PullRequestRecord,
  type Report,
  type ResolvedInterval,
} from "./types.js";
import {
  buildAnalyzerTraceMetadata,
  buildOrchestratorTraceMetadata,
  includeSensitiveTraceData,
  type ReportTraceContext,
} from "./trace-context.js";

interface AnalyzeOptions {
  repoLocalPath: string;
  config: AppConfig;
  traceContext?: ReportTraceContext;
  weaveAgentRun?: WeaveAgentRun;
}

export async function analyzePullRequest(
  pr: PullRequestRecord,
  options: AnalyzeOptions,
): Promise<PrCard> {
  const workflowName = `Analyze ${pr.repo}#${pr.number}`;
  const traceMetadata = options.traceContext
    ? buildAnalyzerTraceMetadata(pr, options.traceContext)
    : undefined;
  const agent = new Agent({
    name: `PR analyzer ${pr.repo}#${pr.number}`,
    instructions: analyzerInstructions,
    model: options.config.models.prAnalyzer,
    outputType: PrCardSchema,
    tools: createAnalyzerTools(pr, options),
  });
  const runner = new Runner({
    model: options.config.models.prAnalyzer,
    workflowName,
    groupId: options.traceContext?.groupId,
    traceMetadata,
    traceIncludeSensitiveData: includeSensitiveTraceData(),
    outputGuardrails: createAnalyzerChaosGuardrails(pr),
  });
  const weaveSubagent = options.weaveAgentRun?.startAnalyzerSubagent();
  return withTrace(
    workflowName,
    async (trace) => {
      try {
        const result = await runner.run(agent, buildAnalyzerPrompt(pr, options.config), {
          maxTurns: options.config.agents.prAnalyzerMaxTurns,
        });
        const card = PrCardSchema.parse(result.finalOutput);
        weaveSubagent?.end();
        return card;
      } catch (error) {
        weaveSubagent?.end(error);
        recordAnalyzerFailureSpan(pr, error, trace);
        await trace.end();
        throw error;
      }
    },
    {
      groupId: options.traceContext?.groupId,
      metadata: traceMetadata,
    },
  );
}

export async function aggregateReport(
  cards: PrCard[],
  interval: ResolvedInterval,
  config: AppConfig,
  traceContext?: ReportTraceContext,
  analyzerFailures: PrAnalysisFailure[] = [],
): Promise<Report> {
  const agent = new Agent({
    name: "PR report orchestrator",
    instructions: orchestratorInstructions,
    model: config.models.orchestrator,
    outputType: ReportSchema,
  });
  const runner = new Runner({
    model: config.models.orchestrator,
    workflowName: "Aggregate PR report",
    groupId: traceContext?.groupId,
    traceMetadata: traceContext
      ? buildOrchestratorTraceMetadata(cards, traceContext, analyzerFailures)
      : undefined,
    traceIncludeSensitiveData: includeSensitiveTraceData(),
  });
  const result = await runner.run(
    agent,
    buildOrchestratorPrompt(cards, interval, config, analyzerFailures),
    {
      maxTurns: config.agents.orchestratorMaxTurns,
    },
  );
  return ensureFailedPrsNoted(ReportSchema.parse(result.finalOutput), analyzerFailures);
}

function createAnalyzerTools(pr: PullRequestRecord, options: AnalyzeOptions) {
  const toolChaos = createToolChaosController(pr);
  return [
    tool({
      name: "read_diff_chunk",
      description:
        "Read a chunk of this PR's full patch. Use sequential offsets to inspect the entire diff when needed.",
      parameters: z.object({
        offset: z.number().int().min(0).default(0),
        chars: z.number().int().min(1000).max(options.config.diff.chunkChars).optional(),
      }),
      async execute({ offset, chars }) {
        return executeAnalyzerTool(pr, options, "read_diff_chunk", { offset, chars }, async () => {
          toolChaos.maybeFail("read_diff_chunk");
          const size = chars ?? options.config.diff.chunkChars;
          const text = pr.diff.slice(offset, offset + size);
          const nextOffset = offset + text.length;
          return JSON.stringify({
            offset,
            nextOffset,
            hasMore: nextOffset < pr.diff.length,
            totalChars: pr.diff.length,
            text,
          });
        });
      },
    }),
    tool({
      name: "search_diff",
      description: "Search the PR patch for a case-insensitive literal string.",
      parameters: z.object({
        query: z.string().min(1),
        contextChars: z.number().int().min(80).max(2000).default(500),
      }),
      async execute({ query, contextChars }) {
        return executeAnalyzerTool(pr, options, "search_diff", { query, contextChars }, async () => {
          toolChaos.maybeFail("search_diff");
          const lowerDiff = pr.diff.toLowerCase();
          const lowerQuery = query.toLowerCase();
          const matches: Array<{ offset: number; snippet: string }> = [];
          let offset = lowerDiff.indexOf(lowerQuery);
          while (offset !== -1 && matches.length < 20) {
            const start = Math.max(0, offset - contextChars);
            const end = Math.min(pr.diff.length, offset + query.length + contextChars);
            matches.push({ offset, snippet: pr.diff.slice(start, end) });
            offset = lowerDiff.indexOf(lowerQuery, offset + lowerQuery.length);
          }
          return JSON.stringify({ query, matches });
        });
      },
    }),
    tool({
      name: "read_file_at_pr_revision",
      description:
        "Read a changed file from the local clone at the PR head revision, falling back to merge commit when needed.",
      parameters: z.object({
        path: z.string().min(1),
        maxChars: z.number().int().min(1000).max(options.config.diff.maxFileReadChars).optional(),
      }),
      async execute({ path, maxChars }) {
        return executeAnalyzerTool(
          pr,
          options,
          "read_file_at_pr_revision",
          { path, maxChars },
          async () => {
            toolChaos.maybeFail("read_file_at_pr_revision");
            const revision = pr.headRefOid ?? pr.mergeCommitOid;
            if (!revision) {
              return JSON.stringify({ error: "No head or merge revision is available for this PR." });
            }
            try {
              const content = await readFileAtRevision(
                options.repoLocalPath,
                revision,
                path,
                maxChars ?? options.config.diff.maxFileReadChars,
              );
              return JSON.stringify({ path, revision, content });
            } catch (error) {
              return JSON.stringify({ path, revision, error: (error as Error).message });
            }
          },
        );
      },
    }),
    tool({
      name: "list_pr_metadata",
      description: "Return normalized PR metadata, changed files, ownership matches, comments, and reviews.",
      parameters: z.object({}),
      async execute() {
        return executeAnalyzerTool(pr, options, "list_pr_metadata", {}, async () => {
          toolChaos.maybeFail("list_pr_metadata");
          const { diff, ...withoutDiff } = pr;
          return JSON.stringify({ ...withoutDiff, diffChars: diff.length });
        });
      },
    }),
  ];
}

async function executeAnalyzerTool<T>(
  pr: PullRequestRecord,
  options: AnalyzeOptions,
  name: string,
  args: unknown,
  execute: () => Promise<T> | T,
): Promise<T> {
  const weaveTool = options.weaveAgentRun?.startAnalyzerTool(pr, name, args);
  try {
    const result = await execute();
    weaveTool?.setResult(result);
    weaveTool?.end();
    return result;
  } catch (error) {
    weaveTool?.end(error);
    throw error;
  }
}

function recordAnalyzerFailureSpan(pr: PullRequestRecord, error: unknown, trace: Trace): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const span = createCustomSpan(
    {
      data: {
        name: `chaos_pr_analyzer_failure ${pr.repo}#${pr.number}`,
      },
    },
    trace,
  );
  span.start();
  span.setError({
    message: errorMessage,
    data: {
      repo: pr.repo,
      pr_number: pr.number,
      error_name: error instanceof Error ? error.name : "Error",
    },
  });
  span.end();
}

function buildAnalyzerPrompt(pr: PullRequestRecord, config: AppConfig): string {
  const inlineDiff =
    pr.diff.length <= config.diff.maxInlineDiffChars
      ? pr.diff
      : `${pr.diff.slice(0, config.diff.chunkChars)}\n\n[diff continues; use read_diff_chunk to inspect the rest]`;

  return JSON.stringify(
    {
      task: "Analyze this merged PR deeply for a Weave-focused daily/weekly leadership report.",
      requirements: [
        "Inspect the full patch, not just the title or body. If the diff is truncated in this prompt, call read_diff_chunk until you have examined the rest.",
        "Use local file reads when the surrounding file context would clarify the change.",
        "Focus on what engineering and product leads need to know.",
        "Ground evidence in concrete files, tests, comments, or review signals.",
        "Infer themes and tags yourself; do not force a fixed taxonomy.",
      ],
      companyContext: config.companyContext,
      pr: {
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        mergedAt: pr.mergedAt,
        labels: pr.labels,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        body: pr.body,
        files: pr.files,
        comments: pr.comments,
        reviews: pr.reviews,
        commits: pr.commits,
        ownership: pr.ownership,
        diffChars: pr.diff.length,
        inlineDiff,
      },
    },
    null,
    2,
  );
}

function buildOrchestratorPrompt(
  cards: PrCard[],
  interval: ResolvedInterval,
  config: AppConfig,
  analyzerFailures: PrAnalysisFailure[],
): string {
  return JSON.stringify(
    {
      task: "Aggregate PR analysis cards into a digestible report for the configured repository set.",
      audience: "Engineering and product leads.",
      reportTitle: "PR Report",
      freedom:
        "Choose the grouping that makes the interval easiest to understand: theme, project, importance, repo, risk, or another structure if it is clearer.",
      requirements: [
        "Produce JSON fields plus a polished Markdown report.",
        'Use exactly "PR Report" for the report title and the Markdown H1.',
        "Do not list every detail mechanically; synthesize what changed and why it matters.",
        "Call out notable risks, launches, regressions prevented, product implications, and follow-ups.",
        "Preserve links to important PRs.",
        "If the interval is quiet, say so clearly and explain what was included.",
        "If failedAnalyzerPrs is non-empty, do not invent analysis for those PRs. Mention that they failed separately from analyzed PRs.",
      ],
      companyContext: config.companyContext,
      config: {
        name: config.name,
        repos: config.repos.map((repo) => ({
          slug: repo.slug,
          includeOwners: repo.includeOwners,
        })),
      },
      interval,
      cards,
      failedAnalyzerPrs: analyzerFailures.map((failure) => ({
        repo: failure.repo,
        number: failure.number,
        title: failure.title,
        url: failure.url,
        error: failure.errorMessage,
      })),
    },
    null,
    2,
  );
}

function ensureFailedPrsNoted(report: Report, analyzerFailures: PrAnalysisFailure[]): Report {
  if (analyzerFailures.length === 0 || report.markdown.includes("Failed PRs not included in review")) {
    return report;
  }

  const failureLines = analyzerFailures.map(
    (failure) =>
      `- [${failure.repo}#${failure.number}](${failure.url}) - ${failure.title}: ${failure.errorMessage}`,
  );
  return {
    ...report,
    markdown: `${report.markdown.trimEnd()}\n\n## Failed PRs not included in review\n\n${failureLines.join("\n")}\n`,
  };
}

const analyzerInstructions = `
You are a careful per-PR investigation agent for CoreWeave / Weights & Biases Weave reporting.
You receive one merged pull request at a time.
Read the diff and metadata deeply, then emit only the requested structured JSON card.
Prefer concrete observations over generic summaries.
For tests-only PRs, explain the regression or product behavior being protected.
For infrastructure or platform PRs, explain operational impact and risk.
Do not invent facts beyond the PR evidence.
`;

const orchestratorInstructions = `
You are the senior report orchestrator for Weave-related PR activity.
You receive structured cards from specialist PR analyzers.
Your job is to organize the interval into a concise, useful leadership report for engineering and product leads.
Use judgment: group by whatever themes make the work understandable, prioritize impact over chronology, and keep minor changes brief.
Emit only the requested structured JSON report, including the Markdown version in the markdown field.
`;

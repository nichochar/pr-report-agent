import { Agent, Runner, tool } from "@openai/agents";
import { z } from "zod";
import { readFileAtRevision } from "./local-repo.js";
import {
  PrCardSchema,
  ReportSchema,
  type AppConfig,
  type PrCard,
  type PullRequestRecord,
  type Report,
  type ResolvedInterval,
} from "./types.js";

interface AnalyzeOptions {
  repoLocalPath: string;
  config: AppConfig;
}

export async function analyzePullRequest(
  pr: PullRequestRecord,
  options: AnalyzeOptions,
): Promise<PrCard> {
  const agent = new Agent({
    name: `PR analyzer ${pr.repo}#${pr.number}`,
    instructions: analyzerInstructions,
    model: options.config.models.prAnalyzer,
    outputType: PrCardSchema,
    tools: createAnalyzerTools(pr, options),
  });
  const runner = new Runner({ model: options.config.models.prAnalyzer });
  const result = await runner.run(agent, buildAnalyzerPrompt(pr, options.config), {
    maxTurns: options.config.agents.prAnalyzerMaxTurns,
  });
  return PrCardSchema.parse(result.finalOutput);
}

export async function aggregateReport(
  cards: PrCard[],
  interval: ResolvedInterval,
  config: AppConfig,
): Promise<Report> {
  const agent = new Agent({
    name: "Weave PR report orchestrator",
    instructions: orchestratorInstructions,
    model: config.models.orchestrator,
    outputType: ReportSchema,
  });
  const runner = new Runner({ model: config.models.orchestrator });
  const result = await runner.run(agent, buildOrchestratorPrompt(cards, interval, config), {
    maxTurns: config.agents.orchestratorMaxTurns,
  });
  return ReportSchema.parse(result.finalOutput);
}

function createAnalyzerTools(pr: PullRequestRecord, options: AnalyzeOptions) {
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
    }),
    tool({
      name: "list_pr_metadata",
      description: "Return normalized PR metadata, changed files, ownership matches, comments, and reviews.",
      parameters: z.object({}),
      async execute() {
        const { diff, ...withoutDiff } = pr;
        return JSON.stringify({ ...withoutDiff, diffChars: diff.length });
      },
    }),
  ];
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
): string {
  return JSON.stringify(
    {
      task: "Aggregate PR analysis cards into a digestible CoreWeave/W&B Weave report.",
      audience: "Engineering and product leads.",
      freedom:
        "Choose the grouping that makes the interval easiest to understand: theme, project, importance, repo, risk, or another structure if it is clearer.",
      requirements: [
        "Produce JSON fields plus a polished Markdown report.",
        "Do not list every detail mechanically; synthesize what changed and why it matters.",
        "Call out notable risks, launches, regressions prevented, product implications, and follow-ups.",
        "Preserve links to important PRs.",
        "If the interval is quiet, say so clearly and explain what was included.",
      ],
      companyContext: config.companyContext,
      interval,
      cards,
    },
    null,
    2,
  );
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

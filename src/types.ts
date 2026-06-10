import { z } from "zod";

export const IntervalPresetSchema = z.enum(["previous-day", "previous-week"]);
export type IntervalPreset = z.infer<typeof IntervalPresetSchema>;

export const RepoConfigSchema = z.object({
  slug: z.string().regex(/^[^/]+\/[^/]+$/),
  localPath: z.string(),
  includeOwners: z.array(z.string()).min(1),
  codeownersPaths: z.array(z.string()).default([".github/CODEOWNERS"]),
  productContext: z.string().default(""),
});
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export const AppConfigSchema = z.object({
  companyContext: z.string(),
  defaultTimezone: z.string().default("America/Los_Angeles"),
  defaultInterval: IntervalPresetSchema.default("previous-day"),
  outputDir: z.string().default("runs"),
  models: z.object({
    orchestrator: z.string().default("gpt-5.5"),
    prAnalyzer: z.string().default("gpt-5.4-mini"),
  }),
  github: z.object({
    maxPullRequests: z.number().int().positive().default(1000),
    excludeBots: z.boolean().default(true),
    ignoredAuthorLogins: z.array(z.string()).default([]),
  }),
  diff: z.object({
    chunkChars: z.number().int().positive().default(12000),
    maxInlineDiffChars: z.number().int().positive().default(180000),
    maxFileReadChars: z.number().int().positive().default(40000),
  }),
  agents: z.object({
    prAnalyzerConcurrency: z.number().int().positive().default(3),
    prAnalyzerMaxTurns: z.number().int().positive().default(24),
    orchestratorMaxTurns: z.number().int().positive().default(12),
  }),
  repos: z.array(RepoConfigSchema).min(1),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface ResolvedInterval {
  startIso: string;
  endIso: string;
  timezone: string;
  label: string;
}

export type Trigger =
  | { type: "manual"; preset: IntervalPreset }
  | { type: "manual"; start: string; end: string }
  | { type: "schedule"; cadence: "daily" | "weekly" };

export interface CodeownersRule {
  sourcePath: string;
  lineNumber: number;
  pattern: string;
  owners: string[];
}

export interface CodeownersMatch {
  path: string;
  owners: string[];
  rule?: CodeownersRule;
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: string;
}

export interface PullRequestRecord {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: {
    login: string;
    name?: string;
    isBot: boolean;
  };
  mergedAt: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  baseRefName?: string;
  headRefName?: string;
  baseRefOid?: string;
  headRefOid?: string;
  mergeCommitOid?: string;
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  body?: string;
  files: PullRequestFile[];
  comments: Array<{
    author: string;
    body: string;
    createdAt?: string;
    url?: string;
  }>;
  reviews: Array<{
    author: string;
    state: string;
    body?: string;
    submittedAt?: string;
  }>;
  commits: Array<{
    oid: string;
    messageHeadline: string;
    messageBody?: string;
    authors: string[];
  }>;
  ownership: {
    includeOwners: string[];
    matchedFiles: CodeownersMatch[];
  };
  diff: string;
}

export const PrCardSchema = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  mergedAt: z.string(),
  ownerScope: z.object({
    includeOwners: z.array(z.string()),
    matchedFiles: z.array(
      z.object({
        path: z.string(),
        owners: z.array(z.string()),
        pattern: z.string().optional(),
      }),
    ),
  }),
  summary: z.string(),
  whatChanged: z.array(z.string()),
  productImpact: z.string(),
  technicalDetails: z.array(z.string()),
  notableFiles: z.array(
    z.object({
      path: z.string(),
      role: z.string(),
      notableChanges: z.string(),
    }),
  ),
  themes: z.array(z.string()),
  tags: z.array(z.string()),
  risk: z.object({
    level: z.enum(["low", "medium", "high"]),
    reasons: z.array(z.string()),
  }),
  leadRelevance: z.string(),
  evidence: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type PrCard = z.infer<typeof PrCardSchema>;

export const ReportSchema = z.object({
  title: z.string(),
  interval: z.object({
    start: z.string(),
    end: z.string(),
    timezone: z.string(),
  }),
  audience: z.string(),
  overview: z.string(),
  headlineBullets: z.array(z.string()),
  sections: z.array(
    z.object({
      heading: z.string(),
      summary: z.string(),
      prs: z.array(
        z.object({
          repo: z.string(),
          number: z.number().int(),
          title: z.string(),
          url: z.string(),
          whyItMatters: z.string(),
        }),
      ),
    }),
  ),
  notableRisks: z.array(z.string()),
  followUps: z.array(z.string()),
  markdown: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;

export interface RunArtifacts {
  interval: ResolvedInterval;
  scopedPrs: PullRequestRecord[];
  cards?: PrCard[];
  report?: Report;
}

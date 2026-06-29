import type { AppConfig, PrAnalysisFailure, PrCard, Report, ResolvedInterval } from "../types.js";

export type RunStatus = "complete" | "collect-only" | "partial" | "error";

export interface ArtifactFlags {
  scopedPrs: boolean;
  scopedPrsWithDiffs: boolean;
  cards: boolean;
  analyzerFailures: boolean;
  reportJson: boolean;
  reportMarkdown: boolean;
}

export interface RepoCount {
  repo: string;
  count: number;
}

export interface RiskCounts {
  low: number;
  medium: number;
  high: number;
}

export interface IndexedRunSummary {
  id: string;
  status: RunStatus;
  title?: string;
  interval?: ResolvedInterval;
  createdAt?: string;
  updatedAt?: string;
  prCount: number;
  cardCount: number;
  failureCount: number;
  repos: RepoCount[];
  riskCounts: RiskCounts;
  areas: string[];
  artifacts: ArtifactFlags;
  error?: string;
}

export interface UiConfigSummary {
  name: string;
  repos: Array<{
    slug: string;
    localPath: string;
    includeOwners: string[];
  }>;
}

export type EditableAppConfig = AppConfig;

export interface ConfigValidationIssue {
  path: string;
  severity: "warning";
  message: string;
}

export interface ConfigResponse {
  config: EditableAppConfig;
  revision: string;
  validation: ConfigValidationIssue[];
}

export interface SaveConfigRequest {
  config: EditableAppConfig;
  revision?: string;
}

export interface RunsListResponse {
  config: UiConfigSummary;
  runs: IndexedRunSummary[];
}

export interface ScopedPrSummary {
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: {
    login: string;
    name?: string;
    isBot: boolean;
  };
  mergedAt: string;
  labels?: string[];
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  files?: Array<{
    path: string;
    additions: number;
    deletions: number;
    changeType: string;
  }>;
  ownership?: {
    includeOwners: string[];
    matchedFiles: Array<{
      path: string;
      owners: string[];
      pattern?: string;
    }>;
  };
  diffChars?: number;
  diffPath?: string;
}

export type UiPrCard = PrCard & {
  id: string;
  derivedAreas: string[];
  sectionHeadings: string[];
};

export interface RunDetailResponse extends IndexedRunSummary {
  report?: Report;
  reportMarkdown?: string;
  cards: UiPrCard[];
  scopedPrs: ScopedPrSummary[];
  analyzerFailures: PrAnalysisFailure[];
}

export type LaunchRunRequest =
  | { preset: "previous-day" }
  | { start: string; end: string };

export type JobStatus = "running" | "succeeded" | "failed";

export interface JobLogEntry {
  stream: "stdout" | "stderr" | "system";
  text: string;
  timestamp: string;
}

export interface RunJob {
  id: string;
  status: JobStatus;
  command: string[];
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
  logs: JobLogEntry[];
}

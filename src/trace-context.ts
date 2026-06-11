import type {
  AppConfig,
  PrAnalysisFailure,
  PrCard,
  PullRequestRecord,
  ResolvedInterval,
} from "./types.js";

export interface ReportTraceContext {
  groupId: string;
  baseMetadata: Record<string, string>;
}

export function reportTraceGroupId(interval: ResolvedInterval): string {
  return `pr-report:${interval.label}`;
}

export function buildReportTraceContext(
  config: AppConfig,
  interval: ResolvedInterval,
  telemetryLibrary: string,
): ReportTraceContext {
  const groupId = reportTraceGroupId(interval);
  return {
    groupId,
    baseMetadata: {
      app: "pr-report-agent",
      telemetry_library: telemetryLibrary,
      conversation_id: groupId,
      interval_label: interval.label,
      interval_start_utc: interval.startIso,
      interval_end_utc: interval.endIso,
      interval_timezone: interval.timezone,
    },
  };
}

export function buildAnalyzerTraceMetadata(
  pr: PullRequestRecord,
  context: ReportTraceContext,
): Record<string, string> {
  return {
    ...context.baseMetadata,
    stage: "analyze_pr",
    repo: pr.repo,
    pr_number: String(pr.number),
    pr_author: pr.author.login,
    pr_merged_at: pr.mergedAt,
    pr_matched_files: String(pr.ownership.matchedFiles.length),
    pr_diff_chars: String(pr.diff.length),
  };
}

export function buildOrchestratorTraceMetadata(
  cards: PrCard[],
  context: ReportTraceContext,
  analyzerFailures: PrAnalysisFailure[] = [],
): Record<string, string> {
  return {
    ...context.baseMetadata,
    stage: "aggregate_report",
    pr_cards: String(cards.length),
    failed_pr_analyzers: String(analyzerFailures.length),
    repos_with_cards: Array.from(new Set(cards.map((card) => card.repo))).sort().join(","),
  };
}

export function includeSensitiveTraceData(): boolean {
  const value = process.env.PR_REPORT_TRACE_INCLUDE_SENSITIVE_DATA?.toLowerCase();
  return value !== "0" && value !== "false";
}

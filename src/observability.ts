import { addTraceProcessor, type TracingProcessor } from "@openai/agents";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  createOpenAIAgentsTracingProcessor,
  flushOTel,
  init,
  startSession,
  type Session,
  type SubAgent,
  type Tool,
  type Turn,
} from "weave";
import { includeSensitiveTraceData, type ReportTraceContext } from "./trace-context.js";
import type { AppConfig, PrAnalysisFailure, PrCard, PullRequestRecord, ResolvedInterval } from "./types.js";

let processor: TracingProcessor | undefined;
let initialized = false;

export async function initializeObservability(): Promise<boolean> {
  const project = process.env.WEAVE_PROJECT;
  if (!project) {
    return false;
  }
  if (initialized) {
    return true;
  }

  const otelExportTimeoutMillis = readPositiveIntEnv(
    "PR_REPORT_WEAVE_OTEL_EXPORT_TIMEOUT_MS",
    120_000,
  );
  configureOtelExporterEnv(otelExportTimeoutMillis);
  const maxExportBatchSize = readPositiveIntEnv("PR_REPORT_WEAVE_OTEL_MAX_EXPORT_BATCH_SIZE", 32);

  await init(project, {
    genai: {
      spanProcessor: new BatchSpanProcessor(
        new FetchOtlpTraceExporter({
          projectId: project,
          timeoutMillis: otelExportTimeoutMillis,
        }),
        {
          exportTimeoutMillis: otelExportTimeoutMillis,
          maxExportBatchSize,
        },
      ),
    },
  });
  processor = createOpenAIAgentsTracingProcessor();
  addTraceProcessor(processor);
  initialized = true;
  return true;
}

export async function flushObservability(): Promise<void> {
  await bestEffortFlush("Weave OpenAI Agents trace processor", () => processor?.forceFlush());
  await bestEffortFlush("Weave GenAI OTel exporter", () => flushOTel());
}

export interface WeaveAgentRun {
  startAnalyzerSubagent(): WeaveAgentSpan | undefined;
  startAnalyzerTool(pr: PullRequestRecord, name: string, args: unknown): WeaveAgentTool | undefined;
  recordAnalyzerFailure(failure: PrAnalysisFailure): void;
  recordReportResult(cards: PrCard[], analyzerFailures: PrAnalysisFailure[]): void;
  end(error?: unknown): void;
}

export interface WeaveAgentSpan {
  end(error?: unknown): void;
}

export interface WeaveAgentTool {
  setResult(result: unknown): void;
  end(error?: unknown): void;
}

export function startReportAgentRun(
  config: AppConfig,
  interval: ResolvedInterval,
  traceContext: ReportTraceContext,
  scopedPrCount: number,
): WeaveAgentRun | undefined {
  if (!initialized) {
    return undefined;
  }

  const session = startSession({
    agentName: "pr-report-agent",
    sessionId: traceContext.groupId,
    model: config.models.orchestrator,
  });
  const turn = session.startTurn({
    agentName: "pr-report-agent",
    model: config.models.orchestrator,
  });
  turn
    .setAttribute("pr_report.app", "pr-report-agent")
    .setAttribute("pr_report.interval.label", interval.label)
    .setAttribute("pr_report.interval.start_utc", interval.startIso)
    .setAttribute("pr_report.interval.end_utc", interval.endIso)
    .setAttribute("pr_report.interval.timezone", interval.timezone)
    .setAttribute("pr_report.scoped_prs", scopedPrCount)
    .setAttribute("pr_report.repos", config.repos.map((repo) => repo.slug).join(","));

  return new ActiveWeaveAgentRun(session, turn, config);
}

class ActiveWeaveAgentRun implements WeaveAgentRun {
  private ended = false;
  private readonly includeSensitiveData = includeSensitiveTraceData();
  private readonly payloadMaxChars = readPositiveIntEnv("PR_REPORT_WEAVE_AGENT_PAYLOAD_MAX_CHARS", 2_000);

  constructor(
    private readonly session: Session,
    private readonly turn: Turn,
    private readonly config: AppConfig,
  ) {}

  startAnalyzerSubagent(): WeaveAgentSpan | undefined {
    return new ActiveWeaveAgentSpan(
      this.turn.startSubagent({
        name: "pr-analyzer",
        model: this.config.models.prAnalyzer,
      }),
    );
  }

  startAnalyzerTool(
    pr: PullRequestRecord,
    name: string,
    args: unknown,
  ): WeaveAgentTool | undefined {
    return new ActiveWeaveAgentTool(
      this.turn.startTool({
        name,
        args: serializeToolPayload(
          {
            repo: pr.repo,
            prNumber: pr.number,
            args,
          },
          this.includeSensitiveData,
          this.payloadMaxChars,
        ),
      }),
      this.includeSensitiveData,
      this.payloadMaxChars,
    );
  }

  recordAnalyzerFailure(failure: PrAnalysisFailure): void {
    if (this.ended) {
      return;
    }
    this.turn.addEvent("pr_analyzer.failed", {
      "pr_report.repo": failure.repo,
      "pr_report.pr_number": failure.number,
      "pr_report.error_name": failure.errorName,
      "pr_report.error_message": failure.errorMessage,
    });
  }

  recordReportResult(cards: PrCard[], analyzerFailures: PrAnalysisFailure[]): void {
    if (this.ended) {
      return;
    }
    this.turn
      .setAttribute("pr_report.cards", cards.length)
      .setAttribute("pr_report.failed_analyzers", analyzerFailures.length)
      .setAttribute(
        "pr_report.repos_with_cards",
        Array.from(new Set(cards.map((card) => card.repo))).sort().join(","),
      );
  }

  end(error?: unknown): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const normalizedError = error === undefined ? undefined : toError(error);
    this.turn.end(normalizedError ? { error: normalizedError } : undefined);
    this.session.end();
  }
}

class ActiveWeaveAgentSpan implements WeaveAgentSpan {
  private ended = false;

  constructor(private readonly span: SubAgent) {}

  end(error?: unknown): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const normalizedError = error === undefined ? undefined : toError(error);
    this.span.end(normalizedError ? { error: normalizedError } : undefined);
  }
}

class ActiveWeaveAgentTool implements WeaveAgentTool {
  private ended = false;

  constructor(
    private readonly tool: Tool,
    private readonly includeSensitiveData: boolean,
    private readonly payloadMaxChars: number,
  ) {}

  setResult(result: unknown): void {
    this.tool.result = serializeToolPayload(result, this.includeSensitiveData, this.payloadMaxChars);
  }

  end(error?: unknown): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const normalizedError = error === undefined ? undefined : toError(error);
    this.tool.end(normalizedError ? { error: normalizedError } : undefined);
  }
}

async function bestEffortFlush(label: string, flush: () => Promise<void> | void | undefined): Promise<void> {
  try {
    await flush();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (failOnObservabilityFlushError()) {
      console.warn(`${label} flush failed; failing report run so telemetry loss is visible: ${message}`);
      throw error;
    }
    console.warn(`${label} flush failed; continuing because PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR=false: ${message}`);
  }
}

function serializeToolPayload(
  value: unknown,
  includeSensitiveData: boolean,
  maxChars: number,
): string {
  if (!includeSensitiveData) {
    return JSON.stringify({ redacted: true, type: payloadType(value) });
  }
  const normalized = truncatePayload(value, maxChars);
  if (typeof value === "string") {
    return normalized as string;
  }
  return JSON.stringify(normalized);
}

function truncatePayload(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") {
    return truncateString(value, maxChars);
  }
  if (Array.isArray(value)) {
    const maxItems = 50;
    const truncated = value.slice(0, maxItems).map((item) => truncatePayload(item, maxChars));
    if (value.length > maxItems) {
      truncated.push(`[truncated ${value.length - maxItems} additional items]`);
    }
    return truncated;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const maxEntries = 80;
    const truncated: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, maxEntries)) {
      truncated[key] = truncatePayload(entryValue, maxChars);
    }
    if (entries.length > maxEntries) {
      truncated.__truncatedKeys = entries.length - maxEntries;
    }
    return truncated;
  }
  return value;
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars from Weave Agents tool payload]`;
}

function payloadType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function readPositiveIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function failOnObservabilityFlushError(): boolean {
  const value = process.env.PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR?.toLowerCase();
  return value !== "0" && value !== "false";
}

function configureOtelExporterEnv(timeoutMillis: number): void {
  if (!process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT) {
    process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT = String(timeoutMillis);
  }
}

interface FetchOtlpTraceExporterOptions {
  projectId: string;
  timeoutMillis: number;
}

class FetchOtlpTraceExporter implements SpanExporter {
  private readonly pendingExports = new Set<Promise<void>>();
  private shutdownRequested = false;

  constructor(private readonly options: FetchOtlpTraceExporterOptions) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.shutdownRequested) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error("Exporter has been shutdown"),
      });
      return;
    }
    const exportPromise = this.exportSpans(spans)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) =>
        resultCallback({
          code: ExportResultCode.FAILED,
          error: toError(error),
        }),
      )
      .finally(() => this.pendingExports.delete(exportPromise));
    this.pendingExports.add(exportPromise);
  }

  async forceFlush(): Promise<void> {
    await Promise.all(this.pendingExports);
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    await this.forceFlush();
  }

  private async exportSpans(spans: ReadableSpan[]): Promise<void> {
    const body = ProtobufTraceSerializer.serializeRequest(spans);
    if (!body) {
      throw new Error("Could not serialize Weave GenAI OTLP trace request.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMillis);
    try {
      const response = await fetch(`${resolveTraceBaseUrl()}/agents/otel/v1/traces`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${readWandbApiKey()}`).toString("base64")}`,
          "Content-Type": "application/x-protobuf",
          project_id: this.options.projectId,
          "User-Agent": "pr-report-agent/weave-fetch-otlp",
        },
        body: Buffer.from(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Weave GenAI OTLP export failed with HTTP ${response.status}: ${await response.text()}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolveTraceBaseUrl(): string {
  if (process.env.WF_TRACE_SERVER_URL) {
    return process.env.WF_TRACE_SERVER_URL.replace(/\/$/, "");
  }
  const baseUrl = process.env.WANDB_BASE_URL;
  if (!baseUrl) {
    return "https://trace.wandb.ai";
  }
  return `${baseUrl.replace(/\/$/, "")}/traces`;
}

function readWandbApiKey(): string {
  const apiKey = process.env.WANDB_API_KEY;
  if (!apiKey) {
    throw new Error("WANDB_API_KEY is required for Weave GenAI fetch OTLP export.");
  }
  return apiKey;
}

export const testExports = {
  configureOtelExporterEnv,
  failOnObservabilityFlushError,
  resolveTraceBaseUrl,
  serializeToolPayload,
  truncatePayload,
  truncateString,
};

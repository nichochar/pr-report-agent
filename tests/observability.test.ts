import { afterEach, describe, expect, test } from "bun:test";
import { startReportAgentRun, testExports } from "../src/observability.js";
import type { AppConfig, ResolvedInterval } from "../src/types.js";

describe("Weave observability helpers", () => {
  const originalFlushPolicy = process.env.PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR;
  const originalOtlpTimeout = process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT;

  afterEach(() => {
    if (originalFlushPolicy === undefined) {
      delete process.env.PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR;
    } else {
      process.env.PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR = originalFlushPolicy;
    }
    if (originalOtlpTimeout === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT = originalOtlpTimeout;
    }
  });

  test("does not start a Weave Agents run before observability is initialized", () => {
    const config = {
      repos: [{ slug: "wandb/weave" }],
      models: {
        orchestrator: "gpt-5.5",
        prAnalyzer: "gpt-5.4-mini",
      },
    } as AppConfig;
    const interval = {
      startIso: "2026-06-09T07:00:00Z",
      endIso: "2026-06-10T07:00:00Z",
      timezone: "America/Los_Angeles",
      label: "manual_2026-06-09_to_2026-06-10",
    } satisfies ResolvedInterval;

    expect(
      startReportAgentRun(
        config,
        interval,
        {
          groupId: "pr-report:manual_2026-06-09_to_2026-06-10",
          baseMetadata: {
            app: "pr-report-agent",
            telemetry_library: "weave",
          },
        },
        3,
      ),
    ).toBeUndefined();
  });

  test("caps large Weave Agents tool payloads", () => {
    expect(testExports.truncateString("abcdef", 3)).toBe(
      "abc\n[truncated 3 chars from Weave Agents tool payload]",
    );

    expect(
      testExports.serializeToolPayload(
        {
          repo: "ww",
          result: "0123456789",
        },
        true,
        4,
      ),
    ).toBe(
      JSON.stringify({
        repo: "ww",
        result: "0123\n[truncated 6 chars from Weave Agents tool payload]",
      }),
    );
  });

  test("redacts Weave Agents tool payloads when sensitive tracing is disabled", () => {
    expect(testExports.serializeToolPayload("large private diff", false, 4)).toBe(
      JSON.stringify({ redacted: true, type: "string" }),
    );
  });

  test("fails on telemetry flush errors by default", () => {
    delete process.env.PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR;
    expect(testExports.failOnObservabilityFlushError()).toBe(true);

    process.env.PR_REPORT_FAIL_ON_OBSERVABILITY_FLUSH_ERROR = "false";
    expect(testExports.failOnObservabilityFlushError()).toBe(false);
  });

  test("sets OpenTelemetry exporter request timeout when not explicitly configured", () => {
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT;

    testExports.configureOtelExporterEnv(120_000);
    expect(String(process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT)).toBe("120000");

    process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT = "300000";
    testExports.configureOtelExporterEnv(120_000);
    expect(String(process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT)).toBe("300000");
  });
});

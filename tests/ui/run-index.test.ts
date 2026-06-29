import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { listRuns, readRunDetail, testExports } from "../../src/ui/run-index.js";
import type { PrCard, Report, ResolvedInterval } from "../../src/types.js";

describe("UI run index", () => {
  test("indexes complete runs and strips full diffs from PR summaries", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "pr-report-ui-"));
    const runDir = join(outputDir, "manual_2026-06-09T000000_to_2026-06-10T000000");
    await mkdir(runDir);
    await writeJson(join(runDir, "scoped-prs.json"), {
      interval: interval(),
      scopedPrs: [
        {
          repo: "wandb/weave",
          number: 10,
          title: "Add agent spans",
          url: "https://github.com/wandb/weave/pull/10",
          mergedAt: "2026-06-09T08:00:00Z",
          diff: "large patch",
          diffChars: 11,
        },
      ],
    });
    await writeJson(join(runDir, "cards.json"), [card()]);
    await writeJson(join(runDir, "report.json"), report());
    await writeFile(join(runDir, "report.md"), "# Report\n", "utf8");

    const runs = await listRuns(outputDir);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "manual_2026-06-09T000000_to_2026-06-10T000000",
      status: "complete",
      title: "PR Report",
      prCount: 1,
      cardCount: 1,
      repos: [{ repo: "wandb/weave", count: 1 }],
    });
    expect(runs[0].areas).toContain("OpenAI Agents SDK observability");

    const detail = await readRunDetail(outputDir, runs[0].id);
    expect(detail.reportMarkdown).toBe("# Report\n");
    expect(detail.report?.title).toBe("PR Report");
    expect(detail.cards[0].derivedAreas).toContain("OpenAI Agents SDK observability");
    expect(detail.cards[0].derivedAreas).toContain("Tracing");
    expect(detail.cards[0].derivedAreas).toContain("Openai Agents");
    expect(detail.scopedPrs[0]).not.toHaveProperty("diff");
  });

  test("supports collect-only and analyzer-failure artifacts", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "pr-report-ui-"));
    const collectRunDir = join(outputDir, "previous-day_2026-06-10_to_2026-06-11");
    const failedRunDir = join(outputDir, "manual_2026-06-11T000000_to_2026-06-12T000000");
    await mkdir(collectRunDir);
    await mkdir(failedRunDir);
    await writeJson(join(collectRunDir, "scoped-prs.json"), {
      interval: interval("previous-day_2026-06-10_to_2026-06-11"),
      scopedPrs: [{ repo: "wandb/core", number: 20, title: "Collect only" }],
    });
    await writeJson(join(failedRunDir, "scoped-prs.json"), {
      interval: interval("manual_2026-06-11T000000_to_2026-06-12T000000"),
      scopedPrs: [{ repo: "wandb/core", number: 21, title: "Failed analyzer" }],
    });
    await writeJson(join(failedRunDir, "cards.json"), []);
    await writeJson(join(failedRunDir, "analyzer-failures.json"), [
      {
        repo: "wandb/core",
        number: 21,
        title: "Failed analyzer",
        url: "https://github.com/wandb/core/pull/21",
        mergedAt: "2026-06-11T08:00:00Z",
        errorName: "Error",
        errorMessage: "boom",
        failedAt: "2026-06-11T09:00:00Z",
      },
    ]);

    const runs = await listRuns(outputDir);
    expect(runs.find((run) => run.id === "previous-day_2026-06-10_to_2026-06-11")).toMatchObject({
      status: "collect-only",
      prCount: 1,
    });
    expect(
      runs.find((run) => run.id === "manual_2026-06-11T000000_to_2026-06-12T000000"),
    ).toMatchObject({
      status: "partial",
      failureCount: 1,
    });
  });

  test("derives areas from section headings, card themes, and tags", () => {
    const derived = testExports.deriveAreas([card()], report());
    expect(derived.areas).toContain("OpenAI Agents SDK observability");
    expect(derived.cards[0].derivedAreas).toEqual(
      expect.arrayContaining(["OpenAI Agents SDK observability", "Tracing", "Openai Agents"]),
    );
    expect(testExports.formatTag("agent-chat_media")).toBe("Agent Chat Media");
    expect(testExports.normalizeReportTitle("Weave PR Activity Report")).toBe("PR Report");
    expect(testExports.normalizeReportMarkdownTitle("# Weave PR Activity Report\n")).toBe(
      "# PR Report\n",
    );
  });
});

function interval(label = "manual_2026-06-09T000000_to_2026-06-10T000000"): ResolvedInterval {
  return {
    startIso: "2026-06-09T07:00:00Z",
    endIso: "2026-06-10T07:00:00Z",
    timezone: "America/Los_Angeles",
    label,
  };
}

function report(): Report {
  return {
    title: "Weave PR Activity Report",
    interval: {
      start: "2026-06-09T07:00:00Z",
      end: "2026-06-10T07:00:00Z",
      timezone: "America/Los_Angeles",
    },
    audience: "Engineering and product leads",
    overview: "A report.",
    headlineBullets: ["Tracing shipped."],
    sections: [
      {
        heading: "OpenAI Agents SDK observability",
        summary: "Tracing work.",
        prs: [
          {
            repo: "wandb/weave",
            number: 10,
            title: "Add agent spans",
            url: "https://github.com/wandb/weave/pull/10",
            whyItMatters: "Better traces.",
          },
        ],
      },
    ],
    notableRisks: [],
    followUps: [],
    markdown: "# Report\n",
  };
}

function card(): PrCard {
  return {
    repo: "wandb/weave",
    number: 10,
    title: "Add agent spans",
    url: "https://github.com/wandb/weave/pull/10",
    author: "dev",
    mergedAt: "2026-06-09T08:00:00Z",
    ownerScope: {
      includeOwners: ["@wandb/weave-team"],
      matchedFiles: [{ path: "sdks/node/src/openai.ts", owners: ["@wandb/weave-team"] }],
    },
    summary: "Adds spans.",
    whatChanged: ["Added invoke_agent spans."],
    productImpact: "Better OpenAI Agents visibility.",
    technicalDetails: ["Uses OTel."],
    notableFiles: [
      {
        path: "sdks/node/src/openai.ts",
        role: "integration",
        notableChanges: "Adds span mapping.",
      },
    ],
    themes: ["Tracing"],
    tags: ["openai-agents"],
    risk: { level: "low", reasons: ["Tests included."] },
    leadRelevance: "Useful for agent tracing.",
    evidence: ["Diff updated tracing processor."],
    openQuestions: [],
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { writeRunArtifacts } from "../src/artifacts.js";
import type { AppConfig, Report } from "../src/types.js";

describe("artifact writer", () => {
  test("writes scoped PRs, cards, report JSON, and Markdown", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "pr-report-agent-"));
    const config = {
      outputDir,
    } as AppConfig;
    const report: Report = {
      title: "Report",
      interval: {
        start: "2026-06-09T17:00:00Z",
        end: "2026-06-09T17:30:00Z",
        timezone: "America/Los_Angeles",
      },
      audience: "Engineering and product leads",
      overview: "Quiet interval.",
      headlineBullets: ["One useful change."],
      sections: [],
      notableRisks: [],
      followUps: [],
      markdown: "# Report\n",
    };

    const runDir = await writeRunArtifacts(config, {
      interval: {
        startIso: "2026-06-09T17:00:00Z",
        endIso: "2026-06-09T17:30:00Z",
        timezone: "America/Los_Angeles",
        label: "manual_smoke",
      },
      scopedPrs: [],
      cards: [],
      report,
    });

    expect(JSON.parse(await readFile(join(runDir, "scoped-prs.json"), "utf8"))).toEqual({
      interval: {
        startIso: "2026-06-09T17:00:00Z",
        endIso: "2026-06-09T17:30:00Z",
        timezone: "America/Los_Angeles",
        label: "manual_smoke",
      },
      scopedPrs: [],
    });
    expect(JSON.parse(await readFile(join(runDir, "cards.json"), "utf8"))).toEqual([]);
    expect(JSON.parse(await readFile(join(runDir, "report.json"), "utf8")).title).toBe("Report");
    expect(await readFile(join(runDir, "report.md"), "utf8")).toBe("# Report\n");
  });
});

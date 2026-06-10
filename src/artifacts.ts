import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig, RunArtifacts } from "./types.js";

export async function writeRunArtifacts(
  config: AppConfig,
  artifacts: RunArtifacts,
): Promise<string> {
  const runDir = join(config.outputDir, artifacts.interval.label);
  await mkdir(runDir, { recursive: true });

  await writeJson(join(runDir, "scoped-prs.json"), {
    interval: artifacts.interval,
    scopedPrs: artifacts.scopedPrs.map(({ diff, ...pr }) => ({
      ...pr,
      diffChars: diff.length,
      diffPath: "diffs are retained in scoped-prs-with-diffs.json",
    })),
  });

  await writeJson(join(runDir, "scoped-prs-with-diffs.json"), {
    interval: artifacts.interval,
    scopedPrs: artifacts.scopedPrs,
  });

  if (artifacts.cards) {
    await writeJson(join(runDir, "cards.json"), artifacts.cards);
  }

  if (artifacts.report) {
    await writeJson(join(runDir, "report.json"), artifacts.report);
    await writeFile(join(runDir, "report.md"), artifacts.report.markdown, "utf8");
  }

  return runDir;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadConfig, loadPersistedConfig } from "../src/config.js";
import {
  FileConfigStore,
  StaleConfigRevisionError,
  validateConfig,
} from "../src/ui/config-store.js";
import type { AppConfig } from "../src/types.js";

describe("config persistence", () => {
  test("keeps editable paths raw while resolving runtime paths", async () => {
    const configPath = await writeConfig(config({ localPath: "~/crwv/weave" }));

    const editable = await loadPersistedConfig(configPath);
    const resolved = await loadConfig(configPath);

    expect(editable.repos[0].localPath).toBe("~/crwv/weave");
    expect(resolved.repos[0].localPath).toEndWith("/crwv/weave");
    expect(resolved.repos[0].localPath).not.toBe("~/crwv/weave");
  });

  test("writes config updates and rejects stale revisions", async () => {
    const configPath = await writeConfig(config({ localPath: "/tmp/weave" }));
    const store = new FileConfigStore(configPath);
    const initial = await store.readEditable();
    const next = clone(initial.config);
    next.repos = [
      {
        ...next.repos[0],
        slug: "wandb/core",
        localPath: "/tmp/core",
      },
    ];

    const updated = await store.update(next, initial.revision);

    expect(updated.revision).not.toBe(initial.revision);
    expect(JSON.parse(await readFile(configPath, "utf8")).repos[0]).toMatchObject({
      slug: "wandb/core",
      localPath: "/tmp/core",
    });
    await expect(store.update(initial.config, initial.revision)).rejects.toThrow(
      StaleConfigRevisionError,
    );
  });

  test("validates local repo paths and codeowners files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pr-report-config-"));
    const repoPath = join(root, "weave");
    await mkdir(join(repoPath, ".git"), { recursive: true });
    await mkdir(join(repoPath, ".github"), { recursive: true });
    await writeFile(join(repoPath, ".github", "CODEOWNERS"), "* @wandb/weave-team\n", "utf8");

    expect(await validateConfig(config({ localPath: repoPath }))).toEqual([]);
    expect(await validateConfig(config({ localPath: join(root, "missing") }))).toEqual([
      {
        path: "repos.0.localPath",
        severity: "warning",
        message: `Local path does not exist: ${join(root, "missing")}`,
      },
    ]);
  });
});

function config(overrides: Partial<AppConfig["repos"][number]> = {}): AppConfig {
  return {
    name: "Test",
    companyContext: "",
    defaultTimezone: "America/Los_Angeles",
    defaultInterval: "previous-day",
    outputDir: "runs",
    models: { orchestrator: "gpt-5.5", prAnalyzer: "gpt-5.4-mini" },
    github: {
      maxPullRequests: 1000,
      excludeBots: true,
      ignoredAuthorLogins: [],
    },
    diff: {
      chunkChars: 12000,
      maxInlineDiffChars: 180000,
      maxFileReadChars: 40000,
    },
    agents: {
      prAnalyzerConcurrency: 3,
      prAnalyzerMaxTurns: 24,
      orchestratorMaxTurns: 12,
    },
    repos: [
      {
        slug: "wandb/weave",
        localPath: "/tmp/weave",
        includeOwners: ["@wandb/weave-team"],
        codeownersPaths: [".github/CODEOWNERS"],
        productContext: "",
        ...overrides,
      },
    ],
  };
}

async function writeConfig(value: AppConfig): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pr-report-config-"));
  const configPath = join(root, "config.json");
  await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return configPath;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

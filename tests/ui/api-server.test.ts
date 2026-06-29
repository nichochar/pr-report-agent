import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createApiHandler } from "../../src/ui/api-server.js";
import { FileConfigStore } from "../../src/ui/config-store.js";
import { RunJobManager } from "../../src/ui/run-launcher.js";
import type { AppConfig } from "../../src/types.js";

describe("UI API server", () => {
  test("returns run lists and details", async () => {
    const outputDir = await fixtureOutputDir();
    const fixture = await fixtureConfigStore(outputDir);
    const handler = createApiHandler({
      configStore: fixture.store,
      jobManager: new RunJobManager({
        cwd: "/tmp",
        configPath: fixture.configPath,
        runner: (_command, callbacks) => callbacks.exit(0),
      }),
    });

    const listResponse = await handler(new Request("http://127.0.0.1/api/runs"));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.runs).toHaveLength(1);
    expect(listBody.config).toMatchObject({
      name: "Test",
      repos: [{ slug: "wandb/weave", localPath: "/tmp/weave", includeOwners: ["@wandb/weave-team"] }],
    });

    const detailResponse = await handler(
      new Request(`http://127.0.0.1/api/runs/${listBody.runs[0].id}`),
    );
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.reportMarkdown).toBe("# Report\n");
  });

  test("returns not found for missing runs and jobs", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "pr-report-ui-api-"));
    const fixture = await fixtureConfigStore(outputDir);
    const handler = createApiHandler({
      configStore: fixture.store,
      jobManager: new RunJobManager({
        cwd: "/tmp",
        configPath: fixture.configPath,
        runner: (_command, callbacks) => callbacks.exit(0),
      }),
    });

    expect((await handler(new Request("http://127.0.0.1/api/runs/missing"))).status).toBe(404);
    expect((await handler(new Request("http://127.0.0.1/api/jobs/missing"))).status).toBe(404);
  });

  test("launches runs and rejects a second active run", async () => {
    const outputDir = await fixtureOutputDir();
    const fixture = await fixtureConfigStore(outputDir);
    const manager = new RunJobManager({
      cwd: "/tmp",
      configPath: fixture.configPath,
      runner: () => undefined,
    });
    const handler = createApiHandler({ configStore: fixture.store, jobManager: manager });

    const launchResponse = await handler(
      new Request("http://127.0.0.1/api/runs", {
        method: "POST",
        body: JSON.stringify({ preset: "previous-day" }),
      }),
    );
    expect(launchResponse.status).toBe(202);
    const launchBody = await launchResponse.json();
    expect(launchBody.job.status).toBe("running");

    const secondResponse = await handler(
      new Request("http://127.0.0.1/api/runs", {
        method: "POST",
        body: JSON.stringify({ preset: "previous-day" }),
      }),
    );
    expect(secondResponse.status).toBe(409);

    const jobResponse = await handler(
      new Request(`http://127.0.0.1/api/jobs/${launchBody.job.id}`),
    );
    expect(jobResponse.status).toBe(200);
  });

  test("reads and writes editable config", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "pr-report-ui-api-"));
    const fixture = await fixtureConfigStore(outputDir);
    const handler = createApiHandler({
      configStore: fixture.store,
      jobManager: new RunJobManager({
        cwd: "/tmp",
        configPath: fixture.configPath,
        runner: (_command, callbacks) => callbacks.exit(0),
      }),
    });

    const getResponse = await handler(new Request("http://127.0.0.1/api/config"));
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.config.repos[0]).toMatchObject({
      slug: "wandb/weave",
      localPath: "/tmp/weave",
    });
    expect(getBody.revision).toEqual(expect.any(String));

    const nextConfig: AppConfig = {
      ...getBody.config,
      repos: [
        {
          ...getBody.config.repos[0],
          slug: "wandb/core",
          localPath: "~/crwv/core",
          productContext: "Core monorepo",
        },
      ],
    };

    const putResponse = await handler(
      new Request("http://127.0.0.1/api/config", {
        method: "PUT",
        body: JSON.stringify({ config: nextConfig, revision: getBody.revision }),
      }),
    );
    expect(putResponse.status).toBe(200);
    const putBody = await putResponse.json();
    expect(putBody.config.repos[0]).toMatchObject({
      slug: "wandb/core",
      localPath: "~/crwv/core",
      productContext: "Core monorepo",
    });

    const fileBody = JSON.parse(await Bun.file(fixture.configPath).text());
    expect(fileBody.repos[0].localPath).toBe("~/crwv/core");

    const staleResponse = await handler(
      new Request("http://127.0.0.1/api/config", {
        method: "PUT",
        body: JSON.stringify({ config: getBody.config, revision: getBody.revision }),
      }),
    );
    expect(staleResponse.status).toBe(409);
  });
});

async function fixtureOutputDir(): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), "pr-report-ui-api-"));
  const runDir = join(outputDir, "manual_2026-06-09T000000_to_2026-06-10T000000");
  await mkdir(runDir);
  await writeJson(join(runDir, "scoped-prs.json"), {
    interval: {
      startIso: "2026-06-09T07:00:00Z",
      endIso: "2026-06-10T07:00:00Z",
      timezone: "America/Los_Angeles",
      label: "manual_2026-06-09T000000_to_2026-06-10T000000",
    },
    scopedPrs: [],
  });
  await writeJson(join(runDir, "cards.json"), []);
  await writeJson(join(runDir, "report.json"), {
    title: "Report",
    interval: {
      start: "2026-06-09T07:00:00Z",
      end: "2026-06-10T07:00:00Z",
      timezone: "America/Los_Angeles",
    },
    audience: "Leads",
    overview: "",
    headlineBullets: [],
    sections: [],
    notableRisks: [],
    followUps: [],
    markdown: "# Report\n",
  });
  await writeFile(join(runDir, "report.md"), "# Report\n", "utf8");
  return outputDir;
}

async function fixtureConfigStore(outputDir: string): Promise<{
  configPath: string;
  store: FileConfigStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "pr-report-ui-config-"));
  const configPath = join(root, "config.json");
  await writeJson(configPath, config(outputDir));
  return { configPath, store: new FileConfigStore(configPath) };
}

function config(outputDir: string): AppConfig {
  return {
    name: "Test",
    companyContext: "",
    defaultTimezone: "America/Los_Angeles",
    defaultInterval: "previous-day",
    outputDir,
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
      },
    ],
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

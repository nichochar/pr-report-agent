import { describe, expect, test } from "bun:test";
import { ActiveRunError, buildRunCommand, RunJobManager } from "../../src/ui/run-launcher.js";
import type { ProcessCallbacks } from "../../src/ui/run-launcher.js";

describe("UI run launcher", () => {
  test("builds CLI commands for previous-day and explicit runs", () => {
    expect(buildRunCommand("config/coreweave-weave.config.json", { preset: "previous-day" })).toEqual([
      "bun",
      "src/index.ts",
      "run",
      "--config",
      "config/coreweave-weave.config.json",
      "--preset",
      "previous-day",
    ]);
    expect(buildRunCommand("config/coreweave-weave.config.json", { start: "2026-06-09", end: "2026-06-10" })).toEqual([
      "bun",
      "src/index.ts",
      "run",
      "--config",
      "config/coreweave-weave.config.json",
      "--start",
      "2026-06-09",
      "--end",
      "2026-06-10",
    ]);
  });

  test("captures fake process logs and completion", () => {
    const manager = new RunJobManager({
      cwd: "/tmp",
      configPath: "config/coreweave-weave.config.json",
      runner: (_command, callbacks) => {
        callbacks.stdout("collecting\n");
        callbacks.stderr("warning\n");
        callbacks.exit(0);
      },
      now: () => new Date("2026-06-23T12:00:00Z"),
    });

    const job = manager.launch({ preset: "previous-day" });
    expect(job.status).toBe("succeeded");
    expect(job.logs.map((entry) => entry.text).join("")).toContain("collecting");
    expect(manager.getJob(job.id)?.exitCode).toBe(0);
  });

  test("rejects a second active run", () => {
    let callbacks: ProcessCallbacks | undefined;
    const manager = new RunJobManager({
      cwd: "/tmp",
      configPath: "config/coreweave-weave.config.json",
      runner: (_command, nextCallbacks) => {
        callbacks = nextCallbacks;
      },
      now: () => new Date("2026-06-23T12:00:00Z"),
    });

    manager.launch({ preset: "previous-day" });
    expect(() => manager.launch({ preset: "previous-day" })).toThrow(ActiveRunError);
    callbacks?.exit(0);
    expect(manager.launch({ preset: "previous-day" }).status).toBe("running");
  });
});

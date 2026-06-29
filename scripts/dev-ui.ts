#!/usr/bin/env bun
const apiPort = Bun.env.PR_REPORT_UI_API_PORT ?? "8787";
const webPort = Bun.env.PR_REPORT_UI_WEB_PORT ?? "5173";

const children = [
  Bun.spawn(["bun", "src/ui/server.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: { ...Bun.env, PR_REPORT_UI_API_PORT: apiPort },
  }),
  Bun.spawn(
    [
      "bunx",
      "vite",
      "--config",
      "web/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      webPort,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: { ...Bun.env, PR_REPORT_UI_API_PORT: apiPort },
    },
  ),
];

function shutdown(): void {
  for (const child of children) {
    child.kill();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const exitCodes = await Promise.all(children.map((child) => child.exited));
process.exit(exitCodes.find((code) => code !== 0) ?? 0);

#!/usr/bin/env bun
import { resolve } from "node:path";
import { createApiHandler, createDefaultJobManager } from "./api-server.js";
import { FileConfigStore } from "./config-store.js";

const port = Number(Bun.env.PR_REPORT_UI_API_PORT ?? 8787);
const configPath = resolve(Bun.env.PR_REPORT_UI_CONFIG ?? "config/coreweave-weave.config.json");
const configStore = new FileConfigStore(configPath);
await configStore.readResolved();
const jobManager = createDefaultJobManager({ cwd: process.cwd(), configPath });

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: createApiHandler({ configStore, jobManager }),
});

console.log(`PR report UI API listening on http://127.0.0.1:${port}`);

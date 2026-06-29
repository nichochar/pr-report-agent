import { homedir } from "node:os";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AppConfigSchema, type AppConfig } from "./types.js";

export async function loadConfig(path: string): Promise<AppConfig> {
  return resolveConfig(await loadPersistedConfig(path));
}

export async function loadPersistedConfig(path: string): Promise<AppConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = AppConfigSchema.parse(JSON.parse(raw));
  return parsed;
}

export async function savePersistedConfig(path: string, config: AppConfig): Promise<AppConfig> {
  const parsed = AppConfigSchema.parse(config);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
  return parsed;
}

export function resolveConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    outputDir: expandPath(config.outputDir),
    repos: config.repos.map((repo) => ({
      ...repo,
      localPath: expandPath(repo.localPath),
    })),
  };
}

export function expandPath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return isAbsolute(path) ? path : resolve(path);
}

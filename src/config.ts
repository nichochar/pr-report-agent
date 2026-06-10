import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { AppConfigSchema, type AppConfig } from "./types.js";

export async function loadConfig(path: string): Promise<AppConfig> {
  const file = Bun.file(path);
  const raw = await file.text();
  const parsed = AppConfigSchema.parse(JSON.parse(raw));
  return {
    ...parsed,
    outputDir: expandPath(parsed.outputDir),
    repos: parsed.repos.map((repo) => ({
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

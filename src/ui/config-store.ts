import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expandPath,
  loadConfig,
  loadPersistedConfig,
  savePersistedConfig,
} from "../config.js";
import type { AppConfig } from "../types.js";
import type { ConfigValidationIssue } from "./shared.js";

export interface ConfigState {
  config: AppConfig;
  revision: string;
}

export interface ConfigStore {
  readEditable(): Promise<ConfigState>;
  readResolved(): Promise<AppConfig>;
  update(config: AppConfig, expectedRevision?: string): Promise<ConfigState>;
}

export class StaleConfigRevisionError extends Error {
  constructor() {
    super("Config changed on disk. Refresh before saving again.");
    this.name = "StaleConfigRevisionError";
  }
}

export class FileConfigStore implements ConfigStore {
  constructor(private readonly configPath: string) {}

  async readEditable(): Promise<ConfigState> {
    return {
      config: await loadPersistedConfig(this.configPath),
      revision: await readConfigRevision(this.configPath),
    };
  }

  async readResolved(): Promise<AppConfig> {
    return loadConfig(this.configPath);
  }

  async update(config: AppConfig, expectedRevision?: string): Promise<ConfigState> {
    if (expectedRevision) {
      const currentRevision = await readConfigRevision(this.configPath);
      if (currentRevision !== expectedRevision) {
        throw new StaleConfigRevisionError();
      }
    }
    await savePersistedConfig(this.configPath, config);
    return this.readEditable();
  }
}

export async function readConfigRevision(path: string): Promise<string> {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
}

export async function validateConfig(config: AppConfig): Promise<ConfigValidationIssue[]> {
  const issues: ConfigValidationIssue[] = [];
  const seenSlugs = new Set<string>();

  await Promise.all(
    config.repos.map(async (repo, index) => {
      const basePath = `repos.${index}`;

      if (seenSlugs.has(repo.slug)) {
        issues.push({
          path: `${basePath}.slug`,
          severity: "warning",
          message: `Duplicate repo slug: ${repo.slug}`,
        });
      }
      seenSlugs.add(repo.slug);

      const localPath = expandPath(repo.localPath);
      if (!(await pathExists(localPath))) {
        issues.push({
          path: `${basePath}.localPath`,
          severity: "warning",
          message: `Local path does not exist: ${repo.localPath}`,
        });
        return;
      }

      if (!(await pathExists(join(localPath, ".git")))) {
        issues.push({
          path: `${basePath}.localPath`,
          severity: "warning",
          message: `Local path is not a git checkout: ${repo.localPath}`,
        });
      }

      await Promise.all(
        repo.codeownersPaths.map(async (codeownersPath, codeownersIndex) => {
          if (!(await pathExists(join(localPath, codeownersPath)))) {
            issues.push({
              path: `${basePath}.codeownersPaths.${codeownersIndex}`,
              severity: "warning",
              message: `CODEOWNERS file was not found: ${codeownersPath}`,
            });
          }
        }),
      );
    }),
  );

  return issues.sort((left, right) => left.path.localeCompare(right.path));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

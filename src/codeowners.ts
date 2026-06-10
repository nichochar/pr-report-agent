import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimatch } from "minimatch";
import type { CodeownersMatch, CodeownersRule, RepoConfig } from "./types.js";

export async function loadCodeownersRules(repo: RepoConfig): Promise<CodeownersRule[]> {
  const allRules: CodeownersRule[] = [];
  for (const sourcePath of repo.codeownersPaths) {
    const absolutePath = join(repo.localPath, sourcePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const content = await readFile(absolutePath, "utf8");
    allRules.push(...parseCodeowners(content, sourcePath));
  }
  return allRules;
}

export function parseCodeowners(content: string, sourcePath = "CODEOWNERS"): CodeownersRule[] {
  return content
    .split(/\r?\n/)
    .map((line, index): CodeownersRule | undefined => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return undefined;
      }
      const [pattern, ...owners] = trimmed.split(/\s+/);
      if (!pattern || owners.length === 0 || pattern.startsWith("!")) {
        return undefined;
      }
      return {
        sourcePath,
        lineNumber: index + 1,
        pattern,
        owners,
      };
    })
    .filter((rule): rule is CodeownersRule => Boolean(rule));
}

export function ownersForPath(path: string, rules: CodeownersRule[]): CodeownersMatch {
  const normalizedPath = normalizePath(path);
  let matchedRule: CodeownersRule | undefined;

  for (const rule of rules) {
    if (matchesCodeownersPattern(normalizedPath, rule.pattern)) {
      matchedRule = rule;
    }
  }

  return {
    path: normalizedPath,
    owners: matchedRule?.owners ?? [],
    rule: matchedRule,
  };
}

export function ownerScopedFiles(
  paths: string[],
  rules: CodeownersRule[],
  includeOwners: string[],
): CodeownersMatch[] {
  const includeOwnerSet = new Set(includeOwners.map(normalizeOwner));
  return paths
    .map((path) => ownersForPath(path, rules))
    .filter((match) => match.owners.some((owner) => includeOwnerSet.has(normalizeOwner(owner))));
}

export function matchesCodeownersPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  return patternToGlobs(pattern).some((glob) =>
    minimatch(normalizedPath, glob, {
      dot: true,
      nocase: false,
      nonegate: true,
      nocomment: true,
    }),
  );
}

function patternToGlobs(pattern: string): string[] {
  const anchored = pattern.startsWith("/");
  let cleaned = normalizePath(pattern.replace(/^\/+/, ""));

  if (cleaned === "") {
    return [];
  }

  if (cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
    return anchored ? [`${cleaned}/**`] : [`${cleaned}/**`, `**/${cleaned}/**`];
  }

  if (!cleaned.includes("/")) {
    return [cleaned, `**/${cleaned}`];
  }

  const directoryFallback = looksLikeDirectoryPattern(cleaned) ? [`${cleaned}/**`] : [];
  return anchored
    ? [cleaned, ...directoryFallback]
    : [cleaned, `**/${cleaned}`, ...directoryFallback, ...directoryFallback.map((glob) => `**/${glob}`)];
}

function looksLikeDirectoryPattern(pattern: string): boolean {
  const lastSegment = pattern.split("/").at(-1) ?? pattern;
  return !lastSegment.includes(".") && !lastSegment.includes("*");
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function normalizeOwner(owner: string): string {
  return owner.toLowerCase();
}

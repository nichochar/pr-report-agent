import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./shell.js";

export function assertLocalRepo(path: string): void {
  if (!existsSync(join(path, ".git"))) {
    throw new Error(`Expected local git clone at ${path}`);
  }
}

export async function ensureRevisionAvailable(repoPath: string, revision: string): Promise<void> {
  try {
    await runCommand("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: repoPath });
    return;
  } catch {
    await runCommand("git", ["fetch", "--quiet", "origin"], {
      cwd: repoPath,
      maxBuffer: 1024 * 1024 * 8,
    });
    await runCommand("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: repoPath });
  }
}

export async function readFileAtRevision(
  repoPath: string,
  revision: string,
  filePath: string,
  maxChars: number,
): Promise<string> {
  await ensureRevisionAvailable(repoPath, revision);
  const content = await runCommand("git", ["show", `${revision}:${filePath}`], {
    cwd: repoPath,
    maxBuffer: Math.max(maxChars * 4, 1024 * 1024),
  });
  return content.length > maxChars
    ? `${content.slice(0, maxChars)}\n\n[truncated after ${maxChars} chars]`
    : content;
}

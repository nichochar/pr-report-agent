import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; maxBuffer?: number } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 1024 * 1024 * 64,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    const err = error as Error & { stderr?: string; stdout?: string };
    const detail = [err.message, err.stderr, err.stdout].filter(Boolean).join("\n");
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${detail}`);
  }
}

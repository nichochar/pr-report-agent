import type { JobLogEntry, JobStatus, LaunchRunRequest, RunJob } from "./shared.js";

export class ActiveRunError extends Error {
  constructor() {
    super("A report run is already active.");
    this.name = "ActiveRunError";
  }
}

export interface ProcessCallbacks {
  stdout(text: string): void;
  stderr(text: string): void;
  exit(code: number): void;
  error(error: unknown): void;
}

export type ProcessRunner = (
  command: string[],
  callbacks: ProcessCallbacks,
) => { kill?: () => void } | void;

export interface RunJobManagerOptions {
  cwd: string;
  configPath: string;
  runner?: ProcessRunner;
  now?: () => Date;
  maxLogChars?: number;
}

interface MutableRunJob extends RunJob {
  logChars: number;
}

export class RunJobManager {
  private readonly jobs = new Map<string, MutableRunJob>();
  private readonly runner: ProcessRunner;
  private readonly now: () => Date;
  private readonly maxLogChars: number;
  private activeJobId: string | undefined;

  constructor(private readonly options: RunJobManagerOptions) {
    this.runner = options.runner ?? createBunProcessRunner(options.cwd);
    this.now = options.now ?? (() => new Date());
    this.maxLogChars = options.maxLogChars ?? 240_000;
  }

  launch(input: LaunchRunRequest): RunJob {
    const activeJob = this.activeJobId ? this.jobs.get(this.activeJobId) : undefined;
    if (activeJob?.status === "running") {
      throw new ActiveRunError();
    }

    const command = buildRunCommand(this.options.configPath, input);
    const job: MutableRunJob = {
      id: `${this.now().toISOString().replace(/[:.]/g, "-")}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      status: "running",
      command,
      startedAt: this.now().toISOString(),
      logs: [],
      logChars: 0,
    };
    this.jobs.set(job.id, job);
    this.activeJobId = job.id;
    this.appendLog(job, "system", `$ ${command.join(" ")}\n`);

    try {
      this.runner(command, {
        stdout: (text) => this.appendLog(job, "stdout", text),
        stderr: (text) => this.appendLog(job, "stderr", text),
        exit: (code) => this.finishJob(job, code),
        error: (error) => this.failJob(job, error),
      });
    } catch (error) {
      this.failJob(job, error);
    }

    return snapshotJob(job);
  }

  getJob(id: string): RunJob | undefined {
    const job = this.jobs.get(id);
    return job ? snapshotJob(job) : undefined;
  }

  private finishJob(job: MutableRunJob, code: number): void {
    if (job.status !== "running") {
      return;
    }
    job.exitCode = code;
    job.status = code === 0 ? "succeeded" : "failed";
    job.completedAt = this.now().toISOString();
    if (code !== 0) {
      job.error = `Report process exited with code ${code}.`;
    }
    this.appendLog(job, "system", `\n[process exited with code ${code}]\n`);
    if (this.activeJobId === job.id) {
      this.activeJobId = undefined;
    }
  }

  private failJob(job: MutableRunJob, error: unknown): void {
    if (job.status !== "running") {
      return;
    }
    job.status = "failed";
    job.completedAt = this.now().toISOString();
    job.error = error instanceof Error ? error.message : String(error);
    this.appendLog(job, "system", `\n[process failed: ${job.error}]\n`);
    if (this.activeJobId === job.id) {
      this.activeJobId = undefined;
    }
  }

  private appendLog(job: MutableRunJob, stream: JobLogEntry["stream"], text: string): void {
    if (!text) {
      return;
    }
    job.logs.push({
      stream,
      text,
      timestamp: this.now().toISOString(),
    });
    job.logChars += text.length;
    while (job.logChars > this.maxLogChars && job.logs.length > 1) {
      const removed = job.logs.shift();
      job.logChars -= removed?.text.length ?? 0;
    }
  }
}

export function buildRunCommand(configPath: string, input: LaunchRunRequest): string[] {
  const args = ["bun", "src/index.ts", "run", "--config", configPath];
  if ("preset" in input) {
    args.push("--preset", input.preset);
  } else {
    args.push("--start", input.start, "--end", input.end);
  }
  return args;
}

function createBunProcessRunner(cwd: string): ProcessRunner {
  return (command, callbacks) => {
    const process = Bun.spawn(command, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: Bun.env,
    });

    void pipeStream(process.stdout, callbacks.stdout, callbacks.error);
    void pipeStream(process.stderr, callbacks.stderr, callbacks.error);
    void process.exited.then(callbacks.exit, callbacks.error);

    return {
      kill: () => process.kill(),
    };
  };
}

async function pipeStream(
  stream: ReadableStream<Uint8Array> | null,
  onText: (text: string) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  if (!stream) {
    return;
  }
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      onText(decoder.decode(value, { stream: true }));
    }
    const trailing = decoder.decode();
    if (trailing) {
      onText(trailing);
    }
  } catch (error) {
    onError(error);
  }
}

function snapshotJob(job: MutableRunJob): RunJob {
  return {
    id: job.id,
    status: job.status as JobStatus,
    command: [...job.command],
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    exitCode: job.exitCode,
    error: job.error,
    logs: job.logs.map((entry) => ({ ...entry })),
  };
}

export const testExports = { snapshotJob };

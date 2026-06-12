#!/usr/bin/env bun
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { runPrReportAgent } from "./run.js";
import { resolveTriggerInterval } from "./trigger.js";
import { IntervalPresetSchema, type Trigger } from "./types.js";

interface CliOptions {
  command: "run";
  configPath: string;
  collectOnly: boolean;
  maxPrs?: number;
  trigger: Trigger;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig(options.configPath);
  const interval = resolveTriggerInterval(options.trigger, config);
  const runDir = await runPrReportAgent(config, interval, {
    collectOnly: options.collectOnly,
    maxPrs: options.maxPrs,
  });
  console.log(`Wrote PR report artifacts to ${runDir}`);
}

function parseArgs(args: string[]): CliOptions {
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "run";
  const rest = command === args[0] ? args.slice(1) : args;
  if (command !== "run") {
    throw new Error(`Unknown command "${command}". Expected "run".`);
  }

  let configPath = resolve("config/coreweave-weave.config.json");
  let collectOnly = false;
  let maxPrs: number | undefined;
  let preset: string | undefined;
  let start: string | undefined;
  let end: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    switch (arg) {
      case "--config":
        configPath = resolve(requiredValue(rest, ++index, arg));
        break;
      case "--collect-only":
        collectOnly = true;
        break;
      case "--max-prs":
        maxPrs = parsePositiveInteger(requiredValue(rest, ++index, arg), arg);
        break;
      case "--preset":
        preset = requiredValue(rest, ++index, arg);
        break;
      case "--start":
        start = requiredValue(rest, ++index, arg);
        break;
      case "--end":
        end = requiredValue(rest, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument "${arg}".`);
    }
  }

  const trigger = buildTrigger({ preset, start, end });
  return { command, configPath, collectOnly, maxPrs, trigger };
}

function buildTrigger(input: {
  preset?: string;
  start?: string;
  end?: string;
}): Trigger {
  if (input.start || input.end) {
    if (!input.start || !input.end) {
      throw new Error("--start and --end must be provided together.");
    }
    return { type: "manual", start: input.start, end: input.end };
  }

  const preset = IntervalPresetSchema.parse(input.preset ?? "previous-day");
  return { type: "manual", preset };
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

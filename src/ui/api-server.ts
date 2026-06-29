import { resolve } from "node:path";
import { z } from "zod";
import { AppConfigSchema, type AppConfig } from "../types.js";
import {
  StaleConfigRevisionError,
  validateConfig,
  type ConfigState,
  type ConfigStore,
} from "./config-store.js";
import { readRunDetail, listRuns } from "./run-index.js";
import {
  ActiveRunError,
  RunJobManager,
  type RunJobManagerOptions,
} from "./run-launcher.js";

const LaunchRunRequestSchema = z.union([
  z.object({ preset: z.literal("previous-day") }),
  z.object({
    start: z.string().min(1),
    end: z.string().min(1),
  }),
]);

const SaveConfigRequestSchema = z.object({
  config: AppConfigSchema,
  revision: z.string().optional(),
});

export interface CreateApiHandlerOptions {
  configStore: ConfigStore;
  jobManager: RunJobManager;
}

export function createApiHandler(options: CreateApiHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === "OPTIONS") {
      return emptyResponse(204);
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    try {
      if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "config") {
        return jsonResponse(await configResponse(await options.configStore.readEditable()));
      }

      if (request.method === "PUT" && parts.length === 2 && parts[0] === "api" && parts[1] === "config") {
        const body = SaveConfigRequestSchema.parse(await request.json());
        const state = await options.configStore.update(body.config, body.revision);
        return jsonResponse(await configResponse(state));
      }

      if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "runs") {
        const [config, editable] = await Promise.all([
          options.configStore.readResolved(),
          options.configStore.readEditable(),
        ]);
        return jsonResponse({
          config: configSummary(editable.config),
          runs: await listRuns(config.outputDir),
        });
      }

      if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "runs") {
        const config = await options.configStore.readResolved();
        return jsonResponse(await readRunDetail(config.outputDir, parts[2]));
      }

      if (request.method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "runs") {
        const body = LaunchRunRequestSchema.parse(await request.json());
        const job = options.jobManager.launch(body);
        return jsonResponse({ job }, 202);
      }

      if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "jobs") {
        const job = options.jobManager.getJob(parts[2]);
        if (!job) {
          return jsonResponse({ error: `Job "${parts[2]}" was not found.` }, 404);
        }
        return jsonResponse({ job });
      }

      return jsonResponse({ error: "Not found." }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createDefaultJobManager(input: {
  cwd: string;
  configPath: string;
}): RunJobManager {
  const options: RunJobManagerOptions = {
    cwd: input.cwd,
    configPath: resolve(input.configPath),
  };
  return new RunJobManager(options);
}

function errorResponse(error: unknown): Response {
  if (error instanceof ActiveRunError) {
    return jsonResponse({ error: error.message }, 409);
  }
  if (error instanceof StaleConfigRevisionError) {
    return jsonResponse({ error: error.message }, 409);
  }
  if (error instanceof z.ZodError) {
    return jsonResponse({ error: "Invalid request body.", details: error.issues }, 400);
  }
  if (isNotFound(error)) {
    return jsonResponse({ error: "Not found." }, 404);
  }
  return jsonResponse(
    { error: error instanceof Error ? error.message : String(error) },
    500,
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: corsHeaders(),
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "http://127.0.0.1:5173",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function configSummary(config: AppConfig) {
  return {
    name: config.name,
    repos: config.repos.map((repo) => ({
      slug: repo.slug,
      localPath: repo.localPath,
      includeOwners: repo.includeOwners,
    })),
  };
}

async function configResponse(state: ConfigState) {
  return {
    ...state,
    validation: await validateConfig(state.config),
  };
}

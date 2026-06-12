import { setTraceProcessors } from "@openai/agents";
import { Client } from "langsmith";
import { OpenAIAgentsTracingProcessor } from "langsmith/wrappers/openai_agents";

let processor: OpenAIAgentsTracingProcessor | undefined;

export function initializeObservability(): boolean {
  if (!process.env.LANGSMITH_API_KEY) {
    return false;
  }
  if (processor) {
    return true;
  }

  processor = new OpenAIAgentsTracingProcessor({
    client: new Client(),
    projectName: process.env.LANGSMITH_PROJECT ?? "pr-report-agent",
    name: "Weave PR report agent",
    tags: ["pr-report-agent", "weave", "langsmith"],
    metadata: {
      app: "pr-report-agent",
      environment: process.env.NODE_ENV ?? "local",
      telemetry_library: "langsmith",
    },
  });
  setTraceProcessors([processor]);
  return true;
}

export async function flushObservability(): Promise<void> {
  await processor?.forceFlush();
}

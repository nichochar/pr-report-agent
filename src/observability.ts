import { addTraceProcessor } from "@openai/agents";
import {
  createRaindropOpenAIAgents,
  type RaindropOpenAIAgentsClient,
} from "@raindrop-ai/openai-agents";

let client: RaindropOpenAIAgentsClient | undefined;

export function initializeObservability(options: { convoId: string }): boolean {
  if (!process.env.RAINDROP_WRITE_KEY) {
    return false;
  }
  if (client) {
    return true;
  }

  client = createRaindropOpenAIAgents({
    writeKey: process.env.RAINDROP_WRITE_KEY,
    endpoint: process.env.RAINDROP_ENDPOINT,
    userId: process.env.RAINDROP_USER_ID ?? "pr-report-agent",
    convoId: process.env.RAINDROP_CONVO_ID ?? options.convoId,
    debug: process.env.RAINDROP_DEBUG === "1",
  });
  addTraceProcessor(client.processor);
  return true;
}

export async function flushObservability(): Promise<void> {
  await client?.flush();
  await client?.shutdown();
}

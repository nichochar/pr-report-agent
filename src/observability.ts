import { addTraceProcessor, type TracingProcessor } from "@openai/agents";
import { createOpenAIAgentsTracingProcessor, flushOTel, init } from "weave";

let processor: TracingProcessor | undefined;
let initialized = false;

export async function initializeObservability(): Promise<boolean> {
  const project = process.env.WEAVE_PROJECT;
  if (!project) {
    return false;
  }
  if (initialized) {
    return true;
  }

  await init(project);
  processor = createOpenAIAgentsTracingProcessor();
  addTraceProcessor(processor);
  initialized = true;
  return true;
}

export async function flushObservability(): Promise<void> {
  await processor?.forceFlush();
  await flushOTel();
}

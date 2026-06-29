import type {
  ConfigResponse,
  LaunchRunRequest,
  RunDetailResponse,
  RunJob,
  RunsListResponse,
  SaveConfigRequest,
} from "../../../src/ui/shared.js";

const API_BASE = "/api";

export async function fetchRuns(): Promise<RunsListResponse> {
  return fetchJson<RunsListResponse>(`${API_BASE}/runs`);
}

export async function fetchConfig(): Promise<ConfigResponse> {
  return fetchJson<ConfigResponse>(`${API_BASE}/config`);
}

export async function saveConfig(input: SaveConfigRequest): Promise<ConfigResponse> {
  return fetchJson<ConfigResponse>(`${API_BASE}/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchRunDetail(id: string): Promise<RunDetailResponse> {
  return fetchJson<RunDetailResponse>(`${API_BASE}/runs/${encodeURIComponent(id)}`);
}

export async function launchRun(input: LaunchRunRequest): Promise<RunJob> {
  const response = await fetchJson<{ job: RunJob }>(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.job;
}

export async function fetchJob(id: string): Promise<RunJob> {
  const response = await fetchJson<{ job: RunJob }>(`${API_BASE}/jobs/${encodeURIComponent(id)}`);
  return response.job;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

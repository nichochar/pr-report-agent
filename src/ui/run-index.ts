import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  PrCardSchema,
  ReportSchema,
  type PrAnalysisFailure,
  type PrCard,
  type Report,
  type ResolvedInterval,
} from "../types.js";
import type {
  ArtifactFlags,
  IndexedRunSummary,
  RepoCount,
  RiskCounts,
  RunDetailResponse,
  ScopedPrSummary,
  UiPrCard,
} from "./shared.js";

const ScopedPrsFileSchema = z.object({
  interval: z
    .object({
      startIso: z.string(),
      endIso: z.string(),
      timezone: z.string(),
      label: z.string(),
    })
    .optional(),
  scopedPrs: z.array(z.record(z.string(), z.unknown())).default([]),
});

const AnalyzerFailuresSchema = z.array(
  z.object({
    repo: z.string(),
    number: z.number().int(),
    title: z.string(),
    url: z.string(),
    mergedAt: z.string(),
    errorName: z.string(),
    errorMessage: z.string(),
    failedAt: z.string(),
  }),
);

interface RunFiles {
  dir: string;
  id: string;
  artifacts: ArtifactFlags;
  createdAt?: string;
  updatedAt?: string;
}

interface AreaDerivation {
  areas: string[];
  cards: UiPrCard[];
}

interface AreaInput {
  label: string;
  priority: number;
}

interface AreaStat {
  label: string;
  priority: number;
  count: number;
}

export async function listRuns(outputDir: string): Promise<IndexedRunSummary[]> {
  const root = resolve(outputDir);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await readRunSummary(root, entry.name);
        } catch (error) {
          return errorSummary(root, entry.name, error);
        }
      }),
  );

  return summaries.sort(compareRunsNewestFirst);
}

export async function readRunDetail(outputDir: string, runId: string): Promise<RunDetailResponse> {
  const root = resolve(outputDir);
  const files = await inspectRunFiles(root, runId);
  return buildRunDetail(files);
}

function compareRunsNewestFirst(left: IndexedRunSummary, right: IndexedRunSummary): number {
  return (
    Date.parse(right.interval?.endIso ?? right.updatedAt ?? "") -
      Date.parse(left.interval?.endIso ?? left.updatedAt ?? "") ||
    right.id.localeCompare(left.id)
  );
}

async function readRunSummary(root: string, runId: string): Promise<IndexedRunSummary> {
  const detail = await buildRunDetail(await inspectRunFiles(root, runId));
  const { report, reportMarkdown, cards, scopedPrs, analyzerFailures, ...summary } = detail;
  void report;
  void reportMarkdown;
  void cards;
  void scopedPrs;
  void analyzerFailures;
  return summary;
}

async function buildRunDetail(files: RunFiles): Promise<RunDetailResponse> {
  const scopedFile = await readJsonFile(join(files.dir, "scoped-prs.json"), ScopedPrsFileSchema);
  const report = await readJsonFile(join(files.dir, "report.json"), ReportSchema);
  const cards = await readJsonFile(join(files.dir, "cards.json"), z.array(PrCardSchema));
  const analyzerFailures =
    (await readJsonFile(join(files.dir, "analyzer-failures.json"), AnalyzerFailuresSchema)) ?? [];
  const reportMarkdown = normalizeReportMarkdownTitle(await readTextFile(join(files.dir, "report.md")));
  const normalizedReport = normalizeReport(report);
  const scopedPrs = ((scopedFile?.scopedPrs ?? []) as unknown as ScopedPrSummary[]).map(
    stripDiff,
  );
  const interval = scopedFile?.interval ?? intervalFromReport(files.id, normalizedReport);
  const areaDerivation = deriveAreas(cards ?? [], normalizedReport);
  const summary = buildSummary({
    files,
    interval,
    report: normalizedReport,
    scopedPrs,
    cards: areaDerivation.cards,
    analyzerFailures,
    areas: areaDerivation.areas,
  });

  return {
    ...summary,
    report: normalizedReport,
    reportMarkdown,
    cards: areaDerivation.cards,
    scopedPrs,
    analyzerFailures,
  };
}

function buildSummary(input: {
  files: RunFiles;
  interval?: ResolvedInterval;
  report?: Report;
  scopedPrs: ScopedPrSummary[];
  cards: UiPrCard[];
  analyzerFailures: PrAnalysisFailure[];
  areas: string[];
}): IndexedRunSummary {
  const prCount = input.scopedPrs.length || input.cards.length;
  return {
    id: input.files.id,
    status: statusForArtifacts(input.files.artifacts),
    title: normalizeReportTitle(input.report?.title),
    interval: input.interval,
    createdAt: input.files.createdAt,
    updatedAt: input.files.updatedAt,
    prCount,
    cardCount: input.cards.length,
    failureCount: input.analyzerFailures.length,
    repos: repoCounts(input.scopedPrs, input.cards),
    riskCounts: riskCounts(input.cards),
    areas: input.areas,
    artifacts: input.files.artifacts,
  };
}

function normalizeReport(report: Report | undefined): Report | undefined {
  if (!report) {
    return undefined;
  }
  return {
    ...report,
    title: normalizeReportTitle(report.title) ?? report.title,
    markdown: normalizeReportMarkdownTitle(report.markdown) ?? report.markdown,
  };
}

function normalizeReportTitle(title: string | undefined): string | undefined {
  if (!title) {
    return title;
  }
  return title.trim().toLocaleLowerCase() === "weave pr activity report" ? "PR Report" : title;
}

function normalizeReportMarkdownTitle(markdown: string | undefined): string | undefined {
  if (!markdown) {
    return markdown;
  }
  return markdown.replace(/^#\s+Weave PR Activity Report[ \t]*$/m, "# PR Report");
}

function statusForArtifacts(artifacts: ArtifactFlags): IndexedRunSummary["status"] {
  if (artifacts.reportJson && artifacts.reportMarkdown && artifacts.cards) {
    return "complete";
  }
  if (artifacts.scopedPrs && !artifacts.cards && !artifacts.reportJson) {
    return "collect-only";
  }
  return "partial";
}

async function inspectRunFiles(root: string, runId: string): Promise<RunFiles> {
  assertSafeRunId(runId);
  const dir = resolve(root, runId);
  if (!isInside(root, dir)) {
    throw new Error(`Invalid run id "${runId}".`);
  }

  const dirStat = await stat(dir);
  if (!dirStat.isDirectory()) {
    throw new Error(`Run "${runId}" is not a directory.`);
  }

  const names = new Set(await readdir(dir));
  const artifactNames = [
    "scoped-prs.json",
    "scoped-prs-with-diffs.json",
    "cards.json",
    "analyzer-failures.json",
    "report.json",
    "report.md",
  ];
  const artifactStats = await Promise.all(
    artifactNames
      .filter((name) => names.has(name))
      .map(async (name) => stat(join(dir, name))),
  );
  const createdMs = Math.min(dirStat.birthtimeMs, ...artifactStats.map((item) => item.birthtimeMs));
  const updatedMs = Math.max(dirStat.mtimeMs, ...artifactStats.map((item) => item.mtimeMs));

  return {
    dir,
    id: basename(dir),
    artifacts: {
      scopedPrs: names.has("scoped-prs.json"),
      scopedPrsWithDiffs: names.has("scoped-prs-with-diffs.json"),
      cards: names.has("cards.json"),
      analyzerFailures: names.has("analyzer-failures.json"),
      reportJson: names.has("report.json"),
      reportMarkdown: names.has("report.md"),
    },
    createdAt: new Date(createdMs).toISOString(),
    updatedAt: new Date(updatedMs).toISOString(),
  };
}

async function errorSummary(
  root: string,
  runId: string,
  error: unknown,
): Promise<IndexedRunSummary> {
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  try {
    const dirStat = await stat(join(root, runId));
    createdAt = dirStat.birthtime.toISOString();
    updatedAt = dirStat.mtime.toISOString();
  } catch {
    // Ignore secondary filesystem errors while reporting the original indexing issue.
  }

  return {
    id: runId,
    status: "error",
    createdAt,
    updatedAt,
    prCount: 0,
    cardCount: 0,
    failureCount: 0,
    repos: [],
    riskCounts: { low: 0, medium: 0, high: 0 },
    areas: [],
    artifacts: {
      scopedPrs: false,
      scopedPrsWithDiffs: false,
      cards: false,
      analyzerFailures: false,
      reportJson: false,
      reportMarkdown: false,
    },
    error: error instanceof Error ? error.message : String(error),
  };
}

function intervalFromReport(id: string, report: Report | undefined): ResolvedInterval | undefined {
  if (!report) {
    return undefined;
  }
  return {
    startIso: report.interval.start,
    endIso: report.interval.end,
    timezone: report.interval.timezone,
    label: id,
  };
}

function deriveAreas(cards: PrCard[], report: Report | undefined): AreaDerivation {
  const sectionHeadingsByCard = new Map<string, string[]>();
  for (const section of report?.sections ?? []) {
    for (const pr of section.prs) {
      addUnique(sectionHeadingsByCard, cardKey(pr.repo, pr.number), section.heading);
    }
  }

  const areaStats = new Map<string, AreaStat>();
  const uiCards = cards.map((card) => {
    const sectionHeadings = sectionHeadingsByCard.get(cardKey(card.repo, card.number)) ?? [];
    const areaInputs = collectAreaInputs(sectionHeadings, card);
    const areas = uniqueAreaLabels(areaInputs);
    for (const area of areaInputs) {
      addAreaStat(areaStats, area);
    }
    return {
      ...card,
      id: cardKey(card.repo, card.number),
      derivedAreas: areas,
      sectionHeadings,
    };
  });

  return {
    areas: displayAreas(areaStats),
    cards: uiCards,
  };
}

function collectAreas(sectionHeadings: string[], card: PrCard): string[] {
  return uniqueAreaLabels(collectAreaInputs(sectionHeadings, card));
}

function collectAreaInputs(sectionHeadings: string[], card: PrCard): AreaInput[] {
  const areas: AreaInput[] = [];
  for (const value of sectionHeadings) {
    addAreaInput(areas, value, 0);
  }
  for (const value of card.themes) {
    addAreaInput(areas, value, 1);
  }
  for (const value of card.tags) {
    addAreaInput(areas, formatTag(value), 2);
  }
  return areas;
}

function addAreaInput(areas: AreaInput[], value: string, priority: number): void {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 96) {
    return;
  }
  areas.push({ label: normalized, priority });
}

function uniqueAreaLabels(areaInputs: AreaInput[]): string[] {
  const areas = new Map<string, string>();
  for (const area of areaInputs) {
    areas.set(area.label.toLocaleLowerCase(), area.label);
  }
  return [...areas.values()];
}

function addAreaStat(stats: Map<string, AreaStat>, area: AreaInput): void {
  const key = area.label.toLocaleLowerCase();
  const existing = stats.get(key);
  if (existing) {
    existing.count += 1;
    existing.priority = Math.min(existing.priority, area.priority);
    return;
  }
  stats.set(key, { label: area.label, priority: area.priority, count: 1 });
}

function displayAreas(stats: Map<string, AreaStat>): string[] {
  return [...stats.values()]
    .filter((area) => area.priority === 0 || area.count > 1)
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        right.count - left.count ||
        left.label.localeCompare(right.label),
    )
    .slice(0, 60)
    .map((area) => area.label);
}

function formatTag(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addUnique(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key) ?? [];
  if (!existing.includes(value)) {
    existing.push(value);
  }
  map.set(key, existing);
}

function repoCounts(scopedPrs: ScopedPrSummary[], cards: UiPrCard[]): RepoCount[] {
  const counts = new Map<string, number>();
  const source = scopedPrs.length > 0 ? scopedPrs : cards;
  for (const item of source) {
    counts.set(item.repo, (counts.get(item.repo) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([repo, count]) => ({ repo, count }))
    .sort((left, right) => left.repo.localeCompare(right.repo));
}

function riskCounts(cards: UiPrCard[]): RiskCounts {
  const counts: RiskCounts = { low: 0, medium: 0, high: 0 };
  for (const card of cards) {
    counts[card.risk.level] += 1;
  }
  return counts;
}

function stripDiff(pr: ScopedPrSummary & { diff?: unknown }): ScopedPrSummary {
  const { diff, ...summary } = pr;
  void diff;
  return summary;
}

async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const text = await readTextFile(path);
  if (text === undefined) {
    return undefined;
  }
  return schema.parse(JSON.parse(text));
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function assertSafeRunId(runId: string): void {
  if (!runId || runId.includes("/") || runId.includes("\\") || runId === "." || runId === "..") {
    throw new Error(`Invalid run id "${runId}".`);
  }
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

function cardKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export const testExports = {
  collectAreas,
  deriveAreas,
  formatTag,
  normalizeReportMarkdownTitle,
  normalizeReportTitle,
  statusForArtifacts,
};

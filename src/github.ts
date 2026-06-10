import { DateTime } from "luxon";
import { loadCodeownersRules, ownerScopedFiles } from "./codeowners.js";
import { assertLocalRepo } from "./local-repo.js";
import { runCommand } from "./shell.js";
import type {
  AppConfig,
  CodeownersMatch,
  PullRequestFile,
  PullRequestRecord,
  RepoConfig,
  ResolvedInterval,
} from "./types.js";

interface GhListPr {
  additions: number;
  author?: { login?: string; name?: string; is_bot?: boolean };
  changedFiles: number;
  closedAt?: string;
  createdAt?: string;
  deletions: number;
  labels?: Array<{ name: string }>;
  mergeCommit?: { oid?: string };
  mergedAt: string;
  number: number;
  title: string;
  updatedAt?: string;
  url: string;
}

interface GhPrDetails {
  baseRefName?: string;
  baseRefOid?: string;
  body?: string;
  comments?: Array<{
    author?: { login?: string };
    body?: string;
    createdAt?: string;
    url?: string;
  }>;
  commits?: Array<{
    oid?: string;
    messageHeadline?: string;
    messageBody?: string;
    authors?: Array<{ login?: string; name?: string; email?: string }>;
  }>;
  files?: Array<{
    path: string;
    additions: number;
    deletions: number;
    changeType: string;
  }>;
  headRefName?: string;
  headRefOid?: string;
  reviews?: Array<{
    author?: { login?: string };
    body?: string;
    state?: string;
    submittedAt?: string;
  }>;
}

export async function collectScopedPullRequests(
  config: AppConfig,
  interval: ResolvedInterval,
): Promise<PullRequestRecord[]> {
  const all: PullRequestRecord[] = [];

  for (const repo of config.repos) {
    assertLocalRepo(repo.localPath);
    const rules = await loadCodeownersRules(repo);
    console.error(`Scanning ${repo.slug} for merged PRs in ${interval.label}`);
    const summaries = await listMergedPullRequests(repo, config, interval);
    let scopedCount = 0;

    for (const summary of summaries) {
      if (config.github.excludeBots && isBotAuthor(summary, config.github.ignoredAuthorLogins)) {
        continue;
      }

      const details = await loadPullRequestDetails(repo.slug, summary.number);
      const files = normalizeFiles(details.files ?? []);
      const matchedFiles = ownerScopedFiles(
        files.map((file) => file.path),
        rules,
        repo.includeOwners,
      );
      if (matchedFiles.length === 0) {
        continue;
      }

      const diff = await loadPullRequestDiff(repo.slug, summary.number);
      scopedCount += 1;
      all.push(normalizePullRequest(repo, summary, details, files, matchedFiles, diff));
    }

    console.error(`Scoped ${scopedCount} of ${summaries.length} merged PRs from ${repo.slug}`);
  }

  return all.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}

export async function listMergedPullRequests(
  repo: RepoConfig,
  config: AppConfig,
  interval: ResolvedInterval,
): Promise<GhListPr[]> {
  const start = DateTime.fromISO(interval.startIso).minus({ days: 1 }).toISODate();
  const end = DateTime.fromISO(interval.endIso).plus({ days: 1 }).toISODate();
  const search = `merged:${start}..${end}`;
  const jsonFields = [
    "number",
    "title",
    "url",
    "author",
    "mergedAt",
    "createdAt",
    "updatedAt",
    "closedAt",
    "mergeCommit",
    "labels",
    "additions",
    "deletions",
    "changedFiles",
  ].join(",");

  const stdout = await runCommand(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repo.slug,
      "--state",
      "merged",
      "--limit",
      String(config.github.maxPullRequests),
      "--search",
      search,
      "--json",
      jsonFields,
    ],
    { maxBuffer: 1024 * 1024 * 64 },
  );
  const prs = JSON.parse(stdout) as GhListPr[];
  const startMs = Date.parse(interval.startIso);
  const endMs = Date.parse(interval.endIso);
  return prs.filter((pr) => {
    const mergedMs = Date.parse(pr.mergedAt);
    return mergedMs >= startMs && mergedMs < endMs;
  });
}

export async function loadPullRequestDetails(repoSlug: string, number: number): Promise<GhPrDetails> {
  const jsonFields = [
    "files",
    "body",
    "comments",
    "reviews",
    "commits",
    "baseRefName",
    "headRefName",
    "baseRefOid",
    "headRefOid",
  ].join(",");
  const stdout = await runCommand(
    "gh",
    ["pr", "view", String(number), "--repo", repoSlug, "--json", jsonFields],
    { maxBuffer: 1024 * 1024 * 64 },
  );
  return JSON.parse(stdout) as GhPrDetails;
}

export async function loadPullRequestDiff(repoSlug: string, number: number): Promise<string> {
  return runCommand("gh", ["pr", "diff", String(number), "--repo", repoSlug, "--patch"], {
    maxBuffer: 1024 * 1024 * 128,
  });
}

export function isBotAuthor(pr: GhListPr, ignoredAuthorLogins: string[]): boolean {
  const login = pr.author?.login ?? "";
  const normalizedIgnored = new Set(ignoredAuthorLogins.map((author) => author.toLowerCase()));
  return (
    Boolean(pr.author?.is_bot) ||
    login.endsWith("[bot]") ||
    normalizedIgnored.has(login.toLowerCase())
  );
}

function normalizePullRequest(
  repo: RepoConfig,
  summary: GhListPr,
  details: GhPrDetails,
  files: PullRequestFile[],
  matchedFiles: CodeownersMatch[],
  diff: string,
): PullRequestRecord {
  return {
    repo: repo.slug,
    number: summary.number,
    title: summary.title,
    url: summary.url,
    author: {
      login: summary.author?.login ?? "unknown",
      name: summary.author?.name,
      isBot: Boolean(summary.author?.is_bot),
    },
    mergedAt: summary.mergedAt,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    closedAt: summary.closedAt,
    baseRefName: details.baseRefName,
    headRefName: details.headRefName,
    baseRefOid: details.baseRefOid,
    headRefOid: details.headRefOid,
    mergeCommitOid: summary.mergeCommit?.oid,
    labels: summary.labels?.map((label) => label.name) ?? [],
    additions: summary.additions,
    deletions: summary.deletions,
    changedFiles: summary.changedFiles,
    body: details.body,
    files,
    comments:
      details.comments?.map((comment) => ({
        author: comment.author?.login ?? "unknown",
        body: comment.body ?? "",
        createdAt: comment.createdAt,
        url: comment.url,
      })) ?? [],
    reviews:
      details.reviews?.map((review) => ({
        author: review.author?.login ?? "unknown",
        state: review.state ?? "UNKNOWN",
        body: review.body,
        submittedAt: review.submittedAt,
      })) ?? [],
    commits:
      details.commits?.map((commit) => ({
        oid: commit.oid ?? "",
        messageHeadline: commit.messageHeadline ?? "",
        messageBody: commit.messageBody,
        authors:
          commit.authors?.map(
            (author) => author.login ?? author.name ?? author.email ?? "unknown",
          ) ?? [],
      })) ?? [],
    ownership: {
      includeOwners: repo.includeOwners,
      matchedFiles,
    },
    diff,
  };
}

function normalizeFiles(files: PullRequestFile[]): PullRequestFile[] {
  return files.map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    changeType: file.changeType,
  }));
}

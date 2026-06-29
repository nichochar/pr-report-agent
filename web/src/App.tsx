import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FolderGit2,
  ExternalLink,
  FileText,
  GitPullRequest,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { fetchConfig, fetchJob, fetchRunDetail, fetchRuns, launchRun, saveConfig } from "./lib/api.js";
import { cn } from "./lib/utils.js";
import type {
  ConfigResponse,
  EditableAppConfig,
  IndexedRunSummary,
  RunDetailResponse,
  RunJob,
  UiConfigSummary,
  UiPrCard,
} from "../../src/ui/shared.js";

type Tab = "report" | "cards";
type LaunchMode = "previous-day" | "explicit";
type RiskFilter = "all" | "low" | "medium" | "high";

export default function App(): React.ReactElement {
  const [runs, setRuns] = useState<IndexedRunSummary[]>([]);
  const [config, setConfig] = useState<UiConfigSummary | undefined>();
  const [configState, setConfigState] = useState<ConfigResponse | undefined>();
  const [configDraft, setConfigDraft] = useState<EditableAppConfig | undefined>();
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [runDetail, setRunDetail] = useState<RunDetailResponse | undefined>();
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>("report");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [repo, setRepo] = useState("all");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [job, setJob] = useState<RunJob | undefined>();
  const [launchMode, setLaunchMode] = useState<LaunchMode>("previous-day");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function refreshRuns(selectLatest = false): Promise<void> {
    setIsLoadingRuns(true);
    setError(undefined);
    try {
      const response = await fetchRuns();
      const nextRuns = response.runs;
      setConfig(response.config);
      setRuns(nextRuns);
      if (selectLatest || !selectedRunId) {
        setSelectedRunId(defaultRunId(nextRuns));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingRuns(false);
    }
  }

  async function refreshConfig(): Promise<void> {
    setError(undefined);
    try {
      const response = await fetchConfig();
      setConfigState(response);
      setConfigDraft(cloneConfig(response.config));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void refreshRuns(true);
    void refreshConfig();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(undefined);
      return;
    }
    setIsLoadingDetail(true);
    setError(undefined);
    void fetchRunDetail(selectedRunId)
      .then((detail) => {
        setRunDetail(detail);
        setSelectedCardId(undefined);
        setArea("all");
        setRepo("all");
        setRisk("all");
        setQuery("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => setIsLoadingDetail(false));
  }, [selectedRunId]);

  useEffect(() => {
    if (!job || job.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchJob(job.id)
        .then((nextJob) => {
          setJob(nextJob);
          if (nextJob.status !== "running") {
            void refreshRuns(true);
          }
        })
        .catch((jobError) => {
          setError(jobError instanceof Error ? jobError.message : String(jobError));
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  const repos = useMemo(() => {
    const source = runDetail?.repos ?? [];
    return source.map((item) => item.repo);
  }, [runDetail]);

  const filteredCards = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (runDetail?.cards ?? []).filter((card) => {
      if (repo !== "all" && card.repo !== repo) {
        return false;
      }
      if (risk !== "all" && card.risk.level !== risk) {
        return false;
      }
      if (area !== "all" && !card.derivedAreas.includes(area)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return cardSearchText(card).includes(normalizedQuery);
    });
  }, [area, query, repo, risk, runDetail]);

  async function submitRun(): Promise<void> {
    setError(undefined);
    try {
      const nextJob = await launchRun(
        launchMode === "previous-day"
          ? { preset: "previous-day" }
          : { start: startDate, end: endDate },
      );
      setJob(nextJob);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
    }
  }

  async function submitConfig(): Promise<void> {
    if (!configDraft) {
      return;
    }
    setIsSavingConfig(true);
    setError(undefined);
    try {
      const response = await saveConfig({
        config: configDraft,
        revision: configState?.revision,
      });
      setConfigState(response);
      setConfigDraft(cloneConfig(response.config));
      setConfig(configSummary(response.config));
      setIsEditingConfig(false);
      await refreshRuns();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSavingConfig(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-5 p-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold">PR Reports</h1>
                  <p className="text-sm text-slate-500">Local repo reports</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  title="Refresh runs"
                  aria-label="Refresh runs"
                  onClick={() => void refreshRuns()}
                >
                  <RefreshCw className={cn(isLoadingRuns && "animate-spin")} />
                </Button>
              </div>
              {error ? (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}
            </div>

            <LaunchRunPanel
              mode={launchMode}
              setMode={setLaunchMode}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              job={job}
              config={configDraft ? configSummary(configDraft) : config}
              configDraft={configDraft}
              configValidation={configState?.validation ?? []}
              isEditingConfig={isEditingConfig}
              setIsEditingConfig={setIsEditingConfig}
              isSavingConfig={isSavingConfig}
              setConfigDraft={setConfigDraft}
              onSaveConfig={() => void submitConfig()}
              onResetConfig={() => {
                setConfigDraft(configState ? cloneConfig(configState.config) : undefined);
                setIsEditingConfig(false);
              }}
              onSubmit={() => void submitRun()}
            />

            <div className="min-h-0 flex-1">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                <CalendarDays className="size-4 text-sky-700" />
                Run Archive
              </div>
              <div className="max-h-[38vh] space-y-2 overflow-auto pr-1 lg:max-h-none">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    className={cn(
                      "w-full rounded-md border p-3 text-left transition-colors",
                      selectedRunId === run.id
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    )}
                    onClick={() => {
                      setSelectedRunId(run.id);
                      setTab("report");
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {displayRunTitle(run)}
                        </div>
                        <div
                          className={cn(
                            "mt-1 truncate text-xs",
                            selectedRunId === run.id ? "text-slate-300" : "text-slate-500",
                          )}
                        >
                          {formatInterval(run)}
                        </div>
                      </div>
                      <StatusBadge status={run.status} selected={selectedRunId === run.id} />
                    </div>
                    <div
                      className={cn(
                        "mt-2 flex flex-wrap gap-2 text-xs",
                        selectedRunId === run.id ? "text-slate-200" : "text-slate-500",
                      )}
                    >
                      <span>{run.prCount} PRs</span>
                      <span>{run.cardCount} cards</span>
                      {run.failureCount > 0 ? <span>{run.failureCount} failed</span> : null}
                    </div>
                  </button>
                ))}
                {!isLoadingRuns && runs.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    No runs found.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:p-6">
            <RunHeader detail={runDetail} isLoading={isLoadingDetail} />

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
              <div className="flex gap-1">
                <TabButton active={tab === "report"} onClick={() => setTab("report")}>
                  <FileText /> Report
                </TabButton>
                <TabButton active={tab === "cards"} onClick={() => setTab("cards")}>
                  <GitPullRequest /> PR Cards
                </TabButton>
              </div>
              {runDetail?.report?.interval ? (
                <div className="pb-2 text-sm text-slate-500">
                  {runDetail.report.interval.timezone}
                </div>
              ) : null}
            </div>

            {tab === "report" ? (
              <ReportView markdown={runDetail?.reportMarkdown ?? runDetail?.report?.markdown} />
            ) : (
              <CardsView
                detail={runDetail}
                filteredCards={filteredCards}
                selectedCardId={selectedCardId}
                setSelectedCardId={setSelectedCardId}
                query={query}
                setQuery={setQuery}
                repos={repos}
                repo={repo}
                setRepo={setRepo}
                risk={risk}
                setRisk={setRisk}
                area={area}
                setArea={setArea}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function LaunchRunPanel(props: {
  mode: LaunchMode;
  setMode: (mode: LaunchMode) => void;
  startDate: string;
  setStartDate: (value: string) => void;
  endDate: string;
  setEndDate: (value: string) => void;
  job?: RunJob;
  config?: UiConfigSummary;
  configDraft?: EditableAppConfig;
  configValidation: ConfigResponse["validation"];
  isEditingConfig: boolean;
  setIsEditingConfig: (value: boolean) => void;
  isSavingConfig: boolean;
  setConfigDraft: (value: EditableAppConfig | undefined) => void;
  onSaveConfig: () => void;
  onResetConfig: () => void;
  onSubmit: () => void;
}): React.ReactElement {
  const canSubmit =
    props.job?.status !== "running" &&
    (props.mode === "previous-day" || (props.startDate && props.endDate));
  const canSaveConfig = props.configDraft ? isConfigDraftComplete(props.configDraft) : false;

  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
        <Play className="size-4 text-emerald-700" />
        Launch Run
      </div>
      <ConfigEditor
        config={props.config}
        draft={props.configDraft}
        validation={props.configValidation}
        isEditing={props.isEditingConfig}
        isSaving={props.isSavingConfig}
        canSave={canSaveConfig}
        setIsEditing={props.setIsEditingConfig}
        setDraft={props.setConfigDraft}
        onSave={props.onSaveConfig}
        onReset={props.onResetConfig}
      />
      <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-200 p-1">
        <button
          type="button"
          className={cn(
            "rounded px-2 py-1.5 text-sm font-medium",
            props.mode === "previous-day" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600",
          )}
          onClick={() => props.setMode("previous-day")}
        >
          Previous day
        </button>
        <button
          type="button"
          className={cn(
            "rounded px-2 py-1.5 text-sm font-medium",
            props.mode === "explicit" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600",
          )}
          onClick={() => props.setMode("explicit")}
        >
          Date range
        </button>
      </div>
      {props.mode === "explicit" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Input
            type="date"
            value={props.startDate}
            aria-label="Start date"
            onChange={(event) => props.setStartDate(event.target.value)}
          />
          <Input
            type="date"
            value={props.endDate}
            aria-label="End date"
            onChange={(event) => props.setEndDate(event.target.value)}
          />
        </div>
      ) : null}
      <Button
        type="button"
        className="mt-3 w-full"
        disabled={!canSubmit}
        onClick={props.onSubmit}
      >
        {props.job?.status === "running" ? <Loader2 className="animate-spin" /> : <Play />}
        Run report
      </Button>
      {props.job ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs">
            <span className="font-medium text-slate-700">{props.job.status}</span>
            {props.job.exitCode !== undefined ? (
              <span className="text-slate-500">exit {props.job.exitCode}</span>
            ) : null}
          </div>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-slate-700">
            {props.job.logs.map((entry) => entry.text).join("")}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

function ConfigEditor(props: {
  config?: UiConfigSummary;
  draft?: EditableAppConfig;
  validation: ConfigResponse["validation"];
  isEditing: boolean;
  isSaving: boolean;
  canSave: boolean;
  setIsEditing: (value: boolean) => void;
  setDraft: (value: EditableAppConfig | undefined) => void;
  onSave: () => void;
  onReset: () => void;
}): React.ReactElement {
  const repos = props.draft?.repos ?? [];

  function updateRepo(index: number, patch: Partial<EditableAppConfig["repos"][number]>): void {
    if (!props.draft) {
      return;
    }
    const next = cloneConfig(props.draft);
    next.repos[index] = { ...next.repos[index], ...patch };
    props.setDraft(next);
  }

  function removeRepo(index: number): void {
    if (!props.draft || props.draft.repos.length <= 1) {
      return;
    }
    const next = cloneConfig(props.draft);
    next.repos.splice(index, 1);
    props.setDraft(next);
  }

  function addRepo(): void {
    if (!props.draft) {
      return;
    }
    const next = cloneConfig(props.draft);
    next.repos.push({
      slug: "",
      localPath: "",
      includeOwners: ["@wandb/weave-team"],
      codeownersPaths: [".github/CODEOWNERS"],
      productContext: "",
    });
    props.setDraft(next);
  }

  if (!props.isEditing) {
    return (
      <div className="mb-3 rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-slate-500">
              <Settings2 className="size-3.5" />
              Config
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900">
              {props.config?.name ?? "Default"}
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="Edit repo config"
            aria-label="Edit repo config"
            disabled={!props.draft}
            onClick={() => props.setIsEditing(true)}
          >
            <Pencil />
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {(props.config?.repos ?? []).map((repo) => (
            <div key={repo.slug} className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="flex items-center gap-2">
                <FolderGit2 className="size-4 shrink-0 text-sky-700" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{repo.slug}</div>
                  <div className="truncate text-xs text-slate-500">{repo.localPath}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {repo.includeOwners.map((owner) => (
                  <Badge key={owner} variant="outline">
                    {owner}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
        <ValidationMessages validation={props.validation} />
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase text-slate-500">
          <Settings2 className="size-3.5" />
          Repos
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Cancel config edits"
            aria-label="Cancel config edits"
            onClick={props.onReset}
          >
            <X />
          </Button>
          <Button
            type="button"
            size="icon"
            title="Save config"
            aria-label="Save config"
            disabled={!props.canSave || props.isSaving}
            onClick={props.onSave}
          >
            {props.isSaving ? <Loader2 className="animate-spin" /> : <Save />}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {repos.map((repo, index) => (
          <div key={index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-sm font-medium text-slate-800">
                {repo.slug || "New repo"}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Remove repo"
                aria-label="Remove repo"
                disabled={repos.length <= 1}
                onClick={() => removeRepo(index)}
              >
                <Trash2 />
              </Button>
            </div>

            <div className="space-y-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Slug</span>
                <Input
                  value={repo.slug}
                  placeholder="owner/repo"
                  onChange={(event) => updateRepo(index, { slug: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Local path</span>
                <Input
                  value={repo.localPath}
                  placeholder="~/crwv/weave"
                  onChange={(event) => updateRepo(index, { localPath: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Owners</span>
                <Input
                  value={formatList(repo.includeOwners)}
                  placeholder="@wandb/weave-team"
                  onChange={(event) =>
                    updateRepo(index, { includeOwners: parseList(event.target.value) })
                  }
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">CODEOWNERS</span>
                <Input
                  value={formatList(repo.codeownersPaths)}
                  placeholder=".github/CODEOWNERS"
                  onChange={(event) =>
                    updateRepo(index, { codeownersPaths: parseList(event.target.value) })
                  }
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Context</span>
                <textarea
                  className="min-h-20 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                  value={repo.productContext}
                  onChange={(event) => updateRepo(index, { productContext: event.target.value })}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" size="sm" className="mt-3 w-full" onClick={addRepo}>
        <Plus />
        Add repo
      </Button>
      <ValidationMessages validation={props.validation} />
    </div>
  );
}

function ValidationMessages({
  validation,
}: {
  validation: ConfigResponse["validation"];
}): React.ReactElement | null {
  if (validation.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 space-y-1.5">
      {validation.map((issue) => (
        <div
          key={`${issue.path}:${issue.message}`}
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function RunHeader({
  detail,
  isLoading,
}: {
  detail?: RunDetailResponse;
  isLoading: boolean;
}): React.ReactElement {
  return (
    <header className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-xl font-semibold">
            {detail ? displayRunTitle(detail) : "PR Report"}
          </h2>
          {isLoading ? <Loader2 className="size-4 animate-spin text-slate-500" /> : null}
        </div>
        <div className="mt-1 text-sm text-slate-500">{detail ? formatInterval(detail) : ""}</div>
      </div>
      {detail ? (
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-80">
          <Metric label="PRs" value={detail.prCount} />
          <Metric label="Cards" value={detail.cardCount} />
          <Metric label="Areas" value={detail.areas.length} />
        </div>
      ) : null}
    </header>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={cn(
        "flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium [&_svg]:size-4",
        active
          ? "border-slate-950 text-slate-950"
          : "border-transparent text-slate-500 hover:text-slate-900",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ReportView({ markdown }: { markdown?: string }): React.ReactElement {
  if (!markdown) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-slate-500">
          This run does not have a Markdown report.
        </CardContent>
      </Card>
    );
  }

  return (
    <article className="rounded-md border border-slate-200 bg-white p-5">
      <div className="report-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </article>
  );
}

function CardsView(props: {
  detail?: RunDetailResponse;
  filteredCards: UiPrCard[];
  selectedCardId?: string;
  setSelectedCardId: (id: string | undefined) => void;
  query: string;
  setQuery: (value: string) => void;
  repos: string[];
  repo: string;
  setRepo: (value: string) => void;
  risk: RiskFilter;
  setRisk: (value: RiskFilter) => void;
  area: string;
  setArea: (value: string) => void;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      <section className="min-w-0 space-y-3">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Search className="size-4 text-sky-700" />
              Filters
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-[1fr_160px_140px]">
              <Input
                value={props.query}
                placeholder="Search cards"
                aria-label="Search cards"
                onChange={(event) => props.setQuery(event.target.value)}
              />
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm"
                value={props.repo}
                aria-label="Repo"
                onChange={(event) => props.setRepo(event.target.value)}
              >
                <option value="all">All repos</option>
                {props.repos.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm"
                value={props.risk}
                aria-label="Risk"
                onChange={(event) => props.setRisk(event.target.value as RiskFilter)}
              >
                <option value="all">All risks</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="mt-3 flex max-h-28 flex-wrap gap-2 overflow-auto">
              <AreaButton
                active={props.area === "all"}
                label="All areas"
                onClick={() => props.setArea("all")}
              />
              {(props.detail?.areas ?? []).map((item) => (
                <AreaButton
                  key={item}
                  active={props.area === item}
                  label={item}
                  onClick={() => props.setArea(item)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {props.filteredCards.map((card) => {
            const isExpanded = props.selectedCardId === card.id;
            return (
            <Card
              key={card.id}
              className={cn(
                "transition-colors",
                isExpanded
                  ? "border-slate-950"
                  : "hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={isExpanded}
                    onClick={() => props.setSelectedCardId(isExpanded ? undefined : card.id)}
                  >
                    <div className="truncate text-sm font-semibold">{card.title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {card.repo} #{card.number} by {card.author}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.setRisk(card.risk.level);
                    }}
                    title={`Filter to ${card.risk.level} risk`}
                  >
                    <RiskBadge level={card.risk.level} />
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-3 text-sm leading-6 text-slate-600">{card.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5" onClick={(event) => event.stopPropagation()}>
                  <FilterBadge
                    label={card.repo}
                    active={props.repo === card.repo}
                    onClick={() => props.setRepo(card.repo)}
                  />
                  {card.derivedAreas.slice(0, 4).map((item) => (
                    <FilterBadge
                      key={item}
                      label={item}
                      active={props.area === item}
                      onClick={() => props.setArea(item)}
                    />
                  ))}
                </div>
                {isExpanded ? (
                  <div className="mt-5 border-t border-slate-200 pt-5">
                    <CardDetail
                      card={card}
                      setArea={props.setArea}
                      setRepo={props.setRepo}
                      setRisk={props.setRisk}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
            );
          })}
          {props.filteredCards.length === 0 ? (
            <Card>
              <CardContent className="pt-4 text-sm text-slate-500">No matching cards.</CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AreaButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={cn(
        "max-w-full rounded-md border px-2.5 py-1 text-xs font-medium",
        active
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      )}
      onClick={onClick}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

function FilterBadge({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button type="button" className="max-w-full" title={`Filter to ${label}`} onClick={onClick}>
      <Badge variant={active ? "default" : "secondary"} className="truncate">
        {label}
      </Badge>
    </button>
  );
}

function CardDetail({
  card,
  setArea,
  setRepo,
  setRisk,
}: {
  card: UiPrCard;
  setArea: (value: string) => void;
  setRepo: (value: string) => void;
  setRisk: (value: RiskFilter) => void;
}): React.ReactElement {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-slate-500">
            {card.repo} #{card.number}
          </div>
          <h3 className="mt-1 text-lg font-semibold leading-7">{card.title}</h3>
        </div>
        <Button asChild variant="secondary" size="icon" title="Open GitHub PR" aria-label="Open GitHub PR">
          <a href={card.url} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" title={`Filter to ${card.risk.level} risk`} onClick={() => setRisk(card.risk.level)}>
          <RiskBadge level={card.risk.level} />
        </button>
        <FilterBadge label={card.repo} active={false} onClick={() => setRepo(card.repo)} />
        <Badge variant="outline">{card.author}</Badge>
        <Badge variant="outline">{formatDate(card.mergedAt)}</Badge>
        {card.derivedAreas.map((item) => (
          <FilterBadge key={item} label={item} active={false} onClick={() => setArea(item)} />
        ))}
      </div>
      <DetailBlock title="Summary" body={card.summary} />
      <DetailBlock title="Product impact" body={card.productImpact} />
      <DetailList title="What changed" items={card.whatChanged} />
      <DetailList title="Technical details" items={card.technicalDetails} />
      <DetailList title="Risk reasons" items={card.risk.reasons} />
      <DetailList title="Open questions" items={card.openQuestions} />

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900">Files and ownership</h4>
        <div className="space-y-2">
          {card.notableFiles.map((file) => (
            <div key={file.path} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="break-words font-mono text-xs text-slate-700">{file.path}</div>
              <div className="mt-1 text-xs font-medium text-slate-500">{file.role}</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{file.notableChanges}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {card.ownerScope.matchedFiles.slice(0, 12).map((file) => (
            <Badge key={file.path} variant="outline" className="max-w-full">
              <span className="truncate">{file.path}</span>
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}

function DetailBlock({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <section>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </section>
  );
}

function DetailList({
  title,
  items,
}: {
  title: string;
  items: string[];
}): React.ReactElement | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <section>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadge({
  status,
  selected,
}: {
  status: IndexedRunSummary["status"];
  selected: boolean;
}): React.ReactElement {
  if (status === "complete") {
    return (
      <span className={cn("shrink-0", selected ? "text-emerald-200" : "text-emerald-700")}>
        <CheckCircle2 className="size-4" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={cn("shrink-0", selected ? "text-rose-200" : "text-rose-700")}>
        <AlertTriangle className="size-4" />
      </span>
    );
  }
  return (
    <Badge variant={selected ? "outline" : "secondary"} className="shrink-0">
      {status}
    </Badge>
  );
}

function RiskBadge({
  level,
}: {
  level: "low" | "medium" | "high";
}): React.ReactElement {
  const variant =
    level === "low" ? "riskLow" : level === "medium" ? "riskMedium" : "riskHigh";
  return <Badge variant={variant}>{level} risk</Badge>;
}

function configSummary(config: EditableAppConfig): UiConfigSummary {
  return {
    name: config.name,
    repos: config.repos.map((repo) => ({
      slug: repo.slug,
      localPath: repo.localPath,
      includeOwners: repo.includeOwners,
    })),
  };
}

function isConfigDraftComplete(config: EditableAppConfig): boolean {
  return (
    config.repos.length > 0 &&
    config.repos.every(
      (repo) =>
        /^[^/]+\/[^/]+$/.test(repo.slug) &&
        repo.localPath.trim().length > 0 &&
        repo.includeOwners.length > 0 &&
        repo.codeownersPaths.length > 0,
    )
  );
}

function formatList(values: string[]): string {
  return values.join(", ");
}

function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloneConfig(config: EditableAppConfig): EditableAppConfig {
  return JSON.parse(JSON.stringify(config)) as EditableAppConfig;
}

function cardSearchText(card: UiPrCard): string {
  return [
    card.repo,
    card.number,
    card.title,
    card.author,
    card.summary,
    card.productImpact,
    card.leadRelevance,
    ...card.themes,
    ...card.tags,
    ...card.derivedAreas,
    ...card.whatChanged,
    ...card.technicalDetails,
    ...card.notableFiles.flatMap((file) => [file.path, file.role, file.notableChanges]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function formatRunTitle(run: IndexedRunSummary): string {
  return run.interval?.label ?? run.id;
}

function displayRunTitle(run: { title?: string; interval?: { label: string } }): string {
  return run.title?.trim() || formatRunTitle(run as IndexedRunSummary);
}

function defaultRunId(runs: IndexedRunSummary[]): string | undefined {
  return runs.find((run) => run.status === "complete")?.id ?? runs[0]?.id;
}

function formatInterval(run: { interval?: { startIso: string; endIso: string } }): string {
  if (!run.interval) {
    return "";
  }
  return `${formatDate(run.interval.startIso)} to ${formatDate(run.interval.endIso)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

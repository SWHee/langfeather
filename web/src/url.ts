import type { DashboardBucket } from "./api/types";

export type AppView = "traces" | "insights" | "evaluate" | "settings";

/** Evaluate 안의 세그먼트. */
export type EvaluateSection = "datasets" | "queues" | "scores";

export type OverviewUrlState = {
  from: string;
  to: string;
  timezone: string;
  bucket: DashboardBucket;
  query: string;
  tag: string;
  sessionId: string;
  release: string;
  environment: string;
  userId: string;
  scoreIds: string[];
  toolNames: string[];
};

export type EvaluationUrlState = {
  datasetId: string | null;
  tab: "compare" | "experiments" | "examples";
  experimentIds: string[];
  metricKeys: string[];
  caseId: string | null;
};

export type AppUrlState = {
  view: AppView;
  section: EvaluateSection;
  overview: OverviewUrlState;
  evaluation: EvaluationUrlState;
  traceId: string | null;
};

/**
 * top-level 기능은 이 배열 하나에서만 정의한다. 탭 재편은 되돌릴 수 있어야 한다고
 * 합의했고, 되돌리는 비용은 여기가 유일한 정의 지점일 때만 낮다.
 */
const APP_VIEWS: readonly AppView[] = [
  "traces",
  "insights",
  "evaluate",
  "settings",
];

const EVALUATE_SECTIONS: readonly EvaluateSection[] = [
  "datasets",
  "queues",
  "scores",
];

/**
 * 재편 이전 `view` 값. 이미 공유된 link를 깨지 않기 위해 읽을 때만 옮겨 준다.
 * URL을 다시 쓸 때는 항상 새 값으로만 쓴다.
 */
const LEGACY_VIEWS: Record<string, { view: AppView; section?: EvaluateSection }> =
  {
    overview: { view: "insights" },
    traces: { view: "traces" },
    queues: { view: "evaluate", section: "queues" },
    scores: { view: "evaluate", section: "scores" },
    datasets: { view: "evaluate", section: "datasets" },
    data: { view: "settings" },
  };
const DASHBOARD_BUCKETS: readonly DashboardBucket[] = [
  "auto",
  "minute",
  "hour",
  "day",
  "week",
  "month",
];
const EVALUATION_TABS: readonly EvaluationUrlState["tab"][] = [
  "examples",
  "experiments",
  "compare",
];

function oneOf<T extends string>(
  value: string | null,
  choices: readonly T[],
  fallback: T,
): T {
  return value !== null && choices.includes(value as T)
    ? (value as T)
    : fallback;
}

function list(value: string | null): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "") ?? []
  );
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function defaultOverviewUrlState(now = new Date()): OverviewUrlState {
  return {
    from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000).toISOString(),
    to: now.toISOString(),
    timezone: localTimezone(),
    bucket: "auto",
    query: "",
    tag: "",
    sessionId: "",
    release: "",
    environment: "",
    userId: "",
    scoreIds: [],
    toolNames: [],
  };
}

function readOverviewUrlState(params: URLSearchParams): OverviewUrlState {
  const defaults = defaultOverviewUrlState();
  return {
    from: params.get("overview_from") ?? defaults.from,
    to: params.get("overview_to") ?? defaults.to,
    timezone: params.get("overview_timezone") ?? defaults.timezone,
    bucket: oneOf(
      params.get("overview_bucket"),
      DASHBOARD_BUCKETS,
      defaults.bucket,
    ),
    query: params.get("overview_query") ?? "",
    tag: params.get("overview_tag") ?? "",
    sessionId: params.get("overview_session") ?? "",
    release: params.get("overview_release") ?? "",
    environment: params.get("overview_environment") ?? "",
    userId: params.get("overview_user") ?? "",
    scoreIds: list(params.get("overview_scores")).slice(0, 4),
    toolNames: list(params.get("overview_tools")),
  };
}

function readShell(params: URLSearchParams): {
  view: AppView;
  section: EvaluateSection;
} {
  const raw = params.get("view");
  const section = oneOf(params.get("section"), EVALUATE_SECTIONS, "datasets");
  if (raw !== null && APP_VIEWS.includes(raw as AppView)) {
    return { view: raw as AppView, section };
  }
  const legacy = raw === null ? undefined : LEGACY_VIEWS[raw];
  if (legacy === undefined) return { view: "traces", section };
  return { view: legacy.view, section: legacy.section ?? section };
}

export function readAppUrlState(search = window.location.search): AppUrlState {
  const params = new URLSearchParams(search);
  return {
    ...readShell(params),
    overview: readOverviewUrlState(params),
    evaluation: {
      datasetId: params.get("dataset"),
      tab: oneOf(params.get("tab"), EVALUATION_TABS, "examples"),
      experimentIds: list(params.get("experiments")),
      metricKeys: list(params.get("metrics")),
      caseId: params.get("case"),
    },
    traceId: params.get("trace"),
  };
}

export function replaceAppUrlState(state: AppUrlState): void {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  for (const key of [
    "view",
    "section",
    "overview_from",
    "overview_to",
    "overview_timezone",
    "overview_bucket",
    "overview_query",
    "overview_tag",
    "overview_session",
    "overview_release",
    "overview_environment",
    "overview_user",
    "overview_scores",
    "overview_tools",
    "dataset",
    "tab",
    "experiments",
    "metrics",
    "case",
    "trace",
  ]) {
    params.delete(key);
  }

  params.set("view", state.view);
  if (state.view === "evaluate" && state.section !== "datasets") {
    params.set("section", state.section);
  }
  const overview = state.overview;
  params.set("overview_from", overview.from);
  params.set("overview_to", overview.to);
  params.set("overview_timezone", overview.timezone);
  if (overview.bucket !== "auto")
    params.set("overview_bucket", overview.bucket);
  if (overview.query) params.set("overview_query", overview.query);
  if (overview.tag) params.set("overview_tag", overview.tag);
  if (overview.sessionId) params.set("overview_session", overview.sessionId);
  if (overview.release) params.set("overview_release", overview.release);
  if (overview.environment)
    params.set("overview_environment", overview.environment);
  if (overview.userId) params.set("overview_user", overview.userId);
  if (overview.scoreIds.length)
    params.set("overview_scores", overview.scoreIds.join(","));
  if (overview.toolNames.length)
    params.set("overview_tools", overview.toolNames.join(","));
  const hasEvaluationContext =
    (state.view === "evaluate" && state.section === "datasets") ||
    state.evaluation.datasetId !== null ||
    state.evaluation.experimentIds.length > 0 ||
    state.evaluation.metricKeys.length > 0 ||
    state.evaluation.caseId !== null;
  if (state.evaluation.datasetId !== null) {
    params.set("dataset", state.evaluation.datasetId);
  }
  if (hasEvaluationContext) {
    params.set("tab", state.evaluation.tab);
  }
  if (state.evaluation.experimentIds.length > 0) {
    params.set("experiments", state.evaluation.experimentIds.join(","));
  }
  if (state.evaluation.metricKeys.length > 0) {
    params.set("metrics", state.evaluation.metricKeys.join(","));
  }
  if (state.evaluation.caseId !== null) {
    params.set("case", state.evaluation.caseId);
  }
  if (state.traceId !== null) {
    params.set("trace", state.traceId);
  }

  window.history.replaceState(window.history.state, "", url);
}

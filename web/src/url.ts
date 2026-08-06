import type { DashboardBucket } from "./api/types";

export type AppView = "overview" | "traces" | "evaluate" | "settings";

/**
 * Evaluate 안의 세그먼트. 기획서 05절대로 넷이다 — dataset 안에 다시 탭을 두면
 * 같은 여정이 두 겹으로 갈라진다. dataset 선택은 세그먼트가 아니라 상단의
 * context bar가 맡는다.
 */
export type EvaluateSection =
  | "examples"
  | "experiments"
  | "queues"
  | "scores";

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
  "overview",
  "traces",
  "evaluate",
  "settings",
];

/** 기본 진입 화면. 배열 순서와 함께 여기 한 곳에서만 정한다. */
const DEFAULT_VIEW: AppView = "overview";

const EVALUATE_SECTIONS: readonly EvaluateSection[] = [
  "examples",
  "experiments",
  "queues",
  "scores",
];

/**
 * 재편 이전 `view` 값. 이미 공유된 link를 깨지 않기 위해 읽을 때만 옮겨 준다.
 * URL을 다시 쓸 때는 항상 새 값으로만 쓴다.
 */
const LEGACY_VIEWS: Record<string, { view: AppView; section?: EvaluateSection }> =
  {
    // 재편 중 잠깐 쓰던 이름. Overview로 되돌렸다.
    insights: { view: "overview" },
    traces: { view: "traces" },
    queues: { view: "evaluate", section: "queues" },
    scores: { view: "evaluate", section: "scores" },
    datasets: { view: "evaluate", section: "examples" },
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
/**
 * 재편 이전의 `tab` 값. 세그먼트가 그 자리를 대신하므로 읽을 때만 옮겨 준다.
 * `compare`는 실제로 experiments 안에서 그려지던 화면이라 그쪽으로 접는다.
 */
const LEGACY_TABS: Record<string, EvaluateSection> = {
  examples: "examples",
  experiments: "experiments",
  compare: "experiments",
};

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
  const legacyTab = LEGACY_TABS[params.get("tab") ?? ""];
  const section = oneOf(
    params.get("section"),
    EVALUATE_SECTIONS,
    legacyTab ?? "examples",
  );
  if (raw !== null && APP_VIEWS.includes(raw as AppView)) {
    return { view: raw as AppView, section };
  }
  const legacy = raw === null ? undefined : LEGACY_VIEWS[raw];
  if (legacy === undefined) return { view: DEFAULT_VIEW, section };
  return { view: legacy.view, section: legacy.section ?? section };
}

export function readAppUrlState(search = window.location.search): AppUrlState {
  const params = new URLSearchParams(search);
  return {
    ...readShell(params),
    overview: readOverviewUrlState(params),
    evaluation: {
      datasetId: params.get("dataset"),
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
  if (state.view === "evaluate" && state.section !== "examples") {
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
  if (state.evaluation.datasetId !== null) {
    params.set("dataset", state.evaluation.datasetId);
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

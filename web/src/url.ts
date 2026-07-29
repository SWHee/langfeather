export type AppView = "traces" | "queues" | "scores" | "datasets" | "data";

export type EvaluationUrlState = {
  datasetId: string | null;
  tab: "compare" | "experiments" | "examples";
  experimentIds: string[];
  metricKeys: string[];
  caseId: string | null;
};

export type AppUrlState = {
  view: AppView;
  evaluation: EvaluationUrlState;
  traceId: string | null;
};

const APP_VIEWS: readonly AppView[] = [
  "traces",
  "queues",
  "scores",
  "datasets",
  "data",
];
const EVALUATION_TABS: readonly EvaluationUrlState["tab"][] = [
  "compare",
  "experiments",
  "examples",
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
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "") ?? [];
}

export function readAppUrlState(search = window.location.search): AppUrlState {
  const params = new URLSearchParams(search);
  return {
    view: oneOf(params.get("view"), APP_VIEWS, "traces"),
    evaluation: {
      datasetId: params.get("dataset"),
      tab: oneOf(params.get("tab"), EVALUATION_TABS, "compare"),
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
  const hasEvaluationContext =
    state.view === "datasets" ||
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

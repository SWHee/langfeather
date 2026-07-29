import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { getExperiment } from "../api/client";
import type {
  Experiment,
  ExperimentCase,
  ExperimentEvaluator,
  ExperimentResult,
  ExperimentSummary,
} from "../api/types";
import { compareExperiments, type EvaluatorStat } from "./comparison";
import { formatDateTime, preview } from "./formatters";
import {
  CASE_STATUS_LABEL,
  EXPERIMENT_STATUS_LABEL,
} from "./labels";

type ComparisonLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; experiments: Experiment[] };

const EMPTY_EXPERIMENTS: readonly Experiment[] = [];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 4,
  }).format(value);
}

function formatValue(stat: EvaluatorStat): string {
  if (stat.value === null) {
    return "평가값 없음";
  }
  if (stat.dataType === "boolean") {
    const passedCount = Math.round(stat.value * stat.scoredCount);
    return `${(stat.value * 100).toFixed(1)}% (${passedCount}/${stat.scoredCount} 통과)`;
  }
  return `평균 ${formatNumber(stat.value)}`;
}

function formatDelta(stat: EvaluatorStat): string {
  if (stat.delta === null) {
    return "기준 차이 계산 불가";
  }
  const sign = stat.delta > 0 ? "+" : "";
  return stat.dataType === "boolean"
    ? `기준 대비 ${sign}${(stat.delta * 100).toFixed(1)}%p`
    : `기준 대비 ${sign}${formatNumber(stat.delta)}`;
}

function evaluatorUnion(experiments: readonly Experiment[]) {
  const evaluators = new Map<string, ExperimentEvaluator>();
  const conflictingKeys = new Set<string>();
  for (const experiment of experiments) {
    for (const evaluator of experiment.evaluators) {
      const known = evaluators.get(evaluator.key);
      if (known === undefined) {
        evaluators.set(evaluator.key, evaluator);
      } else if (known.data_type !== evaluator.data_type) {
        conflictingKeys.add(evaluator.key);
      }
    }
  }
  return { evaluators: [...evaluators.values()], conflictingKeys };
}

function commonEvaluatorKeys(experiments: readonly Experiment[]): string[] {
  const firstExperiment = experiments[0];
  if (experiments.length < 2 || firstExperiment === undefined) {
    return [];
  }
  return firstExperiment.evaluators
    .filter((evaluator) =>
      experiments.slice(1).every((experiment) =>
        experiment.evaluators.some(
          (candidate) =>
            candidate.key === evaluator.key &&
            candidate.data_type === evaluator.data_type,
        ),
      ),
    )
    .slice(0, 4)
    .map(({ key }) => key);
}

function metricBarWidth(
  stat: EvaluatorStat | undefined,
  maximumMagnitude: number,
): number {
  if (stat?.value === null || stat === undefined) {
    return 0;
  }
  if (stat.dataType === "boolean") {
    return Math.max(0, Math.min(100, stat.value * 100));
  }
  if (maximumMagnitude === 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(100, (Math.abs(stat.value) / maximumMagnitude) * 100),
  );
}

function MetricCard({
  evaluator,
  comparisons,
}: {
  evaluator: ExperimentEvaluator;
  comparisons: ReturnType<typeof compareExperiments>;
}) {
  const maximumMagnitude =
    evaluator.data_type === "boolean"
      ? 1
      : Math.max(
          0,
          ...comparisons.map((comparison) =>
            Math.abs(comparison.stats.get(evaluator.key)?.value ?? 0),
          ),
        );
  const accessibleSummary = comparisons
    .map((comparison) => {
      const stat = comparison.stats.get(evaluator.key);
      return stat === undefined
        ? `${comparison.name}: 해당 지표 없음`
        : `${comparison.name}: ${formatValue(stat)}, 전체 ${stat.caseCount}, 정상 ${stat.scoredCount}, 오류 ${stat.errorCount}, 평가값 없음 ${stat.missingCount}, 대상 실패 ${stat.targetFailedCount}`;
    })
    .join(". ");

  return (
    <article className="compare-metric-card">
      <header>
        <div>
          <h3>{evaluator.name}</h3>
          <code>{evaluator.key}</code>
        </div>
        <span>{evaluator.data_type === "boolean" ? "통과율" : "평균"}</span>
      </header>
      <div
        className="compare-metric-chart"
        role="img"
        aria-label={`${evaluator.name} 비교 차트. ${accessibleSummary}`}
      >
        {comparisons.map((comparison) => {
          const stat = comparison.stats.get(evaluator.key);
          return (
            <div className="compare-chart-row" key={comparison.experimentId}>
              <div className="compare-chart-heading">
                <strong>{comparison.name}</strong>
                <span>
                  {stat === undefined ? "해당 지표 없음" : formatValue(stat)}
                </span>
              </div>
              <svg
                aria-hidden="true"
                className="compare-bar"
                preserveAspectRatio="none"
                viewBox="0 0 100 8"
              >
                <rect
                  className="compare-bar-track"
                  height="8"
                  rx="2"
                  width="100"
                />
                <rect
                  className="compare-bar-value"
                  height="8"
                  rx="2"
                  width={metricBarWidth(stat, maximumMagnitude)}
                />
              </svg>
              {stat === undefined ? (
                <p className="compare-chart-counts">집계할 지표가 없습니다.</p>
              ) : (
                <p className="compare-chart-counts">
                  <span>전체 {stat.caseCount}</span>
                  <span>정상 {stat.scoredCount}</span>
                  <span data-tone={stat.errorCount > 0 ? "error" : "neutral"}>
                    오류 {stat.errorCount}
                  </span>
                  <span
                    data-tone={stat.missingCount > 0 ? "warning" : "neutral"}
                  >
                    평가값 없음 {stat.missingCount}
                  </span>
                  <span
                    data-tone={stat.targetFailedCount > 0 ? "error" : "neutral"}
                  >
                    대상 실패 {stat.targetFailedCount}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function resultFor(
  experimentCase: ExperimentCase,
  evaluatorKey: string,
): ExperimentResult | undefined {
  return experimentCase.evaluator_results.find(
    ({ evaluator_key: key }) => key === evaluatorKey,
  );
}

function formatCaseValue(
  result: ExperimentResult | undefined,
  evaluator: ExperimentEvaluator,
): string {
  if (result?.error_message !== null && result?.error_message !== undefined) {
    return `Evaluator 오류: ${result.error_message}`;
  }
  if (result === undefined || result.value === null) {
    return "평가값 없음";
  }
  if (evaluator.data_type === "boolean") {
    return result.value === true ? "통과 (true)" : "실패 (false)";
  }
  return formatNumber(typeof result.value === "number" ? result.value : 0);
}

function formatCaseDelta(
  result: ExperimentResult | undefined,
  baselineResult: ExperimentResult | undefined,
  evaluator: ExperimentEvaluator,
  isBaseline: boolean,
): string {
  if (isBaseline) {
    return "기준";
  }
  const delta = caseDelta(result, baselineResult, evaluator);
  if (delta === null) {
    return "기준 차이 계산 불가";
  }
  return evaluator.data_type === "boolean"
    ? `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%p`
    : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
}

function caseDelta(
  result: ExperimentResult | undefined,
  baselineResult: ExperimentResult | undefined,
  evaluator: ExperimentEvaluator,
): number | null {
  if (
    result === undefined ||
    baselineResult === undefined ||
    result.error_message !== null ||
    baselineResult.error_message !== null ||
    result.value === null ||
    baselineResult.value === null
  ) {
    return null;
  }
  if (evaluator.data_type === "boolean") {
    const value = result.value === true ? 1 : 0;
    const baselineValue = baselineResult.value === true ? 1 : 0;
    return value - baselineValue;
  }
  if (
    typeof result.value !== "number" ||
    typeof baselineResult.value !== "number"
  ) {
    return null;
  }
  return result.value - baselineResult.value;
}

interface CaseChoice {
  datasetExampleId: string;
  input: ExperimentCase["input"];
  position: number;
}

type CaseFilter = "all" | "worse" | "better" | "failed";

function caseChoices(experiments: readonly Experiment[]): CaseChoice[] {
  const choices = new Map<string, CaseChoice>();
  for (const experiment of experiments) {
    for (const experimentCase of experiment.cases) {
      if (!choices.has(experimentCase.dataset_example_id)) {
        choices.set(experimentCase.dataset_example_id, {
          datasetExampleId: experimentCase.dataset_example_id,
          input: experimentCase.input,
          position: experimentCase.position,
        });
      }
    }
  }
  return [...choices.values()].sort(
    (left, right) => left.position - right.position,
  );
}

function matchesCaseFilter(
  choice: CaseChoice,
  experiments: readonly Experiment[],
  evaluators: readonly ExperimentEvaluator[],
  filter: CaseFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  const cases = experiments.flatMap((experiment) => {
    const experimentCase = experiment.cases.find(
      ({ dataset_example_id: id }) => id === choice.datasetExampleId,
    );
    return experimentCase === undefined ? [] : [experimentCase];
  });
  if (filter === "failed") {
    return cases.some(({ status }) => status === "failed");
  }
  const baselineCase = experiments[0]?.cases.find(
    ({ dataset_example_id: id }) => id === choice.datasetExampleId,
  );
  if (baselineCase === undefined) {
    return false;
  }
  const deltas = experiments.slice(1).flatMap((experiment) => {
    const experimentCase = experiment.cases.find(
      ({ dataset_example_id: id }) => id === choice.datasetExampleId,
    );
    if (experimentCase === undefined) {
      return [];
    }
    return evaluators.flatMap((evaluator) => {
      const delta = caseDelta(
        resultFor(experimentCase, evaluator.key),
        resultFor(baselineCase, evaluator.key),
        evaluator,
      );
      return delta === null ? [] : [delta];
    });
  });
  return filter === "worse"
    ? deltas.some((delta) => delta < 0)
    : deltas.some((delta) => delta > 0);
}

function jsonEvidence(value: ExperimentCase["output"]): string {
  return value === null ? "출력값 없음" : JSON.stringify(value, null, 2);
}

function CaseComparison({
  experiments,
  evaluators,
  selectedExampleId,
  onSelectExample,
  onClose,
  onOpenTrace,
}: {
  experiments: readonly Experiment[];
  evaluators: readonly ExperimentEvaluator[];
  selectedExampleId: string;
  onSelectExample: (exampleId: string) => void;
  onClose: () => void;
  onOpenTrace?: (traceId: string) => void;
}) {
  const [caseFilter, setCaseFilter] = useState<CaseFilter>("all");
  const [caseSearch, setCaseSearch] = useState("");
  const choices = useMemo(() => caseChoices(experiments), [experiments]);
  const normalizedSearch = caseSearch.trim().toLocaleLowerCase();
  const filteredChoices = useMemo(
    () =>
      choices.filter(
        (choice) =>
          matchesCaseFilter(choice, experiments, evaluators, caseFilter) &&
          (normalizedSearch.length === 0 ||
            preview(choice.input)
              .toLocaleLowerCase()
              .includes(normalizedSearch)),
      ),
    [caseFilter, choices, evaluators, experiments, normalizedSearch],
  );
  const selectionIsVisible = filteredChoices.some(
    ({ datasetExampleId }) => datasetExampleId === selectedExampleId,
  );
  const firstFilteredExampleId = filteredChoices[0]?.datasetExampleId;

  useEffect(() => {
    if (!selectionIsVisible && firstFilteredExampleId !== undefined) {
      onSelectExample(firstFilteredExampleId);
    }
  }, [firstFilteredExampleId, onSelectExample, selectionIsVisible]);

  const baselineCase = experiments[0]?.cases.find(
    ({ dataset_example_id: id }) => id === selectedExampleId,
  );

  return (
    <section
      className="compare-case-section"
      aria-label="Case 상세 비교"
      role="region"
    >
      <header className="compare-section-heading">
        <div>
          <h2>Case comparison</h2>
          <p>같은 example의 실행 결과와 평가 근거를 나란히 확인합니다.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          상세 닫기
        </button>
      </header>

      <div className="compare-case-layout">
        <nav className="compare-case-list" aria-label="비교할 case">
          <div className="compare-case-filters">
            <input
              aria-label="Case input 검색"
              placeholder="Input 검색"
              type="search"
              value={caseSearch}
              onChange={(event) => setCaseSearch(event.target.value)}
            />
            <select
              aria-label="Case 결과 필터"
              value={caseFilter}
              onChange={(event) =>
                setCaseFilter(event.target.value as CaseFilter)
              }
            >
              <option value="all">전체</option>
              <option value="worse">기준 대비 나빠진 case</option>
              <option value="better">기준 대비 좋아진 case</option>
              <option value="failed">Target 실행 실패 case</option>
            </select>
          </div>
          {filteredChoices.length === 0 ? (
            <p className="compare-case-filter-empty">
              조건에 맞는 case가 없습니다.
            </p>
          ) : (
            filteredChoices.map((choice) => (
              <button
                aria-pressed={choice.datasetExampleId === selectedExampleId}
                key={choice.datasetExampleId}
                type="button"
                onClick={() => onSelectExample(choice.datasetExampleId)}
              >
                <small>Case {choice.position + 1}</small>
                <span>{preview(choice.input)}</span>
              </button>
            ))
          )}
        </nav>

        <div className="compare-case-results">
          {experiments.map((experiment, experimentIndex) => {
            const experimentCase = experiment.cases.find(
              ({ dataset_example_id: id }) => id === selectedExampleId,
            );
            const traceId = experimentCase?.trace_id ?? null;
            return (
              <article
                className="compare-case-result"
                key={experiment.experiment_id}
              >
                <header>
                  <h3>{experiment.name}</h3>
                  <span
                    data-tone={
                      experimentCase?.status === "failed" ? "error" : "neutral"
                    }
                  >
                    {experimentCase === undefined
                      ? "Case 없음"
                      : CASE_STATUS_LABEL[experimentCase.status]}
                  </span>
                </header>
                {experimentCase === undefined ? (
                  <p className="compare-inline-state">
                    이 experiment에는 같은 example의 case가 없습니다.
                  </p>
                ) : (
                  <>
                    <dl className="compare-case-metrics">
                      {evaluators.map((evaluator) => {
                        const result = resultFor(experimentCase, evaluator.key);
                        const baselineResult =
                          baselineCase === undefined
                            ? undefined
                            : resultFor(baselineCase, evaluator.key);
                        return (
                          <div key={evaluator.key}>
                            <dt>{evaluator.name}</dt>
                            <dd>
                              <span>{formatCaseValue(result, evaluator)}</span>
                              <small>
                                기준 대비{" "}
                                {formatCaseDelta(
                                  result,
                                  baselineResult,
                                  evaluator,
                                  experimentIndex === 0,
                                )}
                              </small>
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                    <div className="compare-output">
                      <strong>출력값</strong>
                      <pre>{jsonEvidence(experimentCase.output)}</pre>
                    </div>
                    {traceId !== null && onOpenTrace !== undefined && (
                      <button
                        className="compare-trace-link"
                        type="button"
                        onClick={() => onOpenTrace(traceId)}
                      >
                        Trace 상세 열기
                      </button>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function CompareView({
  experiments,
  onOpenTrace,
}: {
  experiments: readonly ExperimentSummary[];
  onOpenTrace?: (traceId: string) => void;
}) {
  const [selectedExperimentIds, setSelectedExperimentIds] = useState<string[]>(
    [],
  );
  const [selectedEvaluatorKeys, setSelectedEvaluatorKeys] = useState<string[]>(
    [],
  );
  const [loadState, setLoadState] = useState<ComparisonLoadState>({
    status: "idle",
  });
  const [requestRevision, setRequestRevision] = useState(0);
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(
    null,
  );
  const [caseAnchorExperimentId, setCaseAnchorExperimentId] = useState<
    string | null
  >(null);
  const hasManualEvaluatorSelection = useRef(false);

  useEffect(() => {
    if (selectedExperimentIds.length < 2) {
      return;
    }

    const controller = new AbortController();
    void Promise.all(
      selectedExperimentIds.map((experimentId) =>
        getExperiment(experimentId, controller.signal),
      ),
    )
      .then((loadedExperiments) => {
        if (!controller.signal.aborted) {
          setLoadState({
            status: "success",
            experiments: loadedExperiments,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [requestRevision, selectedExperimentIds]);

  const loadedExperiments =
    loadState.status === "success" ? loadState.experiments : EMPTY_EXPERIMENTS;
  const { evaluators, conflictingKeys } = useMemo(
    () => evaluatorUnion(loadedExperiments),
    [loadedExperiments],
  );

  useEffect(() => {
    if (
      loadState.status !== "success" ||
      hasManualEvaluatorSelection.current
    ) {
      return;
    }
    setSelectedEvaluatorKeys(commonEvaluatorKeys(loadState.experiments));
  }, [loadState]);

  const selectedEvaluators = selectedEvaluatorKeys.flatMap((key) => {
    const evaluator = evaluators.find((candidate) => candidate.key === key);
    return evaluator === undefined ? [] : [evaluator];
  });
  const comparisons = compareExperiments(loadedExperiments);
  const selectedRevision =
    experiments.find(({ experiment_id: id }) => id === selectedExperimentIds[0])
      ?.dataset_revision ?? null;

  const toggleExperiment = (experiment: ExperimentSummary) => {
    const nextExperimentIds = selectedExperimentIds.includes(
      experiment.experiment_id,
    )
      ? selectedExperimentIds.filter((id) => id !== experiment.experiment_id)
      : [...selectedExperimentIds, experiment.experiment_id];
    setSelectedExperimentIds(nextExperimentIds);
    if (!hasManualEvaluatorSelection.current) {
      setSelectedEvaluatorKeys([]);
    }
    setSelectedExampleId(null);
    setCaseAnchorExperimentId(null);
    setLoadState({
      status: nextExperimentIds.length < 2 ? "idle" : "loading",
    });
  };

  const toggleEvaluator = (evaluatorKey: string) => {
    hasManualEvaluatorSelection.current = true;
    setSelectedEvaluatorKeys((current) =>
      current.includes(evaluatorKey)
        ? current.filter((key) => key !== evaluatorKey)
        : [...current, evaluatorKey],
    );
    setSelectedExampleId(null);
    setCaseAnchorExperimentId(null);
  };

  const setBaseline = (experimentId: string) => {
    setSelectedExperimentIds((current) => [
      experimentId,
      ...current.filter((id) => id !== experimentId),
    ]);
    setSelectedExampleId(null);
    setCaseAnchorExperimentId(null);
    setLoadState({ status: "loading" });
  };

  const openCasesFor = (experimentId: string) => {
    const experiment = loadedExperiments.find(
      ({ experiment_id: id }) => id === experimentId,
    );
    const firstCase = experiment?.cases[0] ?? loadedExperiments[0]?.cases[0];
    setCaseAnchorExperimentId(experimentId);
    setSelectedExampleId(firstCase?.dataset_example_id ?? null);
  };

  const openCasesWithKeyboard = (
    event: KeyboardEvent<HTMLTableRowElement>,
    experimentId: string,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openCasesFor(experimentId);
  };

  if (experiments.length === 0) {
    return (
      <section className="compare-empty-state">
        <strong>아직 experiment가 없습니다.</strong>
        <p>Python SDK에서 평가를 실행하면 비교할 결과가 나타납니다.</p>
      </section>
    );
  }

  if (experiments.length === 1) {
    return (
      <section className="compare-empty-state">
        <strong>Experiment가 1개뿐이라 비교할 수 없습니다.</strong>
        <p>같은 Dataset revision에서 experiment를 하나 더 실행해 주세요.</p>
      </section>
    );
  }

  const hasMissingMetric = selectedEvaluators.some((evaluator) =>
    loadedExperiments.some(
      (experiment) =>
        !experiment.evaluators.some(({ key }) => key === evaluator.key),
    ),
  );
  const hasEvaluatorError = selectedEvaluatorKeys.some((key) =>
    comparisons.some(
      (comparison) => (comparison.stats.get(key)?.errorCount ?? 0) > 0,
    ),
  );
  const hasRunningExperiment = loadedExperiments.some(
    ({ status }) => status === "running",
  );
  const hasFailedOrCancelledExperiment = loadedExperiments.some(
    ({ status, failed_case_count: failedCaseCount }) =>
      status === "cancelled" || failedCaseCount > 0,
  );

  return (
    <div className="compare-view">
      <section className="compare-controls" aria-label="비교 조건">
        <fieldset>
          <legend>
            Experiment <span>{selectedExperimentIds.length}/4 선택</span>
          </legend>
          <p>
            같은 Dataset revision에서 2~4개를 선택하세요. 최대 4개는 화면
            밀도와 가로 스크롤을 방지하기 위한 제한입니다.
          </p>
          <div className="compare-choice-list">
            {experiments.map((experiment) => {
              const selected = selectedExperimentIds.includes(
                experiment.experiment_id,
              );
              const isBaseline =
                selectedExperimentIds[0] === experiment.experiment_id;
              const revisionMismatch =
                selectedRevision !== null &&
                experiment.dataset_revision !== selectedRevision;
              const maximumReached =
                selectedExperimentIds.length >= 4 && !selected;
              return (
                <div
                  className="compare-experiment-choice"
                  data-selected={selected}
                  key={experiment.experiment_id}
                >
                  <label
                    data-disabled={revisionMismatch || maximumReached}
                    data-selected={selected}
                  >
                    <input
                      checked={selected}
                      disabled={revisionMismatch || maximumReached}
                      type="checkbox"
                      onChange={() => toggleExperiment(experiment)}
                    />
                    <span>
                      <strong>{experiment.name}</strong>
                      <small>
                        revision {experiment.dataset_revision} ·{" "}
                        {EXPERIMENT_STATUS_LABEL[experiment.status]}
                      </small>
                    </span>
                    {revisionMismatch ? (
                      <em>revision {experiment.dataset_revision} 전용</em>
                    ) : maximumReached ? (
                      <em>최대 4개</em>
                    ) : null}
                  </label>
                  {selected &&
                    (isBaseline ? (
                      <span className="compare-baseline-status">현재 기준</span>
                    ) : (
                      <button
                        className="compare-baseline-button"
                        type="button"
                        onClick={() => setBaseline(experiment.experiment_id)}
                      >
                        <span className="sr-only">{experiment.name}을 </span>
                        기준으로 설정
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            평가 지표 <span>{selectedEvaluatorKeys.length}/4 선택</span>
          </legend>
          <p>
            선택한 experiment에 공통인 지표를 최대 4개까지 자동 선택합니다.
            최대 4개는 화면 밀도와 가로 스크롤을 방지하기 위한 제한입니다.
          </p>
          {loadState.status === "success" && evaluators.length > 0 ? (
            <div className="compare-choice-list compare-evaluator-list">
              {evaluators.map((evaluator) => {
                const selected = selectedEvaluatorKeys.includes(evaluator.key);
                const conflicting = conflictingKeys.has(evaluator.key);
                const maximumReached =
                  selectedEvaluatorKeys.length >= 4 && !selected;
                const disabled = conflicting || maximumReached;
                return (
                  <label
                    data-disabled={disabled}
                    data-selected={selected}
                    key={evaluator.key}
                  >
                    <input
                      checked={selected}
                      disabled={disabled}
                      type="checkbox"
                      onChange={() => toggleEvaluator(evaluator.key)}
                    />
                    <span>
                      <strong>{evaluator.name}</strong>
                      <small>
                        {evaluator.key} · {evaluator.data_type}
                      </small>
                    </span>
                    {conflicting ? (
                      <em>experiment마다 결과 유형이 달라 비교할 수 없음</em>
                    ) : (
                      maximumReached && <em>최대 4개</em>
                    )}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="compare-control-state">
              {selectedExperimentIds.length < 2
                ? "Experiment를 먼저 2개 이상 선택하세요."
                : loadState.status === "loading"
                  ? "평가 지표를 불러오는 중…"
                  : loadState.status === "error"
                    ? "평가 지표를 불러오지 못했습니다."
                    : "선택한 experiment에 평가 지표가 없습니다."}
            </p>
          )}
        </fieldset>
      </section>

      {selectedExperimentIds.length === 0 ? (
        <section className="compare-empty-state">
          <strong>비교할 Experiment를 선택하세요.</strong>
          <p>첫 번째 선택이 기준 experiment가 됩니다.</p>
        </section>
      ) : selectedExperimentIds.length === 1 ? (
        <section className="compare-empty-state">
          <strong>Experiment를 하나 더 선택하세요.</strong>
          <p>비교하려면 같은 revision의 experiment가 최소 2개 필요합니다.</p>
        </section>
      ) : loadState.status === "loading" ? (
        <div className="compare-loading-state" aria-live="polite">
          Experiment 비교 데이터를 불러오는 중…
        </div>
      ) : loadState.status === "error" ? (
        <section className="compare-empty-state" role="alert">
          <strong>Experiment 비교 데이터를 불러오지 못했습니다.</strong>
          <p>서버 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setLoadState({ status: "loading" });
              setRequestRevision((revision) => revision + 1);
            }}
          >
            다시 시도
          </button>
        </section>
      ) : loadState.status === "success" &&
        selectedEvaluatorKeys.length === 0 ? (
        <section className="compare-empty-state">
          <strong>비교할 평가 지표를 선택하세요.</strong>
        </section>
      ) : loadState.status === "success" ? (
        <>
          <div className="compare-status-list" aria-live="polite">
            {hasMissingMetric && (
              <p data-tone="warning">
                일부 experiment에 선택한 지표가 없습니다. 해당 지표 없음으로
                표시합니다.
              </p>
            )}
            {hasEvaluatorError && (
              <p data-tone="error">
                Evaluator 오류가 있는 결과가 있습니다. 오류 수를 함께
                확인하세요.
              </p>
            )}
            {hasRunningExperiment && (
              <p data-tone="warning">
                실행 중인 experiment가 포함되어 결과가 바뀔 수 있습니다.
              </p>
            )}
            {hasFailedOrCancelledExperiment && (
              <p data-tone="error">
                취소되었거나 대상 실행이 실패한 experiment가 포함되어 있습니다.
              </p>
            )}
          </div>

          <section aria-labelledby="compare-metrics-title">
            <header className="compare-section-heading">
              <div>
                <h2 id="compare-metrics-title">Metric comparison</h2>
                <p>첫 번째 experiment를 기준으로 선택한 지표만 표시합니다.</p>
              </div>
            </header>
            <div className="compare-metric-grid">
              {selectedEvaluators.map((evaluator) => (
                <MetricCard
                  comparisons={comparisons}
                  evaluator={evaluator}
                  key={evaluator.key}
                />
              ))}
            </div>
          </section>

          <section
            className="compare-summary"
            aria-labelledby="compare-summary-title"
          >
            <header className="compare-section-heading">
              <div>
                <h2 id="compare-summary-title">Experiment summary</h2>
                <p>행을 선택하면 같은 example의 case 상세를 엽니다.</p>
              </div>
            </header>
            <div className="compare-summary-table-wrap">
              <table className="compare-summary-table">
                <thead>
                  <tr>
                    <th scope="col">이름</th>
                    <th scope="col">상태</th>
                    <th scope="col">완료 / 전체</th>
                    <th scope="col">오류 수</th>
                    {selectedEvaluators.map((evaluator) => (
                      <th scope="col" key={evaluator.key}>
                        {evaluator.name}
                      </th>
                    ))}
                    <th scope="col">실행 날짜</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((comparison) => {
                    const errorCount = selectedEvaluatorKeys.reduce(
                      (total, key) =>
                        total + (comparison.stats.get(key)?.errorCount ?? 0),
                      0,
                    );
                    return (
                      <tr
                        aria-label={`${comparison.name} case 비교 열기`}
                        data-selected={
                          caseAnchorExperimentId === comparison.experimentId
                            ? "true"
                            : "false"
                        }
                        key={comparison.experimentId}
                        tabIndex={0}
                        onClick={() => openCasesFor(comparison.experimentId)}
                        onKeyDown={(event) =>
                          openCasesWithKeyboard(event, comparison.experimentId)
                        }
                      >
                        <td data-label="이름">
                          <strong>{comparison.name}</strong>
                          {comparison === comparisons[0] && <small>기준</small>}
                        </td>
                        <td data-label="상태">
                          <span
                            className={`experiment-status status-${comparison.status}`}
                          >
                            {EXPERIMENT_STATUS_LABEL[comparison.status]}
                          </span>
                        </td>
                        <td data-label="완료 / 전체">
                          {comparison.completedCaseCount} /{" "}
                          {comparison.caseCount}
                          {comparison.failedCaseCount > 0 && (
                            <small>
                              대상 실패 {comparison.failedCaseCount}
                            </small>
                          )}
                        </td>
                        <td data-label="오류 수">
                          <span
                            data-tone={errorCount > 0 ? "error" : "neutral"}
                          >
                            Evaluator 오류 {errorCount}
                          </span>
                        </td>
                        {selectedEvaluators.map((evaluator) => {
                          const stat = comparison.stats.get(evaluator.key);
                          return (
                            <td data-label={evaluator.name} key={evaluator.key}>
                              {stat === undefined ? (
                                <span data-tone="warning">해당 지표 없음</span>
                              ) : (
                                <>
                                  <strong>{formatValue(stat)}</strong>
                                  {comparison !== comparisons[0] && (
                                    <small>{formatDelta(stat)}</small>
                                  )}
                                </>
                              )}
                            </td>
                          );
                        })}
                        <td data-label="실행 날짜">
                          <time dateTime={comparison.startedAt}>
                            {formatDateTime(comparison.startedAt)}
                          </time>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {selectedExampleId !== null && (
            <CaseComparison
              evaluators={selectedEvaluators}
              experiments={loadedExperiments}
              selectedExampleId={selectedExampleId}
              onClose={() => {
                setSelectedExampleId(null);
                setCaseAnchorExperimentId(null);
              }}
              onOpenTrace={onOpenTrace}
              onSelectExample={setSelectedExampleId}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

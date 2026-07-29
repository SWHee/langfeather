import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { getExperiment } from "../api/client";
import type {
  Experiment,
  ExperimentCase,
  ExperimentEvaluator,
  ExperimentResult,
  ExperimentStatus,
  ExperimentSummary,
} from "../api/types";
import { compareExperiments, type EvaluatorStat } from "./comparison";
import { formatDateTime, preview } from "./formatters";

type ComparisonLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; experiments: Experiment[] };

const EXPERIMENT_STATUS_LABEL: Record<ExperimentStatus, string> = {
  running: "실행 중",
  completed: "완료",
  cancelled: "취소",
};

const CASE_STATUS_LABEL: Record<ExperimentCase["status"], string> = {
  pending: "대기",
  completed: "완료",
  failed: "실패",
};

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
    return "기준";
  }
  const sign = stat.delta > 0 ? "+" : "";
  return stat.dataType === "boolean"
    ? `${sign}${(stat.delta * 100).toFixed(1)}%p`
    : `${sign}${formatNumber(stat.delta)}`;
}

function evaluatorUnion(experiments: readonly Experiment[]) {
  const evaluators = new Map<string, ExperimentEvaluator>();
  for (const experiment of experiments) {
    for (const evaluator of experiment.evaluators) {
      if (!evaluators.has(evaluator.key)) {
        evaluators.set(evaluator.key, evaluator);
      }
    }
  }
  return [...evaluators.values()];
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
  if (
    result === undefined ||
    baselineResult === undefined ||
    result.error_message !== null ||
    baselineResult.error_message !== null ||
    result.value === null ||
    baselineResult.value === null
  ) {
    return "기준 차이 계산 불가";
  }
  if (evaluator.data_type === "boolean") {
    const value = result.value === true ? 1 : 0;
    const baselineValue = baselineResult.value === true ? 1 : 0;
    const delta = (value - baselineValue) * 100;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%p`;
  }
  if (
    typeof result.value !== "number" ||
    typeof baselineResult.value !== "number"
  ) {
    return "기준 차이 계산 불가";
  }
  const delta = result.value - baselineResult.value;
  return `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
}

interface CaseChoice {
  datasetExampleId: string;
  input: ExperimentCase["input"];
  position: number;
}

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

function jsonEvidence(value: ExperimentCase["output"]): string {
  return value === null ? "출력값 없음" : JSON.stringify(value, null, 2);
}

function CaseComparison({
  experiments,
  evaluators,
  selectedExampleId,
  onSelectExample,
  onClose,
}: {
  experiments: readonly Experiment[];
  evaluators: readonly ExperimentEvaluator[];
  selectedExampleId: string;
  onSelectExample: (exampleId: string) => void;
  onClose: () => void;
}) {
  const choices = caseChoices(experiments);
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
          {choices.map((choice) => (
            <button
              aria-pressed={choice.datasetExampleId === selectedExampleId}
              key={choice.datasetExampleId}
              type="button"
              onClick={() => onSelectExample(choice.datasetExampleId)}
            >
              <small>Case {choice.position + 1}</small>
              <span>{preview(choice.input)}</span>
            </button>
          ))}
        </nav>

        <div className="compare-case-results">
          {experiments.map((experiment, experimentIndex) => {
            const experimentCase = experiment.cases.find(
              ({ dataset_example_id: id }) => id === selectedExampleId,
            );
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
                    {experimentCase.trace_id !== null && (
                      <a
                        className="compare-trace-link"
                        href={`/traces/${encodeURIComponent(experimentCase.trace_id)}`}
                      >
                        Trace 상세 열기
                      </a>
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
}: {
  experiments: readonly ExperimentSummary[];
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
  const evaluators = useMemo(
    () => evaluatorUnion(loadedExperiments),
    [loadedExperiments],
  );

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
    setSelectedEvaluatorKeys([]);
    setSelectedExampleId(null);
    setCaseAnchorExperimentId(null);
    setLoadState({
      status: nextExperimentIds.length < 2 ? "idle" : "loading",
    });
  };

  const toggleEvaluator = (evaluatorKey: string) => {
    setSelectedEvaluatorKeys((current) =>
      current.includes(evaluatorKey)
        ? current.filter((key) => key !== evaluatorKey)
        : [...current, evaluatorKey],
    );
    setSelectedExampleId(null);
    setCaseAnchorExperimentId(null);
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
          <p>같은 Dataset revision에서 2~4개를 선택하세요.</p>
          <div className="compare-choice-list">
            {experiments.map((experiment) => {
              const selected = selectedExperimentIds.includes(
                experiment.experiment_id,
              );
              const revisionMismatch =
                selectedRevision !== null &&
                experiment.dataset_revision !== selectedRevision;
              const maximumReached =
                selectedExperimentIds.length >= 4 && !selected;
              return (
                <label
                  data-disabled={revisionMismatch || maximumReached}
                  data-selected={selected}
                  key={experiment.experiment_id}
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
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            평가 지표 <span>{selectedEvaluatorKeys.length}/4 선택</span>
          </legend>
          <p>선택한 experiment에 저장된 지표 중 최대 4개를 고르세요.</p>
          {loadState.status === "success" && evaluators.length > 0 ? (
            <div className="compare-choice-list compare-evaluator-list">
              {evaluators.map((evaluator) => {
                const selected = selectedEvaluatorKeys.includes(evaluator.key);
                const maximumReached =
                  selectedEvaluatorKeys.length >= 4 && !selected;
                return (
                  <label
                    data-disabled={maximumReached}
                    data-selected={selected}
                    key={evaluator.key}
                  >
                    <input
                      checked={selected}
                      disabled={maximumReached}
                      type="checkbox"
                      onChange={() => toggleEvaluator(evaluator.key)}
                    />
                    <span>
                      <strong>{evaluator.name}</strong>
                      <small>
                        {evaluator.key} · {evaluator.data_type}
                      </small>
                    </span>
                    {maximumReached && <em>최대 4개</em>}
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
                                  <small>기준 대비 {formatDelta(stat)}</small>
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
              onSelectExample={setSelectedExampleId}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

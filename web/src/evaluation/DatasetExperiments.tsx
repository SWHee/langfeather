import { Fragment, useEffect, useState } from "react";

import { getExperiment } from "../api/client";
import type { Experiment, ExperimentSummary } from "../api/types";
import { compareExperiments } from "./comparison";
import { duration, formatDateTime, preview } from "./formatters";

function ExperimentResultSummary({ experiment }: { experiment: Experiment }) {
  const comparison = compareExperiments([experiment])[0];
  const completedDurations = experiment.cases.flatMap(({ duration_us }) =>
    duration_us === null ? [] : [duration_us],
  );
  const averageDuration =
    completedDurations.length === 0
      ? null
      : completedDurations.reduce((total, value) => total + value, 0) /
        completedDurations.length;

  return (
    <div
      className="experiment-run-note"
      aria-label={`${experiment.name} 결과 요약`}
    >
      <div>
        {experiment.evaluators.length === 0 ? (
          <span>등록된 evaluator가 없습니다.</span>
        ) : (
          experiment.evaluators.map((evaluator) => {
            const stat = comparison?.stats.get(evaluator.key);
            let value = "평가값 없음";
            if (stat?.value !== null && stat?.value !== undefined) {
              value =
                evaluator.data_type === "boolean"
                  ? `${(stat.value * 100).toFixed(1)}% 통과 (${Math.round(
                      stat.value * stat.scoredCount,
                    )}/${stat.scoredCount})`
                  : `평균 ${stat.value.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    })}`;
            }
            return (
              <span className="evaluation-result" key={evaluator.key}>
                {evaluator.name} {value}
              </span>
            );
          })
        )}
      </div>
      <span>평균 실행 시간 {duration(averageDuration)}</span>
    </div>
  );
}

export function DatasetExperiments({
  experiments,
  onRequestCompare,
}: {
  experiments: ExperimentSummary[];
  onRequestCompare?: () => void;
}) {
  const [selectedExperimentId, setSelectedExperimentId] = useState<
    string | null
  >(null);
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [expandedExperimentId, setExpandedExperimentId] = useState<
    string | null
  >(null);
  const [summaryExperiments, setSummaryExperiments] = useState<
    Record<string, Experiment>
  >({});
  const [summaryLoadErrorId, setSummaryLoadErrorId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (selectedExperimentId === null) {
      return;
    }
    const controller = new AbortController();
    void getExperiment(selectedExperimentId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setExperiment(response);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setExperiment(null);
          setLoadError(true);
        }
      });
    return () => controller.abort();
  }, [selectedExperimentId]);

  useEffect(() => {
    if (
      expandedExperimentId === null ||
      summaryExperiments[expandedExperimentId] !== undefined ||
      summaryLoadErrorId === expandedExperimentId
    ) {
      return;
    }
    const controller = new AbortController();
    void getExperiment(expandedExperimentId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setSummaryExperiments((current) => ({
            ...current,
            [response.experiment_id]: response,
          }));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSummaryLoadErrorId(expandedExperimentId);
        }
      });
    return () => controller.abort();
  }, [expandedExperimentId, summaryExperiments, summaryLoadErrorId]);

  const displayed =
    experiment?.experiment_id === selectedExperimentId ? experiment : null;

  if (experiments.length === 0) {
    return (
      <section className="management-surface" aria-label="Experiments">
        <div className="management-empty">
          <strong>아직 experiment가 없습니다.</strong>
          <p>
            Python SDK에서 <code>langfeather.evaluate()</code>를 실행하면 여기에
            나타납니다.
          </p>
        </div>
      </section>
    );
  }

  if (displayed === null) {
    return (
      <section className="management-surface" aria-label="Experiments">
        {loadError && (
          <div className="management-empty" role="alert">
            <strong>Experiment를 불러오지 못했습니다.</strong>
          </div>
        )}
        <div className="management-table-scroll">
          <table className="management-table experiment-table">
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">상태</th>
                <th scope="col">진행</th>
                <th scope="col">Dataset revision</th>
                <th scope="col">실행 시각</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((item) => {
                const isExpanded =
                  expandedExperimentId === item.experiment_id;
                const summary = summaryExperiments[item.experiment_id];
                return (
                  <Fragment key={item.experiment_id}>
                    <tr>
                      <td data-label="이름">
                        <button
                          className="table-name-button"
                          type="button"
                          onClick={() => {
                            setLoadError(false);
                            setSelectedExperimentId(item.experiment_id);
                          }}
                        >
                          {item.name}
                        </button>
                      </td>
                      <td data-label="상태">
                        <span
                          className={`experiment-status status-${item.status}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td data-label="진행">
                        {item.completed_case_count}/{item.case_count} ·{" "}
                        {item.failed_case_count} failed
                        <button
                          className="link-button"
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={`${item.name} 결과 요약 ${
                            isExpanded ? "접기" : "펼치기"
                          }`}
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedExperimentId(null);
                            } else {
                              setSummaryLoadErrorId(null);
                              setExpandedExperimentId(item.experiment_id);
                            }
                          }}
                        >
                          {isExpanded ? "요약 접기" : "결과 요약"}
                        </button>
                      </td>
                      <td data-label="Dataset revision">
                        rev {item.dataset_revision}
                      </td>
                      <td data-label="실행 시각">
                        {formatDateTime(item.started_at)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} data-label="결과 요약">
                          {summary !== undefined ? (
                            <ExperimentResultSummary experiment={summary} />
                          ) : summaryLoadErrorId === item.experiment_id ? (
                            <span role="alert">
                              결과 요약을 불러오지 못했습니다.
                            </span>
                          ) : null}
                          {summary === undefined &&
                            summaryLoadErrorId !== item.experiment_id && (
                              <span>결과 요약을 불러오는 중…</span>
                            )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="management-surface" aria-label="Experiment 상세">
      <div className="experiment-detail-heading">
        <div>
          <button
            className="link-button"
            type="button"
            onClick={() => {
              setSelectedExperimentId(null);
            }}
          >
            ← Experiment 목록
          </button>
          <h2>{displayed.name}</h2>
          <p>
            Dataset revision {displayed.dataset_revision} ·{" "}
            {displayed.completed_case_count} completed ·{" "}
            {displayed.failed_case_count} target failures
          </p>
        </div>
        <div className="experiment-compare-note">
          <span>Experiment 비교는 Compare 탭에서 확인하세요.</span>
          {onRequestCompare !== undefined && (
            <button
              className="secondary-button"
              type="button"
              onClick={onRequestCompare}
            >
              Compare 탭으로 이동
            </button>
          )}
        </div>
      </div>

      <div className="experiment-run-note">
        <code>
          langfeather.evaluate(dataset=&quot;{displayed.dataset_id}&quot;, …)
        </code>
        <span>실행은 user Python process에서만 수행됩니다.</span>
      </div>

      <div className="management-table-scroll">
        <table className="management-table experiment-case-table">
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Expected / actual</th>
              <th scope="col">Scores</th>
              <th scope="col">Trace</th>
            </tr>
          </thead>
          <tbody>
            {displayed.cases.map((item) => (
              <tr key={item.experiment_case_id} data-status={item.status}>
                <td data-label="Case">
                  <strong>{item.status}</strong>
                  <small>{duration(item.duration_us)}</small>
                </td>
                <td data-label="Expected / actual">
                  <code>{preview(item.expected_output)}</code>
                  <code>{preview(item.output)}</code>
                </td>
                <td data-label="Scores">
                  {item.evaluator_results.map((result) => (
                    <span
                      className={`evaluation-result${
                        result.error_message === null
                          ? ""
                          : " evaluation-result-error"
                      }`}
                      key={result.evaluator_key}
                    >
                      {result.evaluator_key}:{" "}
                      {result.error_message ?? String(result.value)}
                    </span>
                  ))}
                </td>
                <td data-label="Trace">{item.trace_id ?? "Unavailable"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

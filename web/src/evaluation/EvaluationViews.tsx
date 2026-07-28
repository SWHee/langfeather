import { useEffect, useMemo, useState } from "react";

import {
  addDatasetExample,
  createDataset,
  getDataset,
  getDatasets,
  getExperiment,
  getExperiments,
} from "../api/client";
import type {
  Dataset,
  DatasetSummary,
  Experiment,
  ExperimentSummary,
  JsonValue,
} from "../api/types";

type Tab = "datasets" | "experiments";

function preview(value: JsonValue | null): string {
  if (value === null) {
    return "—";
  }
  const raw = JSON.stringify(value);
  return raw.length > 100 ? `${raw.slice(0, 97)}…` : raw;
}

function duration(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value < 1_000) {
    return `${value} µs`;
  }
  return value < 1_000_000
    ? `${Math.round(value / 1_000)} ms`
    : `${(value / 1_000_000).toFixed(2)} s`;
}

function State({ children }: { children: string }) {
  return <p className="evaluation-state">{children}</p>;
}

export function EvaluationView() {
  const [tab, setTab] = useState<Tab>("datasets");
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    null,
  );
  const [selectedExperimentId, setSelectedExperimentId] = useState<
    string | null
  >(null);
  const [comparisonExperimentId, setComparisonExperimentId] = useState<
    string | null
  >(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [comparisonExperiment, setComparisonExperiment] =
    useState<Experiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showNewDataset, setShowNewDataset] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [inputDraft, setInputDraft] = useState("{}");
  const [expectedDraft, setExpectedDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshLists = () => {
    setLoading(true);
    setError(false);
    void Promise.all([getDatasets(), getExperiments()])
      .then(([datasetResponse, experimentResponse]) => {
        setDatasets(datasetResponse.items);
        setExperiments(experimentResponse.items);
        setSelectedDatasetId(
          (current) => current ?? datasetResponse.items[0]?.dataset_id ?? null,
        );
        setSelectedExperimentId(
          (current) =>
            current ?? experimentResponse.items[0]?.experiment_id ?? null,
        );
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void Promise.resolve().then(refreshLists);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (selectedDatasetId === null) {
      return;
    }
    void getDataset(selectedDatasetId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setDataset(response);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDataset(null);
        }
      });
    return () => controller.abort();
  }, [selectedDatasetId]);

  useEffect(() => {
    const controller = new AbortController();
    if (selectedExperimentId === null) {
      return;
    }
    void getExperiment(selectedExperimentId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setExperiment(response);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setExperiment(null);
        }
      });
    return () => controller.abort();
  }, [selectedExperimentId]);

  useEffect(() => {
    const controller = new AbortController();
    if (comparisonExperimentId === null) {
      return;
    }
    void getExperiment(comparisonExperimentId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setComparisonExperiment(response);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setComparisonExperiment(null);
        }
      });
    return () => controller.abort();
  }, [comparisonExperimentId]);

  const selectedDatasetSummary = useMemo(
    () =>
      datasets.find((item) => item.dataset_id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  );
  const displayedDataset =
    dataset?.dataset_id === selectedDatasetId ? dataset : null;
  const displayedExperiment =
    experiment?.experiment_id === selectedExperimentId ? experiment : null;
  const displayedComparison =
    comparisonExperiment?.experiment_id === comparisonExperimentId
      ? comparisonExperiment
      : null;

  const createNewDataset = () => {
    if (datasetName.trim() === "") {
      setFormError("Dataset 이름을 입력하세요.");
      return;
    }
    setSaving(true);
    setFormError(null);
    void createDataset({
      name: datasetName.trim(),
      description: datasetDescription.trim() || null,
    })
      .then((created) => {
        setDatasets((items) => [created, ...items]);
        setSelectedDatasetId(created.dataset_id);
        setDataset(created);
        setShowNewDataset(false);
        setDatasetName("");
        setDatasetDescription("");
      })
      .catch(() =>
        setFormError(
          "Dataset을 만들지 못했습니다. 이름을 확인하고 다시 시도하세요.",
        ),
      )
      .finally(() => setSaving(false));
  };

  const addExample = () => {
    if (dataset === null) {
      return;
    }
    let input: JsonValue;
    let expectedOutput: JsonValue | null = null;
    try {
      input = JSON.parse(inputDraft) as JsonValue;
      if (expectedDraft.trim() !== "") {
        expectedOutput = JSON.parse(expectedDraft) as JsonValue;
      }
    } catch {
      setFormError("Input과 expected output은 유효한 JSON이어야 합니다.");
      return;
    }
    setSaving(true);
    setFormError(null);
    void addDatasetExample(dataset.dataset_id, {
      input,
      expected_output: expectedOutput,
    })
      .then((updated) => {
        setDataset(updated);
        setDatasets((items) =>
          items.map((item) =>
            item.dataset_id === updated.dataset_id ? updated : item,
          ),
        );
        setInputDraft("{}");
        setExpectedDraft("");
      })
      .catch(() => setFormError("Example을 저장하지 못했습니다."))
      .finally(() => setSaving(false));
  };

  return (
    <main className="evaluation-page">
      <header className="evaluation-header">
        <div>
          <p className="evaluation-kicker">Local evaluation</p>
          <h1>Evaluation</h1>
        </div>
        <div className="evaluation-tabs" aria-label="Evaluation 화면">
          <button
            type="button"
            aria-pressed={tab === "datasets"}
            onClick={() => setTab("datasets")}
          >
            Datasets
          </button>
          <button
            type="button"
            aria-pressed={tab === "experiments"}
            onClick={() => setTab("experiments")}
          >
            Experiments
          </button>
        </div>
      </header>

      {loading && <State>Evaluation data를 불러오는 중입니다…</State>}
      {error && (
        <div className="evaluation-error">
          <span>Evaluation data를 불러오지 못했습니다.</span>
          <button type="button" onClick={refreshLists}>
            다시 시도
          </button>
        </div>
      )}
      {!loading && !error && tab === "datasets" && (
        <section className="evaluation-workspace" aria-label="Datasets">
          <aside className="evaluation-rail">
            <div className="evaluation-rail-heading">
              <span>Datasets</span>
              <button
                type="button"
                onClick={() => setShowNewDataset((value) => !value)}
              >
                New
              </button>
            </div>
            {showNewDataset && (
              <div className="dataset-create-form">
                <label>
                  Name
                  <input
                    value={datasetName}
                    onChange={(event) => setDatasetName(event.target.value)}
                    placeholder="rag-regression"
                  />
                </label>
                <label>
                  Description <span>optional</span>
                  <input
                    value={datasetDescription}
                    onChange={(event) =>
                      setDatasetDescription(event.target.value)
                    }
                    placeholder="실패 사례 모음"
                  />
                </label>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving}
                  onClick={createNewDataset}
                >
                  Create dataset
                </button>
              </div>
            )}
            <ul className="evaluation-record-list">
              {datasets.map((item) => (
                <li key={item.dataset_id}>
                  <button
                    type="button"
                    aria-current={
                      item.dataset_id === selectedDatasetId ? "true" : undefined
                    }
                    onClick={() => setSelectedDatasetId(item.dataset_id)}
                  >
                    <strong>{item.name}</strong>
                    <small>
                      rev {item.revision} · {item.example_count} examples
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="evaluation-detail" aria-live="polite">
            {displayedDataset === null && (
              <State>Dataset을 만들어 첫 사례를 추가하세요.</State>
            )}
            {displayedDataset !== null && (
              <>
                <div className="evaluation-detail-heading">
                  <div>
                    <p className="evaluation-kicker">
                      Dataset · revision {displayedDataset.revision}
                    </p>
                    <h2>{displayedDataset.name}</h2>
                    <p>{displayedDataset.description ?? "설명이 없습니다."}</p>
                  </div>
                  <span className="record-count">
                    {displayedDataset.example_count} examples
                  </span>
                </div>
                <div className="dataset-example-table-wrap">
                  <table className="dataset-example-table">
                    <thead>
                      <tr>
                        <th>Input</th>
                        <th>Expected output</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedDataset.examples.map((item) => (
                        <tr key={item.dataset_example_id}>
                          <td>
                            <code>{preview(item.input)}</code>
                          </td>
                          <td>
                            <code>{preview(item.expected_output)}</code>
                          </td>
                          <td>{item.source_trace_id ?? "Manual"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {displayedDataset.examples.length === 0 && (
                    <State>아직 example이 없습니다.</State>
                  )}
                </div>
                <section
                  className="dataset-add-example"
                  aria-labelledby="add-example-title"
                >
                  <div>
                    <h3 id="add-example-title">Add example</h3>
                    <p>Expected output은 의도적으로 비워 둘 수 있습니다.</p>
                  </div>
                  <div className="dataset-json-fields">
                    <label>
                      Input
                      <textarea
                        value={inputDraft}
                        onChange={(event) => setInputDraft(event.target.value)}
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Expected output <span>optional</span>
                      <textarea
                        value={expectedDraft}
                        onChange={(event) =>
                          setExpectedDraft(event.target.value)
                        }
                        spellCheck={false}
                        placeholder='{"answer":"..."}'
                      />
                    </label>
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={saving}
                    onClick={addExample}
                  >
                    Save example
                  </button>
                </section>
              </>
            )}
          </section>
        </section>
      )}
      {!loading && !error && tab === "experiments" && (
        <section className="evaluation-workspace" aria-label="Experiments">
          <aside className="evaluation-rail">
            <div className="evaluation-rail-heading">
              <span>Experiments</span>
            </div>
            <ul className="evaluation-record-list">
              {experiments.map((item) => (
                <li key={item.experiment_id}>
                  <button
                    type="button"
                    aria-current={
                      item.experiment_id === selectedExperimentId
                        ? "true"
                        : undefined
                    }
                    onClick={() => {
                      setSelectedExperimentId(item.experiment_id);
                      setComparisonExperimentId(null);
                    }}
                  >
                    <strong>{item.name}</strong>
                    <small>
                      {item.status} · {item.completed_case_count}/
                      {item.case_count} complete
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            {experiments.length === 0 && (
              <State>
                Python SDK에서 experiment를 실행하면 여기에 나타납니다.
              </State>
            )}
          </aside>
          <section className="evaluation-detail" aria-live="polite">
            {displayedExperiment === null && (
              <State>Experiment를 선택하세요.</State>
            )}
            {displayedExperiment !== null && (
              <>
                <div className="evaluation-detail-heading">
                  <div>
                    <p className="evaluation-kicker">
                      Dataset revision {displayedExperiment.dataset_revision}
                    </p>
                    <h2>{displayedExperiment.name}</h2>
                    <p>
                      {displayedExperiment.completed_case_count} completed ·{" "}
                      {displayedExperiment.failed_case_count} target failures
                    </p>
                  </div>
                  <span
                    className={`experiment-status status-${displayedExperiment.status}`}
                  >
                    {displayedExperiment.status}
                  </span>
                </div>
                <label className="experiment-compare-select">
                  Compare with
                  <select
                    value={comparisonExperimentId ?? ""}
                    onChange={(event) =>
                      setComparisonExperimentId(event.target.value || null)
                    }
                  >
                    <option value="">No comparison</option>
                    {experiments
                      .filter(
                        (item) =>
                          item.experiment_id !==
                            displayedExperiment.experiment_id &&
                          item.dataset_id === displayedExperiment.dataset_id &&
                          item.dataset_revision ===
                            displayedExperiment.dataset_revision,
                      )
                      .map((item) => (
                        <option
                          key={item.experiment_id}
                          value={item.experiment_id}
                        >
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                {displayedComparison !== null && (
                  <section
                    className="experiment-comparison"
                    aria-labelledby="experiment-comparison-title"
                  >
                    <div>
                      <p className="evaluation-kicker">Same-case comparison</p>
                      <h3 id="experiment-comparison-title">
                        {displayedExperiment.name} ↔ {displayedComparison.name}
                      </h3>
                    </div>
                    <div className="dataset-example-table-wrap">
                      <table className="dataset-example-table">
                        <thead>
                          <tr>
                            <th>Case</th>
                            <th>{displayedExperiment.name}</th>
                            <th>{displayedComparison.name}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayedExperiment.cases.map((item) => {
                            const compared = displayedComparison.cases.find(
                              (candidate) =>
                                candidate.dataset_example_id ===
                                item.dataset_example_id,
                            );
                            return (
                              <tr key={item.experiment_case_id}>
                                <td>
                                  <code>{preview(item.input)}</code>
                                </td>
                                <td>
                                  <strong>{item.status}</strong>
                                  <code>{preview(item.output)}</code>
                                </td>
                                <td>
                                  {compared === undefined ? (
                                    "—"
                                  ) : (
                                    <>
                                      <strong>{compared.status}</strong>
                                      <code>{preview(compared.output)}</code>
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                <div className="experiment-run-note">
                  <code>
                    langfeather.evaluate(dataset=&quot;
                    {displayedExperiment.dataset_id}
                    &quot;, …)
                  </code>
                  <span>실행은 user Python process에서만 수행됩니다.</span>
                </div>
                <div className="dataset-example-table-wrap">
                  <table className="dataset-example-table experiment-case-table">
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Expected / actual</th>
                        <th>Scores</th>
                        <th>Trace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedExperiment.cases.map((item) => (
                        <tr
                          key={item.experiment_case_id}
                          data-status={item.status}
                        >
                          <td>
                            <strong>{item.status}</strong>
                            <small>{duration(item.duration_us)}</small>
                          </td>
                          <td>
                            <code>{preview(item.expected_output)}</code>
                            <code>{preview(item.output)}</code>
                          </td>
                          <td>
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
                          <td>{item.trace_id ?? "Unavailable"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </section>
      )}
      {formError !== null && (
        <p className="evaluation-form-error" role="alert">
          {formError}
        </p>
      )}
      {selectedDatasetSummary === null &&
        tab === "datasets" &&
        datasets.length > 0 && (
          <span className="visually-hidden">
            Dataset 선택을 불러오는 중입니다.
          </span>
        )}
    </main>
  );
}

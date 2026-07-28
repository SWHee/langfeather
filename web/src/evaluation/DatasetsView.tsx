import { useEffect, useState } from "react";

import {
  addDatasetExample,
  ApiError,
  createDataset,
  deleteDataset,
  deleteDatasetExample,
  getDataset,
  getDatasets,
  getExperiments,
} from "../api/client";
import type {
  Dataset,
  DatasetSummary,
  ExperimentSummary,
  JsonValue,
} from "../api/types";
import { ManagementDialog, OverflowMenu } from "../components/ManagementChrome";
import { DatasetExperiments } from "./DatasetExperiments";
import { formatDate, formatDateTime, preview } from "./formatters";

type DetailTab = "examples" | "experiments";

type Status = { text: string; tone: "info" | "error" };

/* A blocked delete must not read like a completed one. */
function Toast({ status }: { status: Status }) {
  return (
    <div
      className="management-toast"
      data-tone={status.tone}
      role={status.tone === "error" ? "alert" : "status"}
      aria-live={status.tone === "error" ? "assertive" : "polite"}
    >
      {status.text}
    </div>
  );
}

export function DatasetsView() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [addExampleOpen, setAddExampleOpen] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    null,
  );
  const [detailTab, setDetailTab] = useState<DetailTab>("examples");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inputDraft, setInputDraft] = useState("{}");
  const [expectedDraft, setExpectedDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const notify = (text: string) => setStatus({ text, tone: "info" });
  const warn = (text: string) => setStatus({ text, tone: "error" });

  const loadLists = () => {
    setLoading(true);
    setLoadError(false);
    void Promise.all([getDatasets(), getExperiments()])
      .then(([datasetResponse, experimentResponse]) => {
        setDatasets(datasetResponse.items);
        setExperiments(experimentResponse.items);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void Promise.resolve().then(loadLists);
  }, []);

  useEffect(() => {
    if (status === null) {
      return;
    }
    const timeoutId = window.setTimeout(() => setStatus(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  useEffect(() => {
    if (selectedDatasetId === null) {
      return;
    }
    const controller = new AbortController();
    void getDataset(selectedDatasetId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setDataset(response);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDataset(null);
          setDetailError(true);
        }
      });
    return () => controller.abort();
  }, [selectedDatasetId]);

  const openDataset = (datasetId: string) => {
    setDetailError(false);
    setSelectedDatasetId(datasetId);
    setDetailTab("examples");
    setDataset(null);
  };

  const closeDataset = () => {
    setSelectedDatasetId(null);
    setDataset(null);
    setAddExampleOpen(false);
    setDetailError(false);
  };

  const applyDataset = (updated: Dataset) => {
    setDataset(updated);
    setDatasets((items) =>
      items.map((item) =>
        item.dataset_id === updated.dataset_id ? updated : item,
      ),
    );
  };

  const create = () => {
    if (name.trim() === "") {
      setFormError("Dataset 이름을 입력하세요.");
      return;
    }
    setPending(true);
    setFormError(null);
    void createDataset({
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
    })
      .then((created) => {
        setDatasets((items) => [created, ...items]);
        setName("");
        setDescription("");
        setCreateOpen(false);
        notify("Dataset을 만들었습니다.");
      })
      .catch(() =>
        setFormError(
          "Dataset을 만들지 못했습니다. 이름이 이미 있는지 확인하세요.",
        ),
      )
      .finally(() => setPending(false));
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
    setPending(true);
    setFormError(null);
    void addDatasetExample(dataset.dataset_id, {
      input,
      expected_output: expectedOutput,
    })
      .then((updated) => {
        applyDataset(updated);
        setInputDraft("{}");
        setExpectedDraft("");
        setAddExampleOpen(false);
        notify("Example을 추가했습니다.");
      })
      .catch(() => setFormError("Example을 저장하지 못했습니다."))
      .finally(() => setPending(false));
  };

  const removeDataset = (summary: DatasetSummary) => {
    if (
      !window.confirm(
        `'${summary.name}' Dataset과 example ${summary.example_count}개를 영구 삭제할까요?`,
      )
    ) {
      return;
    }
    void deleteDataset(summary.dataset_id)
      .then(() => {
        setDatasets((items) =>
          items.filter((item) => item.dataset_id !== summary.dataset_id),
        );
        if (selectedDatasetId === summary.dataset_id) {
          closeDataset();
        }
        notify("Dataset을 삭제했습니다.");
      })
      .catch((cause: unknown) =>
        warn(
          cause instanceof ApiError && cause.status === 409
            ? "Experiment 기록이 있는 dataset은 삭제할 수 없습니다."
            : "Dataset을 삭제하지 못했습니다.",
        ),
      );
  };

  const removeExample = (exampleId: string) => {
    if (dataset === null) {
      return;
    }
    if (
      !window.confirm(
        "이 example을 삭제할까요? 이미 실행한 experiment 기록은 유지됩니다.",
      )
    ) {
      return;
    }
    const datasetId = dataset.dataset_id;
    void deleteDatasetExample(datasetId, exampleId)
      .then(() => getDataset(datasetId))
      .then((updated) => {
        applyDataset(updated);
        notify("Example을 삭제했습니다.");
      })
      .catch(() => warn("Example을 삭제하지 못했습니다."));
  };

  const datasetExperiments = (datasetId: string) =>
    experiments.filter((item) => item.dataset_id === datasetId);

  const lastExperimentAt = (datasetId: string): string | null => {
    const started = datasetExperiments(datasetId).map((item) =>
      Date.parse(item.started_at),
    );
    return started.length === 0
      ? null
      : new Date(Math.max(...started)).toISOString();
  };

  if (selectedDatasetId !== null) {
    const relatedExperiments = datasetExperiments(selectedDatasetId);

    return (
      <main className="management-page dataset-detail-page">
        <nav className="management-breadcrumb" aria-label="Dataset 위치">
          <button
            type="button"
            aria-label="Dataset 목록으로"
            onClick={closeDataset}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Datasets
          </button>
          <span aria-hidden="true">/</span>
          <strong>{dataset?.name ?? "불러오는 중…"}</strong>
        </nav>

        {detailError && (
          <div className="management-empty" role="alert">
            <strong>Dataset을 불러오지 못했습니다.</strong>
            <p>서버 상태를 확인한 뒤 다시 열어 주세요.</p>
          </div>
        )}
        {!detailError && dataset === null && (
          <div className="management-state">Dataset을 불러오는 중…</div>
        )}
        {dataset !== null && (
          <>
            <header className="dataset-detail-heading">
              <div>
                <h1>{dataset.name}</h1>
                <p>{dataset.description ?? "설명이 없습니다."}</p>
              </div>
              <div className="dataset-detail-actions">
                <span className="dataset-revision-badge">
                  revision {dataset.revision}
                </span>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setAddExampleOpen(true);
                  }}
                >
                  <span aria-hidden="true" className="button-plus">
                    +
                  </span>
                  Add example
                </button>
              </div>
            </header>

            <div className="dataset-detail-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "examples"}
                onClick={() => setDetailTab("examples")}
              >
                Examples ({dataset.example_count})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "experiments"}
                onClick={() => setDetailTab("experiments")}
              >
                Experiments ({relatedExperiments.length})
              </button>
            </div>

            {detailTab === "examples" && (
              <section className="management-surface" aria-label="Examples">
                {dataset.examples.length === 0 ? (
                  <div className="management-empty">
                    <strong>아직 example이 없습니다.</strong>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setFormError(null);
                        setAddExampleOpen(true);
                      }}
                    >
                      첫 example 추가하기
                    </button>
                  </div>
                ) : (
                  <div className="management-table-scroll">
                    <table className="management-table dataset-example-table">
                      <thead>
                        <tr>
                          <th scope="col">Input</th>
                          <th scope="col">Expected output</th>
                          <th scope="col">Source</th>
                          <th scope="col" className="actions-column">
                            작업
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {dataset.examples.map((item) => (
                          <tr key={item.dataset_example_id}>
                            <td data-label="Input">
                              <code>{preview(item.input)}</code>
                            </td>
                            <td data-label="Expected output">
                              <code>{preview(item.expected_output)}</code>
                            </td>
                            <td data-label="Source">
                              {item.source_trace_id ?? "Manual"}
                            </td>
                            <td data-label="작업">
                              <div className="row-actions">
                                <OverflowMenu
                                  label={`Example ${item.position + 1} actions`}
                                  actions={[
                                    {
                                      label: "영구 삭제",
                                      icon: "trash",
                                      danger: true,
                                      onSelect: () =>
                                        removeExample(item.dataset_example_id),
                                    },
                                  ]}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {detailTab === "experiments" && (
              <DatasetExperiments
                key={dataset.dataset_id}
                experiments={relatedExperiments}
              />
            )}
          </>
        )}

        {status !== null && <Toast status={status} />}

        {addExampleOpen && (
          <ManagementDialog
            title="Add example"
            titleId="add-example-title"
            className="dataset-example-dialog"
            onClose={() => {
              if (!pending) {
                setAddExampleOpen(false);
              }
            }}
          >
            <form
              className="management-form"
              onSubmit={(event) => {
                event.preventDefault();
                addExample();
              }}
            >
              <label>
                <span>Input</span>
                <textarea
                  aria-label="Input"
                  rows={5}
                  spellCheck={false}
                  value={inputDraft}
                  onChange={(event) => setInputDraft(event.target.value)}
                />
              </label>
              <label>
                <span>Expected output (optional)</span>
                <textarea
                  aria-label="Expected output"
                  rows={5}
                  spellCheck={false}
                  placeholder='{"answer":"..."}'
                  value={expectedDraft}
                  onChange={(event) => setExpectedDraft(event.target.value)}
                />
              </label>
              <p className="management-form-note">
                Expected output은 의도적으로 비워 둘 수 있습니다.
              </p>
              {formError !== null && (
                <p className="management-form-error" role="alert">
                  {formError}
                </p>
              )}
              <button
                className="primary-button"
                type="submit"
                disabled={pending}
              >
                Example 저장
              </button>
            </form>
          </ManagementDialog>
        )}
      </main>
    );
  }

  const filteredDatasets = datasets.filter((item) => {
    const searchText =
      `${item.name} ${item.description ?? ""}`.toLocaleLowerCase();
    return searchText.includes(query.trim().toLocaleLowerCase());
  });

  return (
    <main className="management-page dataset-page">
      <header className="management-header">
        <h1>Datasets</h1>
      </header>

      <section className="management-surface" aria-label="Dataset 목록">
        <div className="management-toolbar">
          <button
            className="primary-button toolbar-primary"
            type="button"
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
          >
            <span aria-hidden="true" className="button-plus">
              +
            </span>
            New Dataset
          </button>
          <label className="management-search">
            <span aria-hidden="true" className="search-icon" />
            <input
              aria-label="Dataset 검색"
              placeholder="Search by name..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="management-count">{filteredDatasets.length}개</span>
        </div>

        {loading ? (
          <div className="management-state">Datasets를 불러오는 중…</div>
        ) : loadError ? (
          <div className="management-empty" role="alert">
            <strong>Datasets를 불러오지 못했습니다.</strong>
            <button
              className="secondary-button"
              type="button"
              onClick={loadLists}
            >
              다시 시도
            </button>
          </div>
        ) : datasets.length === 0 ? (
          <div className="management-empty">
            <strong>아직 Dataset이 없습니다.</strong>
            <p>Trace 상세의 Add to Dataset으로도 만들 수 있습니다.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setFormError(null);
                setCreateOpen(true);
              }}
            >
              첫 Dataset 만들기
            </button>
          </div>
        ) : filteredDatasets.length === 0 ? (
          <div className="management-empty">
            <strong>검색 결과가 없습니다.</strong>
            <p>다른 이름으로 검색해 보세요.</p>
          </div>
        ) : (
          <div className="management-table-scroll">
            <table className="management-table dataset-table">
              <thead>
                <tr>
                  <th scope="col">이름</th>
                  <th scope="col">Experiments</th>
                  <th scope="col">최근 experiment</th>
                  <th scope="col">Examples</th>
                  <th scope="col">수정일</th>
                  <th scope="col" className="actions-column">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDatasets.map((item) => {
                  const lastRun = lastExperimentAt(item.dataset_id);
                  return (
                    <tr key={item.dataset_id}>
                      <td data-label="이름">
                        <button
                          className="table-name-button"
                          type="button"
                          onClick={() => openDataset(item.dataset_id)}
                        >
                          {item.name}
                        </button>
                        {item.description !== null && (
                          <small>{item.description}</small>
                        )}
                      </td>
                      <td data-label="Experiments">
                        {datasetExperiments(item.dataset_id).length}
                      </td>
                      <td data-label="최근 experiment">
                        {lastRun === null ? "—" : formatDateTime(lastRun)}
                      </td>
                      <td data-label="Examples">{item.example_count}</td>
                      <td data-label="수정일">{formatDate(item.updated_at)}</td>
                      <td data-label="작업">
                        <div className="row-actions">
                          <OverflowMenu
                            label={`${item.name} actions`}
                            actions={[
                              {
                                label: "영구 삭제",
                                icon: "trash",
                                danger: true,
                                onSelect: () => removeDataset(item),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {status !== null && <Toast status={status} />}

      {createOpen && (
        <ManagementDialog
          title="New Dataset"
          titleId="new-dataset-title"
          className="dataset-create-dialog"
          onClose={() => {
            if (!pending) {
              setCreateOpen(false);
            }
          }}
        >
          <form
            className="management-form"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <label>
              <span>Dataset 이름</span>
              <input
                aria-label="Dataset 이름"
                required
                maxLength={255}
                value={name}
                placeholder="rag-regression"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>설명</span>
              <input
                aria-label="설명"
                value={description}
                placeholder="검토가 끝난 실패 사례"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {formError !== null && (
              <p className="management-form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={pending}>
              Dataset 생성
            </button>
          </form>
        </ManagementDialog>
      )}
    </main>
  );
}

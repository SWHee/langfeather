import { useEffect, useRef, useState, type KeyboardEvent } from "react";

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
import { CompareView } from "./CompareView";
import { DatasetExperiments } from "./DatasetExperiments";
import { preview } from "./formatters";

type DetailTab = "compare" | "experiments" | "examples";

type Status = { text: string; tone: "info" | "error" };

const DETAIL_TABS: DetailTab[] = ["compare", "experiments", "examples"];

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

export function DatasetsView({
  onOpenTrace,
}: {
  onOpenTrace?: (traceId: string) => void;
}) {
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
  const [detailTab, setDetailTab] = useState<DetailTab>("compare");
  const selectedDatasetIdRef = useRef(selectedDatasetId);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailRequestRevision, setDetailRequestRevision] = useState(0);
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
        setSelectedDatasetId((current) => {
          if (
            current !== null &&
            datasetResponse.items.some((item) => item.dataset_id === current)
          ) {
            return current;
          }
          return datasetResponse.items[0]?.dataset_id ?? null;
        });
      })
      .catch(() => {
        setDatasets([]);
        setExperiments([]);
        setSelectedDatasetId(null);
        setDataset(null);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void Promise.resolve().then(loadLists);
  }, []);

  useEffect(() => {
    selectedDatasetIdRef.current = selectedDatasetId;
  }, [selectedDatasetId]);

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
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setDataset(null);
        if (cause instanceof ApiError && cause.status === 404) {
          setDetailError(false);
          setDatasets((items) =>
            items.filter((item) => item.dataset_id !== selectedDatasetId),
          );
          setSelectedDatasetId(null);
          notify("이 Dataset은 삭제되었습니다.");
          void getDatasets()
            .then((response) => {
              setDatasets(response.items);
              setSelectedDatasetId(response.items[0]?.dataset_id ?? null);
            })
            .catch(() => setLoadError(true));
          return;
        }
        setDetailError(true);
      });
    return () => controller.abort();
  }, [detailRequestRevision, selectedDatasetId]);

  const selectDataset = (datasetId: string) => {
    if (datasetId === selectedDatasetId) {
      return;
    }
    setDetailError(false);
    setSelectedDatasetId(datasetId);
    setDataset(null);
    setAddExampleOpen(false);
  };

  const retryDataset = () => {
    setDetailError(false);
    setDataset(null);
    setDetailRequestRevision((revision) => revision + 1);
  };

  const applyDataset = (updated: Dataset) => {
    setDatasets((items) =>
      items.map((item) =>
        item.dataset_id === updated.dataset_id ? updated : item,
      ),
    );
    if (selectedDatasetIdRef.current !== updated.dataset_id) {
      return;
    }
    setDataset(updated);
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
        setSelectedDatasetId(created.dataset_id);
        setDataset(created);
        setDetailError(false);
        setDetailTab("compare");
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
        const remaining = datasets.filter(
          (item) => item.dataset_id !== summary.dataset_id,
        );
        setDatasets(remaining);
        if (selectedDatasetId === summary.dataset_id) {
          setSelectedDatasetId(remaining[0]?.dataset_id ?? null);
          setDataset(null);
          setDetailError(false);
          setAddExampleOpen(false);
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

  const selectTab = (tab: DetailTab) => {
    setDetailTab(tab);
  };

  const moveBetweenTabs = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: DetailTab,
  ) => {
    const currentIndex = DETAIL_TABS.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % DETAIL_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + DETAIL_TABS.length) % DETAIL_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = DETAIL_TABS.length - 1;
    }
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const nextTab = DETAIL_TABS[nextIndex];
    if (nextTab === undefined) {
      return;
    }
    selectTab(nextTab);
    document.getElementById(`evaluation-tab-${nextTab}`)?.focus();
  };

  const selectedSummary =
    datasets.find((item) => item.dataset_id === selectedDatasetId) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredDatasets = datasets.filter((item) =>
    `${item.name} ${item.description ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  const filteredSelection = filteredDatasets.some(
    (item) => item.dataset_id === selectedDatasetId,
  )
    ? selectedDatasetId
    : null;
  const displayedDataset =
    dataset?.dataset_id === selectedDatasetId ? dataset : null;
  const relatedExperiments =
    selectedDatasetId === null
      ? []
      : experiments.filter((item) => item.dataset_id === selectedDatasetId);
  const displayedRevision =
    displayedDataset?.revision ?? selectedSummary?.revision ?? null;
  const selectorPlaceholder = loading
    ? "불러오는 중…"
    : loadError
      ? "Dataset을 선택할 수 없음"
      : datasets.length === 0
        ? "Dataset 없음"
        : "검색 결과 없음";

  return (
    <main className="management-page evaluation-page">
      <header className="management-header evaluation-header">
        <div>
          <h1>Datasets &amp; Experiments</h1>
          <p>Dataset 문맥 안에서 examples와 experiment 결과를 검토합니다.</p>
        </div>
        <button
          className="primary-button"
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
      </header>

      <section className="evaluation-dataset-context" aria-label="Dataset 문맥">
        <div className="evaluation-dataset-selector">
          <span>Dataset</span>
          <label className="management-search">
            <span aria-hidden="true" className="search-icon" />
            <input
              aria-label="Dataset 검색"
              placeholder="Search by name or description..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Dataset 선택"
            value={filteredSelection ?? ""}
            disabled={loading || loadError || filteredDatasets.length === 0}
            onChange={(event) => selectDataset(event.target.value)}
          >
            {filteredDatasets.length === 0 ? (
              <option value="">{selectorPlaceholder}</option>
            ) : (
              filteredDatasets.map((item) => (
                <option key={item.dataset_id} value={item.dataset_id}>
                  {item.name}
                </option>
              ))
            )}
          </select>
        </div>
        <span className="dataset-revision-badge">
          revision {displayedRevision ?? "—"}
        </span>
        {selectedSummary !== null && (
          <OverflowMenu
            label={`${selectedSummary.name} actions`}
            actions={[
              {
                label: "영구 삭제",
                icon: "trash",
                danger: true,
                onSelect: () => removeDataset(selectedSummary),
              },
            ]}
          />
        )}
      </section>

      {loading ? (
        <div className="management-state" aria-live="polite">
          Evaluation 데이터를 불러오는 중…
        </div>
      ) : loadError ? (
        <div className="management-empty" role="alert">
          <strong>Evaluation 데이터를 불러오지 못했습니다.</strong>
          <p>서버 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={loadLists}
          >
            다시 시도
          </button>
        </div>
      ) : selectedSummary === null ? (
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
      ) : (
        <>
          <header className="dataset-detail-heading evaluation-dataset-heading">
            <div>
              <h2>{selectedSummary.name}</h2>
              <p>{selectedSummary.description ?? "설명이 없습니다."}</p>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={displayedDataset === null}
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
          </header>

          <div
            className="dataset-detail-tabs"
            role="tablist"
            aria-label={`${selectedSummary.name} Evaluation 보기`}
          >
            <button
              id="evaluation-tab-compare"
              type="button"
              role="tab"
              aria-controls="evaluation-panel-compare"
              aria-selected={detailTab === "compare"}
              tabIndex={detailTab === "compare" ? 0 : -1}
              onClick={() => selectTab("compare")}
              onKeyDown={(event) => moveBetweenTabs(event, "compare")}
            >
              Compare
            </button>
            <button
              id="evaluation-tab-experiments"
              type="button"
              role="tab"
              aria-controls="evaluation-panel-experiments"
              aria-selected={detailTab === "experiments"}
              tabIndex={detailTab === "experiments" ? 0 : -1}
              onClick={() => selectTab("experiments")}
              onKeyDown={(event) => moveBetweenTabs(event, "experiments")}
            >
              Experiments ({relatedExperiments.length})
            </button>
            <button
              id="evaluation-tab-examples"
              type="button"
              role="tab"
              aria-controls="evaluation-panel-examples"
              aria-selected={detailTab === "examples"}
              tabIndex={detailTab === "examples" ? 0 : -1}
              onClick={() => selectTab("examples")}
              onKeyDown={(event) => moveBetweenTabs(event, "examples")}
            >
              Examples ({selectedSummary.example_count})
            </button>
          </div>

          {detailError ? (
            <div className="management-empty" role="alert">
              <strong>Dataset을 불러오지 못했습니다.</strong>
              <p>서버 상태를 확인한 뒤 다시 시도해 주세요.</p>
              <button
                className="secondary-button"
                type="button"
                onClick={retryDataset}
              >
                다시 시도
              </button>
            </div>
          ) : displayedDataset === null ? (
            <div className="management-state" aria-live="polite">
              Dataset 세부 정보를 불러오는 중…
            </div>
          ) : detailTab === "compare" ? (
            <div
              id="evaluation-panel-compare"
              role="tabpanel"
              aria-labelledby="evaluation-tab-compare"
            >
              <CompareView
                key={displayedDataset.dataset_id}
                experiments={relatedExperiments}
                onOpenTrace={onOpenTrace}
              />
            </div>
          ) : detailTab === "experiments" ? (
            <div
              id="evaluation-panel-experiments"
              role="tabpanel"
              aria-labelledby="evaluation-tab-experiments"
            >
              <DatasetExperiments
                key={displayedDataset.dataset_id}
                experiments={relatedExperiments}
              />
            </div>
          ) : (
            <section
              id="evaluation-panel-examples"
              className="management-surface"
              role="tabpanel"
              aria-labelledby="evaluation-tab-examples"
            >
              {displayedDataset.examples.length === 0 ? (
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
                      {displayedDataset.examples.map((item) => (
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
            <button className="primary-button" type="submit" disabled={pending}>
              Example 저장
            </button>
          </form>
        </ManagementDialog>
      )}

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

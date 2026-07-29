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
  updateDatasetExample,
} from "../api/client";
import type {
  Dataset,
  DatasetExample,
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

type JsonlExample = {
  input: JsonValue;
  expected_output: JsonValue | null;
  metadata: { [key: string]: JsonValue };
};

// Exported for a contract-focused round-trip test alongside the component.
// eslint-disable-next-line react-refresh/only-export-components
export function examplesToJsonl(examples: readonly DatasetExample[]): string {
  if (examples.length === 0) {
    return "";
  }
  return `${examples
    .map((example) =>
      JSON.stringify({
        input: example.input,
        expected_output: example.expected_output,
        metadata: example.metadata,
      }),
    )
    .join("\n")}\n`;
}

function parseJsonlExample(value: unknown): JsonlExample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("example must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "input")) {
    throw new Error("input is required");
  }
  const rawMetadata = record.metadata ?? {};
  if (
    typeof rawMetadata !== "object" ||
    rawMetadata === null ||
    Array.isArray(rawMetadata)
  ) {
    throw new Error("metadata must be a JSON object");
  }
  return {
    input: record.input as JsonValue,
    expected_output: Object.prototype.hasOwnProperty.call(
      record,
      "expected_output",
    )
      ? (record.expected_output as JsonValue | null)
      : null,
    metadata: rawMetadata as { [key: string]: JsonValue },
  };
}

function readTextFile(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("file read failed")),
    );
    reader.readAsText(file);
  });
}

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
  const [metadataDraft, setMetadataDraft] = useState("");
  const [editingExampleId, setEditingExampleId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
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

  const resetExampleForm = () => {
    setInputDraft("{}");
    setExpectedDraft("");
    setMetadataDraft("");
    setEditingExampleId(null);
    setFormError(null);
  };

  const openAddExample = () => {
    resetExampleForm();
    setAddExampleOpen(true);
  };

  const openEditExample = (example: DatasetExample) => {
    setInputDraft(JSON.stringify(example.input));
    setExpectedDraft(
      example.expected_output === null
        ? ""
        : JSON.stringify(example.expected_output),
    );
    setMetadataDraft(JSON.stringify(example.metadata));
    setEditingExampleId(example.dataset_example_id);
    setFormError(null);
    setAddExampleOpen(true);
  };

  const closeExampleDialog = () => {
    setAddExampleOpen(false);
    resetExampleForm();
  };

  const saveExample = () => {
    if (dataset === null) {
      return;
    }
    let input: JsonValue;
    let expectedOutput: JsonValue | null = null;
    let metadata: { [key: string]: JsonValue } = {};
    try {
      input = JSON.parse(inputDraft) as JsonValue;
    } catch (cause: unknown) {
      setFormError(
        `Input JSON 오류${cause instanceof SyntaxError ? `: ${cause.message}` : ""}`,
      );
      return;
    }
    if (expectedDraft.trim() !== "") {
      try {
        expectedOutput = JSON.parse(expectedDraft) as JsonValue;
      } catch (cause: unknown) {
        setFormError(
          `Expected output JSON 오류${cause instanceof SyntaxError ? `: ${cause.message}` : ""}`,
        );
        return;
      }
    }
    if (metadataDraft.trim() !== "") {
      let parsedMetadata: JsonValue;
      try {
        parsedMetadata = JSON.parse(metadataDraft) as JsonValue;
      } catch (cause: unknown) {
        setFormError(
          `Metadata JSON 오류${cause instanceof SyntaxError ? `: ${cause.message}` : ""}`,
        );
        return;
      }
      if (
        parsedMetadata === null ||
        typeof parsedMetadata !== "object" ||
        Array.isArray(parsedMetadata)
      ) {
        setFormError("Metadata는 JSON object여야 합니다.");
        return;
      }
      metadata = parsedMetadata;
    }
    if (
      input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).length === 0 &&
      !window.confirm("비어 있는 input입니다. 저장할까요?")
    ) {
      return;
    }
    setPending(true);
    setFormError(null);
    const request = { input, expected_output: expectedOutput, metadata };
    const operation =
      editingExampleId === null
        ? addDatasetExample(dataset.dataset_id, request)
        : updateDatasetExample(
            dataset.dataset_id,
            editingExampleId,
            request,
          );
    void operation
      .then((updated) => {
        applyDataset(updated);
        const action = editingExampleId === null ? "추가" : "수정";
        closeExampleDialog();
        notify(`Example을 ${action}했습니다.`);
      })
      .catch(() => setFormError("Example을 저장하지 못했습니다."))
      .finally(() => setPending(false));
  };

  const exportJsonl = () => {
    if (dataset === null) {
      return;
    }
    const contents = examplesToJsonl(dataset.examples);
    const blob = new Blob([contents], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const safeName =
      dataset.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
      dataset.dataset_id;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}.jsonl`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notify(`Example ${dataset.examples.length}개를 JSONL로 내보냈습니다.`);
  };

  const importJsonl = async (file: File) => {
    if (dataset === null) {
      return;
    }
    const datasetId = dataset.dataset_id;
    setImporting(true);
    let contents: string;
    try {
      contents = await readTextFile(file);
    } catch {
      warn("JSONL 파일을 읽지 못했습니다.");
      setImporting(false);
      return;
    }

    let imported = 0;
    let latestDataset: Dataset | null = null;
    const failedLines: number[] = [];
    const lines = contents.split(/\r?\n/);
    for (const [index, rawLine] of lines.entries()) {
      const lineNumber = index + 1;
      if (rawLine.trim() === "") {
        continue;
      }
      let example: JsonlExample;
      try {
        example = parseJsonlExample(JSON.parse(rawLine) as unknown);
      } catch {
        failedLines.push(lineNumber);
        continue;
      }
      try {
        latestDataset = await addDatasetExample(datasetId, example);
        imported += 1;
      } catch {
        failedLines.push(lineNumber);
      }
    }
    if (latestDataset !== null) {
      applyDataset(latestDataset);
    }
    if (failedLines.length === 0) {
      notify(`JSONL import: ${imported}개를 추가했습니다.`);
    } else {
      warn(
        `JSONL import: ${imported}개 추가, 실패한 줄 ${failedLines.join(", ")}.`,
      );
    }
    setImporting(false);
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
            <div className="dataset-detail-actions dataset-jsonl-actions">
              <label
                className="secondary-button dataset-jsonl-import"
                data-disabled={displayedDataset === null || importing}
              >
                Import JSONL
                <input
                  className="sr-only"
                  type="file"
                  accept=".jsonl,application/x-ndjson,application/json"
                  aria-label="JSONL 가져오기"
                  disabled={displayedDataset === null || importing}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file !== undefined) {
                      void importJsonl(file);
                    }
                  }}
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={
                  displayedDataset === null ||
                  displayedDataset.examples.length === 0 ||
                  importing
                }
                onClick={exportJsonl}
              >
                Export JSONL
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={displayedDataset === null || importing}
                onClick={openAddExample}
              >
                <span aria-hidden="true" className="button-plus">
                  +
                </span>
                Add example
              </button>
            </div>
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
                    onClick={openAddExample}
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
                                    label: "수정",
                                    icon: "edit",
                                    onSelect: () => openEditExample(item),
                                  },
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
          title={editingExampleId === null ? "Add example" : "Example 수정"}
          titleId="dataset-example-title"
          className="dataset-example-dialog"
          onClose={() => {
            if (!pending) {
              closeExampleDialog();
            }
          }}
        >
          <form
            className="management-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveExample();
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
            <label>
              <span>Metadata (optional)</span>
              <textarea
                aria-label="Metadata"
                rows={4}
                spellCheck={false}
                placeholder='{"category":"regression"}'
                value={metadataDraft}
                onChange={(event) => setMetadataDraft(event.target.value)}
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
              {editingExampleId === null ? "Example 저장" : "Example 수정"}
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

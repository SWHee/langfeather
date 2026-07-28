import { useEffect, useMemo, useState } from "react";
import {
  archiveScore,
  completeAnnotationQueueItem,
  createAnnotationQueue,
  createScore,
  deleteAnnotation,
  deleteAnnotationQueue,
  deleteAnnotationQueueItem,
  deleteScore,
  editAnnotationQueueItem,
  getAnnotationQueues,
  getObservation,
  getScores,
  getTrace,
  putAnnotation,
  putTraceMemo,
  updateScore,
  updateAnnotationQueue,
} from "../api/client";
import type {
  AnnotationQueue,
  AnnotationQueueItem,
  AnnotationValue,
  Observation,
  ScoreConfig,
  ScoreCreateRequest,
  ScoreDataType,
  TraceDetail,
} from "../api/types";
import {
  ObservationInspector,
  type LoadState,
} from "../components/ObservationInspector";
import {
  ManagementDialog,
  OverflowMenu,
} from "../components/ManagementChrome";
import { useDismissiblePopover } from "../components/useDismissiblePopover";
import { RuntimeExecutionGraph } from "../graph/RuntimeExecutionGraph";

type AnnotationEntry = {
  score_config_id: string;
  value: AnnotationValue;
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}


function queueItemStatusLabel(status: AnnotationQueueItem["status"]): string {
  return status === "completed" ? "완료" : "검토 대기";
}

function valuesFromDetail(
  detail: TraceDetail,
): Record<string, AnnotationValue | undefined> {
  return Object.fromEntries(
    detail.annotations.map((annotation) => [
      annotation.score_config_id,
      annotation.value,
    ]),
  );
}

function ScoreField({
  score,
  value,
  readOnly,
  onChange,
}: {
  score: ScoreConfig;
  value: AnnotationValue | undefined;
  readOnly: boolean;
  onChange: (value: AnnotationValue) => void;
}) {
  if (score.data_type === "boolean") {
    return (
      <select
        aria-label={`${score.name} 값`}
        disabled={readOnly}
        value={value === undefined ? "" : value ? "true" : "false"}
        onChange={(event) => onChange(event.target.value === "true")}
      >
        <option value="" disabled>
          미기록
        </option>
        <option value="true">{score.boolean_true_label ?? "True"}</option>
        <option value="false">{score.boolean_false_label ?? "False"}</option>
      </select>
    );
  }
  if (score.data_type === "number") {
    return (
      <input
        aria-label={`${score.name} 값`}
        disabled={readOnly}
        type="number"
        min={score.number_min ?? undefined}
        max={score.number_max ?? undefined}
        step="any"
        value={typeof value === "number" ? value : ""}
        onChange={(event) => {
          if (event.target.value !== "") {
            onChange(Number(event.target.value));
          }
        }}
      />
    );
  }

  const selected = Array.isArray(value) ? value : [];
  if (score.categorical_selection_mode === "single") {
    return (
      <select
        aria-label={`${score.name} 값`}
        disabled={readOnly}
        value={selected[0] ?? ""}
        onChange={(event) => onChange([event.target.value])}
      >
        <option value="" disabled>
          미기록
        </option>
        {score.options
          .filter((option) => option.archived_at === null)
          .map((option) => (
            <option key={option.score_option_id} value={option.score_option_id}>
              {option.label}
            </option>
          ))}
      </select>
    );
  }
  return (
    <div className="multiple-score-options" aria-label={`${score.name} 값`}>
      {score.options
        .filter((option) => option.archived_at === null)
        .map((option) => (
          <label
            key={option.score_option_id}
            data-selected={selected.includes(option.score_option_id)}
          >
            <input
              type="checkbox"
              disabled={readOnly}
              checked={selected.includes(option.score_option_id)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, option.score_option_id]
                  : selected.filter((item) => item !== option.score_option_id);
                onChange(next);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
    </div>
  );
}

function AnnotationEditor({
  scores,
  detail,
  readOnly,
  actionLabel,
  busy,
  onSubmit,
  onEdit,
  onDelete,
  addableScores,
  onAddScore,
}: {
  scores: ScoreConfig[];
  detail: TraceDetail;
  readOnly: boolean;
  actionLabel: string;
  busy: boolean;
  onSubmit: (entries: AnnotationEntry[], memo: string) => Promise<void>;
  onEdit?: () => Promise<void>;
  onDelete?: (scoreConfigId: string) => Promise<void>;
  addableScores?: ScoreConfig[];
  onAddScore?: (scoreConfigId: string) => void;
}) {
  const [values, setValues] = useState<
    Record<string, AnnotationValue | undefined>
  >(() => valuesFromDetail(detail));
  const [memo, setMemo] = useState(detail.memo?.content ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [isScorePickerOpen, setIsScorePickerOpen] = useState(false);
  const { rootRef: scorePickerRef, triggerRef: scorePickerTriggerRef } =
    useDismissiblePopover(isScorePickerOpen, () => setIsScorePickerOpen(false));

  const submit = async () => {
    setSaveState("idle");
    const entries = scores.flatMap((score) => {
      if (score.archived_at !== null) {
        return [];
      }
      const value = values[score.score_config_id];
      return value === undefined
        ? []
        : [{ score_config_id: score.score_config_id, value }];
    });
    try {
      await onSubmit(entries, memo);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <section className="annotation-editor" aria-labelledby="annotation-title">
      <div className="annotation-editor-heading">
        <div>
          <h3 id="annotation-title">Annotation</h3>
          <span>
            {scores.length === 0 ? "Score 없음" : `Score ${scores.length}개`}
          </span>
        </div>
        <div className="annotation-header-actions">
          {onAddScore !== undefined && addableScores !== undefined && (
            <div className="annotation-score-picker" ref={scorePickerRef}>
              <button
                ref={scorePickerTriggerRef}
                className="secondary-button"
                type="button"
                aria-expanded={isScorePickerOpen}
                aria-haspopup="menu"
                disabled={addableScores.length === 0}
                onClick={() => setIsScorePickerOpen((current) => !current)}
              >
                Score 추가
              </button>
              {isScorePickerOpen && (
                <div
                  className="annotation-score-menu"
                  role="menu"
                  aria-label="추가할 Score"
                >
                  {addableScores.map((score) => (
                    <button
                      key={score.score_config_id}
                      className="text-button"
                      type="button"
                      onClick={() => {
                        onAddScore(score.score_config_id);
                        setSaveState("idle");
                        setIsScorePickerOpen(false);
                      }}
                    >
                      {score.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {readOnly && onEdit !== undefined && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void onEdit()}
            >
              수정
            </button>
          )}
        </div>
      </div>

      <div className="annotation-editor-body">
        {scores.length > 0 && (
          <div className="score-fields">
            {scores.map((score) => {
              const existing = detail.annotations.some(
                (annotation) =>
                  annotation.score_config_id === score.score_config_id,
              );
              return (
                <div className="score-field" key={score.score_config_id}>
                  <label>
                    <span>
                      <strong>{score.name}</strong>
                      {score.description !== null && (
                        <small>{score.description}</small>
                      )}
                    </span>
                    <ScoreField
                      score={score}
                      value={values[score.score_config_id]}
                      readOnly={readOnly || score.archived_at !== null}
                      onChange={(value) => {
                        setSaveState("idle");
                        setValues((current) => ({
                          ...current,
                          [score.score_config_id]: value,
                        }));
                      }}
                    />
                  </label>
                  {!readOnly &&
                    score.archived_at === null &&
                    existing &&
                    onDelete !== undefined && (
                      <button
                        className="text-button danger-text"
                        type="button"
                        onClick={() => void onDelete(score.score_config_id)}
                      >
                        값 지우기
                      </button>
                    )}
                </div>
              );
            })}
          </div>
        )}

        <label className="memo-field">
          <span>
            <strong>Memo</strong>
          </span>
          <textarea
            aria-label="Trace 메모"
            disabled={readOnly}
            rows={4}
            value={memo}
            onChange={(event) => {
              setSaveState("idle");
              setMemo(event.target.value);
            }}
            placeholder="판단 근거나 다음에 확인할 내용을 기록하세요."
          />
        </label>
      </div>

      {!readOnly && (
        <footer className="annotation-editor-footer">
          <span
            className="annotation-save-status"
            role={saveState === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {saveState === "saved"
              ? "저장됨"
              : saveState === "error"
                ? "저장하지 못했습니다."
                : ""}
          </span>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "저장 중…" : actionLabel}
          </button>
        </footer>
      )}
    </section>
  );
}

export function TraceAnnotationPanel({
  detail,
  onChanged,
}: {
  detail: TraceDetail;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedScoreIds, setSelectedScoreIds] = useState<string[]>(() =>
    detail.annotations.map((annotation) => annotation.score_config_id),
  );

  const selectedScores = detail.score_configs.filter(
    (score) =>
      selectedScoreIds.includes(score.score_config_id) ||
      detail.annotations.some(
        (annotation) => annotation.score_config_id === score.score_config_id,
      ),
  );
  const addableScores = detail.score_configs.filter(
    (score) =>
      score.archived_at === null &&
      !selectedScores.some(
        (selected) => selected.score_config_id === score.score_config_id,
      ),
  );

  const save = async (entries: AnnotationEntry[], memo: string) => {
    setBusy(true);
    try {
      await Promise.all([
        ...entries.map((entry) =>
          putAnnotation(detail.trace_id, entry.score_config_id, entry.value),
        ),
        putTraceMemo(detail.trace_id, memo),
      ]);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (scoreConfigId: string) => {
    setBusy(true);
    try {
      await deleteAnnotation(detail.trace_id, scoreConfigId);
      setSelectedScoreIds((current) =>
        current.filter((scoreId) => scoreId !== scoreConfigId),
      );
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnnotationEditor
      key={[
        detail.trace_id,
        detail.memo?.updated_at ?? "no-memo",
        ...detail.annotations.map((annotation) => annotation.updated_at),
      ].join(":")}
      scores={selectedScores}
      detail={detail}
      readOnly={false}
      actionLabel="저장"
      busy={busy}
      onSubmit={save}
      onDelete={remove}
      addableScores={addableScores}
      onAddScore={(scoreConfigId) =>
        setSelectedScoreIds((current) => [...current, scoreConfigId])
      }
    />
  );
}

function buildScoreRequest(
  name: string,
  description: string,
  dataType: ScoreDataType,
  booleanTrueLabel: string,
  booleanFalseLabel: string,
  numberMin: string,
  numberMax: string,
  selectionMode: "single" | "multiple",
  optionText: string,
): ScoreCreateRequest {
  const common = {
    name,
    description: description === "" ? null : description,
    data_type: dataType,
  } satisfies ScoreCreateRequest;
  if (dataType === "boolean") {
    return {
      ...common,
      boolean_true_label: booleanTrueLabel,
      boolean_false_label: booleanFalseLabel,
    };
  }
  if (dataType === "number") {
    return {
      ...common,
      number_min: numberMin === "" ? null : Number(numberMin),
      number_max: numberMax === "" ? null : Number(numberMax),
    };
  }
  return {
    ...common,
    categorical_selection_mode: selectionMode,
    options: optionText
      .split("\n")
      .map((label) => label.trim())
      .filter((label) => label !== "")
      .map((label) => ({ label })),
  };
}

function buildScorePatch(
  request: ScoreCreateRequest,
  isUsed: boolean,
): Partial<ScoreCreateRequest> {
  const common: Partial<ScoreCreateRequest> = {
    name: request.name,
    description: request.description,
  };
  if (isUsed) {
    return common;
  }
  if (request.data_type === "boolean") {
    return {
      ...common,
      boolean_true_label: request.boolean_true_label,
      boolean_false_label: request.boolean_false_label,
    };
  }
  if (request.data_type === "number") {
    return {
      ...common,
      number_min: request.number_min,
      number_max: request.number_max,
    };
  }
  return {
    ...common,
    categorical_selection_mode: request.categorical_selection_mode,
    options: request.options,
  };
}

export function ScoresView() {
  const [scores, setScores] = useState<ScoreConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingScore, setEditingScore] = useState<ScoreConfig | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataType, setDataType] = useState<ScoreDataType>("boolean");
  const [booleanTrueLabel, setBooleanTrueLabel] = useState("Success");
  const [booleanFalseLabel, setBooleanFalseLabel] = useState("Failure");
  const [numberMin, setNumberMin] = useState("");
  const [numberMax, setNumberMax] = useState("");
  const [selectionMode, setSelectionMode] = useState<"single" | "multiple">(
    "single",
  );
  const [optionText, setOptionText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refresh = () =>
    getScores(true).then((response) => {
      setScores(response.items);
      setLoading(false);
    });

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (statusMessage === null) {
      return;
    }
    const timeoutId = window.setTimeout(() => setStatusMessage(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setDataType("boolean");
    setBooleanTrueLabel("Success");
    setBooleanFalseLabel("Failure");
    setNumberMin("");
    setNumberMax("");
    setSelectionMode("single");
    setOptionText("");
  };

  const openCreateDialog = () => {
    resetForm();
    setEditingScore(null);
    setError(false);
    setCreateOpen(true);
  };

  const openEditDialog = (score: ScoreConfig) => {
    setEditingScore(score);
    setName(score.name);
    setDescription(score.description ?? "");
    setDataType(score.data_type);
    setBooleanTrueLabel(score.boolean_true_label ?? "True");
    setBooleanFalseLabel(score.boolean_false_label ?? "False");
    setNumberMin(score.number_min?.toString() ?? "");
    setNumberMax(score.number_max?.toString() ?? "");
    setSelectionMode(score.categorical_selection_mode ?? "single");
    setOptionText(score.options.map((option) => option.label).join("\n"));
    setError(false);
    setCreateOpen(true);
  };

  const closeScoreDialog = () => {
    if (!pending) {
      setCreateOpen(false);
      setEditingScore(null);
    }
  };

  const saveScore = async () => {
    setPending(true);
    setError(false);
    try {
      const request = buildScoreRequest(
        name.trim(),
        description.trim(),
        dataType,
        booleanTrueLabel.trim(),
        booleanFalseLabel.trim(),
        numberMin,
        numberMax,
        selectionMode,
        optionText,
      );
      if (editingScore === null) {
        await createScore(request);
      } else {
        await updateScore(
          editingScore.score_config_id,
          buildScorePatch(request, editingScore.is_used),
        );
      }
      await refresh();
      setCreateOpen(false);
      setEditingScore(null);
      resetForm();
      setStatusMessage(
        editingScore === null
          ? "Score를 만들었습니다."
          : "Score 변경을 저장했습니다.",
      );
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  const removeOrArchive = async (score: ScoreConfig) => {
    const confirmed = score.is_used
      ? window.confirm(
          `'${score.name}' Score를 보관할까요? 기존 annotation은 유지됩니다.`,
        )
      : window.confirm(`'${score.name}' Score를 영구 삭제할까요?`);
    if (!confirmed) {
      return;
    }
    try {
      if (score.is_used) {
        await archiveScore(score.score_config_id);
      } else {
        await deleteScore(score.score_config_id);
      }
      await refresh();
      setStatusMessage(
        score.is_used ? "Score를 보관했습니다." : "Score를 영구 삭제했습니다.",
      );
    } catch {
      setStatusMessage("Score 작업을 완료하지 못했습니다.");
    }
  };

  const filteredScores = scores.filter((score) => {
    const searchText = `${score.name} ${score.description ?? ""}`.toLowerCase();
    return searchText.includes(query.trim().toLowerCase());
  });

  const scoreTypeLabel = (score: ScoreConfig) => {
    if (score.data_type !== "categorical") {
      return score.data_type;
    }
    return `categorical · ${score.categorical_selection_mode}`;
  };

  const scoreValues = (score: ScoreConfig) => {
    if (score.data_type === "boolean") {
      return `${score.boolean_true_label ?? "True"} / ${score.boolean_false_label ?? "False"}`;
    }
    if (score.data_type === "number") {
      if (score.number_min === null && score.number_max === null) {
        return "제한 없음";
      }
      return `${score.number_min ?? "−∞"} – ${score.number_max ?? "∞"}`;
    }
    return score.options.map((option) => option.label).join(", ");
  };

  return (
    <main className="management-page scores-page">
      <header className="management-header">
        <h1>Scores</h1>
      </header>

      <section className="management-surface" aria-label="Score 목록">
        <div className="management-toolbar">
          <button
            className="primary-button toolbar-primary"
            type="button"
            onClick={openCreateDialog}
          >
            <span aria-hidden="true" className="button-plus">
              +
            </span>
            New Score
          </button>
          <label className="management-search">
            <span aria-hidden="true" className="search-icon" />
            <input
              aria-label="Score 검색"
              placeholder="Search by name..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="management-count">{filteredScores.length}개</span>
        </div>

        {loading ? (
          <div className="management-state">Scores를 불러오는 중…</div>
        ) : scores.length === 0 ? (
          <div className="management-empty">
            <strong>아직 Score가 없습니다.</strong>
            <button
              className="secondary-button"
              type="button"
              onClick={openCreateDialog}
            >
              첫 Score 만들기
            </button>
          </div>
        ) : filteredScores.length === 0 ? (
          <div className="management-empty">
            <strong>검색 결과가 없습니다.</strong>
            <p>다른 이름으로 검색해 보세요.</p>
          </div>
        ) : (
          <div className="management-table-scroll">
            <table className="management-table score-table">
              <thead>
                <tr>
                  <th scope="col">Score</th>
                  <th scope="col">타입</th>
                  <th scope="col">값</th>
                  <th scope="col">상태</th>
                  <th scope="col" className="actions-column">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredScores.map((score) => (
                  <tr key={score.score_config_id}>
                    <td data-label="Score">
                      <span className="score-name-chip">
                        <span aria-hidden="true" />
                        <strong>{score.name}</strong>
                      </span>
                      {score.description !== null && (
                        <small>{score.description}</small>
                      )}
                    </td>
                    <td data-label="타입">{scoreTypeLabel(score)}</td>
                    <td data-label="값" className="score-values">
                      {scoreValues(score)}
                    </td>
                    <td data-label="상태">
                      <span
                        className="lifecycle-status"
                        data-archived={score.archived_at !== null}
                      >
                        {score.archived_at === null ? "사용 중" : "보관됨"}
                      </span>
                    </td>
                    <td data-label="작업">
                      <div className="row-actions">
                        <OverflowMenu
                          label={`${score.name} actions`}
                          actions={[
                            {
                              label: "수정",
                              icon: "edit",
                              onSelect: () => openEditDialog(score),
                            },
                            ...(score.archived_at === null
                              ? [
                                  {
                                    label: score.is_used ? "보관" : "영구 삭제",
                                    icon: score.is_used
                                      ? ("archive" as const)
                                      : ("trash" as const),
                                    danger: !score.is_used,
                                    onSelect: () => void removeOrArchive(score),
                                  },
                                ]
                              : []),
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

      {statusMessage !== null && (
        <div className="management-toast" role="status" aria-live="polite">
          {statusMessage}
        </div>
      )}

      {createOpen && (
        <ManagementDialog
          title={editingScore === null ? "New Score" : "Edit Score"}
          titleId="score-dialog-title"
          onClose={closeScoreDialog}
        >
          <form
            className="management-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveScore();
            }}
          >
            <label>
              <span>Score 이름</span>
              <input
                aria-label="Score 이름"
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: Success"
              />
            </label>
            <label>
              <span>설명</span>
              <input
                aria-label="설명"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              <span>타입</span>
              <select
                aria-label="타입"
                value={dataType}
                disabled={editingScore !== null}
                onChange={(event) =>
                  setDataType(event.target.value as ScoreDataType)
                }
              >
                <option value="boolean">Boolean</option>
                <option value="number">Number</option>
                <option value="categorical">Categorical</option>
              </select>
            </label>
            {dataType === "boolean" && (
              <div className="inline-fields">
                <label>
                  <span>True label</span>
                  <input
                    required
                    disabled={editingScore?.is_used === true}
                    value={booleanTrueLabel}
                    onChange={(event) =>
                      setBooleanTrueLabel(event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>False label</span>
                  <input
                    required
                    disabled={editingScore?.is_used === true}
                    value={booleanFalseLabel}
                    onChange={(event) =>
                      setBooleanFalseLabel(event.target.value)
                    }
                  />
                </label>
              </div>
            )}
            {dataType === "number" && (
              <div className="inline-fields">
                <label>
                  <span>Minimum</span>
                  <input
                    type="number"
                    step="any"
                    disabled={editingScore?.is_used === true}
                    value={numberMin}
                    onChange={(event) => setNumberMin(event.target.value)}
                  />
                </label>
                <label>
                  <span>Maximum</span>
                  <input
                    type="number"
                    step="any"
                    disabled={editingScore?.is_used === true}
                    value={numberMax}
                    onChange={(event) => setNumberMax(event.target.value)}
                  />
                </label>
              </div>
            )}
            {dataType === "categorical" && (
              <>
                <label>
                  <span>선택 방식</span>
                  <select
                    disabled={editingScore?.is_used === true}
                    value={selectionMode}
                    onChange={(event) =>
                      setSelectionMode(
                        event.target.value as "single" | "multiple",
                      )
                    }
                  >
                    <option value="single">Single</option>
                    <option value="multiple">Multiple</option>
                  </select>
                </label>
                <label>
                  <span>Options · 한 줄에 하나</span>
                  <textarea
                    required
                    rows={5}
                    disabled={editingScore?.is_used === true}
                    value={optionText}
                    onChange={(event) => setOptionText(event.target.value)}
                    placeholder={"Retrieval\nHallucination\nNone"}
                  />
                </label>
              </>
            )}
            {editingScore?.is_used === true && (
              <p className="management-form-note">
                사용 중인 Score는 이름과 설명만 수정할 수 있습니다.
              </p>
            )}
            <button className="primary-button" type="submit" disabled={pending}>
              {pending
                ? "저장 중…"
                : editingScore === null
                  ? "Score 생성"
                  : "변경 저장"}
            </button>
            {error && (
              <p className="annotation-error" role="alert">
                Score를 저장하지 못했습니다. 입력값을 확인해 주세요.
              </p>
            )}
          </form>
        </ManagementDialog>
      )}
    </main>
  );
}

function QueueReview({
  queue,
  item,
  scores,
  onChanged,
  onCompleted,
}: {
  queue: AnnotationQueue;
  item: AnnotationQueueItem;
  scores: ScoreConfig[];
  onChanged: () => Promise<unknown>;
  onCompleted: () => Promise<unknown>;
}) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [payloadState, setPayloadState] = useState<LoadState<Observation>>({
    status: "idle",
  });
  const [selectedObservationId, setSelectedObservationId] = useState<
    string | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getTrace(item.trace_id, controller.signal)
      .then((nextDetail) => {
        setDetail(nextDetail);
        const root = nextDetail.observations.find(
          (observation) => observation.parent_observation_id === null,
        );
        if (root !== undefined) {
          setSelectedObservationId(root.observation_id);
          setPayloadState({ status: "loading" });
          void getObservation(root.observation_id, controller.signal)
            .then((payload) => {
              setPayloadState({ status: "success", data: payload });
            })
            .catch((error: unknown) => {
              if (!isAbortError(error)) {
                setPayloadState({ status: "error" });
              }
            });
        }
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setLoadError(true);
        }
      });
    return () => controller.abort();
  }, [item.trace_id]);

  const selectedScores = useMemo(
    () =>
      queue.score_config_ids.flatMap((scoreId) => {
        const score = scores.find(
          (candidate) => candidate.score_config_id === scoreId,
        );
        return score === undefined ? [] : [score];
      }),
    [queue.score_config_ids, scores],
  );

  if (loadError) {
    return (
      <div className="management-empty" role="alert">
        <strong>Trace를 불러오지 못했습니다.</strong>
        <p>서버 상태를 확인한 뒤 queue를 다시 열어 주세요.</p>
      </div>
    );
  }

  if (detail === null) {
    return <p>Trace를 불러오는 중…</p>;
  }

  const complete = async (entries: AnnotationEntry[], memo: string) => {
    setBusy(true);
    try {
      await completeAnnotationQueueItem(
        queue.annotation_queue_id,
        item.annotation_queue_item_id,
        entries,
        memo,
      );
      await onCompleted();
    } finally {
      setBusy(false);
    }
  };

  const edit = async () => {
    setBusy(true);
    try {
      await editAnnotationQueueItem(
        queue.annotation_queue_id,
        item.annotation_queue_item_id,
      );
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const selectObservation = async (observationId: string) => {
    setSelectedObservationId(observationId);
    setPayloadState({ status: "loading" });
    try {
      const payload = await getObservation(observationId);
      setPayloadState({ status: "success", data: payload });
    } catch {
      setPayloadState({ status: "error" });
    }
  };

  const retryObservation = () => {
    if (selectedObservationId !== null) {
      void selectObservation(selectedObservationId);
    }
  };

  const selectedObservation =
    detail.observations.find(
      (observation) => observation.observation_id === selectedObservationId,
    ) ?? null;

  return (
    <div className="queue-review">
      <header className="queue-review-header">
        <div>
          <p className="eyebrow">Queue review</p>
          <h2>{detail.name}</h2>
        </div>
        <span className={`queue-status ${item.status}`}>
          {queueItemStatusLabel(item.status)}
        </span>
      </header>
      <div className="queue-execution-grid">
        <div className="graph-panel">
          <RuntimeExecutionGraph
            observations={detail.observations}
            selectedObservationId={selectedObservationId}
            onSelect={(observationId) => void selectObservation(observationId)}
          />
        </div>
        <ObservationInspector
          selectedObservation={selectedObservation}
          payloadState={payloadState}
          onRetry={retryObservation}
        />
      </div>
      <AnnotationEditor
        scores={selectedScores}
        detail={detail}
        readOnly={item.status === "completed"}
        actionLabel={
          queue.items.some(
            (candidate) =>
              candidate.annotation_queue_item_id !==
                item.annotation_queue_item_id && candidate.status === "pending",
          )
            ? "완료 후 다음"
            : "완료"
        }
        busy={busy}
        onSubmit={complete}
        onEdit={edit}
      />
    </div>
  );
}

export function AnnotationQueuesView() {
  const [queues, setQueues] = useState<AnnotationQueue[]>([]);
  const [scores, setScores] = useState<ScoreConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedScoreIds, setSelectedScoreIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refresh = async () => {
    const response = await getAnnotationQueues();
    setQueues(response.items);
    return response.items;
  };

  useEffect(() => {
    void Promise.all([getAnnotationQueues(), getScores(true)])
      .then(([queueResponse, scoreResponse]) => {
        setQueues(queueResponse.items);
        setScores(scoreResponse.items);
        setLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (statusMessage === null) {
      return;
    }
    const timeoutId = window.setTimeout(() => setStatusMessage(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  const selectedQueue =
    queues.find((queue) => queue.annotation_queue_id === selectedQueueId) ??
    null;
  const selectedItem =
    selectedQueue?.items.find(
      (item) => item.annotation_queue_item_id === selectedItemId,
    ) ?? null;

  const create = async () => {
    setPending(true);
    try {
      const queue = await createAnnotationQueue({
        name,
        description: description === "" ? null : description,
        score_config_ids: selectedScoreIds,
        trace_ids: [],
      });
      await refresh();
      setSelectedQueueId(queue.annotation_queue_id);
      setSelectedItemId(queue.items[0]?.annotation_queue_item_id ?? null);
      setName("");
      setDescription("");
      setSelectedScoreIds([]);
      setCreateOpen(false);
      setStatusMessage("Queue를 만들었습니다.");
    } catch {
      setStatusMessage("Queue를 만들지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const removeQueue = async (queueId: string) => {
    if (
      !window.confirm("이 queue를 삭제할까요? Trace annotation은 유지됩니다.")
    ) {
      return;
    }
    try {
      await deleteAnnotationQueue(queueId);
      if (selectedQueueId === queueId) {
        setSelectedQueueId(null);
        setSelectedItemId(null);
      }
      await refresh();
      setStatusMessage("Queue를 삭제했습니다.");
    } catch {
      setStatusMessage("Queue를 삭제하지 못했습니다.");
    }
  };

  const toggleQueueScore = async (
    queue: AnnotationQueue,
    scoreConfigId: string,
    checked: boolean,
  ) => {
    const next = checked
      ? [...queue.score_config_ids, scoreConfigId]
      : queue.score_config_ids.filter((item) => item !== scoreConfigId);
    await updateAnnotationQueue(queue.annotation_queue_id, {
      score_config_ids: next,
    });
    await refresh();
  };

  const removeItemFromQueue = async (
    queue: AnnotationQueue,
    item: AnnotationQueueItem,
  ) => {
    if (
      !window.confirm(
        `'${item.trace_name}' Trace를 이 Queue에서 제거할까요? Annotation은 유지됩니다.`,
      )
    ) {
      return;
    }
    try {
      await deleteAnnotationQueueItem(
        queue.annotation_queue_id,
        item.annotation_queue_item_id,
      );
      if (selectedItemId === item.annotation_queue_item_id) {
        setSelectedItemId(null);
      }
      await refresh();
      setStatusMessage("Trace를 Queue에서 제거했습니다.");
    } catch {
      setStatusMessage("Trace를 Queue에서 제거하지 못했습니다.");
    }
  };

  const filteredQueues = queues.filter((queue) => {
    const searchText = `${queue.name} ${queue.description ?? ""}`.toLowerCase();
    return searchText.includes(query.trim().toLowerCase());
  });

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));

  if (selectedQueue !== null) {
    const completed = selectedQueue.items.filter(
      (item) => item.status === "completed",
    ).length;

    return (
      <main className="management-page queue-detail-page">
        <nav className="management-breadcrumb" aria-label="Queue 위치">
          <button
            type="button"
            aria-label="Queue 목록으로"
            onClick={() => {
              setSelectedQueueId(null);
              setSelectedItemId(null);
              setSettingsOpen(false);
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Annotation Queues
          </button>
          <span aria-hidden="true">/</span>
          <strong>{selectedQueue.name}</strong>
        </nav>

        <header className="queue-detail-heading">
          <div>
            <h1>{selectedQueue.name}</h1>
            {selectedQueue.description !== null && (
              <p>{selectedQueue.description}</p>
            )}
          </div>
          <div className="queue-detail-actions">
            <span>
              완료 {completed} / {selectedQueue.items.length}
            </span>
            <button
              className="secondary-button"
              type="button"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((current) => !current)}
            >
              Queue settings
            </button>
          </div>
        </header>

        {settingsOpen && (
          <section className="queue-settings-panel" aria-label="Queue settings">
            <fieldset>
              <legend>사용할 Scores</legend>
              {scores.map((score) => {
                const selected = selectedQueue.score_config_ids.includes(
                  score.score_config_id,
                );
                return (
                  <label key={score.score_config_id}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!selected && score.archived_at !== null}
                      onChange={(event) =>
                        void toggleQueueScore(
                          selectedQueue,
                          score.score_config_id,
                          event.target.checked,
                        )
                      }
                    />
                    {score.name}
                    {score.archived_at === null ? "" : " (archived)"}
                  </label>
                );
              })}
            </fieldset>
          </section>
        )}

        <div className="queue-detail-layout">
          <aside className="queue-items-panel" aria-label="Queue traces">
            <div className="queue-items-heading">
              <h2>Traces</h2>
              <span>{selectedQueue.items.length}</span>
            </div>
            {selectedQueue.items.length === 0 ? (
              <div className="queue-items-empty">검토할 trace가 없습니다.</div>
            ) : (
              <ul className="queue-item-list">
                {selectedQueue.items.map((item) => (
                  <li key={item.annotation_queue_item_id}>
                    <button
                      type="button"
                      className={
                        item.annotation_queue_item_id === selectedItemId
                          ? "selected"
                          : undefined
                      }
                      onClick={() =>
                        setSelectedItemId(item.annotation_queue_item_id)
                      }
                    >
                      <span>{item.trace_name}</span>
                      <small>{queueItemStatusLabel(item.status)}</small>
                    </button>
                    <OverflowMenu
                      label={`${item.trace_name} actions`}
                      actions={[
                        {
                          label: "Queue에서 제거",
                          icon: "trash",
                          danger: true,
                          onSelect: () =>
                            void removeItemFromQueue(selectedQueue, item),
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="queue-review-workspace" aria-label="Queue review">
            {selectedItem === null ? (
              <div className="detail-placeholder">
                <h2>검토할 trace를 선택하세요</h2>
              </div>
            ) : (
              <QueueReview
                key={`${selectedQueue.annotation_queue_id}:${selectedItem.annotation_queue_item_id}:${selectedItem.updated_at}`}
                queue={selectedQueue}
                item={selectedItem}
                scores={scores}
                onChanged={refresh}
                onCompleted={async () => {
                  const updatedQueues = await refresh();
                  const updatedQueue = updatedQueues.find(
                    (queue) =>
                      queue.annotation_queue_id ===
                      selectedQueue.annotation_queue_id,
                  );
                  const nextItem = updatedQueue?.items.find(
                    (item) =>
                      item.annotation_queue_item_id !== selectedItemId &&
                      item.status === "pending",
                  );
                  if (nextItem !== undefined) {
                    setSelectedItemId(nextItem.annotation_queue_item_id);
                  }
                }}
              />
            )}
          </section>
        </div>
        {statusMessage !== null && (
          <div className="management-toast" role="status" aria-live="polite">
            {statusMessage}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="management-page queue-page">
      <header className="management-header">
        <h1>Annotation Queues</h1>
      </header>

      <section
        className="management-surface"
        aria-label="Annotation Queue 목록"
      >
        <div className="management-toolbar">
          <button
            className="primary-button toolbar-primary"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            <span aria-hidden="true" className="button-plus">
              +
            </span>
            New Queue
          </button>
          <label className="management-search">
            <span aria-hidden="true" className="search-icon" />
            <input
              aria-label="Queue 검색"
              placeholder="Search by name..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="management-count">{filteredQueues.length}개</span>
        </div>

        {loading ? (
          <div className="management-state">Queues를 불러오는 중…</div>
        ) : loadError ? (
          <div className="management-empty" role="alert">
            <strong>Queues를 불러오지 못했습니다.</strong>
            <p>서버 상태를 확인한 뒤 다시 열어 주세요.</p>
          </div>
        ) : queues.length === 0 ? (
          <div className="management-empty">
            <strong>아직 Annotation Queue가 없습니다.</strong>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setCreateOpen(true)}
            >
              첫 Queue 만들기
            </button>
          </div>
        ) : filteredQueues.length === 0 ? (
          <div className="management-empty">
            <strong>검색 결과가 없습니다.</strong>
            <p>다른 이름으로 검색해 보세요.</p>
          </div>
        ) : (
          <div className="management-table-scroll">
            <table className="management-table queue-table">
              <thead>
                <tr>
                  <th scope="col">이름</th>
                  <th scope="col">Traces</th>
                  <th scope="col">Scores</th>
                  <th scope="col">진행</th>
                  <th scope="col">수정일</th>
                  <th scope="col" className="actions-column">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredQueues.map((queue) => {
                  const completed = queue.items.filter(
                    (item) => item.status === "completed",
                  ).length;
                  return (
                    <tr key={queue.annotation_queue_id}>
                      <td data-label="이름">
                        <button
                          className="table-name-button"
                          type="button"
                          onClick={() => {
                            setSelectedQueueId(queue.annotation_queue_id);
                            setSelectedItemId(
                              queue.items[0]?.annotation_queue_item_id ?? null,
                            );
                          }}
                        >
                          {queue.name}
                        </button>
                        {queue.description !== null && (
                          <small>{queue.description}</small>
                        )}
                      </td>
                      <td data-label="Traces">{queue.items.length}</td>
                      <td data-label="Scores">
                        {queue.score_config_ids.length}
                      </td>
                      <td data-label="진행">
                        <span className="queue-progress">
                          완료 {completed} / {queue.items.length}
                        </span>
                      </td>
                      <td data-label="수정일">
                        {formatDate(queue.updated_at)}
                      </td>
                      <td data-label="작업">
                        <div className="row-actions">
                          <OverflowMenu
                            label={`${queue.name} actions`}
                            actions={[
                              {
                                label: "영구 삭제",
                                icon: "trash",
                                danger: true,
                                onSelect: () =>
                                  void removeQueue(queue.annotation_queue_id),
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

      {statusMessage !== null && (
        <div className="management-toast" role="status" aria-live="polite">
          {statusMessage}
        </div>
      )}

      {createOpen && (
        <ManagementDialog
          title="New Queue"
          titleId="new-queue-title"
          className="queue-create-dialog"
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
              void create();
            }}
          >
            <label>
              <span>Queue 이름</span>
              <input
                aria-label="Queue 이름"
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>설명</span>
              <input
                aria-label="설명"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <fieldset>
              <legend>Scores</legend>
              {scores
                .filter((score) => score.archived_at === null)
                .map((score) => (
                  <label key={score.score_config_id}>
                    <input
                      type="checkbox"
                      checked={selectedScoreIds.includes(score.score_config_id)}
                      onChange={(event) =>
                        setSelectedScoreIds((current) =>
                          event.target.checked
                            ? [...current, score.score_config_id]
                            : current.filter(
                                (item) => item !== score.score_config_id,
                              ),
                        )
                      }
                    />
                    {score.name}
                  </label>
                ))}
            </fieldset>
            <button className="primary-button" type="submit" disabled={pending}>
              Queue 생성
            </button>
          </form>
        </ManagementDialog>
      )}
    </main>
  );
}

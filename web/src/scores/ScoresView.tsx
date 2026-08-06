import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  archiveScore,
  createScore,
  deleteScore,
  getScores,
  updateScore,
} from "../api/client";
import type {
  ScoreConfig,
  ScoreCreateRequest,
  ScoreDataType,
} from "../api/types";
import {
  ColumnHeaderCell,
  EmptyBlock,
  ErrorBlock,
  IconClose,
  LoadingBlock,
  Modal,
  SelectColGroup,
  deferState,
  sortRows,
  type ReorderableColumnDef,
  useReorderableColumns,
} from "../components";
import { useT } from "../i18n/context";

type LoadState = "loading" | "success" | "error";

const SCORE_COLUMNS: ReorderableColumnDef[] = [
  { id: "name", label: "Score", width: 275 },
  { id: "type", label: "Type", width: 188 },
  { id: "value", label: "Value", width: 350 },
  { id: "state", label: "Status", width: 138 },
  { id: "description", label: "Description", width: 325 },
];

function scoreValueText(score: ScoreConfig): string {
  if (score.data_type === "boolean")
    return `${score.boolean_true_label ?? "True"} / ${score.boolean_false_label ?? "False"}`;
  if (score.data_type === "number")
    return `${score.number_min ?? "−∞"} – ${score.number_max ?? "∞"}`;
  return score.options.map((option) => option.label).join(", ");
}

const SCORE_SORT_VALUES: Record<
  string,
  (score: ScoreConfig) => string | number
> = {
  name: (score) => score.name,
  type: (score) => score.data_type,
  value: (score) => scoreValueText(score),
  state: (score) => (score.archived_at ? 1 : 0),
  description: (score) => score.description ?? "",
};

type FormState = {
  name: string;
  description: string;
  dataType: ScoreDataType;
  trueLabel: string;
  falseLabel: string;
  min: string;
  max: string;
  mode: "single" | "multiple";
  options: string[];
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  dataType: "boolean",
  trueLabel: "Success",
  falseLabel: "Failure",
  min: "",
  max: "",
  mode: "single",
  options: ["좋음", "보통"],
};

function fromScore(score: ScoreConfig): FormState {
  return {
    name: score.name,
    description: score.description ?? "",
    dataType: score.data_type,
    trueLabel: score.boolean_true_label ?? "Success",
    falseLabel: score.boolean_false_label ?? "Failure",
    min: score.number_min?.toString() ?? "",
    max: score.number_max?.toString() ?? "",
    mode: score.categorical_selection_mode ?? "single",
    options: score.options.map((option) => option.label),
  };
}

function payload(form: FormState): ScoreCreateRequest {
  const base: ScoreCreateRequest = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    data_type: form.dataType,
  };
  if (form.dataType === "boolean")
    return {
      ...base,
      boolean_true_label: form.trueLabel || null,
      boolean_false_label: form.falseLabel || null,
    };
  if (form.dataType === "number")
    return {
      ...base,
      number_min: form.min === "" ? null : Number(form.min),
      number_max: form.max === "" ? null : Number(form.max),
    };
  return {
    ...base,
    categorical_selection_mode: form.mode,
    options: form.options.filter(Boolean).map((label) => ({ label })),
  };
}

export function ScoresView() {
  const t = useT();
  const [scores, setScores] = useState<ScoreConfig[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScoreConfig | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const columns = useReorderableColumns(SCORE_COLUMNS);

  useEffect(() => {
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setState("loading");
      setError("");
    });
    void getScores(true, controller.signal)
      .then((response) => {
        setScores(response.items);
        setState("success");
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof Error && reason.name === "AbortError")) {
          setState("error");
          setError("Score 목록을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, [retry]);

  const visible = scores.filter((score) =>
    `${score.name} ${score.description ?? ""} ${score.data_type}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const sortedVisible = useMemo(
    () => sortRows(visible, columns.sort, SCORE_SORT_VALUES),
    [visible, columns.sort],
  );
  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMutationError("");
    setFormOpen(true);
  };
  const openEdit = (score: ScoreConfig) => {
    setEditing(score);
    setForm(fromScore(score));
    setMutationError("");
    setFormOpen(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setPending(true);
    setMutationError("");
    try {
      const request = payload(form);
      const saved = editing
        ? await updateScore(
            editing.score_config_id,
            editing.is_used
              ? { name: request.name, description: request.description }
              : request,
          )
        : await createScore(request);
      setScores((items) =>
        editing
          ? items.map((score) =>
              score.score_config_id === saved.score_config_id ? saved : score,
            )
          : [saved, ...items],
      );
      setFormOpen(false);
    } catch {
      setMutationError("Score를 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };
  const removeOrArchiveBulk = async () => {
    setBulkPending(true);
    setMutationError("");
    try {
      const targets = scores.filter((score) =>
        selectedIds.includes(score.score_config_id),
      );
      await Promise.all(
        targets.map((score) =>
          score.is_used || score.has_annotations
            ? archiveScore(score.score_config_id)
            : deleteScore(score.score_config_id),
        ),
      );
      const archivedIds = new Set(
        targets
          .filter((score) => score.is_used || score.has_annotations)
          .map((score) => score.score_config_id),
      );
      const deletedIds = new Set(
        targets
          .filter((score) => !(score.is_used || score.has_annotations))
          .map((score) => score.score_config_id),
      );
      setScores((items) =>
        items
          .filter((score) => !deletedIds.has(score.score_config_id))
          .map((score) =>
            archivedIds.has(score.score_config_id)
              ? {
                  ...score,
                  archived_at: score.archived_at ?? new Date().toISOString(),
                }
              : score,
          ),
      );
      setSelectedIds([]);
      setBulkConfirmOpen(false);
    } catch {
      setMutationError("선택한 Score를 처리하지 못했습니다.");
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <main className="page scores-page" id="lf-main" tabIndex={-1}>
      <h1>Scores</h1>
      <div className="scores-toolbar">
        <button className="lf-btn is-primary" type="button" onClick={openNew}>
          + New Score
        </button>
        <input
          className="search"
          type="search"
          aria-label={t("Score 검색")}
          value={search}
          placeholder={t("Score 검색")}
          onChange={(event) => setSearch(event.target.value)}
        />
        {selectedIds.length ? (
          <div className="bulk-actions">
            {selectedIds.length === 1 ? (
              <button
                className="lf-btn"
                type="button"
                onClick={() => {
                  const score = scores.find(
                    (item) => item.score_config_id === selectedIds[0],
                  );
                  if (score) openEdit(score);
                }}
              >
                Edit
              </button>
            ) : null}
            <button
              className="lf-btn is-danger"
              type="button"
              onClick={() => setBulkConfirmOpen(true)}
            >
              Delete ({selectedIds.length})
            </button>
          </div>
        ) : null}
        <span className="count">{t("{n}개", {n: visible.length})}</span>
      </div>
      {mutationError && !formOpen ? (
        <p className="mutation-status is-error">{t(mutationError)}</p>
      ) : null}
      <div className="table-shell">
        {state === "loading" ? (
          <LoadingBlock label={t("Scores를 불러오는 중…")} />
        ) : state === "error" ? (
          <ErrorBlock
            message={t(error)}
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : visible.length === 0 ? (
          <EmptyBlock>{t("검색 결과가 없습니다.")}</EmptyBlock>
        ) : (
          <table>
            <SelectColGroup columns={columns} />
            <thead>
              <tr>
                <th className="select-col">
                  <input
                    type="checkbox"
                    aria-label={t("모든 score 선택")}
                    checked={
                      visible.length > 0 &&
                      visible.every((score) =>
                        selectedIds.includes(score.score_config_id),
                      )
                    }
                    onChange={(event) =>
                      setSelectedIds(
                        event.target.checked
                          ? visible.map((score) => score.score_config_id)
                          : [],
                      )
                    }
                  />
                </th>
                {columns.order.map((id) => {
                  const def = SCORE_COLUMNS.find((c) => c.id === id)!;
                  return (
                    <ColumnHeaderCell
                      key={id}
                      id={id}
                      label={def.label}
                      columns={columns}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedVisible.map((score) => {
                const cell: Record<string, ReactNode> = {
                  name: <span className="score-name">{score.name}</span>,
                  type: (
                    <>
                      {score.data_type}
                      {score.data_type === "categorical"
                        ? ` · ${score.categorical_selection_mode}`
                        : ""}
                    </>
                  ),
                  value: scoreValueText(score),
                  state: (
                    <span
                      className={`score-state${score.archived_at ? " is-archived" : ""}`}
                    >
                      {score.archived_at ? t("보관됨") : t("사용 중")}
                    </span>
                  ),
                  description: score.description ?? "",
                };
                const cellClass: Record<string, string> = {
                  type: "type",
                  value: "value",
                  description: "payload",
                };
                return (
                  <tr key={score.score_config_id}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        aria-label={t("{name} 선택", {name: score.name})}
                        checked={selectedIds.includes(score.score_config_id)}
                        onChange={(event) =>
                          setSelectedIds((ids) =>
                            event.target.checked
                              ? [...ids, score.score_config_id]
                              : ids.filter(
                                  (id) => id !== score.score_config_id,
                                ),
                          )
                        }
                      />
                    </td>
                    {columns.order.map((id) => (
                      <td key={id} className={cellClass[id]}>
                        {cell[id]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Modal
        open={formOpen}
        title={editing ? "Edit Score" : "New Score"}
        onClose={() => !pending && setFormOpen(false)}
        className="score-modal"
      >
        <form className="lf-modal-body" onSubmit={(event) => void save(event)}>
          <label className="modal-field">
            {t("Score 이름")}
            <input
              autoFocus
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder={t("예: Success")}
            />
          </label>
          <label className="modal-field">
            {t("설명")}
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
          <label className="modal-field">
            {t("타입")}
            <select
              disabled={editing?.is_used}
              value={form.dataType}
              onChange={(event) =>
                setForm({
                  ...form,
                  dataType: event.target.value as ScoreDataType,
                })
              }
            >
              <option value="boolean">Boolean</option>
              <option value="number">Number</option>
              <option value="categorical">Categorical</option>
            </select>
          </label>
          {!editing?.is_used ? (
            <ScoreConfigFields form={form} setForm={setForm} />
          ) : (
            <p className="field-note">
              {t("이미 사용된 score는 이름과 설명만 수정할 수 있습니다.")}
            </p>
          )}
          {mutationError ? (
            <p className="mutation-status is-error" role="alert">
              {t(mutationError)}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={pending}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-primary"
              type="submit"
              disabled={pending}
            >
              {pending ? t("저장 중…") : editing ? t("수정") : t("Score 생성")}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={bulkConfirmOpen}
        title={t("Score를 삭제할까요? ({n})", {n: selectedIds.length})}
        onClose={() => {
          if (!bulkPending) setBulkConfirmOpen(false);
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            {t(
              "아직 사용되지 않은 score는 영구 삭제됩니다. 이미 사용 중이거나 annotation이 있는 score는 기존 annotation의 의미를 보존하기 위해 대신 보관 처리됩니다.",
            )}
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={bulkPending}
              onClick={() => setBulkConfirmOpen(false)}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={bulkPending}
              onClick={() => void removeOrArchiveBulk()}
            >
              {bulkPending ? t("처리 중…") : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

function ScoreConfigFields({
  form,
  setForm,
}: {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
}) {
  const t = useT();
  if (form.dataType === "boolean")
    return (
      <div className="two-fields">
        <label className="modal-field">
          True label
          <input
            value={form.trueLabel}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                trueLabel: event.target.value,
              }))
            }
          />
        </label>
        <label className="modal-field">
          False label
          <input
            value={form.falseLabel}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                falseLabel: event.target.value,
              }))
            }
          />
        </label>
      </div>
    );
  if (form.dataType === "number")
    return (
      <div className="two-fields">
        <label className="modal-field">
          Minimum
          <input
            type="number"
            value={form.min}
            placeholder={t("선택 사항")}
            onChange={(event) =>
              setForm((current) => ({ ...current, min: event.target.value }))
            }
          />
        </label>
        <label className="modal-field">
          Maximum
          <input
            type="number"
            value={form.max}
            placeholder={t("선택 사항")}
            onChange={(event) =>
              setForm((current) => ({ ...current, max: event.target.value }))
            }
          />
        </label>
      </div>
    );
  return (
    <div className="score-config">
      <label className="modal-field">
        {t("선택 방식")}
        <select
          value={form.mode}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              mode: event.target.value as FormState["mode"],
            }))
          }
        >
          <option value="single">single</option>
          <option value="multiple">multiple</option>
        </select>
      </label>
      <div className="option-list">
        {form.options.map((option, index) => (
          <div className="option-row" key={`${index}-${option}`}>
            <input
              aria-label={t("옵션")}
              value={option}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  options: current.options.map((value, position) =>
                    position === index ? event.target.value : value,
                  ),
                }))
              }
            />
            <button
              className="remove-option"
              type="button"
              aria-label={t("옵션 삭제")}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  options: current.options.filter(
                    (_, position) => position !== index,
                  ),
                }))
              }
            >
              <IconClose />
            </button>
          </div>
        ))}
      </div>
      <button
        className="lf-btn"
        type="button"
        onClick={() =>
          setForm((current) => ({
            ...current,
            options: [...current.options, ""],
          }))
        }
      >
        {t("+ 옵션 추가")}
      </button>
    </div>
  );
}

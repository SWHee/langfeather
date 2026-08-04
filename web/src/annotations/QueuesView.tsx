import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  completeAnnotationQueueItem,
  createAnnotationQueue,
  deleteAnnotationQueue,
  deleteAnnotationQueueItem,
  editAnnotationQueueItem,
  getAnnotationQueue,
  getAnnotationQueues,
  getObservation,
  getScores,
  getTrace,
} from "../api/client";
import type {
  AnnotationQueue,
  AnnotationQueueItem,
  AnnotationValue,
  Observation,
  ScoreConfig,
  TraceDetail,
} from "../api/types";
import {
  ColumnHeaderCell,
  EmptyBlock,
  ErrorBlock,
  IconClose,
  JsonCode,
  LIST_PAGE_SIZE,
  LoadingBlock,
  Modal,
  Pagination,
  SelectColGroup,
  deferState,
  formatDuration,
  paginate,
  relativeTime,
  sortRows,
  type ReorderableColumnDef,
  useReorderableColumns,
} from "../components";
import { RuntimeGraphView } from "../graph/RuntimeGraphView";

type QueueLoad = "loading" | "success" | "error";

function abort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function pendingCount(queue: AnnotationQueue): number {
  return queue.items.filter((item) => item.status === "pending").length;
}

function completedCount(queue: AnnotationQueue): number {
  return queue.items.length - pendingCount(queue);
}

const QUEUE_LIST_COLUMNS: ReorderableColumnDef[] = [
  { id: "name", label: "Name", width: 275 },
  { id: "progress", label: "Progress", width: 188 },
  { id: "scores", label: "Scores", width: 275 },
  { id: "updated", label: "Updated At", width: 162 },
  { id: "description", label: "Description", width: 325 },
];

const QUEUE_LIST_SORT_VALUES: Record<
  string,
  (queue: AnnotationQueue) => string | number
> = {
  name: (queue) => queue.name,
  progress: (queue) =>
    queue.items.length === 0 ? 0 : completedCount(queue) / queue.items.length,
  scores: (queue) => queue.score_config_ids.length,
  updated: (queue) => queue.updated_at,
  description: (queue) => queue.description ?? "",
};

const QUEUE_ITEM_COLUMNS: ReorderableColumnDef[] = [
  { id: "status", label: "상태", width: 112 },
  { id: "started", label: "수집", width: 115 },
  { id: "trace_id", label: "Trace ID", width: 212 },
  { id: "input", label: "Input", width: 275 },
  { id: "output", label: "Output", width: 275 },
  { id: "latency", label: "Latency", width: 120 },
];

const QUEUE_ITEM_SORT_VALUES: Record<
  string,
  (item: AnnotationQueueItem) => string | number
> = {
  status: (item) => item.status,
  started: (item) => item.updated_at,
  trace_id: (item) => item.trace_id,
  input: (item) => item.input_preview,
  output: (item) => item.output_preview,
  latency: (item) => item.duration_us,
};

export function QueuesView() {
  const [queues, setQueues] = useState<AnnotationQueue[]>([]);
  const [scores, setScores] = useState<ScoreConfig[]>([]);
  const [loadState, setLoadState] = useState<QueueLoad>("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const queueColumns = useReorderableColumns(QUEUE_LIST_COLUMNS);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const [activeQueue, setActiveQueue] = useState<AnnotationQueue | null>(null);
  const [detailState, setDetailState] = useState<QueueLoad>("success");
  const [detailError, setDetailError] = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scoreIds, setScoreIds] = useState<string[]>([]);
  const [mutationError, setMutationError] = useState("");
  const [pending, setPending] = useState(false);
  const [reviewItem, setReviewItem] = useState<AnnotationQueueItem | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setLoadState("loading");
      setError("");
    });
    void Promise.all([
      getAnnotationQueues(controller.signal),
      getScores(true, controller.signal),
    ])
      .then(([queueResponse, scoreResponse]) => {
        setQueues(queueResponse.items);
        setScores(scoreResponse.items);
        setLoadState("success");
      })
      .catch((reason: unknown) => {
        if (abort(reason)) return;
        setLoadState("error");
        setError("Annotation Queue 목록을 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!activeQueueId) {
      deferState(() => setActiveQueue(null));
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setDetailState("loading");
      setDetailError("");
      setSelectedItems([]);
    });
    void getAnnotationQueue(activeQueueId, controller.signal)
      .then((queue) => {
        setActiveQueue(queue);
        setDetailState("success");
      })
      .catch((reason: unknown) => {
        if (abort(reason)) return;
        setDetailState("error");
        setDetailError("Queue 상세를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [activeQueueId, retry]);

  const scoreById = useMemo(
    () => new Map(scores.map((score) => [score.score_config_id, score])),
    [scores],
  );
  const visible = queues.filter((queue) =>
    `${queue.name} ${queue.description ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const sortedVisible = useMemo(
    () => sortRows(visible, queueColumns.sort, QUEUE_LIST_SORT_VALUES),
    [visible, queueColumns.sort],
  );
  const selectedAll =
    activeQueue !== null &&
    activeQueue.items.length > 0 &&
    activeQueue.items.every((item) =>
      selectedItems.includes(item.annotation_queue_item_id),
    );

  const refresh = () => setRetry((value) => value + 1);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setMutationError("");
    try {
      const created = await createAnnotationQueue({
        name: name.trim(),
        description: description.trim() || null,
        score_config_ids: scoreIds,
        trace_ids: [],
      });
      setQueues((items) => [created, ...items]);
      setName("");
      setDescription("");
      setScoreIds([]);
      setNewOpen(false);
    } catch {
      setMutationError("Queue를 생성하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };
  const deleteQueue = async () => {
    if (!activeQueue) return;
    setPending(true);
    setMutationError("");
    try {
      await deleteAnnotationQueue(activeQueue.annotation_queue_id);
      setQueues((items) =>
        items.filter(
          (queue) =>
            queue.annotation_queue_id !== activeQueue.annotation_queue_id,
        ),
      );
      setDeleteOpen(false);
      setActiveQueueId(null);
    } catch {
      setMutationError("Queue를 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };
  const deleteBulkQueues = async () => {
    setBulkPending(true);
    setMutationError("");
    try {
      await Promise.all(
        selectedQueueIds.map((id) => deleteAnnotationQueue(id)),
      );
      setQueues((items) =>
        items.filter(
          (queue) => !selectedQueueIds.includes(queue.annotation_queue_id),
        ),
      );
      setSelectedQueueIds([]);
      setBulkDeleteOpen(false);
    } catch {
      setMutationError("선택한 Queue를 모두 삭제하지 못했습니다.");
    } finally {
      setBulkPending(false);
    }
  };
  const removeItems = async () => {
    if (!activeQueue) return;
    setPending(true);
    setMutationError("");
    try {
      await Promise.all(
        selectedItems.map((itemId) =>
          deleteAnnotationQueueItem(activeQueue.annotation_queue_id, itemId),
        ),
      );
      setActiveQueue((queue) =>
        queue
          ? {
              ...queue,
              items: queue.items.filter(
                (item) =>
                  !selectedItems.includes(item.annotation_queue_item_id),
              ),
            }
          : queue,
      );
      setQueues((items) =>
        items.map((queue) =>
          queue.annotation_queue_id === activeQueue.annotation_queue_id
            ? {
                ...queue,
                items: queue.items.filter(
                  (item) =>
                    !selectedItems.includes(item.annotation_queue_item_id),
                ),
              }
            : queue,
        ),
      );
      setSelectedItems([]);
      setRemoveOpen(false);
    } catch {
      setMutationError("선택한 Queue item을 제거하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page queue-page" id="lf-main" tabIndex={-1}>
      {activeQueueId === null ? (
        <section className="queue-list-view">
          <h1>Annotation Queues</h1>
          <div className="queue-toolbar">
            <button
              className="lf-btn is-primary"
              type="button"
              onClick={() => setNewOpen(true)}
            >
              + New Queue
            </button>
            <input
              className="search"
              type="search"
              aria-label="Queue 검색"
              value={query}
              placeholder="Queue 검색"
              onChange={(event) => setQuery(event.target.value)}
            />
            {selectedQueueIds.length ? (
              <div className="bulk-actions">
                <button
                  className="lf-btn is-danger"
                  type="button"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  Delete ({selectedQueueIds.length})
                </button>
              </div>
            ) : null}
            <span className="count">{visible.length}개</span>
          </div>
          {loadState === "loading" ? (
            <LoadingBlock label="Annotation Queues를 불러오는 중…" />
          ) : loadState === "error" ? (
            <ErrorBlock message={error} onRetry={refresh} />
          ) : visible.length === 0 ? (
            <EmptyBlock>검색 결과가 없습니다.</EmptyBlock>
          ) : (
            <div className="queue-table-shell">
              <table className="queue-table">
                <SelectColGroup columns={queueColumns} />
                <thead>
                  <tr>
                    <th className="select-col">
                      <input
                        type="checkbox"
                        aria-label="모든 queue 선택"
                        checked={
                          visible.length > 0 &&
                          visible.every((queue) =>
                            selectedQueueIds.includes(
                              queue.annotation_queue_id,
                            ),
                          )
                        }
                        onChange={(event) =>
                          setSelectedQueueIds(
                            event.target.checked
                              ? visible.map(
                                  (queue) => queue.annotation_queue_id,
                                )
                              : [],
                          )
                        }
                      />
                    </th>
                    {queueColumns.order.map((id) => {
                      const def = QUEUE_LIST_COLUMNS.find((c) => c.id === id)!;
                      return (
                        <ColumnHeaderCell
                          key={id}
                          id={id}
                          label={def.label}
                          columns={queueColumns}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedVisible.map((queue) => {
                    const total = queue.items.length;
                    const completed = completedCount(queue);
                    const cell: Record<string, ReactNode> = {
                      name: queue.name,
                      progress: (
                        <div className="queue-progress">
                          <div className="queue-progress-bar">
                            <div
                              className="queue-progress-fill"
                              style={{
                                width: `${total === 0 ? 0 : (completed / total) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="queue-progress-label">
                            {completed} / {total} runs
                          </span>
                        </div>
                      ),
                      scores: (
                        <div className="tags">
                          {queue.score_config_ids.map((id) => (
                            <span className="tag" key={id}>
                              {scoreById.get(id)?.name ?? id}
                            </span>
                          ))}
                        </div>
                      ),
                      updated: relativeTime(queue.updated_at),
                      description: queue.description ?? "",
                    };
                    const cellClass: Record<string, string> = {
                      name: "queue-name mono",
                      updated: "mono",
                      description: "payload",
                    };
                    return (
                      <tr
                        className="queue-row"
                        tabIndex={0}
                        key={queue.annotation_queue_id}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("input"))
                            return;
                          setActiveQueueId(queue.annotation_queue_id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveQueueId(queue.annotation_queue_id);
                          }
                        }}
                      >
                        <td className="select-col">
                          <input
                            type="checkbox"
                            aria-label={`${queue.name} 선택`}
                            checked={selectedQueueIds.includes(
                              queue.annotation_queue_id,
                            )}
                            onChange={(event) =>
                              setSelectedQueueIds((ids) =>
                                event.target.checked
                                  ? [...ids, queue.annotation_queue_id]
                                  : ids.filter(
                                      (id) => id !== queue.annotation_queue_id,
                                    ),
                              )
                            }
                          />
                        </td>
                        {queueColumns.order.map((id) => (
                          <td key={id} className={cellClass[id]}>
                            {cell[id]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="queue-detail-view">
          {detailState === "loading" ? (
            <LoadingBlock label="Queue 상세를 불러오는 중…" />
          ) : detailState === "error" ? (
            <ErrorBlock message={detailError} onRetry={refresh} />
          ) : activeQueue ? (
            <>
              <header className="detail-head queue-detail-head">
                <button
                  className="back"
                  type="button"
                  onClick={() => setActiveQueueId(null)}
                >
                  ← Queues
                </button>
                <div className="detail-main">
                  <h1>{activeQueue.name}</h1>
                  <p className="queue-desc">
                    {activeQueue.description ?? "설명 없음"}
                  </p>
                  <div className="score-line">
                    {activeQueue.score_config_ids.map((id) => (
                      <span className="tag" key={id}>
                        {scoreById.get(id)?.name ?? id}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="detail-actions">
                  <button
                    className="lf-btn is-danger"
                    type="button"
                    disabled={selectedItems.length === 0}
                    onClick={() => setRemoveOpen(true)}
                  >
                    큐에서 제거
                    {selectedItems.length ? ` (${selectedItems.length})` : ""}
                  </button>
                  <button
                    className="lf-btn is-danger"
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete queue
                  </button>
                </div>
              </header>
              {mutationError ? (
                <p className="mutation-status is-error" role="alert">
                  {mutationError}
                </p>
              ) : null}
              <QueueTable
                queue={activeQueue}
                selectedItems={selectedItems}
                onToggleAll={(checked) =>
                  setSelectedItems(
                    checked
                      ? activeQueue.items.map(
                          (item) => item.annotation_queue_item_id,
                        )
                      : [],
                  )
                }
                selectedAll={selectedAll}
                onToggle={(id, checked) =>
                  setSelectedItems((items) =>
                    checked
                      ? [...items, id]
                      : items.filter((item) => item !== id),
                  )
                }
                onReview={setReviewItem}
              />
            </>
          ) : null}
        </section>
      )}
      <Modal open={newOpen} title="New Queue" onClose={() => setNewOpen(false)}>
        <form
          className="lf-modal-body"
          onSubmit={(event) => void create(event)}
        >
          <label className="modal-field">
            이름
            <input
              autoFocus
              required
              value={name}
              placeholder="예: Release review"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="modal-field">
            설명
            <textarea
              value={description}
              placeholder="선택 사항"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <fieldset className="score-options">
            <legend>Custom Scores</legend>
            {scores
              .filter((score) => score.archived_at === null)
              .map((score) => (
                <label key={score.score_config_id}>
                  <input
                    type="checkbox"
                    checked={scoreIds.includes(score.score_config_id)}
                    onChange={(event) =>
                      setScoreIds((ids) =>
                        event.target.checked
                          ? [...ids, score.score_config_id]
                          : ids.filter((id) => id !== score.score_config_id),
                      )
                    }
                  />{" "}
                  {score.name}
                  <small>{score.data_type}</small>
                </label>
              ))}
          </fieldset>
          {mutationError ? (
            <p className="mutation-status is-error">{mutationError}</p>
          ) : null}
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              onClick={() => setNewOpen(false)}
            >
              취소
            </button>
            <button
              className="lf-btn is-primary"
              type="submit"
              disabled={pending}
            >
              {pending ? "생성 중…" : "생성"}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={deleteOpen}
        title="Queue를 삭제할까요?"
        onClose={() => {
          if (pending) return;
          setDeleteOpen(false);
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            큐와 큐에 속한 항목 연결만 삭제됩니다. 원본 trace는 유지됩니다.
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={pending}
              onClick={() => setDeleteOpen(false)}
            >
              취소
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={pending}
              onClick={() => void deleteQueue()}
            >
              {pending ? "삭제 중…" : "삭제"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={removeOpen}
        title="선택한 trace를 큐에서 뺄까요?"
        onClose={() => !pending && setRemoveOpen(false)}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            원본 trace와 저장된 annotations는 유지됩니다.
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={pending}
              onClick={() => setRemoveOpen(false)}
            >
              취소
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={pending}
              onClick={() => void removeItems()}
            >
              {pending ? "제거 중…" : "큐에서 제거"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={bulkDeleteOpen}
        title="선택한 Queue를 삭제할까요?"
        onClose={() => {
          if (!bulkPending) setBulkDeleteOpen(false);
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            {selectedQueueIds.length}개 큐와 큐에 속한 항목 연결만 삭제됩니다.
            원본 trace는 유지됩니다.
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={bulkPending}
              onClick={() => setBulkDeleteOpen(false)}
            >
              취소
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={bulkPending}
              onClick={() => void deleteBulkQueues()}
            >
              {bulkPending ? "삭제 중…" : "삭제"}
            </button>
          </div>
        </div>
      </Modal>
      <QueueReview
        item={reviewItem}
        queue={activeQueue}
        scores={scores}
        onClose={() => setReviewItem(null)}
        onItemUpdated={(updated) => {
          setActiveQueue((queue) =>
            queue
              ? {
                  ...queue,
                  items: queue.items.map((item) =>
                    item.annotation_queue_item_id ===
                    updated.annotation_queue_item_id
                      ? updated
                      : item,
                  ),
                }
              : queue,
          );
        }}
        onCompleted={() => setReviewItem(null)}
      />
    </main>
  );
}

function QueueTable({
  queue,
  selectedItems,
  selectedAll,
  onToggleAll,
  onToggle,
  onReview,
}: {
  queue: AnnotationQueue;
  selectedItems: string[];
  selectedAll: boolean;
  onToggleAll: (checked: boolean) => void;
  onToggle: (id: string, checked: boolean) => void;
  onReview: (item: AnnotationQueueItem) => void;
}) {
  const columns = useReorderableColumns(QUEUE_ITEM_COLUMNS);
  const sortedItems = useMemo(
    () => sortRows(queue.items, columns.sort, QUEUE_ITEM_SORT_VALUES),
    [queue.items, columns.sort],
  );
  const [page, setPage] = useState(1);
  const totalPages = Math.max(
    1,
    Math.ceil(sortedItems.length / LIST_PAGE_SIZE),
  );
  const pagedItems = paginate(sortedItems, page);
  return (
    <>
      <div className="queue-table-shell">
        <table className="queue-trace-table">
          <SelectColGroup columns={columns} />
          <thead>
            <tr>
              <th className="select-col">
                <input
                  type="checkbox"
                  aria-label="모든 trace 선택"
                  checked={selectedAll}
                  onChange={(event) => onToggleAll(event.target.checked)}
                />
              </th>
              {columns.order.map((id) => {
                const def = QUEUE_ITEM_COLUMNS.find((c) => c.id === id)!;
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
            {pagedItems.map((item) => {
              const cell: Record<string, ReactNode> = {
                status: (
                  <>
                    <span
                      className={`queue-item-status ${item.status === "completed" ? "is-completed" : ""}`}
                    >
                      {item.status === "completed" ? "완료" : "대기"}
                    </span>
                    {item.was_edited ? (
                      <span className="queue-item-edited">수정됨</span>
                    ) : null}
                  </>
                ),
                started: relativeTime(item.updated_at),
                trace_id: item.trace_id,
                input: item.input_preview,
                output: item.output_preview,
                latency: formatDuration(item.duration_us),
              };
              const cellClass: Record<string, string> = {
                started: "mono",
                trace_id: "mono trace-id",
                input: "payload",
                output: "payload",
                latency: "mono",
              };
              return (
                <tr
                  className="trace-row"
                  key={item.annotation_queue_item_id}
                  tabIndex={0}
                  onClick={() => onReview(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onReview(item);
                    }
                  }}
                >
                  <td className="select-col">
                    <input
                      type="checkbox"
                      aria-label={`${item.trace_id} 선택`}
                      checked={selectedItems.includes(
                        item.annotation_queue_item_id,
                      )}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        onToggle(
                          item.annotation_queue_item_id,
                          event.target.checked,
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
      </div>
      {sortedItems.length > 0 ? (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      ) : null}
    </>
  );
}

function QueueReview({
  item,
  queue,
  scores,
  onClose,
  onItemUpdated,
  onCompleted,
}: {
  item: AnnotationQueueItem | null;
  queue: AnnotationQueue | null;
  scores: ScoreConfig[];
  onClose: () => void;
  onItemUpdated: (item: AnnotationQueueItem) => void;
  onCompleted: () => void;
}) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [observationId, setObservationId] = useState<string | null>(null);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [values, setValues] = useState<Record<string, AnnotationValue | null>>(
    {},
  );
  const [memo, setMemo] = useState("");
  const [state, setState] = useState<QueueLoad>("loading");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(950);
  const [resizing, setResizing] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setState("loading");
      setDetail(null);
    });
    void getTrace(item.trace_id, controller.signal)
      .then((trace) => {
        setDetail(trace);
        const root =
          trace.observations.find(
            (entry) => entry.parent_observation_id === null,
          ) ?? trace.observations[0];
        setObservationId(root?.observation_id ?? null);
        setValues(
          Object.fromEntries(
            trace.annotations.map((annotation) => [
              annotation.score_config_id,
              annotation.value,
            ]),
          ),
        );
        setMemo(trace.memo?.content ?? "");
        setState("success");
      })
      .catch((reason: unknown) => {
        if (!abort(reason)) {
          setState("error");
          setError("Review trace를 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, [item]);

  useEffect(() => {
    if (!observationId) return;
    const controller = new AbortController();
    void getObservation(observationId, controller.signal)
      .then(setObservation)
      .catch(() => setObservation(null));
    return () => controller.abort();
  }, [observationId]);

  useEffect(() => {
    if (!item) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [item, onClose, pending]);

  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      setDrawerWidth(
        Math.max(
          525,
          Math.min(1625, resizing.startWidth + resizing.startX - event.clientX),
        ),
      );
    };
    const end = () => setResizing(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [resizing]);

  if (!item || !queue) return null;
  const queueScores = scores.filter((score) =>
    queue.score_config_ids.includes(score.score_config_id),
  );
  const submit = async () => {
    setPending(true);
    setError("");
    try {
      const annotations = queueScores.flatMap((score) => {
        const value = values[score.score_config_id];
        return value === null ||
          value === undefined ||
          (Array.isArray(value) && value.length === 0)
          ? []
          : [{ score_config_id: score.score_config_id, value }];
      });
      if (item.status === "completed") {
        await editAnnotationQueueItem(
          queue.annotation_queue_id,
          item.annotation_queue_item_id,
        );
      }
      const completed = await completeAnnotationQueueItem(
        queue.annotation_queue_id,
        item.annotation_queue_item_id,
        annotations,
        memo,
      );
      onItemUpdated(completed);
      onCompleted();
    } catch {
      setError("Review를 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };
  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    setResizing({ startX: event.clientX, startWidth: drawerWidth });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return (
    <>
      <div className="review-scrim" onClick={() => !pending && onClose()} />
      <aside
        className={`review-drawer${resizing ? " is-resizing" : ""}`}
        style={{ "--review-drawer-width": `${drawerWidth}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reviewTitle"
      >
        <span
          className="drawer-resize"
          onPointerDown={startResize}
          aria-hidden="true"
        />
        <header className="drawer-head">
          <div>
            <h2 id="reviewTitle">Review trace</h2>
            <p>{item.trace_id}</p>
          </div>
          <button
            className="lf-icon-btn"
            type="button"
            aria-label="상세 닫기"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </header>
        <div className="drawer-body">
          {state === "loading" ? (
            <LoadingBlock />
          ) : state === "error" ? (
            <ErrorBlock message={error} />
          ) : detail ? (
            <>
              <div className="review-grid">
                <section className="detail-card">
                  <h3>실행 흐름</h3>
                  <RuntimeGraphView
                    observations={detail.observations}
                    selectedObservationId={observationId}
                    onSelect={setObservationId}
                  />
                </section>
                <section className="detail-card">
                  <h3>Input / Output</h3>
                  <div className="io-panel">
                    {observation ? (
                      <>
                        <JsonCode value={observation.input} />
                        <JsonCode value={observation.output} />
                      </>
                    ) : (
                      <LoadingBlock label="Payload를 불러오는 중…" />
                    )}
                  </div>
                </section>
              </div>
              <section className="annotation-section">
                <header className="annotation-head">
                  <h3>Annotations</h3>
                  <span className="eyebrow">Queue scores</span>
                </header>
                <div className="annotation-list">
                  {queueScores.map((score) => (
                    <article
                      className="annotation-card"
                      key={score.score_config_id}
                    >
                      <div className="annotation-card-head">
                        <strong>{score.name}</strong>
                        <span>{score.data_type}</span>
                      </div>
                      <ReviewControl
                        score={score}
                        value={values[score.score_config_id]}
                        onChange={(value) =>
                          setValues((current) => ({
                            ...current,
                            [score.score_config_id]: value,
                          }))
                        }
                      />
                    </article>
                  ))}
                </div>
                <label className="memo-field">
                  <span>Memo</span>
                  <textarea
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                  />
                </label>
                <footer className="annotation-footer">
                  <span className="annotation-status" role="status">
                    {error}
                  </span>
                  <button
                    className="lf-btn is-primary"
                    type="button"
                    disabled={pending}
                    onClick={() => void submit()}
                  >
                    {pending ? "저장 중…" : "완료"}
                  </button>
                </footer>
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function ReviewControl({
  score,
  value,
  onChange,
}: {
  score: ScoreConfig;
  value: AnnotationValue | null | undefined;
  onChange: (value: AnnotationValue | null) => void;
}) {
  if (score.data_type === "boolean")
    return (
      <div className="annotation-toggle">
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
        >
          {score.boolean_true_label ?? "True"}
        </button>
        <button
          type="button"
          aria-pressed={value === false}
          onClick={() => onChange(false)}
        >
          {score.boolean_false_label ?? "False"}
        </button>
      </div>
    );
  if (score.data_type === "number")
    return (
      <input
        className="annotation-number"
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
      />
    );
  const selected = Array.isArray(value) ? value : [];
  return (
    <div className="annotation-options">
      {score.options.map((option) => (
        <button
          key={option.score_option_id}
          type="button"
          aria-pressed={selected.includes(option.score_option_id)}
          onClick={() =>
            onChange(
              score.categorical_selection_mode === "multiple"
                ? selected.includes(option.score_option_id)
                  ? selected.filter((id) => id !== option.score_option_id)
                  : [...selected, option.score_option_id]
                : [option.score_option_id],
            )
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

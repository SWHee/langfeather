import {useEffect, useState} from "react";
import {
  createFeedback,
  deleteFeedback,
  deleteTrace,
  getObservation,
  getTrace,
  getTraces,
  resetAllData,
  updateFeedback,
} from "./api/client";
import type {
  Feedback,
  FeedbackPatch,
  JsonValue,
  Observation,
  ObservationSummary,
  TraceDetail,
  TraceQuery,
  TraceListResponse,
  TraceStatus,
} from "./api/types";
import {APP_TITLE} from "./constants";
import {RuntimeExecutionGraph} from "./graph/RuntimeExecutionGraph";
import "./styles.css";

type LoadState<T> =
  | {status: "idle"}
  | {status: "loading"}
  | {status: "error"}
  | {status: "success"; data: T};

const STATUS_LABEL: Record<TraceStatus, string> = {
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function jsonRecord(value: JsonValue): {[key: string]: JsonValue} | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function FailureSummary({error}: {error: JsonValue}) {
  const diagnostic = jsonRecord(error);
  if (diagnostic === null) {
    return null;
  }
  const errorType = diagnostic.__type__;
  const message = diagnostic.message;
  const traceback = diagnostic.traceback;
  const lastFrame = Array.isArray(traceback)
    ? jsonRecord(traceback[traceback.length - 1] ?? null)
    : null;
  const file = lastFrame?.file;
  const line = lastFrame?.line;
  const functionName = lastFrame?.function;

  return (
    <div className="failure-summary" role="alert">
      <p>실패한 노드</p>
      <strong>{typeof errorType === "string" ? errorType : "실행 오류"}</strong>
      <span>{typeof message === "string" ? message : "오류 메시지가 없습니다."}</span>
      {typeof file === "string" && typeof line === "number" && (
        <code>
          {file}:{line}
          {typeof functionName === "string" ? ` · ${functionName}()` : ""}
        </code>
      )}
      <small>전체 traceback과 metadata는 ‘전체 데이터’에서 확인할 수 있습니다.</small>
    </div>
  );
}

function formatDuration(durationUs: number): string {
  if (durationUs < 1_000) {
    return `${durationUs} µs`;
  }
  if (durationUs < 1_000_000) {
    return `${(durationUs / 1_000).toFixed(0)} ms`;
  }
  return `${(durationUs / 1_000_000).toFixed(2)} s`;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function jsonPreview(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value !== null && typeof value === "object") {
    return `Object(${Object.keys(value).length})`;
  }
  return formatJson(value);
}

function JsonTree({value, depth = 0}: {value: JsonValue; depth?: number}) {
  if (Array.isArray(value)) {
    return (
      <details className="json-tree-branch" open={depth < 1}>
        <summary>{jsonPreview(value)}</summary>
        <ol className="json-tree-list">
          {value.map((item, index) => (
            <li key={index}>
              <span className="json-tree-key">{index}: </span>
              <JsonTree value={item} depth={depth + 1} />
            </li>
          ))}
        </ol>
      </details>
    );
  }
  if (value !== null && typeof value === "object") {
    return (
      <details className="json-tree-branch" open={depth < 1}>
        <summary>{jsonPreview(value)}</summary>
        <ul className="json-tree-list">
          {Object.entries(value).map(([key, item]) => (
            <li key={key}>
              <span className="json-tree-key">{JSON.stringify(key)}: </span>
              <JsonTree value={item} depth={depth + 1} />
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return <code className="json-tree-value">{formatJson(value)}</code>;
}

function StatusBadge({status}: {status: TraceStatus}) {
  return (
    <span className="status-badge" data-status={status}>
      <span aria-hidden="true" className="status-dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function LoadingCard({message}: {message: string}) {
  return (
    <div className="state-card" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="state-card state-card-error" role="alert">
      <div>
        <strong>{message}</strong>
        <p>서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.</p>
      </div>
      <button className="secondary-button" type="button" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  );
}

function JsonSection({title, value}: {title: string; value: unknown}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator.clipboard?.writeText !== "function") {
      return;
    }
    void navigator.clipboard.writeText(formatJson(value)).then(() => {
      setCopied(true);
    });
  };
  return (
    <details className="json-section" open>
      <summary>{title}</summary>
      <button className="json-copy-button" type="button" onClick={copy}>
        {copied ? "복사됨" : "복사"}
      </button>
      <div className="json-tree" aria-label={`${title} JSON`}>
        <JsonTree value={value as JsonValue} />
      </div>
    </details>
  );
}

type TraceFilterDraft = {
  query: string;
  status: "" | TraceStatus;
  from: string;
  to: string;
  tag: string;
  session_id: string;
};

const EMPTY_FILTERS: TraceFilterDraft = {
  query: "",
  status: "",
  from: "",
  to: "",
  tag: "",
  session_id: "",
};

function traceQueryFromFilters(filters: TraceFilterDraft): TraceQuery {
  const toIso = (value: string) =>
    value === "" ? undefined : new Date(value).toISOString();
  return {
    query: filters.query || undefined,
    status: filters.status || undefined,
    from: toIso(filters.from),
    to: toIso(filters.to),
    tag: filters.tag || undefined,
    session_id: filters.session_id || undefined,
  };
}

function TraceFilters({
  value,
  onChange,
  onApply,
  onClear,
}: {
  value: TraceFilterDraft;
  onChange: (value: TraceFilterDraft) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const update = (key: keyof TraceFilterDraft, next: string) => {
    onChange({...value, [key]: next});
  };
  const advancedFilterCount = [
    value.status,
    value.from,
    value.to,
    value.tag,
    value.session_id,
  ].filter((filter) => filter !== "").length;

  return (
    <form
      className="trace-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="trace-search-row">
        <label className="trace-search">
          <span aria-hidden="true" className="search-icon" />
          <input
            aria-label="이름 또는 입출력 검색"
            placeholder="Search traces"
            value={value.query}
            onChange={(event) => update("query", event.target.value)}
          />
        </label>
        <button
          className="filter-toggle"
          type="button"
          aria-label="Filters"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span aria-hidden="true" className="filter-icon" />
          Filters
          {advancedFilterCount > 0 && (
            <span className="filter-count">{advancedFilterCount}</span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="trace-filter-popover">
          <div className="trace-filter-row">
            <label>
              <span>상태</span>
              <select
                aria-label="상태 필터"
                value={value.status}
                onChange={(event) => update("status", event.target.value)}
              >
                <option value="">전체</option>
                <option value="completed">완료</option>
                <option value="failed">실패</option>
                <option value="cancelled">취소</option>
              </select>
            </label>
            <label>
              <span>태그</span>
              <input
                aria-label="태그 필터"
                placeholder="quickstart"
                value={value.tag}
                onChange={(event) => update("tag", event.target.value)}
              />
            </label>
          </div>
          <div className="trace-filter-row">
            <label>
              <span>시작</span>
              <input
                aria-label="시작 시간 필터"
                type="datetime-local"
                value={value.from}
                onChange={(event) => update("from", event.target.value)}
              />
            </label>
            <label>
              <span>끝</span>
              <input
                aria-label="끝 시간 필터"
                type="datetime-local"
                value={value.to}
                onChange={(event) => update("to", event.target.value)}
              />
            </label>
          </div>
          <label>
            <span>세션</span>
            <input
              aria-label="세션 필터"
              placeholder="Session ID"
              value={value.session_id}
              onChange={(event) => update("session_id", event.target.value)}
            />
          </label>
          <div className="trace-filter-actions">
            <button className="primary-button" type="submit">
              적용
            </button>
            <button className="text-button" type="button" onClick={onClear}>
              초기화
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function LocalDataControls({onReset}: {onReset: () => void}) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const reset = () => {
    if (confirmation !== "RESET") {
      return;
    }
    setPending(true);
    setError(false);
    void resetAllData()
      .then(() => {
        setConfirmation("");
        onReset();
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <section className="local-data-controls" aria-labelledby="local-data-title">
      <div>
        <h2 id="local-data-title">백업과 초기화</h2>
        <p>원본 trace 데이터는 이 컴퓨터에만 저장됩니다.</p>
      </div>
      <a className="backup-link" href="/api/v1/admin/backup" download>
        SQLite 백업 다운로드
      </a>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          reset();
        }}
      >
        <label>
          <span><code>RESET</code>을 입력하면 모든 추적과 피드백을 지웁니다.</span>
          <input
            aria-label="전체 데이터 초기화 확인"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="RESET"
          />
        </label>
        <button
          className="delete-button"
          type="submit"
          disabled={confirmation !== "RESET" || pending}
        >
          {pending ? "초기화 중…" : "모든 데이터 초기화"}
        </button>
      </form>
      {error && (
        <p className="local-data-error" role="alert">
          데이터를 초기화하지 못했습니다. 다시 시도해 주세요.
        </p>
      )}
    </section>
  );
}

function TraceList({
  response,
  selectedTraceId,
  hasFilters,
  loadingMore,
  onSelect,
  onLoadMore,
}: {
  response: TraceListResponse;
  selectedTraceId: string | null;
  hasFilters: boolean;
  loadingMore: boolean;
  onSelect: (traceId: string) => void;
  onLoadMore: () => void;
}) {
  if (response.items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-feather" aria-hidden="true">
          ↘
        </div>
        <h3>{hasFilters ? "조건에 맞는 요청이 없습니다" : "아직 기록된 요청이 없습니다"}</h3>
        <p>
          {hasFilters ? "검색어나 필터를 바꿔 다시 확인해 보세요." : <><code>wrap_runnable()</code>로 감싼 LangGraph를 실행하면 여기에 요청이 나타납니다.</>}
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="trace-list">
        {response.items.map((trace) => (
          <li key={trace.trace_id}>
            <button
              className="trace-card"
              type="button"
              aria-pressed={selectedTraceId === trace.trace_id}
              onClick={() => {
                onSelect(trace.trace_id);
              }}
            >
              <span className="trace-card-heading">
                <strong>{trace.name}</strong>
                <StatusBadge status={trace.status} />
              </span>
              <span className="trace-preview">{trace.input_preview}</span>
              <span className="trace-card-meta">
                <time dateTime={trace.started_at}>
                  {formatTimestamp(trace.started_at)}
                </time>
                <span>{formatDuration(trace.duration_us)}</span>
                <span>노드 {trace.observation_count}개</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {response.next_cursor !== null && (
        <button
          className="load-more-button"
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "더 불러오는 중…" : "이전 요청 더 보기"}
        </button>
      )}
    </>
  );
}

function Inspector({
  selectedObservation,
  payloadState,
  onRetry,
}: {
  selectedObservation: ObservationSummary | null;
  payloadState: LoadState<Observation>;
  onRetry: () => void;
}) {
  const [detail, setDetail] = useState<"core" | "all">("core");
  return (
    <section className="inspector-panel" aria-labelledby="inspector-title">
      <div className="panel-heading">
        <h3 id="inspector-title">
          {selectedObservation?.name ?? "Input / Output"}
        </h3>
        {selectedObservation === null ? null : (
          <span className="kind-chip">{selectedObservation.kind}</span>
        )}
      </div>

      {payloadState.status === "idle" && (
        <div className="inspector-placeholder">
          <p>노드를 선택하세요.</p>
        </div>
      )}
      {payloadState.status === "loading" && (
        <LoadingCard message="노드 데이터를 불러오는 중입니다…" />
      )}
      {payloadState.status === "error" && (
        <ErrorCard
          message="노드 데이터를 불러오지 못했습니다"
          onRetry={onRetry}
        />
      )}
      {payloadState.status === "success" && (
        <div className="json-inspector">
          {selectedObservation?.status === "failed" && (
            <FailureSummary error={payloadState.data.error} />
          )}
          <div className="inspector-mode-toggle" role="group" aria-label="데이터 상세 수준">
            <button
              className={detail === "core" ? "selected" : undefined}
              type="button"
              aria-pressed={detail === "core"}
              onClick={() => setDetail("core")}
            >
              핵심 입출력
            </button>
            <button
              className={detail === "all" ? "selected" : undefined}
              type="button"
              aria-pressed={detail === "all"}
              onClick={() => setDetail("all")}
            >
              전체 데이터
            </button>
          </div>
          <JsonSection title="Input" value={payloadState.data.input} />
          <JsonSection title="Output" value={payloadState.data.output} />
          {(detail === "all" || payloadState.data.error !== null) && (
            <JsonSection title="Error" value={payloadState.data.error} />
          )}
          {detail === "all" && (
            <>
              <JsonSection title="Usage" value={payloadState.data.usage} />
              <JsonSection title="Metadata" value={payloadState.data.metadata} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function feedbackId(): string {
  if (typeof crypto.randomUUID === "function") {
    return `fb_${crypto.randomUUID()}`;
  }
  return `fb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function FeedbackPanel({
  traceId,
  feedback,
  onChanged,
}: {
  traceId: string;
  feedback: Feedback[];
  onChanged: () => void;
}) {
  const [value, setValue] = useState<"true" | "false">("true");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const submit = () => {
    setPending(true);
    setError(false);
    const booleanValue = value === "true";
    const request =
      editing === null
        ? createFeedback({
            feedback_id: feedbackId(),
            trace_id: traceId,
            name: "user_feedback",
            value: booleanValue,
            comment: comment === "" ? null : comment,
            metadata: {source: "langfeather-web"},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        : updateFeedback(editing.feedback_id, {
            value: booleanValue,
            comment: comment === "" ? null : comment,
          } satisfies FeedbackPatch);
    void request
      .then(() => {
        setComment("");
        setValue("true");
        setEditing(null);
        onChanged();
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setPending(false);
      });
  };

  const edit = (item: Feedback) => {
    setEditing(item);
    setValue(item.value === false ? "false" : "true");
    setComment(item.comment ?? "");
    setError(false);
  };

  const remove = (item: Feedback) => {
    if (!window.confirm("이 피드백을 삭제할까요?")) {
      return;
    }
    setPending(true);
    setError(false);
    void deleteFeedback(item.feedback_id)
      .then(onChanged)
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <section className="feedback-panel" aria-labelledby="feedback-title">
      <div className="feedback-heading">
        <h3 id="feedback-title">Feedback</h3>
        <span>{feedback.length}개</span>
      </div>
      {feedback.length > 0 && (
        <ul className="feedback-list">
          {feedback.map((item) => (
            <li key={item.feedback_id}>
              <span className={item.value === false ? "feedback-negative" : "feedback-positive"}>
                {item.value === false ? "아쉬움" : "도움됨"}
              </span>
              <p>{item.comment ?? "의견 없음"}</p>
              <div>
                <button className="text-button" type="button" onClick={() => edit(item)}>
                  수정
                </button>
                <button className="text-button" type="button" onClick={() => remove(item)}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="feedback-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label>
          <span>평가</span>
          <select
            aria-label="피드백 평가"
            value={value}
            onChange={(event) => setValue(event.target.value as "true" | "false")}
          >
            <option value="true">도움됨</option>
            <option value="false">아쉬움</option>
          </select>
        </label>
        <label>
          <span>메모</span>
          <input
            aria-label="피드백 메모"
            placeholder="예: 이 결과가 기대와 다른 이유"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
        <div className="feedback-actions">
          <button className="secondary-button" type="submit" disabled={pending}>
            {pending ? "저장 중…" : editing === null ? "피드백 저장" : "피드백 수정"}
          </button>
          {editing !== null && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setEditing(null);
                setValue("true");
                setComment("");
              }}
            >
              취소
            </button>
          )}
        </div>
      </form>
      {error && <p className="feedback-error" role="alert">피드백을 저장하지 못했습니다. 다시 시도해 주세요.</p>}
    </section>
  );
}

function TraceDetailPanel({
  detail,
  selectedObservationId,
  payloadState,
  deleting,
  onSelectObservation,
  onSelectTrace,
  onRetryObservation,
  onRefresh,
  onDelete,
}: {
  detail: TraceDetail;
  selectedObservationId: string | null;
  payloadState: LoadState<Observation>;
  deleting: boolean;
  onSelectObservation: (observationId: string) => void;
  onSelectTrace: (traceId: string) => void;
  onRetryObservation: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const selectedObservation =
    detail.observations.find(
      (observation) =>
        observation.observation_id === selectedObservationId,
    ) ?? null;

  return (
    <article className="trace-detail">
      <header className="detail-header">
        <div>
          <h2>{detail.name}</h2>
          <p className="trace-id">{detail.trace_id}</p>
        </div>
        <div className="detail-summary">
          <StatusBadge status={detail.status} />
          <span>{formatDuration(detail.duration_us)}</span>
          <time dateTime={detail.started_at}>
            {formatTimestamp(detail.started_at)}
          </time>
          <button
            className="icon-button delete-trace-button"
            type="button"
            disabled={deleting}
            onClick={onDelete}
            aria-label="이 요청 삭제"
            title="이 요청 삭제"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      {detail.session_id !== null && (
        <nav className="session-navigation" aria-label="같은 세션의 요청 이동">
          <span>{detail.session_id}</span>
          <button
            className="text-button"
            type="button"
            disabled={detail.previous_trace_id === null || detail.previous_trace_id === undefined}
            onClick={() => detail.previous_trace_id !== null && detail.previous_trace_id !== undefined && onSelectTrace(detail.previous_trace_id)}
          >
            이전 요청
          </button>
          <button
            className="text-button"
            type="button"
            disabled={detail.next_trace_id === null || detail.next_trace_id === undefined}
            onClick={() => detail.next_trace_id !== null && detail.next_trace_id !== undefined && onSelectTrace(detail.next_trace_id)}
          >
            다음 요청
          </button>
        </nav>
      )}

      <section className="path-section" aria-labelledby="path-heading">
        <div className="path-heading">
          <h3 id="path-heading">Execution</h3>
          <span className="node-count">
            {detail.observation_count}
          </span>
        </div>

        <div className="detail-grid">
          <div className="graph-panel">
            <RuntimeExecutionGraph
              key={detail.trace_id}
              observations={detail.observations}
              selectedObservationId={selectedObservationId}
              onSelect={onSelectObservation}
            />
          </div>
          <Inspector
            selectedObservation={selectedObservation}
            payloadState={payloadState}
            onRetry={onRetryObservation}
          />
        </div>
      </section>
      <FeedbackPanel
        key={detail.trace_id}
        traceId={detail.trace_id}
        feedback={detail.feedback}
        onChanged={onRefresh}
      />
    </article>
  );
}

export function App() {
  const [activeView, setActiveView] = useState<"traces" | "data">("traces");
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [payloadRevision, setPayloadRevision] = useState(0);
  const [listState, setListState] = useState<LoadState<TraceListResponse>>({
    status: "loading",
  });
  const [filters, setFilters] = useState<TraceFilterDraft>(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] = useState<TraceFilterDraft>(EMPTY_FILTERS);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<LoadState<TraceDetail>>({
    status: "idle",
  });
  const [selectedObservationId, setSelectedObservationId] = useState<
    string | null
  >(null);
  const [payloadState, setPayloadState] = useState<LoadState<Observation>>({
    status: "idle",
  });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void getTraces(traceQueryFromFilters(activeFilters), controller.signal)
      .then((response) => {
        setListState({status: "success", data: response});
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setListState({status: "error"});
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeFilters, listRevision]);

  useEffect(() => {
    if (selectedTraceId === null) {
      return;
    }

    const controller = new AbortController();

    void getTrace(selectedTraceId, controller.signal)
      .then((detail) => {
        setDetailState({status: "success", data: detail});
        const rootObservation = detail.observations.find(
          (observation) => observation.parent_observation_id === null,
        );
        const failedObservation = [...detail.observations]
          .sort((left, right) => left.sequence - right.sequence)
          .find((observation) => observation.status === "failed");
        const initialObservation = failedObservation ?? rootObservation;
        if (initialObservation !== undefined) {
          setSelectedObservationId(initialObservation.observation_id);
          setPayloadState({status: "loading"});
        } else {
          setSelectedObservationId(null);
          setPayloadState({status: "idle"});
        }
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setDetailState({status: "error"});
        }
      });

    return () => {
      controller.abort();
    };
  }, [detailRevision, selectedTraceId]);

  useEffect(() => {
    if (selectedObservationId === null) {
      return;
    }

    const controller = new AbortController();

    void getObservation(selectedObservationId, controller.signal)
      .then((observation) => {
        setPayloadState({status: "success", data: observation});
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setPayloadState({status: "error"});
        }
      });

    return () => {
      controller.abort();
    };
  }, [payloadRevision, selectedObservationId]);

  const selectTrace = (traceId: string) => {
    if (traceId === selectedTraceId && detailState.status !== "error") {
      return;
    }
    setSelectedTraceId(traceId);
    setSelectedObservationId(null);
    setPayloadState({status: "idle"});
    setDetailState({status: "loading"});
  };

  const selectObservation = (observationId: string) => {
    if (
      observationId === selectedObservationId &&
      payloadState.status !== "error"
    ) {
      return;
    }
    setSelectedObservationId(observationId);
    setPayloadState({status: "loading"});
  };

  const retryList = () => {
    setListState({status: "loading"});
    setListRevision((revision) => revision + 1);
  };

  const applyFilters = () => {
    setSelectedTraceId(null);
    setDetailState({status: "idle"});
    setSelectedObservationId(null);
    setPayloadState({status: "idle"});
    setListState({status: "loading"});
    setActiveFilters({...filters});
    setListRevision((revision) => revision + 1);
  };

  const clearFilters = () => {
    const cleared = {...EMPTY_FILTERS};
    setFilters(cleared);
    setSelectedTraceId(null);
    setDetailState({status: "idle"});
    setSelectedObservationId(null);
    setPayloadState({status: "idle"});
    setListState({status: "loading"});
    setActiveFilters(cleared);
    setListRevision((revision) => revision + 1);
  };

  const loadMore = () => {
    if (listState.status !== "success" || listState.data.next_cursor === null) {
      return;
    }
    const cursor = listState.data.next_cursor;
    setLoadingMore(true);
    void getTraces({...traceQueryFromFilters(activeFilters), cursor})
      .then((response) => {
        setListState((current) => {
          if (current.status !== "success" || current.data.next_cursor !== cursor) {
            return current;
          }
          return {
            status: "success",
            data: {
              items: [...current.data.items, ...response.items],
              next_cursor: response.next_cursor,
            },
          };
        });
      })
      .finally(() => {
        setLoadingMore(false);
      });
  };

  const retryDetail = () => {
    setDetailState({status: "loading"});
    setDetailRevision((revision) => revision + 1);
  };

  const retryObservation = () => {
    setPayloadState({status: "loading"});
    setPayloadRevision((revision) => revision + 1);
  };

  const refreshDetail = () => {
    setDetailState({status: "loading"});
    setDetailRevision((revision) => revision + 1);
  };

  const removeTrace = () => {
    if (selectedTraceId === null || !window.confirm("이 요청과 노드, 피드백을 모두 삭제할까요?")) {
      return;
    }
    setDeleting(true);
    void deleteTrace(selectedTraceId)
      .then(() => {
        setSelectedTraceId(null);
        setDetailState({status: "idle"});
        setSelectedObservationId(null);
        setPayloadState({status: "idle"});
        retryList();
      })
      .finally(() => {
        setDeleting(false);
      });
  };

  const resetAll = () => {
    setSelectedTraceId(null);
    setDetailState({status: "idle"});
    setSelectedObservationId(null);
    setPayloadState({status: "idle"});
    setActiveView("traces");
    retryList();
  };

  const hasFilters = Object.values(activeFilters).some((value) => value !== "");

  return (
    <div className="app-frame" data-testid="app-frame">
      <header className="app-header">
        <a className="brand" href="/" aria-label={`${APP_TITLE} 홈`}>
          <span className="brand-mark" aria-hidden="true">
            LF
          </span>
          <strong>{APP_TITLE}</strong>
        </a>
        <nav className="primary-navigation" aria-label="주요 메뉴">
          <button
            type="button"
            aria-pressed={activeView === "traces"}
            onClick={() => setActiveView("traces")}
          >
            Traces
          </button>
          <button
            type="button"
            aria-pressed={activeView === "data"}
            onClick={() => setActiveView("data")}
          >
            Local Data
          </button>
        </nav>
        <span className="local-badge">
          <span aria-hidden="true" />
          Local
        </span>
      </header>

      {activeView === "traces" ? (
        <main className="workspace">
          <aside className="trace-sidebar" aria-labelledby="trace-list-title">
            <div className="sidebar-heading">
              <h1 id="trace-list-title">Traces</h1>
              {listState.status === "success" && (
                <span className="record-count">
                  {listState.data.items.length}
                </span>
              )}
            </div>
            <TraceFilters
              value={filters}
              onChange={setFilters}
              onApply={applyFilters}
              onClear={clearFilters}
            />

            <div className="sidebar-content">
              {listState.status === "loading" && (
                <LoadingCard message="추적 기록을 불러오는 중입니다…" />
              )}
              {listState.status === "error" && (
                <ErrorCard
                  message="추적 기록을 불러오지 못했습니다"
                  onRetry={retryList}
                />
              )}
              {listState.status === "success" && (
                <TraceList
                  response={listState.data}
                  selectedTraceId={selectedTraceId}
                  hasFilters={hasFilters}
                  loadingMore={loadingMore}
                  onSelect={selectTrace}
                  onLoadMore={loadMore}
                />
              )}
            </div>
          </aside>

          <section className="detail-area" aria-label="추적 상세">
            {selectedTraceId === null && (
              <div className="detail-placeholder">
                <h2>요청을 선택하세요</h2>
              </div>
            )}
            {selectedTraceId !== null && detailState.status === "loading" && (
              <LoadingCard message="실행 경로를 불러오는 중입니다…" />
            )}
            {selectedTraceId !== null && detailState.status === "error" && (
              <ErrorCard
                message="실행 경로를 불러오지 못했습니다"
                onRetry={retryDetail}
              />
            )}
            {selectedTraceId !== null && detailState.status === "success" && (
              <TraceDetailPanel
                detail={detailState.data}
                selectedObservationId={selectedObservationId}
                payloadState={payloadState}
                deleting={deleting}
                onSelectObservation={selectObservation}
                onSelectTrace={selectTrace}
                onRetryObservation={retryObservation}
                onRefresh={refreshDetail}
                onDelete={removeTrace}
              />
            )}
          </section>
        </main>
      ) : (
        <main className="local-data-page">
          <LocalDataControls onReset={resetAll} />
        </main>
      )}
    </div>
  );
}

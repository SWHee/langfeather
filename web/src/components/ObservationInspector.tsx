import { useEffect, useId, useState } from "react";
import type { JsonValue, Observation, ObservationSummary } from "../api/types";

export type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; data: T };

function jsonRecord(value: JsonValue): { [key: string]: JsonValue } | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function FailureSummary({ error }: { error: JsonValue }) {
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
      <span>
        {typeof message === "string" ? message : "오류 메시지가 없습니다."}
      </span>
      {typeof file === "string" && typeof line === "number" && (
        <code>
          {file}:{line}
          {typeof functionName === "string" ? ` · ${functionName}()` : ""}
        </code>
      )}
      <small>
        전체 traceback과 metadata는 ‘전체 데이터’에서 확인할 수 있습니다.
      </small>
    </div>
  );
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

function JsonTree({ value, depth = 0 }: { value: JsonValue; depth?: number }) {
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

function JsonSection({ title, value }: { title: string; value: unknown }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeoutId = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

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
      <button
        className="json-copy-button"
        type="button"
        aria-live="polite"
        onClick={copy}
      >
        {copied ? "복사됨" : "복사"}
      </button>
      <div className="json-tree" aria-label={`${title} JSON`}>
        <JsonTree value={value as JsonValue} />
      </div>
    </details>
  );
}

export function ObservationInspector({
  selectedObservation,
  payloadState,
  onRetry,
}: {
  selectedObservation: ObservationSummary | null;
  payloadState: LoadState<Observation>;
  onRetry: () => void;
}) {
  const [detail, setDetail] = useState<"core" | "all">("core");
  const headingId = useId();

  return (
    <section className="inspector-panel" aria-labelledby={headingId}>
      <div className="panel-heading">
        <h3 id={headingId}>{selectedObservation?.name ?? "Input / Output"}</h3>
        {selectedObservation !== null && (
          <span className="kind-chip">{selectedObservation.kind}</span>
        )}
      </div>

      {payloadState.status === "idle" && (
        <div className="inspector-placeholder">
          <p>노드를 선택하세요.</p>
        </div>
      )}
      {payloadState.status === "loading" && (
        <div className="state-card" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <p>노드 데이터를 불러오는 중입니다…</p>
        </div>
      )}
      {payloadState.status === "error" && (
        <div className="state-card state-card-error" role="alert">
          <strong>노드 데이터를 불러오지 못했습니다</strong>
          <button className="secondary-button" type="button" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
      {payloadState.status === "success" && (
        <div className="json-inspector">
          {selectedObservation?.status === "failed" && (
            <FailureSummary error={payloadState.data.error} />
          )}
          <div
            className="inspector-mode-toggle"
            role="group"
            aria-label="데이터 상세 수준"
          >
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
              <JsonSection
                title="Metadata"
                value={payloadState.data.metadata}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

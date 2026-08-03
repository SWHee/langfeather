import { useState } from "react";

import type { JsonValue, Observation } from "../api/types";
import { JsonSection } from "./PrettyJson";

function jsonRecord(value: JsonValue): { [key: string]: JsonValue } | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function FailureSummary({ error }: { error: JsonValue }) {
  const diagnostic = jsonRecord(error);
  if (diagnostic === null) return null;
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
      {typeof file === "string" && typeof line === "number" ? (
        <code>
          {file}:{line}
          {typeof functionName === "string" ? ` · ${functionName}()` : ""}
        </code>
      ) : null}
      <small>전체 traceback과 metadata는 '전체 데이터'에서 확인할 수 있습니다.</small>
    </div>
  );
}

export function ObservationPayloadPanel({
  observation,
}: {
  observation: Observation;
}) {
  const [detail, setDetail] = useState<"core" | "all">("core");

  return (
    <div className="json-inspector">
      {observation.status === "failed" ? (
        <FailureSummary error={observation.error} />
      ) : null}
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
      <JsonSection title="Input" value={observation.input} />
      <JsonSection title="Output" value={observation.output} />
      {detail === "all" || observation.error !== null ? (
        <JsonSection title="Error" value={observation.error} />
      ) : null}
      {detail === "all" ? (
        <>
          <JsonSection title="Usage" value={observation.usage} />
          <JsonSection title="Metadata" value={observation.metadata} />
        </>
      ) : null}
    </div>
  );
}

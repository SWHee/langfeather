import { useState } from "react";

import type { JsonValue, Observation } from "../api/types";
import { LlmView, ToolView } from "./KindPayloadViews";
import { hasKindView } from "./payloadShapes";
import { JsonSection } from "./PrettyJson";
import { RetrievalView } from "./RetrievalView";
import { readDocuments } from "./retrieval";

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
  downstreamLlmInput = null,
}: {
  observation: Observation;
  /**
   * 같은 trace의 하류 llm observation input을 문자열로 편 것. retriever 문서가
   * 답변에 실렸는지 대조하는 데만 쓴다. null이면 대조하지 않는다.
   */
  downstreamLlmInput?: string | null;
}) {
  const [detail, setDetail] = useState<"core" | "all">("core");
  // 검색 결과로 읽을 수 있는 retriever 실행만 전용 화면을 쓴다. 읽을 문서가
  // 없으면 일반 JSON tree로 되돌린다.
  const asRetrieval =
    observation.kind === "retriever" &&
    detail === "core" &&
    readDocuments(observation.output).length > 0;
  const asKindView = detail === "core" && hasKindView(observation);

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
      {asKindView ? (
        observation.kind === "llm" ? (
          <LlmView observation={observation} />
        ) : (
          <ToolView observation={observation} />
        )
      ) : (
        <>
          <JsonSection title="Input" value={observation.input} />
          {asRetrieval ? (
            <RetrievalView
              output={observation.output}
              llmInput={downstreamLlmInput}
            />
          ) : (
            <JsonSection title="Output" value={observation.output} />
          )}
        </>
      )}
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

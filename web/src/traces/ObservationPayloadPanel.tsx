import { useState } from "react";

import { useT, type Translate } from "../i18n/context";

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

function FailureSummary({ error, t }: { error: JsonValue; t: Translate }) {
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
      <p>{t("실패한 노드")}</p>
      <strong>{typeof errorType === "string" ? errorType : t("실행 오류")}</strong>
      <span>{typeof message === "string" ? message : t("오류 메시지가 없습니다.")}</span>
      {typeof file === "string" && typeof line === "number" ? (
        <code>
          {file}:{line}
          {typeof functionName === "string" ? ` · ${functionName}()` : ""}
        </code>
      ) : null}
      <small>{t("전체 traceback은 Error 탭에 있습니다.")}</small>
    </div>
  );
}

/**
 * 검사기 탭. 기획서 05절 스케치가 `Retrieval | Input | Output | Error`를 그렸고
 * 도해 설명이 "오른쪽 패널의 첫 탭이 Retrieval 뷰"라고 못박았다. kind 전용 뷰가
 * 첫 탭이고, 원문 JSON은 Input/Output 탭에 그대로 남는다.
 *
 * 탭 이름은 전부 API field 이름이라 07절에 따라 번역하지 않는다.
 */
type TabId = "kind" | "input" | "output" | "error" | "metadata";

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
  const t = useT();
  const [requested, setRequested] = useState<TabId>("kind");

  // 검색 결과로 읽을 수 있는 retriever 실행만 전용 탭을 얻는다. 읽을 문서가
  // 없으면 탭 자체가 없고 Input/Output의 JSON tree로 되돌아간다.
  const asRetrieval =
    observation.kind === "retriever" &&
    readDocuments(observation.output).length > 0;
  const kindLabel = asRetrieval
    ? "Retrieval"
    : hasKindView(observation)
      ? observation.kind === "llm"
        ? "Messages"
        : "Tool"
      : null;

  const tabs: { id: TabId; label: string }[] = [
    ...(kindLabel === null ? [] : [{ id: "kind" as const, label: kindLabel }]),
    { id: "input", label: "Input" },
    { id: "output", label: "Output" },
    { id: "error", label: "Error" },
    { id: "metadata", label: "Metadata" },
  ];
  // 요청한 탭이 이 observation에 없으면 첫 탭으로 떨어진다. observation을 바꿀
  // 때마다 effect로 state를 되돌리지 않기 위해 렌더 시점에 판정한다.
  const active = tabs.some((tab) => tab.id === requested) ? requested : "input";

  return (
    <div className="json-inspector">
      {observation.status === "failed" ? (
        <FailureSummary error={observation.error} t={t} />
      ) : null}
      <div className="inspector-tabs" role="tablist" aria-label={t("Payload 탭")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={active === tab.id ? "selected" : undefined}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setRequested(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="inspector-panel" role="tabpanel">
        {active === "kind" ? (
          asRetrieval ? (
            <RetrievalView
              output={observation.output}
              llmInput={downstreamLlmInput}
            />
          ) : observation.kind === "llm" ? (
            <LlmView observation={observation} />
          ) : (
            <ToolView observation={observation} />
          )
        ) : null}
        {active === "input" ? (
          <JsonSection title="Input" value={observation.input} />
        ) : null}
        {active === "output" ? (
          <JsonSection title="Output" value={observation.output} />
        ) : null}
        {active === "error" ? (
          observation.error === null ? (
            <p className="inspector-empty">{t("오류 없이 끝났습니다.")}</p>
          ) : (
            <JsonSection title="Error" value={observation.error} />
          )
        ) : null}
        {active === "metadata" ? (
          <>
            <JsonSection title="Usage" value={observation.usage} />
            <JsonSection title="Metadata" value={observation.metadata} />
          </>
        ) : null}
      </div>
    </div>
  );
}

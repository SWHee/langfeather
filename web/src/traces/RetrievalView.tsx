import type {JsonValue} from "../api/types";
import {useT, type Translate} from "../i18n/context";
import {
  matchedPrefixEnd,
  readDocuments,
  usedInAnswer,
  type RetrievedDocument,
} from "./retrieval";

/**
 * retriever 실행을 검색 결과로 읽는 화면. 저장된 payload를 다르게 그릴 뿐이고
 * 없는 값을 추정해 채우지 않는다.
 *
 * `llmInput`이 null이면 대조할 근거가 없다는 뜻이다. 이때는 어떤 카드에도
 * "사용됨" 배지를 붙이지 않고 요약 줄도 보여주지 않는다.
 */
export function RetrievalView({
  output,
  llmInput,
}: {
  output: JsonValue;
  llmInput: string | null;
}) {
  const t = useT();
  const documents = readDocuments(output);
  if (documents.length === 0) return null;

  const used =
    llmInput === null
      ? null
      : new Set(
          documents
            .filter((document) => usedInAnswer(document, llmInput))
            .map((document) => document.rank),
        );

  return (
    <section className="retrieval" aria-label={t("검색 결과")}>
      <p
        className="retrieval-summary"
        // 검색은 됐는데 답변에 안 실린 문서가 있으면 그 자체가 신호다.
        data-warn={used !== null && used.size < documents.length ? "" : undefined}
      >
        {used === null
          ? t("문서 {total}건", {total: documents.length})
          : t("문서 {total}건 중 {used}건이 답변에 사용됨", {
              total: documents.length,
              used: used.size,
            })}
      </p>
      <ol className="retrieval-list">
        {documents.map((document) => (
          <RetrievalCard
            key={document.rank}
            document={document}
            used={used === null ? null : used.has(document.rank)}
            matchedEnd={
              llmInput === null ? 0 : matchedPrefixEnd(document, llmInput)
            }
            t={t}
          />
        ))}
      </ol>
    </section>
  );
}

function RetrievalCard({
  document,
  used,
  matchedEnd,
  t,
}: {
  document: RetrievedDocument;
  used: boolean | null;
  /** 원문 앞에서 이만큼이 llm input에 그대로 실렸다. 0이면 하이라이트하지 않는다. */
  matchedEnd: number;
  t: Translate;
}) {
  return (
    <li className="retrieval-card">
      <header className="retrieval-card-head">
        <span className="retrieval-rank">#{document.rank}</span>
        {document.score !== null ? (
          <span className="retrieval-score">{document.score.toFixed(3)}</span>
        ) : null}
        {document.source !== null ? (
          <span className="retrieval-source" title={document.source}>
            {document.source}
          </span>
        ) : null}
        {used === true ? (
          <span className="retrieval-used">{t("답변에 사용됨")}</span>
        ) : used === false ? (
          <span className="retrieval-unused">{t("미사용")}</span>
        ) : null}
      </header>
      <p className="retrieval-text">
        {matchedEnd > 0 ? (
          <>
            <mark>{document.text.slice(0, matchedEnd)}</mark>
            {document.text.slice(matchedEnd)}
          </>
        ) : (
          document.text
        )}
      </p>
    </li>
  );
}

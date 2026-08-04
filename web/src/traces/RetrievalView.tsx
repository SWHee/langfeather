import type {JsonValue} from "../api/types";
import {useT, type Translate} from "../i18n/context";
import {readDocuments, usedInAnswer, type RetrievedDocument} from "./retrieval";

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
      <p className="retrieval-summary">
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
  t,
}: {
  document: RetrievedDocument;
  used: boolean | null;
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
        ) : null}
      </header>
      <p className="retrieval-text">{document.text}</p>
    </li>
  );
}

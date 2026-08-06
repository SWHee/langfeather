import {describe, expect, it} from "vitest";

import {
  flattenText,
  matchedPrefixEnd,
  readDocuments,
  usedInAnswer,
} from "./retrieval";

const LONG = "예금자보호법 제32조에 따라 예금보험공사는 보험금을 지급한다. ".repeat(3);

describe("readDocuments", () => {
  it("array가 아니면 문서로 읽지 않는다", () => {
    expect(readDocuments({answer: "x"})).toEqual([]);
    expect(readDocuments("문자열")).toEqual([]);
    expect(readDocuments(null)).toEqual([]);
  });

  it("LangChain Document 모양을 읽는다", () => {
    const documents = readDocuments([
      {page_content: "첫 문서", metadata: {source: "a.pdf", score: 0.91}},
    ]);
    expect(documents).toEqual([
      {rank: 1, text: "첫 문서", score: 0.91, source: "a.pdf"},
    ]);
  });

  it("text와 content도 본문으로 인정한다", () => {
    expect(readDocuments([{text: "본문"}])[0]?.text).toBe("본문");
    expect(readDocuments([{content: "본문"}])[0]?.text).toBe("본문");
  });

  it("문자열 배열도 문서로 읽는다", () => {
    expect(readDocuments(["문서 하나"])[0]).toEqual({
      rank: 1,
      text: "문서 하나",
      score: null,
      source: null,
    });
  });

  it("없는 score와 source를 지어내지 않는다", () => {
    const [document] = readDocuments([{page_content: "본문"}]);
    expect(document?.score).toBeNull();
    expect(document?.source).toBeNull();
  });

  it("본문이 없는 항목은 건너뛰고 rank를 다시 센다", () => {
    const documents = readDocuments([
      {page_content: "첫째"},
      {metadata: {source: "빈 문서"}},
      {page_content: "둘째"},
    ]);
    expect(documents.map((d) => [d.rank, d.text])).toEqual([
      [1, "첫째"],
      [2, "둘째"],
    ]);
  });

  it("score는 relevance_score와 metadata.score에서도 읽는다", () => {
    expect(readDocuments([{text: "a", relevance_score: 0.5}])[0]?.score).toBe(
      0.5,
    );
    expect(readDocuments([{text: "a", metadata: {score: 0.25}}])[0]?.score).toBe(
      0.25,
    );
  });
});

describe("usedInAnswer", () => {
  const long = {rank: 1, text: LONG, score: null, source: null};

  it("긴 문서가 llm input에 실렸으면 사용된 것으로 본다", () => {
    expect(usedInAnswer(long, `참고 문서:\n${LONG}\n질문: ...`)).toBe(true);
  });

  it("공백 차이는 무시한다", () => {
    const squeezed = LONG.replace(/\s+/g, "\n");
    expect(usedInAnswer(long, squeezed)).toBe(true);
  });

  it("실리지 않은 문서는 사용되지 않은 것으로 본다", () => {
    expect(usedInAnswer(long, "전혀 다른 문장입니다.")).toBe(false);
  });

  it("짧은 문서는 통째로 일치할 때만 인정한다", () => {
    const short = {rank: 1, text: "예금", score: null, source: null};
    expect(usedInAnswer(short, "예금자보호")).toBe(true);
    expect(usedInAnswer(short, "보호")).toBe(false);
  });
});

describe("matchedPrefixEnd", () => {
  const long = {rank: 1, text: LONG, score: null, source: null};

  it("실리지 않았으면 하이라이트 구간이 없다", () => {
    expect(matchedPrefixEnd(long, "전혀 다른 문장입니다.")).toBe(0);
  });

  it("통째로 실렸으면 원문 끝까지 표시한다", () => {
    const end = matchedPrefixEnd(long, `참고:\n${LONG}\n질문: ...`);
    expect(end).toBe(LONG.trimEnd().length);
  });

  it("앞부분만 실렸으면 그만큼만 표시한다", () => {
    const head = LONG.slice(0, 100);
    const end = matchedPrefixEnd(long, `참고:\n${head}\n다른 이야기`);
    expect(end).toBeGreaterThan(0);
    expect(end).toBeLessThan(LONG.length);
    expect(LONG.slice(0, end).trim()).toBe(head.trim().slice(0, end).trim());
  });
});

describe("flattenText", () => {
  it("중첩된 JSON에서 문자열만 모은다", () => {
    expect(
      flattenText({messages: [{role: "user", content: "안녕"}], n: 3}),
    ).toContain("안녕");
  });

  it("문자열이 없으면 빈 문자열이다", () => {
    expect(flattenText({a: 1, b: null})).toBe("");
  });
});

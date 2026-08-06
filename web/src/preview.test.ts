import {describe, expect, it} from "vitest";

import {valuePreview} from "./components";
import {previewOf, previewText} from "./preview";

describe("previewText", () => {
  it("한 field짜리 payload는 값만 남긴다", () => {
    expect(previewText('{"question": "청약철회 기간은?"}')).toBe(
      "청약철회 기간은?",
    );
  });

  it("여러 field는 값을 순서대로 잇는다", () => {
    expect(previewText('{"a": "질문", "b": "답변"}')).toBe("질문 · 답변");
  });

  it("중첩과 배열을 펴서 읽는다", () => {
    expect(previewText('{"messages": [{"content": "안녕"}, {"content": "네"}]}')).toBe(
      "안녕 · 네",
    );
  });

  it("숫자와 boolean도 값으로 센다", () => {
    expect(previewText('{"n": 3, "ok": true}')).toBe("3 · true");
  });

  it("JSON이 아니면 원문을 그대로 둔다", () => {
    // 서버가 길이 제한으로 잘라 보낸 preview는 되읽을 수 없다.
    expect(previewText('{"question": "아주 긴 질문...')).toBe(
      '{"question": "아주 긴 질문...',
    );
  });

  it("읽어낼 값이 없으면 원문을 둔다", () => {
    expect(previewText("{}")).toBe("{}");
    expect(previewText('{"a": null}')).toBe('{"a": null}');
  });

  it("문자열 하나만 직렬화된 경우도 값만 남긴다", () => {
    expect(previewText('"그냥 문자열"')).toBe("그냥 문자열");
  });
});

describe("valuePreview", () => {
  it("없는 값은 다른 빈 표기와 같은 —로 읽힌다", () => {
    expect(valuePreview(null)).toBe("—");
    expect(valuePreview(undefined)).toBe("—");
  });

  it("값이 있으면 값만 남긴다", () => {
    expect(valuePreview({answer: "14일"})).toBe("14일");
  });

  it("읽어낼 값이 없으면 JSON으로 되돌린다", () => {
    expect(valuePreview({})).toBe("{}");
  });
});

describe("previewOf", () => {
  it("직렬화되지 않은 JSON 값에서 값만 뽑는다", () => {
    expect(previewOf({answer: "14일", source: "약관.pdf"})).toBe(
      "14일 · 약관.pdf",
    );
  });

  it("비어 있으면 빈 문자열이다", () => {
    expect(previewOf({})).toBe("");
    expect(previewOf(null)).toBe("");
  });
});

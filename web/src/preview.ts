import type {JsonValue} from "./api/types";

/**
 * payload를 목록에서 한 줄로 읽기 위한 요약. key와 괄호를 걷어내고 값만 남긴다.
 *
 * 서버는 input/output을 JSON 그대로 직렬화해 보낸다. 목록에서 사용자가 읽고
 * 싶은 것은 질문과 답변이지 payload의 모양이 아니다. 원문 JSON은 검사기의
 * Input/Output 탭에 그대로 남아 있으므로 여기서 접어도 잃는 정보가 없다.
 *
 * 길이 제한에 걸려 잘린 preview는 JSON으로 되읽을 수 없다. 그때는 원문을
 * 그대로 돌려준다 — 읽어낼 수 없는 것을 지어내지 않는다.
 */
export function previewText(raw: string): string {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
  const values: string[] = [];
  collectLeaves(parsed, values);
  return values.length === 0 ? raw : values.join(" · ");
}

/** JSON 값을 그대로 받아 한 줄로 만든다. 문자열로 직렬화된 적 없는 값에 쓴다. */
export function previewOf(value: JsonValue): string {
  const values: string[] = [];
  collectLeaves(value, values);
  return values.join(" · ");
}

function collectLeaves(value: JsonValue, out: string[]): void {
  if (value === null) return;
  if (typeof value === "string") {
    if (value.trim() !== "") out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLeaves(item, out));
    return;
  }
  Object.values(value).forEach((item) => collectLeaves(item, out));
}

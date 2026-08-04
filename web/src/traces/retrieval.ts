import type {JsonValue} from "../api/types";

/**
 * retriever observation의 output에서 문서를 읽어낸다.
 *
 * payload 모양은 retriever 구현마다 다르다. LangChain Document를 그대로 직렬화한
 * 것일 수도 있고 문자열 배열일 수도 있다. 있는 field만 쓰고 없는 값은 추정하지
 * 않는다 — 없는 score를 0으로 채우면 디버깅 도구가 거짓말을 하게 된다.
 */
export type RetrievedDocument = {
  /** array 순서. 1부터 센다. */
  rank: number;
  text: string;
  score: number | null;
  source: string | null;
};

function record(value: JsonValue): {[key: string]: JsonValue} | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function firstString(
  source: {[key: string]: JsonValue} | null,
  keys: string[],
): string | null {
  if (source === null) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function firstNumber(
  source: {[key: string]: JsonValue} | null,
  keys: string[],
): number | null {
  if (source === null) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function documentText(item: JsonValue): string | null {
  if (typeof item === "string") return item.trim() === "" ? null : item;
  return firstString(record(item), ["page_content", "text", "content"]);
}

export function readDocuments(output: JsonValue): RetrievedDocument[] {
  if (!Array.isArray(output)) return [];
  const documents: RetrievedDocument[] = [];
  output.forEach((item) => {
    const text = documentText(item);
    if (text === null) return;
    const fields = record(item);
    const metadata = record(fields?.metadata ?? null);
    documents.push({
      rank: documents.length + 1,
      text,
      score:
        firstNumber(fields, ["score", "relevance_score"]) ??
        firstNumber(metadata, ["score"]),
      source:
        firstString(metadata, ["source", "file_path"]) ??
        firstString(fields, ["id"]),
    });
  });
  return documents;
}

/**
 * 문자열 대조로 쓸 비교 키. 공백만 접는다. 길이가 짧으면 우연히 일치하므로
 * 대조에 쓰지 않는다.
 */
const MIN_MATCH_LENGTH = 40;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 문서가 하류 llm input에 실렸는지. `llmInput`이 null이면(아직 못 읽었거나 llm
 * observation이 없으면) 판정 자체를 하지 않는다 — 호출부가 배지를 감춘다.
 */
export function usedInAnswer(
  document: RetrievedDocument,
  llmInput: string,
): boolean {
  const haystack = normalize(llmInput);
  const needle = normalize(document.text);
  if (needle.length < MIN_MATCH_LENGTH) {
    // 짧은 문서는 전체가 일치할 때만 인정한다.
    return needle !== "" && haystack.includes(needle);
  }
  // 긴 문서는 앞부분이 통째로 실렸는지 본다. chunk가 잘려 들어가는 경우가 많다.
  return haystack.includes(needle.slice(0, MIN_MATCH_LENGTH * 2));
}

/** JSON 어디에 있든 문자열을 모아 하나로 잇는다. llm input 모양이 제각각이다. */
export function flattenText(value: JsonValue): string {
  const parts: string[] = [];
  const walk = (node: JsonValue) => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const asRecord = record(node);
    if (asRecord !== null) Object.values(asRecord).forEach(walk);
  };
  walk(value);
  return parts.join("\n");
}

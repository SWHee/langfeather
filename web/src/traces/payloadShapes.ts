import type {JsonValue, Observation} from "../api/types";

/**
 * llm과 tool payload를 읽어내는 순수 함수들.
 *
 * payload는 LangChain 객체를 직렬화한 것이라 `__type__`과 `fields`로 감싸여
 * 있다. 모양이 다르면 null이나 빈 배열을 돌려주고, 호출부는 일반 JSON tree로
 * 되돌린다. 값을 추정해 채우지 않는다.
 */

export type LlmMessage = {
  role: string;
  content: string;
};

export type TokenUsage = {
  input: number | null;
  output: number | null;
  total: number | null;
};

function record(value: JsonValue): {[key: string]: JsonValue} | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/** LangChain 직렬화는 실제 값을 `fields` 안에 넣는다. 없으면 그대로 쓴다. */
function unwrap(value: JsonValue): {[key: string]: JsonValue} | null {
  const asRecord = record(value);
  if (asRecord === null) return null;
  return record(asRecord.fields) ?? asRecord;
}

/** content는 문자열이거나 block 배열이다. block 배열이면 text만 이어 붙인다. */
function messageContent(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      if (typeof block === "string") return block;
      const text = record(block)?.text;
      return typeof text === "string" ? text : "";
    })
    .filter((text) => text !== "")
    .join("\n");
}

function roleOf(value: JsonValue): string | null {
  const fields = unwrap(value);
  if (fields === null) return null;
  const type = fields.type;
  if (typeof type === "string" && type !== "") return type;
  // type이 없으면 __type__ 끝의 class 이름에서 읽는다. SystemMessage -> system.
  const typeName = record(value)?.__type__;
  if (typeof typeName !== "string") return null;
  const last = typeName.split(".").pop() ?? "";
  const match = /^(\w+?)Message/.exec(last);
  return match === null ? null : match[1].toLowerCase();
}

/**
 * llm input에서 message를 읽는다. LangChain은 prompt를 `[[message, ...]]`로
 * 넘기지만 `[message, ...]` 한 겹인 경우도 받는다.
 */
export function readLlmMessages(input: JsonValue): LlmMessage[] {
  if (!Array.isArray(input)) return [];
  const flat = input.every((item) => Array.isArray(item))
    ? (input as JsonValue[][]).flat()
    : input;
  const messages: LlmMessage[] = [];
  flat.forEach((item) => {
    const role = roleOf(item);
    if (role === null) return;
    const fields = unwrap(item);
    const content = messageContent(fields?.content ?? null);
    if (content === "") return;
    messages.push({role, content});
  });
  return messages;
}

/** llm output에서 응답 text를 읽는다. */
export function readLlmCompletion(output: JsonValue): string | null {
  const fields = unwrap(output);
  const generations = fields?.generations;
  if (!Array.isArray(generations)) return null;
  const first = generations.flat().find((item) => {
    const text = record(item)?.text;
    return typeof text === "string" && text !== "";
  });
  const text = record(first ?? null)?.text;
  return typeof text === "string" ? text : null;
}

/** `Usage`는 typed interface라 JsonValue가 아니다. 필요한 field만 받는다. */
type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
};

export function readTokenUsage(usage: UsageLike | null): TokenUsage | null {
  if (usage === null) return null;
  const read = (value: number | null | undefined): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const result = {
    input: read(usage.input_tokens),
    output: read(usage.output_tokens),
    total: read(usage.total_tokens),
  };
  const hasAny =
    result.input !== null || result.output !== null || result.total !== null;
  return hasAny ? result : null;
}

/** tool 호출 인자. object가 아니면 시그니처를 만들 수 없다. */
export function readToolArguments(
  input: JsonValue,
): Array<{name: string; value: JsonValue}> {
  const fields = record(input);
  if (fields === null) return [];
  return Object.entries(fields).map(([name, value]) => ({name, value}));
}

/**
 * tool 반환값. ToolMessage면 content를 꺼내고, 그것이 JSON 문자열이면 파싱한다.
 * 파싱에 실패하면 문자열 그대로 둔다 — 고쳐서 보여주지 않는다.
 */
export function readToolResult(output: JsonValue): JsonValue {
  const fields = unwrap(output);
  const content = fields?.content;
  const raw = content === undefined ? output : content;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

/** 인자를 `name(a=1, b="x")` 한 줄로 만든다. 긴 값은 호출부가 자른다. */
export function toolSignature(
  name: string,
  args: Array<{name: string; value: JsonValue}>,
): string {
  const rendered = args
    .map((arg) => `${arg.name}=${JSON.stringify(arg.value)}`)
    .join(", ");
  return `${name}(${rendered})`;
}

/** 전용 renderer로 읽어낼 수 있는 payload인지. 아니면 JSON tree로 되돌린다. */
export function hasKindView(observation: Observation): boolean {
  if (observation.kind === "llm") {
    return (
      readLlmMessages(observation.input).length > 0 ||
      readLlmCompletion(observation.output) !== null
    );
  }
  if (observation.kind === "tool") {
    return readToolArguments(observation.input).length > 0;
  }
  return false;
}

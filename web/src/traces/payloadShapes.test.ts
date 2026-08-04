import {describe, expect, it} from "vitest";

import type {JsonValue} from "../api/types";
import {
  readLlmCompletion,
  readLlmMessages,
  readTokenUsage,
  readToolArguments,
  readToolResult,
  toolSignature,
} from "./payloadShapes";

// 실제 collector에 저장된 모양이다. LangChain 객체를 __type__/fields로 감싼다.
const SYSTEM = {
  __type__: "langchain_core.messages.system.SystemMessage",
  fields: {content: "당신은 상담 Agent입니다.", type: "system"},
};
const HUMAN = {
  __type__: "langchain_core.messages.human.HumanMessage",
  fields: {content: "은행이 파산하면?", type: "human"},
};

describe("readLlmMessages", () => {
  it("prompt가 두 겹 배열이어도 편다", () => {
    expect(readLlmMessages([[SYSTEM, HUMAN]])).toEqual([
      {role: "system", content: "당신은 상담 Agent입니다."},
      {role: "human", content: "은행이 파산하면?"},
    ]);
  });

  it("한 겹 배열도 받는다", () => {
    expect(readLlmMessages([HUMAN])).toHaveLength(1);
  });

  it("type이 없으면 __type__의 class 이름에서 역할을 읽는다", () => {
    const message = {
      __type__: "langchain_core.messages.ai.AIMessage",
      fields: {content: "답변"},
    };
    expect(readLlmMessages([message])[0]?.role).toBe("ai");
  });

  it("content가 block 배열이면 text만 이어 붙인다", () => {
    const message: JsonValue = {
      __type__: "langchain_core.messages.ai.AIMessage",
      fields: {
        type: "ai",
        content: [
          {type: "text", text: "확인해드리겠습니다."},
          {type: "tool_use", name: "search", input: {}},
        ],
      },
    };
    expect(readLlmMessages([message])[0]?.content).toBe("확인해드리겠습니다.");
  });

  it("배열이 아니거나 읽을 message가 없으면 빈 배열이다", () => {
    expect(readLlmMessages({prompt: "x"})).toEqual([]);
    expect(readLlmMessages([{unrelated: 1}])).toEqual([]);
  });
});

describe("readLlmCompletion", () => {
  it("generations에서 응답 text를 읽는다", () => {
    const output = {
      __type__: "langchain_core.outputs.llm_result.LLMResult",
      fields: {generations: [[{text: "예금은 1억원까지 보호됩니다."}]]},
    };
    expect(readLlmCompletion(output)).toBe("예금은 1억원까지 보호됩니다.");
  });

  it("모양이 다르면 null이다", () => {
    expect(readLlmCompletion({answer: "x"})).toBeNull();
    expect(readLlmCompletion(null)).toBeNull();
  });
});

describe("readTokenUsage", () => {
  it("token 수를 읽는다", () => {
    expect(
      readTokenUsage({input_tokens: 1263, output_tokens: 111, total_tokens: 1374}),
    ).toEqual({input: 1263, output: 111, total: 1374});
  });

  it("없는 token 수를 0으로 채우지 않는다", () => {
    expect(readTokenUsage({input_tokens: 10})).toEqual({
      input: 10,
      output: null,
      total: null,
    });
  });

  it("usage가 없으면 null이다", () => {
    expect(readTokenUsage(null)).toBeNull();
    expect(readTokenUsage({input_tokens: null})).toBeNull();
  });
});

describe("tool payload", () => {
  it("인자를 시그니처 한 줄로 만든다", () => {
    const args = readToolArguments({question: "예금 보호 한도", top_k: 3});
    expect(toolSignature("search_law_articles", args)).toBe(
      'search_law_articles(question="예금 보호 한도", top_k=3)',
    );
  });

  it("ToolMessage의 content가 JSON 문자열이면 파싱한다", () => {
    const output = {
      __type__: "langchain_core.messages.tool.ToolMessage",
      fields: {content: '{"status":"ok","articles":[]}'},
    };
    expect(readToolResult(output)).toEqual({status: "ok", articles: []});
  });

  it("파싱에 실패하면 문자열 그대로 둔다", () => {
    const output = {
      __type__: "langchain_core.messages.tool.ToolMessage",
      fields: {content: "not json"},
    };
    expect(readToolResult(output)).toBe("not json");
  });

  it("인자가 object가 아니면 시그니처를 만들지 않는다", () => {
    expect(readToolArguments("문자열 인자")).toEqual([]);
  });
});

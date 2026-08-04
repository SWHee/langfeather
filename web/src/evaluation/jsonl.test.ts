import { describe, expect, it } from "vitest";

import type { DatasetExample } from "../api/types";
import { examplesToJsonl, jsonlFileName, parseJsonl } from "./jsonl";

function example(overrides: Partial<DatasetExample> = {}): DatasetExample {
  return {
    dataset_example_id: "dse_1",
    position: 0,
    input: { question: "지원 대상은?" },
    expected_output: { answer: "청년" },
    metadata: {},
    source_trace_id: "tr_1",
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    ...overrides,
  };
}

describe("examplesToJsonl", () => {
  it("writes only the portable fields, one example per line", () => {
    const contents = examplesToJsonl([
      example(),
      example({
        dataset_example_id: "dse_2",
        position: 1,
        input: { question: "제외 대상은?" },
        expected_output: null,
        metadata: { category: "eligibility" },
      }),
    ]);

    expect(
      contents
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
    ).toEqual([
      {
        input: { question: "지원 대상은?" },
        expected_output: { answer: "청년" },
        metadata: {},
      },
      {
        input: { question: "제외 대상은?" },
        expected_output: null,
        metadata: { category: "eligibility" },
      },
    ]);
    expect(contents).toMatch(/\n$/);
    expect(contents).not.toContain("source_trace_id");
    expect(contents).not.toContain("dataset_example_id");
  });

  it("writes nothing for an empty dataset", () => {
    expect(examplesToJsonl([])).toBe("");
  });
});

describe("parseJsonl", () => {
  it("round-trips exported contents", () => {
    const examples = [example(), example({ dataset_example_id: "dse_2" })];

    const { entries, failedLines } = parseJsonl(examplesToJsonl(examples));

    expect(failedLines).toEqual([]);
    expect(entries.map((entry) => entry.example)).toEqual(
      examples.map((item) => ({
        input: item.input,
        expected_output: item.expected_output,
        metadata: item.metadata,
      })),
    );
  });

  it("skips blank lines and reports the original number of failed lines", () => {
    const { entries, failedLines } = parseJsonl(
      [
        '{"input":{"question":"첫 줄"},"metadata":{"source":"jsonl"}}',
        "",
        '{"input":',
        '{"expected_output":{"answer":"답"}}',
        '{"input":1,"metadata":[]}',
        '{"input":{"question":"여섯째 줄"}}',
      ].join("\n"),
    );

    expect(failedLines).toEqual([3, 4, 5]);
    expect(entries).toEqual([
      {
        lineNumber: 1,
        example: {
          input: { question: "첫 줄" },
          expected_output: null,
          metadata: { source: "jsonl" },
        },
      },
      {
        lineNumber: 6,
        example: {
          input: { question: "여섯째 줄" },
          expected_output: null,
          metadata: {},
        },
      },
    ]);
  });

  it("keeps an explicit null input and defaults the optional fields", () => {
    const { entries, failedLines } = parseJsonl('{"input":null}\r\n');

    expect(failedLines).toEqual([]);
    expect(entries[0]?.example).toEqual({
      input: null,
      expected_output: null,
      metadata: {},
    });
  });
});

describe("jsonlFileName", () => {
  it("normalizes the dataset name", () => {
    expect(
      jsonlFileName({ name: "RAG regression v2", dataset_id: "ds_1" }),
    ).toBe("RAG-regression-v2.jsonl");
  });

  it("falls back to the dataset ID when no safe character remains", () => {
    expect(jsonlFileName({ name: "회귀 검증", dataset_id: "ds_1" })).toBe(
      "ds_1.jsonl",
    );
  });
});

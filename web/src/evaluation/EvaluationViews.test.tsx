import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluationView } from "./EvaluationViews";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

const dataset = {
  dataset_id: "ds_regression",
  name: "RAG regression",
  description: "reviewed failures",
  revision: 1,
  example_count: 1,
  created_at: "2026-07-28T10:00:00.000000Z",
  updated_at: "2026-07-28T10:00:00.000000Z",
  examples: [
    {
      dataset_example_id: "dse_1",
      position: 0,
      input: { question: "지원 대상은?" },
      expected_output: { answer: "청년" },
      metadata: {},
      source_trace_id: "tr_reviewed",
      created_at: "2026-07-28T10:00:00.000000Z",
      updated_at: "2026-07-28T10:00:00.000000Z",
    },
  ],
};

describe("EvaluationView", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the selected dataset revision and preserves optional expected output", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/datasets")) {
        return Promise.resolve(jsonResponse({ items: [dataset] }));
      }
      if (url.endsWith("/experiments")) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }
      if (url.endsWith("/datasets/ds_regression")) {
        return Promise.resolve(jsonResponse(dataset));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(<EvaluationView />);

    expect(await screen.findByRole("heading", { name: "RAG regression" })).toBeInTheDocument();
    expect(screen.getByText("Dataset · revision 1")).toBeInTheDocument();
    expect(screen.getByText("Expected output은 의도적으로 비워 둘 수 있습니다.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/datasets", expect.any(Object));
  });
});

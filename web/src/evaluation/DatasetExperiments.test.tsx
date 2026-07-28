import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetExperiments } from "./DatasetExperiments";
import type { ExperimentSummary } from "../api/types";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

const summary: ExperimentSummary = {
  experiment_id: "exp_1",
  dataset_id: "ds_regression",
  dataset_revision: 3,
  name: "baseline",
  status: "completed",
  started_at: "2026-07-28T11:00:00.000000Z",
  ended_at: "2026-07-28T11:00:09.000000Z",
  case_count: 1,
  completed_case_count: 1,
  failed_case_count: 0,
};

const detail = {
  ...summary,
  target_metadata: {},
  evaluators: [
    {
      experiment_evaluator_id: "exe_1",
      key: "exact_match",
      name: "Exact match",
      data_type: "boolean",
      position: 0,
    },
  ],
  cases: [
    {
      experiment_case_id: "exc_1",
      dataset_example_id: "dse_1",
      position: 0,
      input: { question: "지원 대상은?" },
      expected_output: { answer: "청년" },
      metadata: {},
      status: "completed",
      output: { answer: "청년" },
      error: null,
      duration_us: 1_500_000,
      trace_id: "tr_run",
      completed_at: "2026-07-28T11:00:09.000000Z",
      evaluator_results: [
        { evaluator_key: "exact_match", value: true, error_message: null },
      ],
    },
  ],
};

describe("DatasetExperiments", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("points at the SDK when a dataset has no experiments", () => {
    render(<DatasetExperiments experiments={[]} />);

    expect(screen.getByText("아직 experiment가 없습니다.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads case results and the pinned dataset revision on selection", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/experiments/exp_1")) {
        return Promise.resolve(jsonResponse(detail));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(<DatasetExperiments experiments={[summary]} />);
    await userEvent.click(screen.getByRole("button", { name: "baseline" }));

    expect(
      await screen.findByRole("heading", { level: 2, name: "baseline" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Dataset revision 3 · 1 completed · 0 target failures/),
    ).toBeInTheDocument();
    expect(screen.getByText("exact_match: true")).toBeInTheDocument();
    expect(screen.getByText("1.50 s")).toBeInTheDocument();
    expect(screen.getByText("tr_run")).toBeInTheDocument();
  });

  it("offers comparison only against experiments on the same revision", async () => {
    const otherRevision: ExperimentSummary = {
      ...summary,
      experiment_id: "exp_2",
      name: "older revision",
      dataset_revision: 2,
    };
    const sameRevision: ExperimentSummary = {
      ...summary,
      experiment_id: "exp_3",
      name: "tuned prompt",
    };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/experiments/exp_1")) {
        return Promise.resolve(jsonResponse(detail));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(
      <DatasetExperiments
        experiments={[summary, otherRevision, sameRevision]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "baseline" }));

    const select = await screen.findByLabelText(/Compare with/);
    const options = Array.from(
      select.querySelectorAll("option"),
      (option) => option.textContent,
    );
    expect(options).toEqual(["No comparison", "tuned prompt"]);
  });
});

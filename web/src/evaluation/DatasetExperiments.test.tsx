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

  it("does not preload experiment details when the list opens", () => {
    render(<DatasetExperiments experiments={[summary]} />);

    expect(screen.getByRole("button", { name: "baseline" })).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lazily renders evaluator and duration summaries for an expanded row", async () => {
    const aggregateDetail = {
      ...detail,
      case_count: 2,
      completed_case_count: 2,
      evaluators: [
        ...detail.evaluators,
        {
          experiment_evaluator_id: "exe_2",
          key: "relevance",
          name: "Relevance",
          data_type: "number",
          position: 1,
        },
      ],
      cases: [
        {
          ...detail.cases[0],
          duration_us: 1_000_000,
          evaluator_results: [
            { evaluator_key: "exact_match", value: true, error_message: null },
            { evaluator_key: "relevance", value: 3, error_message: null },
          ],
        },
        {
          ...detail.cases[0],
          experiment_case_id: "exc_2",
          dataset_example_id: "dse_2",
          position: 1,
          duration_us: 3_000_000,
          evaluator_results: [
            { evaluator_key: "exact_match", value: false, error_message: null },
            { evaluator_key: "relevance", value: 5, error_message: null },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValue(jsonResponse(aggregateDetail));

    render(<DatasetExperiments experiments={[summary]} />);
    await userEvent.click(
      screen.getByRole("button", { name: "baseline 결과 요약 펼치기" }),
    );

    expect(await screen.findByText("Exact match 50.0% 통과 (1/2)")).toBeInTheDocument();
    expect(screen.getByText("Relevance 평균 4")).toBeInTheDocument();
    expect(screen.getByText("평균 실행 시간 2.00 s")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/experiments\/exp_1$/,
    );
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
      screen.getByText(/Dataset revision 3 · 1 완료 · 0 target 실패/),
    ).toBeInTheDocument();
    expect(screen.getByText("exact_match: true")).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(screen.getByText("1.50 s")).toBeInTheDocument();
    expect(screen.getByText("tr_run")).toBeInTheDocument();
  });

  it("keeps detail focused on one experiment and points to the Compare tab", async () => {
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
        experiments={[summary, sameRevision]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "baseline" }));

    expect(
      await screen.findByText("Experiment 비교는 Compare 탭에서 확인하세요."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Compare with/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Compare 탭으로 이동" }),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers Compare tab navigation when the parent provides it", async () => {
    const onRequestCompare = vi.fn();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/experiments/exp_1")) {
        return Promise.resolve(jsonResponse(detail));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(
      <DatasetExperiments
        experiments={[summary]}
        onRequestCompare={onRequestCompare}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "baseline" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Compare 탭으로 이동" }),
    );

    expect(onRequestCompare).toHaveBeenCalledOnce();
  });
});

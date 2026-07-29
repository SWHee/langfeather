import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Experiment, ExperimentSummary } from "../api/types";
import { CompareView } from "./CompareView";
import type { EvaluationUrlState } from "../url";

const { getExperimentMock } = vi.hoisted(() => ({
  getExperimentMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  getExperiment: getExperimentMock,
}));

function make(id: string, name: string, value: number): Experiment {
  return {
    experiment_id: id,
    dataset_id: "dataset_1",
    dataset_revision: 1,
    name,
    status: "completed",
    started_at: "2026-07-29T00:00:00.000Z",
    ended_at: "2026-07-29T00:01:00.000Z",
    case_count: 1,
    completed_case_count: 1,
    failed_case_count: 0,
    target_metadata: {},
    evaluators: [
      {
        experiment_evaluator_id: "ev_score",
        key: "score",
        name: "Score",
        data_type: "number",
        position: 0,
      },
    ],
    cases: [
      {
        experiment_case_id: `case_${id}`,
        dataset_example_id: "example_0",
        position: 0,
        input: { question: "q" },
        expected_output: null,
        metadata: {},
        status: "completed",
        output: { answer: "a" },
        error: null,
        duration_us: 1000,
        trace_id: null,
        completed_at: "2026-07-29T00:00:01.000Z",
        evaluator_results: [
          { evaluator_key: "score", value, error_message: null },
        ],
      },
    ],
  };
}

const first = make("exp_first", "First", 1);
const second = make("exp_second", "Second", 5);

function summary(item: Experiment): ExperimentSummary {
  const { target_metadata, evaluators, cases, ...rest } = item;
  void target_metadata;
  void evaluators;
  void cases;
  return rest;
}

// DatasetsView가 실제로 하는 것처럼 urlState를 부모 state로 보유한 wrapper
function Harness() {
  const [urlState, setUrlState] = useState<
    Pick<EvaluationUrlState, "experimentIds" | "metricKeys" | "caseId">
  >({ experimentIds: [], metricKeys: [], caseId: null });
  const handleUrlStateChange = useCallback(
    (next: Pick<EvaluationUrlState, "experimentIds" | "metricKeys" | "caseId">) =>
      setUrlState((current) => ({ ...current, ...next })),
    [],
  );
  return (
    <>
      <div data-testid="url-order">{urlState.experimentIds.join(",")}</div>
      <CompareView
        experiments={[summary(first), summary(second)]}
        urlState={urlState}
        onUrlStateChange={handleUrlStateChange}
      />
    </>
  );
}

describe("CompareView with URL state wired", () => {
  beforeEach(() => {
    getExperimentMock.mockReset();
    getExperimentMock.mockImplementation((id: string) =>
      Promise.resolve(id === "exp_first" ? first : second),
    );
  });

  it("reorders experiments so the chosen one becomes the baseline", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("checkbox", { name: /First/ }));
    await user.click(screen.getByRole("checkbox", { name: /Second/ }));
    await screen.findByRole("heading", { level: 3, name: "Score" });

    expect(screen.getByTestId("url-order")).toHaveTextContent(
      "exp_first,exp_second",
    );

    await user.click(
      screen.getByRole("button", { name: /Second을.*기준으로 설정/ }),
    );

    const firstRow = await screen.findByRole("row", {
      name: /First case 비교 열기/,
    });
    expect(within(firstRow).getByText("기준 대비 -4")).toBeInTheDocument();
    expect(screen.getByTestId("url-order")).toHaveTextContent(
      "exp_second,exp_first",
    );
  });
});

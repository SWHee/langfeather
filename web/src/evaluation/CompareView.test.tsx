import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EvaluatorDataType,
  Experiment,
  ExperimentCase,
  ExperimentEvaluator,
  ExperimentResult,
  ExperimentSummary,
} from "../api/types";
import { CompareView } from "./CompareView";

const { getExperimentMock } = vi.hoisted(() => ({
  getExperimentMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  getExperiment: getExperimentMock,
}));

function evaluator(
  key: string,
  name: string,
  dataType: EvaluatorDataType,
): ExperimentEvaluator {
  return {
    experiment_evaluator_id: `evaluator_${key}`,
    key,
    name,
    data_type: dataType,
    position: 0,
  };
}

function result(
  evaluatorKey: string,
  value: boolean | number | null,
  errorMessage: string | null = null,
): ExperimentResult {
  return {
    evaluator_key: evaluatorKey,
    value,
    error_message: errorMessage,
  };
}

function experimentCase(
  id: string,
  evaluatorResults: ExperimentResult[],
  options: {
    status?: ExperimentCase["status"];
    traceId?: string | null;
  } = {},
): ExperimentCase {
  const status = options.status ?? "completed";
  return {
    experiment_case_id: `case_${id}`,
    dataset_example_id: `example_${id}`,
    position: Number(id),
    input: { question: `question ${id}` },
    expected_output: { answer: `expected ${id}` },
    metadata: {},
    status,
    output: status === "failed" ? null : { answer: `actual ${id}` },
    error: status === "failed" ? { message: "target failed" } : null,
    duration_us: 1_000,
    trace_id: options.traceId ?? null,
    completed_at: "2026-07-29T00:00:01.000Z",
    evaluator_results: evaluatorResults,
  };
}

const exactMatch = evaluator("exact_match", "Exact match", "boolean");
const relevance = evaluator("relevance", "Relevance", "number");

function experiment(
  id: string,
  name: string,
  cases: ExperimentCase[],
  options: {
    revision?: number;
    evaluators?: ExperimentEvaluator[];
    status?: Experiment["status"];
  } = {},
): Experiment {
  const status = options.status ?? "completed";
  return {
    experiment_id: id,
    dataset_id: "dataset_1",
    dataset_revision: options.revision ?? 3,
    name,
    status,
    started_at: "2026-07-29T00:00:00.000Z",
    ended_at: status === "running" ? null : "2026-07-29T00:01:00.000Z",
    case_count: cases.length,
    completed_case_count: cases.filter(
      ({ status: caseStatus }) => caseStatus !== "pending",
    ).length,
    failed_case_count: cases.filter(
      ({ status: caseStatus }) => caseStatus === "failed",
    ).length,
    target_metadata: {},
    evaluators: options.evaluators ?? [exactMatch, relevance],
    cases,
  };
}

const baseline = experiment("exp_baseline", "Baseline", [
  experimentCase("0", [result("exact_match", true), result("relevance", 2)], {
    traceId: "tr_baseline_0",
  }),
  experimentCase("1", [result("exact_match", false), result("relevance", 4)]),
  experimentCase("2", [
    result("exact_match", null, "judge unavailable"),
    result("relevance", null),
  ]),
]);

const candidate = experiment("exp_candidate", "Candidate", [
  experimentCase("0", [result("exact_match", true), result("relevance", 4)]),
  experimentCase("1", [result("exact_match", true), result("relevance", 6)]),
  experimentCase("2", [
    result("exact_match", null),
    result("relevance", null, "invalid score"),
  ]),
]);

const otherRevision = experiment(
  "exp_other",
  "Other revision",
  [experimentCase("0", [result("exact_match", true)])],
  { revision: 4, evaluators: [exactMatch] },
);

function summary(item: Experiment): ExperimentSummary {
  const {
    experiment_id,
    dataset_id,
    dataset_revision,
    name,
    status,
    started_at,
    ended_at,
    case_count,
    completed_case_count,
    failed_case_count,
  } = item;
  return {
    experiment_id,
    dataset_id,
    dataset_revision,
    name,
    status,
    started_at,
    ended_at,
    case_count,
    completed_case_count,
    failed_case_count,
  };
}

const summaries = [
  summary(baseline),
  summary(candidate),
  summary(otherRevision),
];

async function selectExperiments(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("checkbox", { name: /Baseline/ }));
  await user.click(screen.getByRole("checkbox", { name: /Candidate/ }));
}

describe("CompareView", () => {
  beforeEach(() => {
    getExperimentMock.mockReset();
    getExperimentMock.mockImplementation((experimentId: string) => {
      const item = [baseline, candidate, otherRevision].find(
        ({ experiment_id: id }) => id === experimentId,
      );
      return item === undefined
        ? Promise.reject(new Error("not found"))
        : Promise.resolve(item);
    });
  });

  it("shows a complete copyable evaluate example for an empty dataset", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<CompareView datasetId="ds_empty_compare" experiments={[]} />);

    const quickstart = screen.getByRole("region", {
      name: "평가 시작 예제",
    });
    expect(quickstart).toHaveTextContent('dataset="ds_empty_compare"');
    expect(quickstart).toHaveTextContent("def answer(case: dict[str, str])");
    expect(quickstart).toHaveTextContent("target_metadata");
    expect(quickstart).not.toHaveTextContent("…");
    await user.click(
      within(quickstart).getByRole("button", { name: "evaluate 예제 복사" }),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('dataset="ds_empty_compare"'),
    );
    expect(quickstart).toHaveTextContent(
      'pip install -e "<경로>/sdk/python[langchain]"',
    );
  });

  it("automatically selects metrics shared by all selected experiments", async () => {
    const user = userEvent.setup();
    render(<CompareView experiments={summaries} />);

    await selectExperiments(user);

    expect(
      await screen.findByRole("checkbox", { name: /Exact match/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Relevance/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("heading", { level: 3, name: "Exact match" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Relevance" }),
    ).toBeInTheDocument();
  });

  it("renders only selected metrics with exact boolean rates and number means", async () => {
    const user = userEvent.setup();
    render(<CompareView experiments={summaries} />);

    await selectExperiments(user);
    await user.click(
      await screen.findByRole("checkbox", { name: /Relevance/ }),
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Exact match" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 3, name: "Relevance" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("50.0% (1/2 통과)")).not.toHaveLength(0);
    expect(screen.getAllByText("100.0% (2/2 통과)")).not.toHaveLength(0);

    await user.click(screen.getByRole("checkbox", { name: /Relevance/ }));

    expect(
      screen.getByRole("heading", { level: 3, name: "Relevance" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("평균 3")).not.toHaveLength(0);
    expect(screen.getAllByText("평균 5")).not.toHaveLength(0);
  });

  it("does not hide evaluator errors or cases without evaluation values", async () => {
    const user = userEvent.setup();
    render(<CompareView experiments={summaries} />);

    await selectExperiments(user);
    await screen.findByRole("checkbox", { name: /Exact match/ });

    const chart = screen.getByRole("img", { name: /Exact match 비교/ });
    expect(within(chart).getByText("오류 1")).toBeInTheDocument();
    expect(within(chart).getByText("평가값 없음 1")).toBeInTheDocument();
  });

  it("recalculates deltas after changing the baseline", async () => {
    const user = userEvent.setup();
    render(<CompareView experiments={summaries} />);

    await selectExperiments(user);
    await screen.findByRole("heading", { level: 3, name: "Relevance" });

    const candidateRow = screen.getByRole("row", {
      name: /Candidate case 비교 열기/,
    });
    expect(within(candidateRow).getByText("기준 대비 +2")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Candidate을.*기준으로 설정/,
      }),
    );

    const baselineRow = await screen.findByRole("row", {
      name: /Baseline case 비교 열기/,
    });
    const updatedCandidateRow = screen.getByRole("row", {
      name: /Candidate case 비교 열기/,
    });
    expect(within(baselineRow).getByText("기준 대비 -2")).toBeInTheDocument();
    expect(within(updatedCandidateRow).getByText("기준")).toBeInTheDocument();
  });

  it("explains why selections are limited to four", () => {
    render(<CompareView experiments={summaries} />);

    expect(
      screen.getAllByText(/화면 밀도와 가로 스크롤을 방지/),
    ).toHaveLength(2);
  });

  it("disables experiments from a different dataset revision", async () => {
    const user = userEvent.setup();
    render(<CompareView experiments={summaries} />);

    await user.click(screen.getByRole("checkbox", { name: /Baseline/ }));

    expect(
      screen.getByRole("checkbox", { name: /Other revision/ }),
    ).toBeDisabled();
    expect(screen.getByText("revision 4 전용")).toBeInTheDocument();
  });

  it("explains that one experiment cannot be compared", () => {
    render(<CompareView experiments={[summary(baseline)]} />);

    expect(
      screen.getByText("Experiment가 1개뿐이라 비교할 수 없습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows an API failure without rendering charts", async () => {
    getExperimentMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<CompareView experiments={summaries} />);

    await selectExperiments(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Experiment 비교 데이터를 불러오지 못했습니다.",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("filters cases by delta, target failure, and input preview search", async () => {
    const filterBaseline = experiment(
      "exp_filter_baseline",
      "Filter baseline",
      [
        experimentCase("0", [result("exact_match", true)]),
        experimentCase("1", [result("exact_match", true)]),
        experimentCase("2", [result("exact_match", false)]),
        experimentCase("3", [result("exact_match", true)]),
      ],
      { evaluators: [exactMatch] },
    );
    const filterCandidate = experiment(
      "exp_filter_candidate",
      "Filter candidate",
      [
        experimentCase("0", [result("exact_match", true)]),
        experimentCase("1", [result("exact_match", false)]),
        experimentCase("2", [result("exact_match", true)]),
        experimentCase("3", [], { status: "failed" }),
      ],
      { evaluators: [exactMatch] },
    );
    filterBaseline.cases[0]!.input = { question: "neutral prompt" };
    filterBaseline.cases[1]!.input = { question: "worse prompt" };
    filterBaseline.cases[2]!.input = { question: "better prompt" };
    filterBaseline.cases[3]!.input = { question: "failed prompt" };
    getExperimentMock.mockImplementation((experimentId: string) =>
      Promise.resolve(
        experimentId === filterBaseline.experiment_id
          ? filterBaseline
          : filterCandidate,
      ),
    );
    const user = userEvent.setup();
    render(
      <CompareView
        experiments={[summary(filterBaseline), summary(filterCandidate)]}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: /Filter baseline/ }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /Filter candidate/ }),
    );
    await screen.findByRole("heading", { level: 3, name: "Exact match" });
    await user.click(
      screen.getByRole("row", { name: /Filter baseline case 비교 열기/ }),
    );

    const caseList = screen.getByRole("navigation", { name: "비교할 case" });
    expect(
      within(caseList).getByRole("button", { name: /neutral prompt/ }),
    ).toBeInTheDocument();
    expect(
      within(caseList).getByRole("button", { name: /worse prompt/ }),
    ).toBeInTheDocument();
    expect(
      within(caseList).getByRole("button", { name: /better prompt/ }),
    ).toBeInTheDocument();
    expect(
      within(caseList).getByRole("button", { name: /failed prompt/ }),
    ).toBeInTheDocument();

    await user.selectOptions(
      within(caseList).getByRole("combobox", { name: "Case 결과 필터" }),
      "worse",
    );
    expect(
      within(caseList).getByRole("button", { name: /worse prompt/ }),
    ).toBeInTheDocument();
    expect(
      within(caseList).queryByRole("button", { name: /better prompt/ }),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      within(caseList).getByRole("combobox", { name: "Case 결과 필터" }),
      "better",
    );
    expect(
      within(caseList).getByRole("button", { name: /better prompt/ }),
    ).toBeInTheDocument();
    expect(
      within(caseList).queryByRole("button", { name: /worse prompt/ }),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      within(caseList).getByRole("combobox", { name: "Case 결과 필터" }),
      "failed",
    );
    expect(
      within(caseList).getByRole("button", { name: /failed prompt/ }),
    ).toBeInTheDocument();
    expect(
      within(caseList).queryByRole("button", { name: /better prompt/ }),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      within(caseList).getByRole("combobox", { name: "Case 결과 필터" }),
      "all",
    );
    await user.type(
      within(caseList).getByRole("searchbox", { name: "Case input 검색" }),
      "neutral",
    );
    expect(
      within(caseList).getByRole("button", { name: /neutral prompt/ }),
    ).toBeInTheDocument();
    expect(
      within(caseList).queryByRole("button", { name: /failed prompt/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the linked trace from a case detail", async () => {
    const user = userEvent.setup();
    const onOpenTrace = vi.fn();
    render(<CompareView experiments={summaries} onOpenTrace={onOpenTrace} />);

    await selectExperiments(user);
    await screen.findByRole("checkbox", { name: /Exact match/ });
    await user.click(
      screen.getByRole("row", { name: /Baseline case 비교 열기/ }),
    );
    await user.click(screen.getByRole("button", { name: /question 0/ }));

    const detail = screen.getByRole("region", { name: "Case 상세 비교" });
    await user.click(
      within(detail).getAllByRole("button", { name: "Trace 상세 열기" })[0]!,
    );

    expect(onOpenTrace).toHaveBeenCalledWith("tr_baseline_0");
  });

  it("identifies cases by input and exposes labeled, copyable JSON evidence", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CompareView experiments={summaries} />);

    await selectExperiments(user);
    await screen.findByRole("checkbox", { name: /Exact match/ });
    await user.click(
      screen.getByRole("row", { name: /Baseline case 비교 열기/ }),
    );

    const caseList = screen.getByRole("navigation", { name: "비교할 case" });
    expect(
      within(caseList).getByRole("button", { name: /question 0/ }),
    ).toBeInTheDocument();
    const baselineResult = screen.getByRole("article", {
      name: "Baseline case 결과",
    });
    expect(within(baselineResult).getByText("Expected")).toBeInTheDocument();
    expect(
      within(baselineResult).getByText("Actual (output)"),
    ).toBeInTheDocument();

    const actual = within(baselineResult).getByRole("group", {
      name: "Actual (output) JSON",
    });
    await user.click(
      within(actual).getByRole("button", {
        name: "Actual (output) JSON 복사",
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      '{\n  "answer": "actual 0"\n}',
    );
    await user.click(within(actual).getByText("전체 보기"));
    expect(within(actual).getByText("전체 보기").parentElement).toHaveAttribute(
      "open",
    );
  });
});

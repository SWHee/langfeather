import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const api = vi.hoisted(() => ({
  addAnnotationQueueItems: vi.fn(),
  addDatasetExample: vi.fn(),
  addTraceToDataset: vi.fn(),
  archiveScore: vi.fn(),
  completeAnnotationQueueItem: vi.fn(),
  createAnnotationQueue: vi.fn(),
  createScore: vi.fn(),
  deleteAnnotation: vi.fn(),
  deleteAnnotationQueue: vi.fn(),
  deleteAnnotationQueueItem: vi.fn(),
  deleteScore: vi.fn(),
  deleteTrace: vi.fn(),
  downloadBackup: vi.fn(),
  getAnnotationQueue: vi.fn(),
  getAnnotationQueues: vi.fn(),
  getDashboard: vi.fn(),
  getDataset: vi.fn(),
  getDatasets: vi.fn(),
  getExperiment: vi.fn(),
  getExperiments: vi.fn(),
  getObservation: vi.fn(),
  getScores: vi.fn(),
  getTrace: vi.fn(),
  getTraces: vi.fn(),
  putAnnotation: vi.fn(),
  putTraceMemo: vi.fn(),
  resetAllData: vi.fn(),
  updateScore: vi.fn(),
}));

vi.mock("./api/client", () => api);

const startedAt = "2026-08-02T01:00:00.000Z";
const trace = {
  trace_id: "tr_001",
  name: "Policy answer",
  started_at: startedAt,
  ended_at: "2026-08-02T01:00:01.000Z",
  duration_us: 1_000_000,
  status: "completed" as const,
  session_id: "session_01",
  user_id: null,
  release: null,
  environment: "local",
  tags: [],
  observation_count: 1,
  input_preview: "청년 정책 알려줘",
  output_preview: "지원 조건을 확인하세요.",
};

const score = {
  score_config_id: "score_001",
  name: "정확성",
  description: null,
  data_type: "boolean" as const,
  boolean_true_label: "좋음",
  boolean_false_label: "나쁨",
  number_min: null,
  number_max: null,
  categorical_selection_mode: null,
  options: [],
  created_at: startedAt,
  updated_at: startedAt,
  archived_at: null,
  has_annotations: false,
  is_used: false,
};

function mockDefaults() {
  api.getDashboard.mockResolvedValue({
    from: startedAt,
    to: startedAt,
    timezone: "UTC",
    bucket: "day",
    totals: {
      trace_count: 1,
      latency_us: { p50: 1_000, p95: 1_000, p99: 1_000 },
      error: { failed: 0, total: 1, rate: 0 },
      llm_calls: 1,
      tool_calls: 0,
    },
    available_tools: [],
    buckets: [],
  });
  api.getTraces.mockResolvedValue({ items: [trace], next_cursor: null });
  api.getTrace.mockResolvedValue({
    ...trace,
    observations: [
      {
        observation_id: "obs_001",
        trace_id: trace.trace_id,
        parent_observation_id: null,
        sequence: 0,
        name: "answer",
        kind: "llm",
        started_at: startedAt,
        ended_at: trace.ended_at,
        duration_us: 1_000_000,
        time_to_first_token_us: null,
        status: "completed",
        model: null,
      },
    ],
    score_configs: [score],
    annotations: [],
    memo: null,
    previous_trace_id: null,
    next_trace_id: null,
  });
  api.getObservation.mockResolvedValue({
    observation_id: "obs_001",
    trace_id: trace.trace_id,
    parent_observation_id: null,
    sequence: 0,
    name: "answer",
    kind: "llm",
    started_at: startedAt,
    ended_at: trace.ended_at,
    duration_us: 1_000_000,
    time_to_first_token_us: null,
    status: "completed",
    input: { question: "청년 정책" },
    output: { answer: "지원 조건을 확인하세요." },
    error: null,
    model: null,
    usage: null,
    metadata: {},
  });
  api.getAnnotationQueues.mockResolvedValue({ items: [] });
  api.getAnnotationQueue.mockResolvedValue({
    annotation_queue_id: "queue_001",
    name: "Release review",
    description: null,
    score_config_ids: [],
    items: [],
    created_at: startedAt,
    updated_at: startedAt,
  });
  api.getScores.mockResolvedValue({ items: [score] });
  api.getDatasets.mockResolvedValue({
    items: [
      {
        dataset_id: "dataset_001",
        name: "Youth policy",
        description: "평가 데이터",
        revision: 3,
        example_count: 1,
        created_at: startedAt,
        updated_at: startedAt,
      },
    ],
  });
  api.getDataset.mockResolvedValue({
    dataset_id: "dataset_001",
    name: "Youth policy",
    description: "평가 데이터",
    revision: 3,
    examples: [
      {
        dataset_example_id: "example_001",
        input: { question: "지원 대상" },
        expected_output: { answer: "청년" },
        metadata: {},
      },
    ],
    created_at: startedAt,
    updated_at: startedAt,
  });
  api.getExperiments.mockResolvedValue({ items: [] });
  api.getExperiment.mockResolvedValue(null);
  api.addAnnotationQueueItems.mockResolvedValue({});
  api.addTraceToDataset.mockResolvedValue({});
  api.archiveScore.mockResolvedValue(score);
  api.completeAnnotationQueueItem.mockResolvedValue({});
  api.createAnnotationQueue.mockResolvedValue({
    annotation_queue_id: "queue_002",
    name: "New Queue",
    description: null,
    score_config_ids: [],
    items: [],
    created_at: startedAt,
    updated_at: startedAt,
  });
  api.createScore.mockResolvedValue({
    ...score,
    score_config_id: "score_002",
    name: "새 점수",
  });
  api.deleteAnnotation.mockResolvedValue(undefined);
  api.deleteAnnotationQueue.mockResolvedValue(undefined);
  api.deleteAnnotationQueueItem.mockResolvedValue(undefined);
  api.deleteScore.mockResolvedValue(undefined);
  api.deleteTrace.mockResolvedValue(undefined);
  api.downloadBackup.mockResolvedValue(undefined);
  api.putAnnotation.mockResolvedValue({});
  api.putTraceMemo.mockResolvedValue(null);
  api.resetAllData.mockResolvedValue(undefined);
  api.updateScore.mockResolvedValue(score);
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  mockDefaults();
  window.history.replaceState(null, "", "/");
});

describe("V2 presentation", () => {
  it("keeps the six V2 surfaces and opens a trace investigation drawer", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Overview" });
    expect(screen.getByRole("button", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Traces" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Annotation Queues" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Scores" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Evaluation" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Setting" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Traces" }));
    await screen.findByRole("heading", { name: "Traces" });
    await user.click(await screen.findByText("tr_001"));
    expect(
      await screen.findByRole("dialog", { name: "Policy answer" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "+ Add scores" }));
    await user.click(screen.getByRole("checkbox", { name: /정확성/ }));
    await user.click(screen.getByRole("button", { name: "추가" }));
    expect(screen.getByText("정확성")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute(
        "aria-hidden",
        "true",
      ),
    );
  });

  it("opens an Overview recent trace drawer from click and Enter, then restores its trigger", async () => {
    const user = userEvent.setup();
    render(<App />);

    const row = await screen.findByRole("button", {
      name: "tr_001 상세 열기",
    });
    expect(within(row).getByText("지원 조건을 확인하세요.")).toBeInTheDocument();
    expect(within(row).queryByText("상세에서 확인")).toBeNull();
    await user.click(row);

    expect(new URLSearchParams(window.location.search).get("view")).toBe(
      "overview",
    );
    expect(new URLSearchParams(window.location.search).get("trace")).toBe(
      "tr_001",
    );
    expect(
      await screen.findByRole("dialog", { name: "Policy answer" }),
    ).toBeVisible();
    await screen.findByText("answer", { selector: ".io-card-head span" });
    expect(
      screen.getByText("LLM", {
        selector: ".io-card-head .runtime-child-kind",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "Annotations" }),
    ).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "저장" });
    await user.click(saveButton);
    await waitFor(() => {
      expect(api.putTraceMemo).toHaveBeenCalledWith("tr_001", "");
    });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Policy answer" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("closes the Add to queue picker and its parent action state before closing the drawer", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Traces" }));
    await screen.findByText("tr_001");
    expect(screen.getByText("지원 조건을 확인하세요.")).toBeInTheDocument();
    expect(screen.queryByText("상세에서 확인")).toBeNull();
    await user.click(screen.getByText("tr_001"));
    await screen.findByRole("dialog", { name: "Policy answer" });

    const actionButton = screen.getByRole("button", { name: "Trace 작업" });
    await user.click(actionButton);
    await user.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(
      await screen.findByRole("dialog", { name: "Add to queue" }),
    ).toBeVisible();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Add to queue" }),
      ).not.toBeInTheDocument();
      expect(actionButton).toHaveAttribute("aria-expanded", "false");
    });

    await user.keyboard("{Escape}");
    const traceRow = screen.getByText("tr_001").closest("tr");
    await waitFor(() => {
      expect(document.querySelector(".trace-drawer")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(traceRow).toHaveFocus();
    });
  });

  it("uses the V2 four-field Traces toolbar while retaining relative-period API bounds", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Traces" }));
    const search = await screen.findByRole("searchbox", { name: "검색" });
    const form = search.closest("form");
    if (!form) throw new Error("Trace filter form is missing");

    expect(within(form).getByRole("combobox", { name: "상태" })).toBeVisible();
    const period = within(form).getByRole("combobox", { name: "기간" });
    expect(within(form).getByRole("textbox", { name: "태그" })).toBeVisible();
    expect(within(form).queryByLabelText("시작")).not.toBeInTheDocument();
    expect(within(form).queryByLabelText("종료")).not.toBeInTheDocument();
    expect(
      within(form).queryByLabelText("Session ID"),
    ).not.toBeInTheDocument();

    await user.selectOptions(period, "24h");
    await user.click(within(form).getByRole("button", { name: "적용" }));
    await waitFor(() => expect(api.getTraces).toHaveBeenCalledTimes(3));
    const query = api.getTraces.mock.calls.at(-1)?.[0];
    expect(query).toEqual(
      expect.objectContaining({
        from: expect.any(String),
        to: expect.any(String),
        session_id: undefined,
      }),
    );
    expect(Date.parse(query.to) - Date.parse(query.from)).toBe(24 * 60 * 60 * 1_000);
  });

  it("creates a score through the V2 modal", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Scores" }));
    await screen.findByRole("button", { name: "+ New Score" });
    await user.click(screen.getByRole("button", { name: "+ New Score" }));
    await user.type(
      screen.getByRole("textbox", { name: "Score 이름" }),
      "새 점수",
    );
    await user.click(screen.getByRole("button", { name: "Score 생성" }));

    await waitFor(() => expect(api.createScore).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("dialog", { name: "New Score" }),
    ).not.toBeInTheDocument();
  });

  it("creates an annotation queue through the V2 queue dialog", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Annotation Queues" }));
    await user.click(await screen.findByRole("button", { name: "+ New Queue" }));
    await user.type(screen.getByRole("textbox", { name: "이름" }), "릴리스 검토");
    await user.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => expect(api.createAnnotationQueue).toHaveBeenCalledOnce());
  });

  it("uses the V2 RESET confirmation before clearing local data", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Setting" }));
    await user.type(
      screen.getByRole("textbox", { name: "계속하려면 RESET 입력" }),
      "RESET",
    );
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(
      screen.getByRole("dialog", { name: "로컬 데이터를 초기화할까요?" }),
    ).toBeVisible();
    await user.click(
      within(
        screen.getByRole("dialog", { name: "로컬 데이터를 초기화할까요?" }),
      ).getByRole("button", { name: "초기화" }),
    );

    await waitFor(() => expect(api.resetAllData).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("heading", { name: "Traces" }),
    ).toBeVisible();
  });

  it("imports JSONL line by line and reports the failed source lines", async () => {
    const user = userEvent.setup();
    api.addDatasetExample
      .mockResolvedValueOnce({
        dataset_id: "dataset_001",
        name: "Youth policy",
        description: "평가 데이터",
        revision: 4,
        examples: [],
        created_at: startedAt,
        updated_at: startedAt,
      })
      .mockRejectedValueOnce(new Error("write failed"));
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Evaluation" }));
    await user.click(
      await screen.findByRole("button", { name: /Youth policy/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "JSONL 작업 메뉴" }),
    );
    expect(screen.getByRole("menuitem", { name: "Export" })).toBeEnabled();
    await user.click(screen.getByRole("menuitem", { name: "Import" }));
    await user.upload(
      screen.getByLabelText("JSONL 가져오기"),
      new File(
        [
          '{"input":{"question":"첫 줄"},"metadata":{"source":"jsonl"}}\n',
          '{"input":\n',
          '{"input":{"question":"셋째 줄"},"expected_output":{"answer":"답"}}\n',
        ],
        "examples.jsonl",
        { type: "application/x-ndjson" },
      ),
    );

    expect(
      await screen.findByText("JSONL import: 1개 추가, 실패한 줄 2, 3."),
    ).toHaveAttribute("data-tone", "error");
    expect(api.addDatasetExample).toHaveBeenCalledTimes(2);
    expect(
      api.addDatasetExample.mock.calls.map(([, example]) => example),
    ).toEqual([
      {
        input: { question: "첫 줄" },
        expected_output: null,
        metadata: { source: "jsonl" },
      },
      {
        input: { question: "셋째 줄" },
        expected_output: { answer: "답" },
        metadata: {},
      },
    ]);
  });

  it("opens the V2 evaluation detail and keeps its two source tabs", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Evaluation" }));
    await user.click(
      await screen.findByRole("button", { name: /Youth policy/ }),
    );
    expect(
      await screen.findByRole("tab", { name: "Examples" }),
    ).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Experiments" }));
    expect(screen.getByRole("tab", { name: "Experiments" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

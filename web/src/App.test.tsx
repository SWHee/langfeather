import {fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {App} from "./App";
import {
  defaultOverviewUrlState,
  readAppUrlState,
  replaceAppUrlState,
} from "./url";

const traceListItem = {
  trace_id: "tr_student_01",
  name: "policy-rag",
  started_at: "2026-07-25T03:00:00.000000Z",
  ended_at: "2026-07-25T03:00:01.500000Z",
  duration_us: 1_500_000,
  status: "completed",
  session_id: "chat-123",
  user_id: null,
  release: "0.1.0",
  environment: "local",
  tags: ["quickstart"],
  observation_count: 2,
  input_preview: "청년 정책을 알려줘",
} as const;

const traceDetail = {
  trace_id: traceListItem.trace_id,
  name: traceListItem.name,
  started_at: traceListItem.started_at,
  ended_at: traceListItem.ended_at,
  duration_us: traceListItem.duration_us,
  status: traceListItem.status,
  session_id: traceListItem.session_id,
  user_id: traceListItem.user_id,
  release: traceListItem.release,
  environment: traceListItem.environment,
  tags: traceListItem.tags,
  observation_count: 2,
  observations: [
    {
      observation_id: "obs_root",
      trace_id: traceListItem.trace_id,
      parent_observation_id: null,
      sequence: 0,
      name: "policy-rag",
      kind: "chain",
      started_at: traceListItem.started_at,
      ended_at: traceListItem.ended_at,
      duration_us: traceListItem.duration_us,
      time_to_first_token_us: null,
      status: "completed",
      model: null,
    },
    {
      observation_id: "obs_retrieve",
      trace_id: traceListItem.trace_id,
      parent_observation_id: "obs_root",
      sequence: 1,
      name: "retrieve_documents",
      kind: "retriever",
      started_at: "2026-07-25T03:00:00.100000Z",
      ended_at: "2026-07-25T03:00:00.400000Z",
      duration_us: 300_000,
      time_to_first_token_us: null,
      status: "completed",
      model: null,
    },
  ],
  score_configs: [],
  annotations: [],
  memo: null,
} as const;

const observationPayload = {
  ...traceDetail.observations[1],
  input: {query: "청년 정책"},
  output: [{page_content: "정책 원문"}],
  error: null,
  usage: null,
  metadata: {
    langgraph_node: "retrieve_documents",
    langgraph_step: 1,
  },
} as const;

const rootObservationPayload = {
  ...traceDetail.observations[0],
  input: {question: "청년 정책을 알려줘"},
  output: {answer: "정책 결과"},
  error: null,
  usage: null,
  metadata: {langgraph_step: 0},
} as const;

const failedTraceDetail = {
  ...traceDetail,
  observations: [
    traceDetail.observations[0],
    {
      ...traceDetail.observations[1],
      observation_id: "obs_failed_tool",
      name: "call_policy_api",
      kind: "tool",
      status: "failed",
    },
  ],
} as const;

const failedObservationPayload = {
  ...observationPayload,
  ...failedTraceDetail.observations[1],
  output: null,
  error: {
    __type__: "builtins.TimeoutError",
    message: "정책 API 응답 시간이 초과됐습니다",
    traceback: [
      {
        file: "/workspace/src/policy.py",
        line: 42,
        function: "call_policy_api",
        code: "response = client.get(url)",
      },
    ],
  },
} as const;

const urlDataset = {
  dataset_id: "ds_url",
  name: "URL regression",
  description: null,
  revision: 1,
  example_count: 1,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
  examples: [
    {
      dataset_example_id: "dse_url",
      position: 0,
      input: {question: "URL state?"},
      expected_output: {answer: "kept"},
      metadata: {},
      source_trace_id: traceListItem.trace_id,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    },
  ],
};

function urlExperiment(id: string, name: string) {
  return {
    experiment_id: id,
    dataset_id: urlDataset.dataset_id,
    dataset_revision: 1,
    name,
    status: "completed",
    started_at: "2026-07-29T00:00:00.000Z",
    ended_at: "2026-07-29T00:00:01.000Z",
    case_count: 1,
    completed_case_count: 1,
    failed_case_count: 0,
    target_metadata: {},
    evaluators: [
      {
        experiment_evaluator_id: `${id}_evaluator`,
        key: "exact_match",
        name: "Exact match",
        data_type: "boolean",
        position: 0,
      },
    ],
    cases: [
      {
        experiment_case_id: `${id}_case`,
        dataset_example_id: "dse_url",
        position: 0,
        input: {question: "URL state?"},
        expected_output: {answer: "kept"},
        metadata: {},
        status: "completed",
        output: {answer: "kept"},
        error: null,
        duration_us: 1_000,
        trace_id: traceListItem.trace_id,
        completed_at: "2026-07-29T00:00:01.000Z",
        evaluator_results: [
          {
            evaluator_key: "exact_match",
            value: true,
            error_message: null,
          },
        ],
      },
    ],
  };
}

const urlBaseline = urlExperiment("exp_url_baseline", "URL baseline");
const urlCandidate = urlExperiment("exp_url_candidate", "URL candidate");
const urlExperimentSummaries = [urlBaseline, urlCandidate].map((item) => ({
  experiment_id: item.experiment_id,
  dataset_id: item.dataset_id,
  dataset_revision: item.dataset_revision,
  name: item.name,
  status: item.status,
  started_at: item.started_at,
  ended_at: item.ended_at,
  case_count: item.case_count,
  completed_case_count: item.completed_case_count,
  failed_case_count: item.failed_case_count,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json"},
  });
}

describe("LangFeather trace explorer", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    window.history.replaceState(null, "", "/?view=traces");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/?view=traces");
  });

  it("opens Overview as the default first navigation view", async () => {
    window.history.replaceState(null, "", "/");
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/v1/scores")) {
        return Promise.resolve(jsonResponse({items: []}));
      }
      if (url.startsWith("/api/v1/dashboard")) {
        return Promise.resolve(
          jsonResponse({
            from: "2026-07-23T00:00:00.000Z",
            to: "2026-07-30T00:00:00.000Z",
            timezone: "UTC",
            bucket: "day",
            totals: {
              trace_count: 0,
              latency_us: {p50: null, p95: null, p99: null},
              error: {failed: 0, total: 0, rate: null},
              llm_calls: 0,
              tool_calls: 0,
            },
            available_tools: [],
            buckets: [],
          }),
        );
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", {name: "Overview"}),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Overview"})).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("round-trips every supported URL state field", () => {
    replaceAppUrlState({
      view: "datasets",
      overview: defaultOverviewUrlState(
        new Date("2026-07-30T00:00:00.000Z"),
      ),
      evaluation: {
        datasetId: "ds_url",
        tab: "examples",
        experimentIds: ["exp_candidate", "exp_baseline"],
        metricKeys: ["faithfulness", "exact_match"],
        caseId: "dse_url",
      },
      traceId: "tr_url",
    });

    expect(readAppUrlState()).toEqual({
      view: "datasets",
      overview: expect.objectContaining({
        bucket: "auto",
        scoreIds: [],
        toolNames: [],
      }),
      evaluation: {
        datasetId: "ds_url",
        tab: "examples",
        experimentIds: ["exp_candidate", "exp_baseline"],
        metricKeys: ["faithfulness", "exact_match"],
        caseId: "dse_url",
      },
      traceId: "tr_url",
    });
    expect(window.location.search).toContain(
      "experiments=exp_candidate%2Cexp_baseline",
    );
  });

  it("opens a trace deep link as the actual selected trace", async () => {
    window.history.replaceState(
      null,
      "",
      `/?view=traces&trace=${traceListItem.trace_id}`,
    );
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/v1/traces") {
        return Promise.resolve(
          jsonResponse({items: [traceListItem], next_cursor: null}),
        );
      }
      if (url === `/api/v1/traces/${traceListItem.trace_id}`) {
        return Promise.resolve(jsonResponse(traceDetail));
      }
      if (url === "/api/v1/observations/obs_root") {
        return Promise.resolve(jsonResponse(rootObservationPayload));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", {name: "Execution"}),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", {name: /policy-rag/})
        .find((button) => button.classList.contains("trace-card")),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps experiment and metric selections after opening a trace and returning to Evaluation", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      null,
      "",
      "/?view=datasets&dataset=ds_url&tab=compare&experiments=exp_url_candidate,exp_url_baseline&metrics=exact_match&case=dse_url",
    );
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/v1/traces") {
        return Promise.resolve(
          jsonResponse({items: [traceListItem], next_cursor: null}),
        );
      }
      if (url === "/api/v1/datasets") {
        return Promise.resolve(jsonResponse({items: [urlDataset]}));
      }
      if (url === "/api/v1/experiments") {
        return Promise.resolve(
          jsonResponse({items: urlExperimentSummaries}),
        );
      }
      if (url === `/api/v1/datasets/${urlDataset.dataset_id}`) {
        return Promise.resolve(jsonResponse(urlDataset));
      }
      if (url === `/api/v1/experiments/${urlBaseline.experiment_id}`) {
        return Promise.resolve(jsonResponse(urlBaseline));
      }
      if (url === `/api/v1/experiments/${urlCandidate.experiment_id}`) {
        return Promise.resolve(jsonResponse(urlCandidate));
      }
      if (url === `/api/v1/traces/${traceListItem.trace_id}`) {
        return Promise.resolve(jsonResponse(traceDetail));
      }
      if (url === "/api/v1/observations/obs_root") {
        return Promise.resolve(jsonResponse(rootObservationPayload));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", {level: 3, name: "Exact match"}),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", {name: "Trace 상세 열기"})[0]!,
    );
    expect(
      await screen.findByRole("heading", {name: "Execution"}),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Evaluation"}));

    expect(
      await screen.findByRole("checkbox", {name: /URL candidate/}),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {name: /URL baseline/}),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {name: /Exact match/}),
    ).toBeChecked();
    expect(readAppUrlState().evaluation).toEqual({
      datasetId: "ds_url",
      tab: "compare",
      experimentIds: ["exp_url_candidate", "exp_url_baseline"],
      metricKeys: ["exact_match"],
      caseId: "dse_url",
    });
  });

  it("shows a loading state while the trace list is pending", () => {
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));

    render(<App />);

    expect(
      screen.getByText("추적 기록을 불러오는 중입니다…"),
    ).toBeInTheDocument();
  });

  it("keeps local data controls on a separate top-level view", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));

    render(<App />);

    expect(screen.getByRole("navigation", {name: "주요 메뉴"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Traces"})).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("백업과 초기화")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", {name: "UI 디자인 컨셉 선택"})).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Local Data"}));

    expect(screen.getByRole("heading", {name: "백업과 초기화"})).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "SQLite 백업 다운로드"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Local Data"})).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens the Evaluation workspace from the top navigation", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/traces")) {
        return new Promise<Response>(() => undefined);
      }
      if (url.endsWith("/datasets") || url.endsWith("/experiments")) {
        return Promise.resolve(jsonResponse({items: []}));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(<App />);

    const evaluation = screen.getByRole("button", {name: "Evaluation"});
    expect(evaluation).toHaveAttribute("aria-pressed", "false");

    await user.click(evaluation);

    expect(
      await screen.findByRole("heading", {name: "Datasets & Experiments"}),
    ).toBeInTheDocument();
    expect(evaluation).toHaveAttribute("aria-pressed", "true");
  });

  it("shows advanced trace filters only when Filters is toggled on", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));

    render(<App />);

    const toggle = screen.getByRole("button", {name: "Filters"});
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", {name: "상태 필터"})).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", {name: "상태 필터"})).toBeInTheDocument();
  });

  it("shows a useful empty state", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({items: [], next_cursor: null}),
    );

    render(<App />);

    expect(
      await screen.findByText("아직 기록된 요청이 없습니다"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/LangGraph를 실행하면 여기에 요청이 나타납니다/),
    ).toBeInTheDocument();
  });

  it("shows an error and retries the list request", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({detail: "unavailable"}, 503))
      .mockResolvedValueOnce(jsonResponse({items: [], next_cursor: null}));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "추적 기록을 불러오지 못했습니다",
    );
    await user.click(screen.getByRole("button", {name: "다시 시도"}));

    expect(
      await screen.findByText("아직 기록된 요청이 없습니다"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lists one trace without fetching its detail early", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({items: [traceListItem], next_cursor: null}),
    );

    render(<App />);

    expect(
      await screen.findByRole("button", {name: /policy-rag/}),
    ).toBeInTheDocument();
    expect(screen.getByText("노드 2개")).toBeInTheDocument();
    expect(screen.getByText("청년 정책을 알려줘")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/traces");
  });

  it("loads summaries after trace selection and payload only after node selection", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: null}),
      )
      .mockResolvedValueOnce(jsonResponse(traceDetail))
      .mockResolvedValueOnce(jsonResponse(rootObservationPayload))
      .mockResolvedValueOnce(jsonResponse(observationPayload));

    render(<App />);

    await user.click(await screen.findByRole("button", {name: /policy-rag/}));

    expect(await screen.findByRole("heading", {name: "Execution"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Node View/})).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", {name: /Runnable View/})).toBeInTheDocument();
    expect(
      screen.queryByText(/기본은 workflow 단계만 보여주며/),
    ).not.toBeInTheDocument();
    const graphNode = screen.getByRole("button", {
      name: /실행 노드 retrieve_documents/,
    });
    expect(graphNode).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/traces/tr_student_01",
    );

    fireEvent.click(graphNode);

    expect(
      await screen.findByRole("heading", {name: "retrieve_documents"}),
    ).toBeInTheDocument();
    expect(graphNode).toHaveClass("selected");
    expect(graphNode).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Input JSON")).toHaveTextContent(
      '"query": "청년 정책"',
    );
    expect(screen.getByLabelText("Output JSON")).toHaveTextContent(
      '"page_content": "정책 원문"',
    );
    expect(screen.queryByLabelText("Metadata JSON")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "전체 데이터"}));
    expect(screen.getByLabelText("Metadata JSON")).toBeInTheDocument();
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/api/v1/observations/obs_root",
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "/api/v1/observations/obs_retrieve",
    );
  });

  it("adds the selected trace to an existing annotation queue", async () => {
    const user = userEvent.setup();
    const queue = {
      annotation_queue_id: "aq_failure_review",
      name: "Failure review",
      description: null,
      score_config_ids: [],
      items: [],
      created_at: "2026-07-28T10:02:00.000000Z",
      updated_at: "2026-07-28T10:02:00.000000Z",
    };
    const queueWithTrace = {
      ...queue,
      items: [
        {
          annotation_queue_item_id: "qi_review",
          annotation_queue_id: queue.annotation_queue_id,
          trace_id: traceListItem.trace_id,
          trace_name: traceListItem.name,
          status: "pending",
          created_at: "2026-07-28T10:03:00.000000Z",
          updated_at: "2026-07-28T10:03:00.000000Z",
          completed_at: null,
        },
      ],
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: null}),
      )
      .mockResolvedValueOnce(jsonResponse(traceDetail))
      .mockResolvedValueOnce(jsonResponse(rootObservationPayload))
      .mockResolvedValueOnce(jsonResponse({items: [queue]}))
      .mockResolvedValueOnce(jsonResponse(queueWithTrace));

    render(<App />);

    await user.click(await screen.findByRole("button", {name: /policy-rag/}));
    await user.click(await screen.findByRole("button", {name: "Trace actions"}));
    await user.click(await screen.findByRole("button", {name: "Add to Queue"}));
    expect(
      screen.getByRole("button", {name: "Trace actions 뒤로"}),
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox", {name: "Queue 검색"})).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", {name: "Failure review"}),
    );

    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/v1/annotation-queues");
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "/api/v1/annotation-queues/aq_failure_review/items",
    );
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({trace_ids: ["tr_student_01"]}),
    });
    expect(
      await screen.findByRole("button", {name: "Failure review 추가됨"}),
    ).toBeDisabled();
  });

  it("dismisses trace actions with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: null}),
      )
      .mockResolvedValueOnce(jsonResponse(traceDetail))
      .mockResolvedValueOnce(jsonResponse(rootObservationPayload));

    render(<App />);

    await user.click(await screen.findByRole("button", {name: /policy-rag/}));
    const trigger = await screen.findByRole("button", {name: "Trace actions"});
    await user.click(trigger);

    expect(
      screen.getByRole("menu", {name: "Trace actions menu"}),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("menu", {name: "Trace actions menu"}),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("focuses the earliest failed node only after the trace is opened", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: null}),
      )
      .mockResolvedValueOnce(jsonResponse(failedTraceDetail))
      .mockResolvedValueOnce(jsonResponse(failedObservationPayload));

    render(<App />);

    const traceButton = await screen.findByRole("button", {
      name: /policy-rag/,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    await user.click(traceButton);

    expect(
      await screen.findByRole("heading", {name: "call_policy_api"}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {name: /실행 노드 call_policy_api/}),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Error JSON")).toHaveTextContent(
      "정책 API 응답 시간이 초과됐습니다",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "builtins.TimeoutError",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "/workspace/src/policy.py:42 · call_policy_api()",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/api/v1/observations/obs_failed_tool",
    );
  });

  it("resets the opaque cursor when a filter is applied", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: "opaque-page-2"}),
      )
      .mockResolvedValueOnce(jsonResponse({items: [], next_cursor: null}));

    render(<App />);

    const search = await screen.findByRole("textbox", {
      name: "이름 또는 입출력 검색",
    });
    await user.type(search, "policy{Enter}");

    expect(
      await screen.findByText("조건에 맞는 요청이 없습니다"),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/traces?query=policy");
  });

  it("loads the next trace page only with the server cursor", async () => {
    const user = userEvent.setup();
    const olderTrace = {...traceListItem, trace_id: "tr_student_00", name: "older-policy-rag"};
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: "opaque-page-2"}),
      )
      .mockResolvedValueOnce(jsonResponse({items: [olderTrace], next_cursor: null}));

    render(<App />);

    await user.click(await screen.findByRole("button", {name: "이전 요청 더 보기"}));

    expect(await screen.findByText("older-policy-rag")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/traces?cursor=opaque-page-2",
    );
  });

  it("folds nested JSON and copies the selected node payload", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {writeText},
    });
    const nestedPayload = {
      ...observationPayload,
      input: {query: "청년 정책", nested: {one: {two: "three"}}},
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: null}),
      )
      .mockResolvedValueOnce(jsonResponse(traceDetail))
      .mockResolvedValueOnce(jsonResponse(rootObservationPayload))
      .mockResolvedValueOnce(jsonResponse(nestedPayload));

    render(<App />);
    await user.click(await screen.findByRole("button", {name: /policy-rag/}));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /실행 노드 retrieve_documents/,
      }),
    );

    const input = await screen.findByLabelText("Input JSON");
    const collapsedBranch = [...input.querySelectorAll("details")].find(
      (element) => !element.open,
    );
    expect(collapsedBranch).toBeDefined();
    await user.click(
      (collapsedBranch?.querySelector("summary") as HTMLElement),
    );
    expect(collapsedBranch).toHaveAttribute("open");

    await user.click(
      input.parentElement?.querySelector("button") as HTMLButtonElement,
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"nested"'),
    );
  });

  it("confirms before deleting the selected trace", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: null}),
      )
      .mockResolvedValueOnce(jsonResponse(traceDetail))
      .mockResolvedValueOnce(jsonResponse(rootObservationPayload))
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(jsonResponse({items: [], next_cursor: null}));

    render(<App />);
    await user.click(await screen.findByRole("button", {name: /policy-rag/}));
    await user.click(await screen.findByRole("button", {name: "Trace actions"}));
    await user.click(await screen.findByRole("button", {name: "이 요청 삭제"}));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "/api/v1/traces/tr_student_01",
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({method: "DELETE"});
    expect(
      await screen.findByText("아직 기록된 요청이 없습니다"),
    ).toBeInTheDocument();
  });

  it("requires RESET before deleting all local trace data", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({items: [traceListItem], next_cursor: null}),
      )
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(jsonResponse({items: [], next_cursor: null}));

    render(<App />);

    await user.click(screen.getByRole("button", {name: "Local Data"}));
    const resetButton = screen.getByRole("button", {name: "모든 데이터 초기화"});
    expect(resetButton).toBeDisabled();
    await user.type(screen.getByLabelText("전체 데이터 초기화 확인"), "RESET");
    await user.click(resetButton);

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/admin/reset");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({confirmation: "RESET"}),
    });
    expect(
      await screen.findByText("아직 기록된 요청이 없습니다"),
    ).toBeInTheDocument();
  });
});

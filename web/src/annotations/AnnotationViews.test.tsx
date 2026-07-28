import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoreConfig, TraceDetail } from "../api/types";
import {
  AnnotationQueuesView,
  ScoresView,
  TraceAnnotationPanel,
} from "./AnnotationViews";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const failureTypeScore: ScoreConfig = {
  score_config_id: "sc_failure",
  name: "Failure Type",
  description: "Observed failures",
  data_type: "categorical",
  boolean_true_label: null,
  boolean_false_label: null,
  number_min: null,
  number_max: null,
  categorical_selection_mode: "multiple",
  options: [
    {
      score_option_id: "so_retrieval",
      label: "Retrieval",
      position: 0,
      archived_at: null,
    },
  ],
  created_at: "2026-07-28T10:00:00.000000Z",
  updated_at: "2026-07-28T10:00:00.000000Z",
  archived_at: null,
  has_annotations: false,
  is_used: false,
};

const traceDetail: TraceDetail = {
  trace_id: "tr_review",
  name: "review-target",
  started_at: "2026-07-28T10:00:00.000000Z",
  ended_at: "2026-07-28T10:00:01.000000Z",
  duration_us: 1_000_000,
  status: "completed",
  session_id: null,
  user_id: null,
  release: null,
  environment: "local",
  tags: [],
  observation_count: 1,
  observations: [
    {
      observation_id: "obs_review",
      trace_id: "tr_review",
      parent_observation_id: null,
      sequence: 0,
      name: "review-target",
      kind: "runnable",
      started_at: "2026-07-28T10:00:00.000000Z",
      ended_at: "2026-07-28T10:00:01.000000Z",
      duration_us: 1_000_000,
      time_to_first_token_us: null,
      status: "completed",
      model: null,
    },
  ],
  score_configs: [failureTypeScore],
  annotations: [],
  memo: null,
};

describe("score and annotation queue views", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps score creation behind a focused New Score dialog", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse(failureTypeScore, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [failureTypeScore] }));

    render(<ScoresView />);

    expect(
      await screen.findByText("아직 Score가 없습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Score 이름")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New Score" }));

    expect(
      screen.getByRole("dialog", { name: "New Score" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Score 이름"), "Failure Type");
    await user.selectOptions(screen.getByLabelText("타입"), "categorical");
    await user.selectOptions(screen.getByLabelText("선택 방식"), "multiple");
    await user.type(
      screen.getByLabelText("Options · 한 줄에 하나"),
      "Retrieval{Enter}Hallucination",
    );
    await user.click(screen.getByRole("button", { name: "Score 생성" }));

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/scores");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: expect.stringContaining('"categorical_selection_mode":"multiple"'),
    });
    expect(
      await screen.findByText("categorical · multiple"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "New Score" }),
    ).not.toBeInTheDocument();
  });

  it("edits a score in the shared dialog from an overflow menu", async () => {
    const user = userEvent.setup();
    const updatedScore = {
      ...failureTypeScore,
      name: "Failure category",
      description: "Primary failure category",
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [failureTypeScore] }))
      .mockResolvedValueOnce(jsonResponse(updatedScore))
      .mockResolvedValueOnce(jsonResponse({ items: [updatedScore] }));

    render(<ScoresView />);

    await user.click(
      await screen.findByRole("button", { name: "Failure Type actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "수정" }));

    expect(
      screen.getByRole("dialog", { name: "Edit Score" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("타입")).toBeDisabled();

    await user.clear(screen.getByLabelText("Score 이름"));
    await user.type(screen.getByLabelText("Score 이름"), "Failure category");
    await user.clear(screen.getByLabelText("설명"));
    await user.type(screen.getByLabelText("설명"), "Primary failure category");
    await user.click(screen.getByRole("button", { name: "변경 저장" }));

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/scores/sc_failure");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      body: expect.stringContaining('"name":"Failure category"'),
    });
    expect(
      screen.queryByRole("dialog", { name: "Edit Score" }),
    ).not.toBeInTheDocument();
  });

  it("confirms permanent score deletion from the overflow menu", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [failureTypeScore] }),
    );

    render(<ScoresView />);

    await user.click(
      await screen.findByRole("button", { name: "Failure Type actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "영구 삭제" }));

    expect(confirm).toHaveBeenCalledWith(
      "'Failure Type' Score를 영구 삭제할까요?",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts with Add scores, then stores the chosen score and a trace memo", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          annotation_id: "an_empty",
          score_config_id: failureTypeScore.score_config_id,
          target_type: "trace",
          target_id: traceDetail.trace_id,
          trace_id: traceDetail.trace_id,
          value: ["so_retrieval"],
          created_at: "2026-07-28T10:01:00.000000Z",
          updated_at: "2026-07-28T10:01:00.000000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          trace_id: traceDetail.trace_id,
          content: "No category applies.",
          created_at: "2026-07-28T10:01:00.000000Z",
          updated_at: "2026-07-28T10:01:00.000000Z",
        }),
      );
    const changed = vi.fn();

    render(<TraceAnnotationPanel detail={traceDetail} onChanged={changed} />);

    expect(screen.queryByLabelText("Failure Type 값")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "선택 없음 기록" }),
    ).not.toBeInTheDocument();
    const addScoreButton = screen.getByRole("button", { name: "Score 추가" });
    await user.click(addScoreButton);
    expect(
      screen.getByRole("menu", { name: "추가할 Score" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("menu", { name: "추가할 Score" }),
    ).not.toBeInTheDocument();
    expect(addScoreButton).toHaveFocus();

    await user.click(addScoreButton);
    await user.click(screen.getByRole("button", { name: "Failure Type" }));
    await user.click(screen.getByRole("checkbox"));
    await user.type(
      screen.getByLabelText("Trace 메모"),
      "No category applies.",
    );
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/traces/tr_review/annotations/sc_failure",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ value: ["so_retrieval"] }),
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/traces/tr_review/memo");
    expect(changed).toHaveBeenCalledOnce();
  });

  it("creates an empty queue from the selected scores without showing traces", async () => {
    const user = userEvent.setup();
    const queue = {
      annotation_queue_id: "aq_review",
      name: "Failure review",
      description: null,
      score_config_ids: [failureTypeScore.score_config_id],
      items: [],
      created_at: "2026-07-28T10:02:00.000000Z",
      updated_at: "2026-07-28T10:02:00.000000Z",
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [failureTypeScore] }))
      .mockResolvedValueOnce(jsonResponse(queue, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [queue] }));

    render(<AnnotationQueuesView />);

    expect(screen.queryByLabelText("Queue 이름")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New Queue" }));
    expect(
      screen.getByRole("dialog", { name: "New Queue" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Queue 이름"), "Failure review");
    await user.click(await screen.findByLabelText("Failure Type"));
    expect(
      screen.queryByRole("group", { name: "Traces" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("review-target")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Queue 생성" }));

    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/annotation-queues");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        name: "Failure review",
        description: null,
        score_config_ids: ["sc_failure"],
        trace_ids: [],
      }),
    });
    expect(await screen.findByText("완료 0 / 0")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Queue 목록으로" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Queue 검색")).not.toBeInTheDocument();
  });

  it("uses the trace inspector for queue review input and output", async () => {
    const user = userEvent.setup();
    const queue = {
      annotation_queue_id: "aq_review",
      name: "Failure review",
      description: null,
      score_config_ids: [failureTypeScore.score_config_id],
      items: [
        {
          annotation_queue_item_id: "qi_review",
          annotation_queue_id: "aq_review",
          trace_id: traceDetail.trace_id,
          trace_name: traceDetail.name,
          status: "pending",
          created_at: "2026-07-28T10:02:00.000000Z",
          updated_at: "2026-07-28T10:02:00.000000Z",
          completed_at: null,
        },
      ],
      created_at: "2026-07-28T10:02:00.000000Z",
      updated_at: "2026-07-28T10:02:00.000000Z",
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [queue] }))
      .mockResolvedValueOnce(jsonResponse({ items: [failureTypeScore] }))
      .mockResolvedValueOnce(jsonResponse(traceDetail))
      .mockResolvedValueOnce(
        jsonResponse({
          ...traceDetail.observations[0],
          input: { question: "review" },
          output: { answer: "done" },
          error: null,
          usage: null,
          metadata: { langgraph_step: 0 },
        }),
      );

    render(<AnnotationQueuesView />);

    await user.click(
      await screen.findByRole("button", { name: "Failure review" }),
    );

    expect(await screen.findByLabelText("Input JSON")).toHaveTextContent(
      '"question":',
    );
    expect(screen.getByLabelText("Output JSON")).toHaveTextContent('"answer":');
    expect(screen.getByRole("button", { name: "핵심 입출력" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.querySelector(".queue-payload")).not.toBeInTheDocument();
  });

  it("moves to the next pending trace after completing a queue review", async () => {
    const user = userEvent.setup();
    const firstItem = {
      annotation_queue_item_id: "qi_first",
      annotation_queue_id: "aq_review",
      trace_id: traceDetail.trace_id,
      trace_name: traceDetail.name,
      status: "pending" as const,
      created_at: "2026-07-28T10:02:00.000000Z",
      updated_at: "2026-07-28T10:02:00.000000Z",
      completed_at: null,
    };
    const secondDetail: TraceDetail = {
      ...traceDetail,
      trace_id: "tr_next",
      name: "next-review",
      observations: [
        {
          ...traceDetail.observations[0],
          observation_id: "obs_next",
          trace_id: "tr_next",
          name: "next-review",
        },
      ],
    };
    const secondItem = {
      ...firstItem,
      annotation_queue_item_id: "qi_second",
      trace_id: secondDetail.trace_id,
      trace_name: secondDetail.name,
    };
    const queue = {
      annotation_queue_id: "aq_review",
      name: "Failure review",
      description: null,
      score_config_ids: [failureTypeScore.score_config_id],
      items: [firstItem, secondItem],
      created_at: "2026-07-28T10:02:00.000000Z",
      updated_at: "2026-07-28T10:02:00.000000Z",
    };
    const completedQueue = {
      ...queue,
      items: [
        {
          ...firstItem,
          status: "completed" as const,
          completed_at: "2026-07-28T10:04:00.000000Z",
          updated_at: "2026-07-28T10:04:00.000000Z",
        },
        secondItem,
      ],
    };

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [queue] }))
      .mockResolvedValueOnce(jsonResponse({ items: [failureTypeScore] }))
      .mockResolvedValueOnce(jsonResponse(traceDetail))
      .mockResolvedValueOnce(
        jsonResponse({
          ...traceDetail.observations[0],
          input: { question: "first" },
          output: { answer: "first" },
          error: null,
          usage: null,
          metadata: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...firstItem,
          status: "completed",
          completed_at: "2026-07-28T10:04:00.000000Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [completedQueue] }))
      .mockResolvedValueOnce(jsonResponse(secondDetail))
      .mockResolvedValueOnce(
        jsonResponse({
          ...secondDetail.observations[0],
          input: { question: "second" },
          output: { answer: "second" },
          error: null,
          usage: null,
          metadata: {},
        }),
      );

    render(<AnnotationQueuesView />);

    await user.click(
      await screen.findByRole("button", { name: "Failure review" }),
    );
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "완료 후 다음" }));

    expect(
      await screen.findByRole("heading", { name: "next-review", level: 2 }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "/api/v1/annotation-queues/aq_review/items/qi_first/complete",
    );
  });
});

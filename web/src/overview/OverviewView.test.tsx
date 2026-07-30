import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultOverviewUrlState } from "../url";
import { OverviewView } from "./OverviewView";

const dashboard = {
  from: "2026-07-23T00:00:00.000Z",
  to: "2026-07-30T00:00:00.000Z",
  timezone: "UTC",
  bucket: "day",
  totals: {
    trace_count: 2,
    latency_us: { p50: 1000, p95: 2000, p99: 2000 },
    error: { failed: 0, total: 2, rate: 0 },
    llm_calls: 2,
    tool_calls: 1,
  },
  available_tools: [{ name: "search", count: 1 }],
  buckets: [
    {
      started_at: "2026-07-23T00:00:00.000Z",
      ended_at: "2026-07-24T00:00:00.000Z",
      requests: { completed: 1, failed: 0, cancelled: 0 },
      latency_us: { p50: 1000, p95: null, p99: null },
      error: { failed: 0, total: 1, rate: 0 },
      llm_calls: 1,
      tool_calls: { search: 1 },
      feedback: [],
    },
    {
      started_at: "2026-07-24T00:00:00.000Z",
      ended_at: "2026-07-25T00:00:00.000Z",
      requests: { completed: 1, failed: 0, cancelled: 0 },
      latency_us: { p50: null, p95: null, p99: null },
      error: { failed: 0, total: 0, rate: null },
      llm_calls: 1,
      tool_calls: {},
      feedback: [],
    },
  ],
} as const;

describe("OverviewView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders metric panels, keeps chart interaction local, and applies its filters", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith("/api/v1/scores") ? { items: [] } : dashboard;
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const changed = vi.fn();
    render(
      <OverviewView
        value={defaultOverviewUrlState(new Date("2026-07-30T00:00:00.000Z"))}
        onUrlStateChange={changed}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Requests" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Latency" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("선택한 feedback score의 기록이 없습니다."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(screen.getByRole("button", { name: "완료" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.change(screen.getByLabelText("Overview 검색"), {
      target: { value: "payment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "payment" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("separates native number averages from feedback rates and treats zero tools as empty", async () => {
    const response = {
      ...dashboard,
      totals: { ...dashboard.totals, tool_calls: 0 },
      buckets: dashboard.buckets.map((bucket, index) => ({
        ...bucket,
        tool_calls: { __others__: 0 },
        feedback: [
          {
            score_config_id: "score-number",
            name: "Quality",
            data_type: "number",
            value: index === 0 ? 2.5 : 4,
            annotation_count: 1,
            option_rates: [],
          },
          {
            score_config_id: "score-boolean",
            name: "Helpful",
            data_type: "boolean",
            value: index === 0 ? 0.5 : 1,
            annotation_count: 1,
            option_rates: [],
          },
        ],
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(input).startsWith("/api/v1/scores")
                ? { items: [] }
                : response,
            ),
            { status: 200 },
          ),
        ),
      ),
    );

    render(
      <OverviewView
        value={defaultOverviewUrlState(new Date("2026-07-30T00:00:00.000Z"))}
        onUrlStateChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("img", { name: "Feedback averages line chart" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Feedback rates line chart" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("이 기간에는 tool 호출이 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Tool calls line chart" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Feedback 표본 수" }),
    ).toHaveTextContent("Quality2개 기록");
    expect(
      screen.getByRole("list", { name: "Feedback 표본 수" }),
    ).toHaveTextContent("Helpful2개 기록");
    const numberPoint = screen.getByRole("img", {
      name: /Quality.*2\.5/,
    });
    fireEvent.focus(numberPoint);
    expect(screen.getByRole("status")).toHaveTextContent("Quality: 2.5");
    expect(screen.getByRole("status")).not.toHaveTextContent("250.0%");
  });

  it("supports score and tool selection, apply/reset, loading, and retry", async () => {
    let dashboardRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/v1/scores")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: Array.from({ length: 5 }, (_, index) => ({
                score_config_id: `score-${index + 1}`,
                name: `Score ${index + 1}`,
              })),
            }),
            { status: 200 },
          ),
        );
      }
      dashboardRequests += 1;
      if (dashboardRequests === 1) return Promise.reject(new Error("offline"));
      return Promise.resolve(
        new Response(JSON.stringify(dashboard), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const changed = vi.fn();

    render(
      <OverviewView
        value={defaultOverviewUrlState(new Date("2026-07-30T00:00:00.000Z"))}
        onUrlStateChange={changed}
      />,
    );

    expect(
      screen.getByText("Overview를 불러오는 중입니다…"),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Overview를 불러오지 못했습니다",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "Requests" }),
    ).toBeInTheDocument();

    await screen.findByRole("checkbox", { name: "Score 5" });
    for (const index of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByRole("checkbox", { name: `Score ${index}` }));
    }
    expect(screen.getByRole("checkbox", { name: "Score 5" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "search (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scoreIds: ["score-1", "score-2", "score-3", "score-4"],
        toolNames: ["search"],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "초기화" }));
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ scoreIds: [], toolNames: [], query: "" }),
    );
  });
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OverviewUrlState } from "../url";
import { OverviewView } from "./OverviewView";

const api = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getTraces: vi.fn(),
}));

vi.mock("../api/client", () => api);

const scrollIntoView = vi.fn();

const BASE_STATE: OverviewUrlState = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-02T00:00:00.000Z",
  range: null,
  timezone: "UTC",
  bucket: "day",
  query: "",
  tag: "",
  sessionId: "",
  release: "",
  environment: "",
  userId: "",
  scoreIds: [],
  toolNames: [],
};

function renderOverview(overrides?: {
  state?: Partial<OverviewUrlState>;
  onChange?: (state: OverviewUrlState) => void;
}) {
  return render(
    <OverviewView
      state={{ ...BASE_STATE, ...overrides?.state }}
      onChange={overrides?.onChange ?? (() => undefined)}
      selectedTraceId={null}
      onOpenTrace={() => undefined}
    />,
  );
}

function dashboardWithTools(toolCalls: Array<Record<string, number>>) {
  return {
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-03T00:00:00.000Z",
    timezone: "UTC",
    bucket: "day",
    totals: {
      trace_count: 2,
      latency_us: { p50: 1_000, p95: 2_000, p99: 3_000 },
      error: { failed: 0, total: 2, rate: 0 },
      llm_calls: 2,
      tool_calls: toolCalls
        .flatMap((bucket) => Object.entries(bucket))
        .reduce(
          (sum, [name, count]) => (name === "__others__" ? sum : sum + count),
          0,
        ),
    },
    available_tools: [],
    buckets: toolCalls.map((tool_calls, index) => ({
      started_at: `2026-08-0${index + 1}T00:00:00.000Z`,
      ended_at: `2026-08-0${index + 2}T00:00:00.000Z`,
      requests: { completed: 2, failed: 0, cancelled: 0 },
      latency_us: { p50: 1_000, p95: 2_000, p99: 3_000 },
      error: { failed: 0, total: 2, rate: 0 },
      llm_calls: 2,
      tool_calls,
      feedback: [],
    })),
  };
}

async function toolCallsCard(): Promise<HTMLElement> {
  await screen.findByRole("heading", { name: "Tool Calls" });
  const card = document.querySelector<HTMLElement>('[data-chart="toolCalls"]');
  if (!card) throw new Error("Tool Calls card was not rendered");
  return card;
}

function legendLabels(card: HTMLElement): string[] {
  return [...card.querySelectorAll(".legend-item:not([aria-hidden])")].map(
    (item) => (item.textContent ?? "").trim(),
  );
}

beforeEach(() => {
  scrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  api.getDashboard.mockResolvedValue({
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-02T00:00:00.000Z",
    timezone: "UTC",
    bucket: "day",
    totals: {
      trace_count: 2,
      latency_us: { p50: 1_000, p95: 2_000, p99: 3_000 },
      error: { failed: 0, total: 2, rate: 0 },
      llm_calls: 2,
      tool_calls: 1,
    },
    available_tools: [],
    buckets: [
      {
        ended_at: "2026-08-02T00:00:00.000Z",
        started_at: "2026-08-01T00:00:00.000Z",
        requests: { completed: 2, failed: 0, cancelled: 0 },
        latency_us: { p50: 1_000, p95: 2_000, p99: 3_000 },
        error: { failed: 0, total: 2, rate: 0 },
        llm_calls: 2,
        tool_calls: { retriever: 1 },
        feedback: [],
      },
    ],
  });
  api.getTraces.mockResolvedValue({ items: [], next_cursor: null });
});

describe("Overview chart navigator", () => {
  it("selects, scrolls, highlights, and announces the chart destination", async () => {
    const user = userEvent.setup();
    renderOverview();

    const traceCount = await screen.findByRole("button", {
      name: "Trace Count",
    });
    const latency = screen.getByRole("button", { name: "Latency" });
    expect(traceCount).toHaveAttribute("aria-current", "true");
    expect(latency).toHaveAttribute("aria-current", "false");

    await user.click(latency);

    expect(latency).toHaveAttribute("aria-current", "true");
    expect(traceCount).toHaveAttribute("aria-current", "false");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Latency 차트로 이동",
      );
      expect(document.querySelector('[data-chart="latency"]')).toHaveClass(
        "chart-highlight",
      );
    });
  });

  it("uses instant movement when reduced motion is preferred", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole("button", { name: "Error Rate" }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Error Rate 차트로 이동",
      ),
    );
  });
});

describe("Overview chart crosshair", () => {
  it("syncs the hovered point across every chart without drawing a highlight circle", async () => {
    api.getDashboard.mockResolvedValue(
      dashboardWithTools([{ __others__: 0 }, { __others__: 0 }]),
    );
    renderOverview();
    await screen.findByRole("heading", { name: "Trace Count" });

    const traceCountCard = document.querySelector<HTMLElement>(
      '[data-chart="traceCount"]',
    );
    const latencyCard = document.querySelector<HTMLElement>(
      '[data-chart="latency"]',
    );
    if (!traceCountCard || !latencyCard) {
      throw new Error("charts were not rendered");
    }
    const traceCountArea =
      traceCountCard.querySelector<HTMLElement>(".chart-area");
    if (!traceCountArea) throw new Error("chart-area missing");

    fireEvent.focus(traceCountArea);

    await waitFor(() => {
      expect(document.querySelectorAll(".chart-tooltip").length).toBe(4);
    });
    expect(latencyCard.querySelector(".chart-crosshair")).not.toBeNull();
    expect(document.querySelectorAll("circle").length).toBe(0);
  });

  it("places the crosshair and tooltip from the zoomed box the cursor lives in", async () => {
    api.getDashboard.mockResolvedValue(
      dashboardWithTools([{}, {}, {}, {}, {}]),
    );
    renderOverview();
    await screen.findByRole("heading", { name: "Trace Count" });

    const area = document
      .querySelector('[data-chart="traceCount"]')
      ?.querySelector<HTMLElement>(".chart-area");
    if (!area) throw new Error("chart-area missing");
    // Page scaling (zoom, transforms) makes the painted box the pointer moves
    // in wider than the element's own clientWidth.
    Object.defineProperty(area, "clientWidth", {
      configurable: true,
      value: 400,
    });
    area.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 500, height: 250 }) as DOMRect;

    fireEvent.mouseMove(area, { clientX: 350, clientY: 175 });

    // Half way across the 500px box is bucket 2 of 0…4, not the 62.5% bucket
    // that dividing by clientWidth would have selected.
    await waitFor(() => {
      expect(area.querySelector(".chart-crosshair")?.getAttribute("x1")).toBe(
        "50",
      );
    });
    const tooltip = area.querySelector<HTMLElement>(".chart-tooltip");
    expect(tooltip?.style.left).toBe("50%");
    expect(tooltip?.style.top).toBe("50%");
  });
});

describe("Overview Tool Calls chart", () => {
  it("explains the empty period instead of drawing the __others__ sentinel", async () => {
    api.getDashboard.mockResolvedValue(
      dashboardWithTools([{ __others__: 0 }, { __others__: 0 }]),
    );
    renderOverview();

    const card = await toolCallsCard();
    expect(
      within(card).getByText("해당 기간에 tool 호출이 없습니다."),
    ).toBeInTheDocument();
    expect(legendLabels(card)).toEqual([]);
    expect(card.querySelector(".chart-legend")).not.toBeNull();
    expect(card.querySelector("svg")).toBeNull();
    expect(document.body.textContent).not.toContain("__others__");

    expect(
      document.querySelectorAll('[data-chart="traceCount"] .legend-item'),
    ).toHaveLength(2);
    expect(
      document.querySelectorAll('[data-chart="latency"] .legend-item'),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll('[data-chart="errorRate"] .legend-item'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-chart="llmCalls"] .legend-item'),
    ).toHaveLength(1);
  });

  it("renders only the real tool name when one name accompanies the sentinel", async () => {
    api.getDashboard.mockResolvedValue(
      dashboardWithTools([
        { retriever: 3, __others__: 0 },
        { retriever: 1, __others__: 0 },
      ]),
    );
    renderOverview();

    const card = await toolCallsCard();
    expect(legendLabels(card)).toEqual(["retriever"]);
    expect(card.querySelector("svg")).not.toBeNull();
    expect(
      within(card).queryByText("해당 기간에 tool 호출이 없습니다."),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("__others__");
  });

  it("renders only the real tool names when two names accompany the sentinel", async () => {
    api.getDashboard.mockResolvedValue(
      dashboardWithTools([
        { retriever: 3, search: 2, __others__: 0 },
        { retriever: 1, search: 4, __others__: 0 },
      ]),
    );
    renderOverview();

    const card = await toolCallsCard();
    expect(legendLabels(card)).toEqual(["retriever", "search"]);
    expect(card.querySelector("svg")).not.toBeNull();
    expect(
      within(card).queryByText("해당 기간에 tool 호출이 없습니다."),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("__others__");
  });

  it("keeps the first three real tool names when more names are reported", async () => {
    api.getDashboard.mockResolvedValue(
      dashboardWithTools([
        { retriever: 5, search: 4, http: 3, grep: 2, __others__: 0 },
        { retriever: 2, search: 2, http: 2, grep: 1, __others__: 0 },
      ]),
    );
    renderOverview();

    const card = await toolCallsCard();
    expect(legendLabels(card)).toEqual(["retriever", "search", "http"]);
    expect(card.querySelector("svg")).not.toBeNull();
    expect(document.body.textContent).not.toContain("grep");
    expect(document.body.textContent).not.toContain("__others__");
  });
});

describe("Overview period presets", () => {
  it("switches to relative range mode when a preset is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderOverview({ onChange });

    await user.click(await screen.findByRole("button", { name: "1시간" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ range: "1h" }),
    );
  });
});

describe("Overview polling", () => {
  it("refetches the dashboard after the poll interval elapses in range mode", async () => {
    vi.useFakeTimers();
    try {
      renderOverview({ state: { range: "24h" } });

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getDashboard).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(api.getDashboard).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not stack polls while a slow request is still in flight", async () => {
    vi.useFakeTimers();
    try {
      // 응답이 영영 오지 않는 요청. 매 주기마다 abort하고 다시 쏘면 화면은
      // 영영 갱신되지 않으므로, 기다리는 동안은 주기를 건너뛰어야 한다.
      api.getDashboard.mockReturnValue(new Promise(() => undefined));
      renderOverview({ state: { range: "24h" } });

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getDashboard).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000 * 3);
      });
      expect(api.getDashboard).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

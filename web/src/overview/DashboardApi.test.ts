import { describe, expect, it, vi } from "vitest";
import { getDashboard } from "../api/client";

describe("dashboard API client", () => {
  it("serializes repeated score and tool selections", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ buckets: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getDashboard({
      from: "2026-07-29T00:00:00.000Z",
      to: "2026-07-30T00:00:00.000Z",
      timezone: "Asia/Seoul",
      bucket: "auto",
      score_id: ["score-1", "score-2"],
      tool_name: ["search", "lookup"],
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "/api/v1/dashboard?from=2026-07-29T00%3A00%3A00.000Z&to=2026-07-30T00%3A00%3A00.000Z&timezone=Asia%2FSeoul&bucket=auto&score_id=score-1&score_id=score-2&tool_name=search&tool_name=lookup",
    );
    vi.unstubAllGlobals();
  });
});

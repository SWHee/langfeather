import { describe, expect, it } from "vitest";
import {
  defaultOverviewUrlState,
  readAppUrlState,
  replaceAppUrlState,
} from "../url";

describe("Overview URL state", () => {
  it("defaults to a seven-day Overview without borrowing trace filters", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(defaultOverviewUrlState(now)).toMatchObject({
      timezone: expect.any(String),
      bucket: "auto",
      query: "",
      scoreIds: [],
      toolNames: [],
    });
    expect(defaultOverviewUrlState(now).to).toBe(now.toISOString());
    expect(defaultOverviewUrlState(now).from).toBe("2026-07-23T12:00:00.000Z");
  });

  it("round-trips prefixed Overview filters independently", () => {
    const overview = {
      from: "2026-07-29T12:00:00.000Z",
      to: "2026-07-30T12:00:00.000Z",
      timezone: "Asia/Seoul",
      bucket: "day" as const,
      query: "payment",
      tag: "production",
      sessionId: "session-1",
      release: "v1",
      environment: "local",
      userId: "user-1",
      scoreIds: ["score-a", "score-b"],
      toolNames: ["search"],
    };
    replaceAppUrlState({
      view: "overview",
      overview,
      evaluation: {
        datasetId: null,
        tab: "compare",
        experimentIds: [],
        metricKeys: [],
        caseId: null,
      },
      traceId: null,
    });

    expect(readAppUrlState().overview).toEqual(overview);
    expect(window.location.search).toContain("overview_from=");
    expect(window.location.search).not.toContain("&from=");
  });
});

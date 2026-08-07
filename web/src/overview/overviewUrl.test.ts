import { describe, expect, it } from "vitest";
import {
  defaultOverviewUrlState,
  readAppUrlState,
  replaceAppUrlState,
  resolveOverviewWindow,
} from "../url";

describe("Overview URL state", () => {
  it("defaults to a seven-day Overview without borrowing trace filters", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(defaultOverviewUrlState(now)).toMatchObject({
      range: "7d",
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
      range: null,
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
      section: "examples",
      overview,
      evaluation: {
        datasetId: null,
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

  it("round-trips overview_range and writes no absolute overview_from/overview_to", () => {
    const overview = {
      ...defaultOverviewUrlState(new Date("2026-07-30T12:00:00.000Z")),
      range: "24h" as const,
    };
    replaceAppUrlState({
      view: "overview",
      section: "examples",
      overview,
      evaluation: {
        datasetId: null,
        experimentIds: [],
        metricKeys: [],
        caseId: null,
      },
      traceId: null,
    });

    expect(window.location.search).toContain("overview_range=24h");
    expect(window.location.search).not.toContain("overview_from=");
    expect(window.location.search).not.toContain("overview_to=");

    const read = readAppUrlState().overview;
    expect(read.range).toBe("24h");
    const spanMs = new Date(read.to).getTime() - new Date(read.from).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1_000);
  });

  it("reads a URL with only overview_from/overview_to as absolute mode", () => {
    const params = new URLSearchParams();
    params.set("overview_from", "2026-07-01T00:00:00.000Z");
    params.set("overview_to", "2026-07-02T00:00:00.000Z");

    const overview = readAppUrlState(`?${params.toString()}`).overview;

    expect(overview.range).toBeNull();
    expect(overview.from).toBe("2026-07-01T00:00:00.000Z");
    expect(overview.to).toBe("2026-07-02T00:00:00.000Z");
  });

  it("opens a bare URL in the default relative range so the board flows", () => {
    expect(readAppUrlState("?view=overview").overview.range).toBe("7d");
  });

  it("resolveOverviewWindow computes the window from a passed-in now per range and passes through absolute state untouched", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const base = defaultOverviewUrlState(now);

    expect(resolveOverviewWindow({ ...base, range: "1h" }, now)).toEqual({
      from: "2026-07-31T23:00:00.000Z",
      to: now.toISOString(),
    });
    expect(resolveOverviewWindow({ ...base, range: "24h" }, now)).toEqual({
      from: "2026-07-31T00:00:00.000Z",
      to: now.toISOString(),
    });
    expect(resolveOverviewWindow({ ...base, range: "7d" }, now)).toEqual({
      from: "2026-07-25T00:00:00.000Z",
      to: now.toISOString(),
    });
    expect(resolveOverviewWindow({ ...base, range: "30d" }, now)).toEqual({
      from: "2026-07-02T00:00:00.000Z",
      to: now.toISOString(),
    });

    const absolute = {
      ...base,
      range: null,
      from: "2020-01-01T00:00:00.000Z",
      to: "2020-01-02T00:00:00.000Z",
    };
    expect(resolveOverviewWindow(absolute, now)).toEqual({
      from: absolute.from,
      to: absolute.to,
    });
  });
});

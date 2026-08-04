import {beforeEach, describe, expect, it} from "vitest";

import {readAppUrlState, replaceAppUrlState, type AppUrlState} from "./url";

function baseState(overrides: Partial<AppUrlState> = {}): AppUrlState {
  const current = readAppUrlState("");
  return {...current, ...overrides};
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("shell URL state", () => {
  it("view가 없으면 Traces를 연다", () => {
    expect(readAppUrlState("").view).toBe("traces");
  });

  it("허용되지 않은 view는 Traces로 떨어진다", () => {
    expect(readAppUrlState("?view=nope").view).toBe("traces");
  });

  it("새 view 값을 그대로 읽는다", () => {
    expect(readAppUrlState("?view=insights").view).toBe("insights");
    expect(readAppUrlState("?view=evaluate").view).toBe("evaluate");
    expect(readAppUrlState("?view=settings").view).toBe("settings");
  });

  // 이미 공유된 link를 깨지 않는다. 재편 이전 값이 대응하는 새 화면을 연다.
  it.each([
    ["?view=overview", "insights", "datasets"],
    ["?view=traces", "traces", "datasets"],
    ["?view=queues", "evaluate", "queues"],
    ["?view=scores", "evaluate", "scores"],
    ["?view=datasets", "evaluate", "datasets"],
    ["?view=data", "settings", "datasets"],
  ])("구 URL %s은 %s로 옮겨 읽는다", (search, view, section) => {
    const state = readAppUrlState(search);
    expect(state.view).toBe(view);
    expect(state.section).toBe(section);
  });

  it("URL을 다시 쓸 때는 새 값만 쓴다", () => {
    replaceAppUrlState(baseState({view: "evaluate", section: "queues"}));
    expect(window.location.search).toContain("view=evaluate");
    expect(window.location.search).toContain("section=queues");
    expect(window.location.search).not.toContain("view=queues");
  });

  it("기본 section인 datasets는 URL에 남기지 않는다", () => {
    replaceAppUrlState(baseState({view: "evaluate", section: "datasets"}));
    expect(window.location.search).not.toContain("section=");
  });

  it("Evaluate가 아닌 화면에서는 section을 쓰지 않는다", () => {
    replaceAppUrlState(baseState({view: "traces", section: "scores"}));
    expect(window.location.search).not.toContain("section=");
  });

  it("view와 section이 round-trip한다", () => {
    replaceAppUrlState(baseState({view: "evaluate", section: "scores"}));
    const restored = readAppUrlState();
    expect(restored.view).toBe("evaluate");
    expect(restored.section).toBe("scores");
  });
});

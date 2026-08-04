import {afterEach, describe, expect, it, vi} from "vitest";

import {
  isThemePreference,
  readPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writePreference,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("theme preference", () => {
  it("저장된 값이 없으면 system이다", () => {
    expect(readPreference()).toBe("system");
  });

  it("허용되지 않은 값이 저장돼 있으면 system으로 취급한다", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readPreference()).toBe("system");
  });

  it("저장한 값을 그대로 읽는다", () => {
    writePreference("dark");
    expect(readPreference()).toBe("dark");
  });

  it("localStorage를 쓸 수 없어도 UI를 막지 않는다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("localStorage 사용 불가");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("localStorage 사용 불가");
    });
    expect(readPreference()).toBe("system");
    expect(() => writePreference("dark")).not.toThrow();
  });

  it("system만 OS 설정을 따르고 light/dark는 고정한다", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("허용된 값만 preference로 인정한다", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

import {afterEach, describe, expect, it, vi} from "vitest";

import {isTheme, readTheme, THEME_STORAGE_KEY, writeTheme} from "./theme";

/** matchMedia는 jsdom에 없다. prefers-color-scheme 응답만 흉내낸다. */
function stubSystemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query === "(prefers-color-scheme: dark)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("고른 적이 없으면 OS 설정을 따른다", () => {
    stubSystemDark(true);
    expect(readTheme()).toBe("dark");
    stubSystemDark(false);
    expect(readTheme()).toBe("light");
  });

  it("예전에 저장된 system은 OS 설정으로 읽는다", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    stubSystemDark(true);
    expect(readTheme()).toBe("dark");
  });

  it("저장한 값을 그대로 읽는다", () => {
    stubSystemDark(true);
    writeTheme("light");
    expect(readTheme()).toBe("light");
  });

  it("localStorage를 쓸 수 없어도 UI를 막지 않는다", () => {
    stubSystemDark(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("localStorage 사용 불가");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("localStorage 사용 불가");
    });
    expect(readTheme()).toBe("light");
    expect(() => writeTheme("dark")).not.toThrow();
  });

  it("light와 dark만 theme으로 인정한다", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isTheme("Dark")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

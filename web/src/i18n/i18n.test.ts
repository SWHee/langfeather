import {afterEach, describe, expect, it, vi} from "vitest";

import {
  EN,
  interpolate,
  isLanguage,
  LANGUAGE_STORAGE_KEY,
  localeOf,
  readLanguage,
  translate,
  writeLanguage,
} from "./i18n";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("language preference", () => {
  it("저장된 값이 없으면 한국어다", () => {
    expect(readLanguage()).toBe("ko");
  });

  it("허용되지 않은 값이 저장돼 있으면 한국어로 취급한다", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    expect(readLanguage()).toBe("ko");
  });

  it("저장한 값을 그대로 읽는다", () => {
    writeLanguage("en");
    expect(readLanguage()).toBe("en");
  });

  it("localStorage를 쓸 수 없어도 UI를 막지 않는다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(readLanguage()).toBe("ko");
    expect(() => writeLanguage("en")).not.toThrow();
  });

  it("허용된 값만 언어로 인정한다", () => {
    expect(isLanguage("ko")).toBe(true);
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("EN")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe("translate", () => {
  it("한국어에서는 원문을 그대로 돌려준다", () => {
    expect(translate("ko", "저장")).toBe("저장");
  });

  it("영어에서는 catalog를 쓴다", () => {
    expect(translate("en", "저장")).toBe("Save");
  });

  // 부분 이관 상태에서도 화면이 깨지지 않아야 한다.
  it("번역이 없으면 한국어로 남는다", () => {
    expect(translate("en", "존재하지 않는 문구")).toBe("존재하지 않는 문구");
  });

  it("{name} 자리에 값을 넣는다", () => {
    expect(translate("en", "{n}건", {n: 12})).toBe("12");
    expect(translate("ko", "{n}건", {n: 12})).toBe("12건");
  });

  it("값이 없는 자리는 그대로 둔다", () => {
    expect(interpolate("{a}와 {b}", {a: "x"})).toBe("x와 {b}");
  });
});

describe("localeOf", () => {
  it("언어 선택을 날짜와 숫자 서식에도 적용한다", () => {
    expect(localeOf("ko")).toBe("ko-KR");
    expect(localeOf("en")).toBe("en-US");
  });
});

describe("EN catalog", () => {
  it("기술 용어를 번역하지 않는다", () => {
    // 이 단어들이 key로 들어오면 API field와의 연결이 끊긴다.
    const technical = ["trace", "observation", "dataset", "payload", "latency"];
    for (const term of technical) {
      expect(Object.keys(EN)).not.toContain(term);
    }
  });

  it("빈 번역은 chart 단위처럼 의도한 곳에만 있다", () => {
    const empty = Object.entries(EN)
      .filter(([, value]) => value === "")
      .map(([key]) => key);
    expect(empty).toEqual(["건"]);
  });
});

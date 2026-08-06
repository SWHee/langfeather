/**
 * theme 선택의 소유자. 계약은 `specs/web-interaction-contract.md`의
 * "client 저장 state"에 있다.
 *
 * 선택지는 light와 dark 둘뿐이다. 저장된 값이 곧 `<html data-theme>`에 붙는
 * 값이라 해석 단계가 없다. 고른 적이 없을 때만 OS 설정을 첫 값으로 쓴다.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "langfeather.theme";

const THEMES: Theme[] = ["light", "dark"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/**
 * 저장된 값이 없거나 알 수 없으면 OS 설정을 따른다. 예전에 저장된 "system"도
 * 여기로 떨어져, 쓰던 사람이 보던 화면이 그대로 유지된다.
 */
export function readTheme(): Theme {
  let raw: string | null;
  try {
    raw = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // 비공개 모드처럼 localStorage를 읽을 수 없는 환경.
    return systemPrefersDark() ? "dark" : "light";
  }
  if (isTheme(raw)) return raw;
  return systemPrefersDark() ? "dark" : "light";
}

/** 저장에 실패해도 오류를 표시하지 않는다. 그 세션 동안만 선택이 유지된다. */
export function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 무시한다.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches
  );
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

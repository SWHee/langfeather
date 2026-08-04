/**
 * theme 선택의 소유자. 계약은 `specs/web-interaction-contract.md`의
 * "client 저장 state"에 있다.
 *
 * 저장하는 값은 사용자의 선택(`system` 포함)이고, `<html data-theme>`에 붙는
 * 값은 그것을 해석한 결과(`light` 또는 `dark`)다. 둘을 섞지 않는다.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "langfeather.theme";

const PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return PREFERENCES.includes(value as ThemePreference);
}

/** 저장된 값이 없거나 허용되지 않은 값이면 system으로 취급한다. */
export function readPreference(): ThemePreference {
  let raw: string | null;
  try {
    raw = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // 비공개 모드처럼 localStorage를 읽을 수 없는 환경. system으로 시작한다.
    return "system";
  }
  return isThemePreference(raw) ? raw : "system";
}

/** 저장에 실패해도 오류를 표시하지 않는다. 그 세션 동안만 선택이 유지된다. */
export function writePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // 무시한다.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches
  );
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark());
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/**
 * OS 설정 변경 구독. system일 때만 새로고침 없이 따라가면 되므로 호출부가
 * preference를 보고 구독 여부를 정한다.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

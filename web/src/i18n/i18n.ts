/**
 * 한/영 전환. 계약은 `specs/web-functional.md`의 "언어 전환"에 있다.
 *
 * key는 한국어 원문 그대로다. key를 새로 짓지 않으므로 호출부가 읽히고,
 * 번역이 없으면 한국어가 그대로 나온다 — 화면이 깨지는 것보다 낫다.
 *
 * 기술 용어(trace, observation, dataset, payload, latency …)는 두 언어 모두에서
 * 영어 원어로 둔다. API field와 SDK 함수와의 연결이 끊기면 안 된다.
 */

export type Language = "ko" | "en";

export const LANGUAGE_STORAGE_KEY = "langfeather.language";

const LANGUAGES: Language[] = ["ko", "en"];

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

export function readLanguage(): Language {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return "ko";
  }
  return isLanguage(raw) ? raw : "ko";
}

export function writeLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // 저장할 수 없어도 그 세션 동안은 선택을 유지한다.
  }
}

/** `{name}` 자리에 값을 넣는다. 값은 사용자 데이터일 수 있으므로 번역하지 않는다. */
export function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function translate(
  language: Language,
  korean: string,
  params?: Record<string, string | number>,
): string {
  const text = language === "en" ? (EN[korean] ?? korean) : korean;
  return params === undefined ? text : interpolate(text, params);
}

/**
 * 한국어 원문 -> 영어. 없는 항목은 한국어로 남는다.
 *
 * 번역하는 것은 사용자가 행동하거나 상태를 이해하기 위한 문구뿐이다. 기술 용어는
 * 양쪽 모두 영어이므로 여기 넣을 필요가 없다.
 */
export const EN: Record<string, string> = {
  // shell
  "본문으로 건너뛰기": "Skip to content",
  "주요 영역": "Primary areas",
  테마: "Theme",
  언어: "Language",
  시스템: "System",
  라이트: "Light",
  다크: "Dark",

  // 공통 동사와 상태
  저장: "Save",
  "저장 중…": "Saving…",
  삭제: "Delete",
  취소: "Cancel",
  생성: "Create",
  추가: "Add",
  적용: "Apply",
  초기화: "Reset",
  선택: "Select",
  완료: "Complete",
  수정: "Edit",
  닫기: "Close",
  "다시 시도": "Retry",
  전체: "All",
  성공: "Success",
  실패: "Failed",
  대기: "Pending",
  요약: "Summary",
  검색: "Search",
  상태: "Status",
  기간: "Period",
  태그: "Tag",
  시작: "Start",
  종료: "End",
  지연: "Latency",
  수집: "Collected",
  이름: "Name",
  설명: "Description",
  값: "Value",
  대상: "Target",
  "이전 요청": "Previous request",
  "다음 요청": "Next request",
  "상세 닫기": "Close detail",
  "그래프 상세 수준": "Graph detail level",
  "데이터 상세 수준": "Data detail level",
  "핵심 입출력": "Key I/O",
  "전체 데이터": "All data",
  반환값: "Return value",
  응답: "Response",
  복사: "Copy",

  // 기간 preset
  "1시간": "1 hour",
  "24시간": "24 hours",
  "최근 7일": "Last 7 days",
  "30일": "30 days",
  커스텀: "Custom",

  // Traces
  "실행 흐름": "Execution flow",
  "실행 관측값이 없습니다.": "No runtime observations.",
  "실제 실행 경로 그래프": "Actual execution path graph",
  "그래프 확대와 축소": "Zoom the graph",
  "Trace ID 또는 input 검색": "Search trace ID or input",
  "목록에서 trace를 고르세요.": "Pick a trace from the list.",
  "그래프에서 관측값을 선택하세요.": "Select an observation in the graph.",
  "Trace 상세를 불러오는 중…": "Loading trace detail…",
  "Payload를 불러오는 중…": "Loading payload…",
  "선택한 관측값 payload를 불러오지 못했습니다.":
    "Could not load the selected observation payload.",
  "Trace 상세": "Trace detail",
  "Trace 작업": "Trace actions",
  "검토 메모": "Review memo",
  "실패한 노드": "Failed node",
  "실행 오류": "Execution error",
  "오류 메시지가 없습니다.": "No error message.",
  "전체 traceback과 metadata는 '전체 데이터'에서 확인할 수 있습니다.":
    "Full traceback and metadata are under 'All data'.",
  "이 trace와 연결된 observations, annotations를 삭제합니다.":
    "This deletes the observations and annotations linked to this trace.",

  // 공통 component
  "불러오는 중…": "Loading…",
  "이전 페이지": "Previous page",
  "다음 페이지": "Next page",
  "{label} 기준 정렬": "Sort by {label}",
  "{n}초 전": "{n}s ago",
  "{n}분 전": "{n}m ago",
  "{n}시간 전": "{n}h ago",
  "{n}일 전": "{n}d ago",

  // runtime graph
  "실행 노드 {name}": "Node {name}",
  "순서 {n}": "Step {n}",
  "하위 {kind} {count}개": "{count} nested {kind}",
  복사됨: "Copied",

  // Retrieval
  "검색 결과": "Retrieved documents",
  "답변에 사용됨": "Used in answer",
  "문서 {total}건": "{total} documents",
  "문서 {total}건 중 {used}건이 답변에 사용됨":
    "{used} of {total} documents used in the answer",

  // kind별 renderer
  "LLM 호출": "LLM call",
  "Tool 호출": "Tool call",

  // Insights
  "그룹: 전체": "Group: all",
  필터: "Filter",
  "해당 기간에 tool 호출이 없습니다.": "No tool calls in this period.",
  "값 없음": "No value",

  // Settings
  설정: "Settings",
  백업: "Backup",
  "SQLite 백업": "SQLite backup",
  "현재 데이터베이스를 다운로드합니다.": "Downloads the current database.",
  "백업 다운로드": "Download backup",
  "로컬 데이터 초기화": "Reset local data",
  "계속하려면 RESET 입력": "Type RESET to continue",
  "로컬 데이터를 초기화할까요?": "Reset local data?",
  "다운로드 중…": "Downloading…",
  "초기화 중…": "Resetting…",
  "SQLite 백업을 다운로드했습니다.": "Downloaded the SQLite backup.",
  "SQLite 백업을 다운로드하지 못했습니다.":
    "Could not download the SQLite backup.",
  "로컬 데이터를 초기화했습니다. 빈 Trace 목록으로 이동합니다.":
    "Local data reset. Returning to an empty trace list.",
  "로컬 데이터를 초기화하지 못했습니다. 데이터는 유지됩니다.":
    "Could not reset local data. Your data is unchanged.",
  "모든 traces, observations, annotations, queues, scores와 datasets가 삭제됩니다.":
    "All traces, observations, annotations, queues, scores and datasets will be deleted.",
  "이 작업은 되돌릴 수 없습니다. 초기화 후 빈 Trace 목록으로 이동합니다.":
    "This cannot be undone. After the reset you return to an empty trace list.",
};

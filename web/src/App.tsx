import { useCallback, useEffect, useState } from "react";

import { QueuesView } from "./annotations/QueuesView";
import { APP_TITLE } from "./constants";
import { EvaluationView } from "./evaluation/EvaluationView";
import { OverviewView } from "./overview/OverviewView";
import { ScoresView } from "./scores/ScoresView";
import { LocalDataView } from "./settings/LocalDataView";
import { OverviewTraceDrawer, TracesView } from "./traces/TracesView";
import {
  applyTheme,
  isThemePreference,
  readPreference,
  watchSystemTheme,
  writePreference,
  type ThemePreference,
} from "./theme";
import {
  readAppUrlState,
  replaceAppUrlState,
  type AppUrlState,
  type AppView,
  type EvaluationUrlState,
  type OverviewUrlState,
} from "./url";
import "./styles.css";

const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string }> = [
  { id: "system", label: "시스템" },
  { id: "light", label: "라이트" },
  { id: "dark", label: "다크" },
];

function ThemeSelect() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    applyTheme(preference);
    // system일 때만 OS 설정 변경을 따라간다.
    if (preference !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [preference]);

  return (
    <select
      className="lf-theme-select"
      aria-label="테마"
      value={preference}
      onChange={(event) => {
        const next = event.target.value;
        if (!isThemePreference(next)) return;
        writePreference(next);
        setPreference(next);
      }}
    >
      {THEME_OPTIONS.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const NAVIGATION: ReadonlyArray<{ id: AppView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "traces", label: "Traces" },
  { id: "queues", label: "Annotation Queues" },
  { id: "scores", label: "Scores" },
  { id: "datasets", label: "Evaluation" },
  { id: "data", label: "Setting" },
];

export function App() {
  const [urlState, setUrlState] = useState<AppUrlState>(() =>
    readAppUrlState(),
  );

  useEffect(() => {
    const restore = () => setUrlState(readAppUrlState());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const commit = useCallback((next: AppUrlState) => {
    setUrlState(next);
    replaceAppUrlState(next);
  }, []);

  const selectView = useCallback((view: AppView) => {
    setUrlState((current) => {
      const next = {
        ...current,
        view,
        traceId: view === "traces" ? current.traceId : null,
      };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const setOverview = useCallback((overview: OverviewUrlState) => {
    setUrlState((current) => {
      const next = { ...current, overview };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const setEvaluation = useCallback((evaluation: EvaluationUrlState) => {
    setUrlState((current) => {
      const next = { ...current, evaluation };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const openTrace = useCallback((traceId: string) => {
    setUrlState((current) => {
      const next = { ...current, view: "traces" as const, traceId };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const openOverviewTrace = useCallback((traceId: string) => {
    setUrlState((current) => {
      const next = { ...current, traceId };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const closeOverviewTrace = useCallback(() => {
    setUrlState((current) => {
      const next = { ...current, traceId: null };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  return (
    <div className={`lf-shell surface-${urlState.view}`}>
      <a className="lf-skip" href="#lf-main">
        본문으로 건너뛰기
      </a>
      <header className="lf-topbar">
        <button
          className="lf-brand"
          type="button"
          onClick={() => selectView("overview")}
          aria-label={`${APP_TITLE} Overview 열기`}
        >
          <svg className="lf-mark" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M49.6 12.6c.5.2.8.6.9 1.1 1.4 8.5-.4 16.2-5.3 21.6-3.6 4-8.3 6.1-13.3 6.3 2.8 1.3 6.4 1.6 10.2.6-3 5.1-8.2 8.2-14.2 8.4-2.2.1-4.3-.2-6.2-.8l-4.6 6.9a1.6 1.6 0 1 1-2.7-1.8l4.6-6.9c-1.4-1.4-2.5-3.1-3.2-5.1-2-5.7-.7-11.6 2.9-15.8-.5 3.9.2 7.4 1.9 9.9-1.1-4.9-.3-10 2.4-14.4 3.6-6 9.8-9.9 18.1-11 .5-.1 1 .1 1.3.5.3.4.3 1 0 1.4l-9.7 15.3c-.2.4-.1.9.3 1.1.4.2.9.1 1.1-.3l14.2-16.4c.3-.4.8-.5 1.3-.4Z" />
          </svg>
          <span className="lf-wordmark">{APP_TITLE}</span>
        </button>
        <nav className="lf-nav" aria-label="주요 영역">
          {NAVIGATION.map((item) => (
            <button
              className="lf-nav-link"
              key={item.id}
              type="button"
              aria-current={urlState.view === item.id ? "page" : undefined}
              onClick={() => selectView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <span className="lf-topbar-spacer" />
        <ThemeSelect />
      </header>

      {urlState.view === "overview" ? (
        <>
          <OverviewView
            state={urlState.overview}
            onChange={setOverview}
            selectedTraceId={urlState.traceId}
            onOpenTrace={openOverviewTrace}
          />
          <OverviewTraceDrawer
            selectedTraceId={urlState.traceId}
            onClose={closeOverviewTrace}
          />
        </>
      ) : null}
      {urlState.view === "traces" ? (
        <TracesView
          selectedTraceId={urlState.traceId}
          onSelectTrace={openTrace}
          onClearTrace={() => commit({ ...urlState, traceId: null })}
        />
      ) : null}
      {urlState.view === "queues" ? <QueuesView /> : null}
      {urlState.view === "scores" ? <ScoresView /> : null}
      {urlState.view === "datasets" ? (
        <EvaluationView state={urlState.evaluation} onChange={setEvaluation} />
      ) : null}
      {urlState.view === "data" ? (
        <LocalDataView
          onReset={() => commit({ ...urlState, view: "traces", traceId: null })}
        />
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";

import { QueuesView } from "./annotations/QueuesView";
import { APP_TITLE } from "./constants";
import { EvaluationView } from "./evaluation/EvaluationView";
import { OverviewView } from "./overview/OverviewView";
import { ScoresView } from "./scores/ScoresView";
import { LocalDataView } from "./settings/LocalDataView";
import { OverviewTraceDrawer, TracesView } from "./traces/TracesView";
import {
  readAppUrlState,
  replaceAppUrlState,
  type AppUrlState,
  type AppView,
  type EvaluationUrlState,
  type OverviewUrlState,
} from "./url";
import "./styles.css";

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
      <header className="lf-topbar">
        <button
          className="lf-brand"
          type="button"
          onClick={() => selectView("overview")}
          aria-label={`${APP_TITLE} Overview 열기`}
        >
          <span className="lf-mark" aria-hidden="true" />
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

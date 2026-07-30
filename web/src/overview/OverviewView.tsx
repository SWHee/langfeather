import { useEffect, useState } from "react";
import { getDashboard, getScores } from "../api/client";
import type {
  DashboardFeedback,
  DashboardQuery,
  DashboardResponse,
  ScoreConfig,
} from "../api/types";
import { defaultOverviewUrlState, type OverviewUrlState } from "../url";
import { LineChart, type LineChartSeries } from "./LineChart";

type State =
  | { status: "loading"; key: string }
  | { status: "error"; key: string }
  | { status: "success"; key: string; data: DashboardResponse };

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function dashboardQuery(state: OverviewUrlState): DashboardQuery {
  return {
    from: state.from,
    to: state.to,
    timezone: state.timezone,
    bucket: state.bucket,
    query: state.query || undefined,
    tag: state.tag || undefined,
    session_id: state.sessionId || undefined,
    release: state.release || undefined,
    environment: state.environment || undefined,
    user_id: state.userId || undefined,
    score_id: state.scoreIds,
    tool_name: state.toolNames,
  };
}

function labels(response: DashboardResponse): string[] {
  return response.buckets.map((bucket) =>
    new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
      hour: response.bucket === "hour" ? "numeric" : undefined,
      timeZone: response.timezone,
    }).format(new Date(bucket.started_at)),
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const headingId = `overview-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section className="overview-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  );
}

type FeedbackCharts = {
  rates: LineChartSeries[];
  numbers: LineChartSeries[];
  counts: Array<{ id: string; name: string; count: number }>;
};

const TOOL_COLORS = [
  "#2563eb",
  "#1d4ed8",
  "#22a06b",
  "#6b7280",
  "#7c3aed",
  "#b54708",
] as const;

function feedbackSeries(response: DashboardResponse): FeedbackCharts {
  const all = new Map<string, DashboardFeedback>();
  response.buckets.forEach((bucket) => {
    bucket.feedback.forEach((item) => all.set(item.score_config_id, item));
  });
  const rates: LineChartSeries[] = [];
  const numbers: LineChartSeries[] = [];
  const counts: FeedbackCharts["counts"] = [];
  [...all.values()].forEach((score, scoreIndex) => {
    const color = TOOL_COLORS[scoreIndex % TOOL_COLORS.length] ?? "#2563eb";
    counts.push({
      id: score.score_config_id,
      name: score.name,
      count: response.buckets.reduce(
        (total, bucket) =>
          total +
          (bucket.feedback.find(
            (item) => item.score_config_id === score.score_config_id,
          )?.annotation_count ?? 0),
        0,
      ),
    });
    if (score.data_type === "number") {
      numbers.push({
        id: score.score_config_id,
        label: score.name,
        color,
        values: response.buckets.map(
          (bucket) =>
            bucket.feedback.find(
              (item) => item.score_config_id === score.score_config_id,
            )?.value ?? null,
        ),
      });
      return;
    }
    if (score.data_type === "boolean") {
      rates.push({
        id: score.score_config_id,
        label: score.name,
        color,
        values: response.buckets.map(
          (bucket) =>
            bucket.feedback.find(
              (item) => item.score_config_id === score.score_config_id,
            )?.value ?? null,
        ),
      });
      return;
    }
    score.option_rates.forEach((option, optionIndex) => {
      rates.push({
        id: `${score.score_config_id}:${option.score_option_id}`,
        label: `${score.name} · ${option.label}`,
        color:
          TOOL_COLORS[(scoreIndex + optionIndex) % TOOL_COLORS.length] ??
          "#2563eb",
        values: response.buckets.map(
          (bucket) =>
            bucket.feedback
              .find((item) => item.score_config_id === score.score_config_id)
              ?.option_rates.find(
                (item) => item.score_option_id === option.score_option_id,
              )?.rate ?? null,
        ),
      });
    });
  });
  return { rates, numbers, counts };
}

function DashboardPanels({ response }: { response: DashboardResponse }) {
  const xLabels = labels(response);
  const toolNames = [
    ...new Set(
      response.buckets.flatMap((bucket) => Object.keys(bucket.tool_calls)),
    ),
  ];
  const feedback = feedbackSeries(response);
  const totalRequests = response.buckets.reduce(
    (total, bucket) =>
      total +
      bucket.requests.completed +
      bucket.requests.failed +
      bucket.requests.cancelled,
    0,
  );
  if (totalRequests === 0) {
    return (
      <div className="overview-empty">
        <h2>이 기간에는 요청이 없습니다</h2>
        <p>기간 또는 공통 필터를 조정해 보세요.</p>
      </div>
    );
  }
  return (
    <div className="overview-panels">
      <Panel title="Requests">
        <LineChart
          title="Requests"
          labels={xLabels}
          series={[
            {
              id: "completed",
              label: "완료",
              color: "#22a06b",
              values: response.buckets.map((item) => item.requests.completed),
            },
            {
              id: "failed",
              label: "실패",
              color: "#b42318",
              values: response.buckets.map((item) => item.requests.failed),
            },
            {
              id: "cancelled",
              label: "취소",
              color: "#667085",
              values: response.buckets.map((item) => item.requests.cancelled),
            },
          ]}
        />
      </Panel>
      <Panel title="Latency">
        <LineChart
          title="Latency"
          labels={xLabels}
          valueFormatter={(value) => `${(value / 1_000).toFixed(0)} ms`}
          series={[
            {
              id: "p50",
              label: "p50",
              color: "#2563eb",
              values: response.buckets.map((item) => item.latency_us.p50),
            },
            {
              id: "p95",
              label: "p95",
              color: "#1d4ed8",
              values: response.buckets.map((item) => item.latency_us.p95),
            },
            {
              id: "p99",
              label: "p99",
              color: "#22a06b",
              values: response.buckets.map((item) => item.latency_us.p99),
            },
          ]}
        />
      </Panel>
      <Panel title="Error rate">
        <LineChart
          title="Error rate"
          labels={xLabels}
          valueFormatter={(value) => `${(value * 100).toFixed(1)}%`}
          series={[
            {
              id: "error",
              label: "실패 비율",
              color: "#b42318",
              values: response.buckets.map((item) => item.error.rate),
            },
          ]}
        />
      </Panel>
      <Panel title="LLM calls">
        <LineChart
          title="LLM calls"
          labels={xLabels}
          series={[
            {
              id: "llm",
              label: "LLM",
              color: "#2563eb",
              values: response.buckets.map((item) => item.llm_calls),
            },
          ]}
        />
      </Panel>
      <Panel title="Tool calls">
        {response.totals.tool_calls === 0 || toolNames.length === 0 ? (
          <p className="overview-partial-empty">
            이 기간에는 tool 호출이 없습니다.
          </p>
        ) : (
          <LineChart
            title="Tool calls"
            labels={xLabels}
            series={toolNames.map((name, index) => ({
              id: name,
              label: name === "__others__" ? "Others" : name,
              color: TOOL_COLORS[index % TOOL_COLORS.length] ?? "#2563eb",
              values: response.buckets.map(
                (item) => item.tool_calls[name] ?? 0,
              ),
            }))}
          />
        )}
      </Panel>
      <Panel title="Feedback">
        {feedback.rates.length === 0 && feedback.numbers.length === 0 ? (
          <p className="overview-partial-empty">
            선택한 feedback score의 기록이 없습니다.
          </p>
        ) : (
          <div className="feedback-charts">
            <ul className="feedback-coverage" aria-label="Feedback 표본 수">
              {feedback.counts.map((score) => (
                <li key={score.id}>
                  <span>{score.name}</span>
                  <strong>{score.count.toLocaleString("ko-KR")}개 기록</strong>
                </li>
              ))}
            </ul>
            {feedback.rates.length > 0 && (
              <LineChart
                title="Feedback rates"
                labels={xLabels}
                valueFormatter={(value) => `${(value * 100).toFixed(1)}%`}
                series={feedback.rates}
              />
            )}
            {feedback.numbers.length > 0 && (
              <LineChart
                title="Feedback averages"
                labels={xLabels}
                valueFormatter={(value) => String(value)}
                series={feedback.numbers}
              />
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Filters({
  value,
  scores,
  availableTools,
  onChange,
  onApply,
  onReset,
}: {
  value: OverviewUrlState;
  scores: ScoreConfig[];
  availableTools: Array<{ name: string; count: number }>;
  onChange: (value: OverviewUrlState) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const update = <K extends keyof OverviewUrlState>(
    key: K,
    next: OverviewUrlState[K],
  ) => onChange({ ...value, [key]: next });
  const setPreset = (days: number) => {
    const to = new Date();
    onChange({
      ...value,
      from: new Date(to.getTime() - days * 86_400_000).toISOString(),
      to: to.toISOString(),
      bucket: "auto",
    });
  };
  const toggle = (
    key: "scoreIds" | "toolNames",
    id: string,
    maximum?: number,
  ) => {
    const current = value[key];
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    if (maximum !== undefined && next.length > maximum) return;
    update(key, next);
  };
  return (
    <form
      className="overview-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="overview-periods" aria-label="기간 선택">
        <button type="button" onClick={() => setPreset(1)}>
          24h
        </button>
        <button type="button" onClick={() => setPreset(7)}>
          7d
        </button>
        <button type="button" onClick={() => setPreset(30)}>
          30d
        </button>
        <label>
          시작
          <input
            aria-label="Overview 시작 시간"
            type="datetime-local"
            value={toLocalInput(value.from)}
            onChange={(event) =>
              update("from", fromLocalInput(event.target.value))
            }
          />
        </label>
        <label>
          끝
          <input
            aria-label="Overview 끝 시간"
            type="datetime-local"
            value={toLocalInput(value.to)}
            onChange={(event) =>
              update("to", fromLocalInput(event.target.value))
            }
          />
        </label>
        <label>
          Bucket
          <select
            aria-label="Overview bucket"
            value={value.bucket}
            onChange={(event) =>
              update("bucket", event.target.value as OverviewUrlState["bucket"])
            }
          >
            <option value="auto">Auto</option>
            <option value="hour">Hour</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </div>
      <div className="overview-filter-fields">
        <label>
          검색
          <input
            aria-label="Overview 검색"
            value={value.query}
            onChange={(event) => update("query", event.target.value)}
          />
        </label>
        <label>
          Tag
          <input
            aria-label="Overview 태그"
            value={value.tag}
            onChange={(event) => update("tag", event.target.value)}
          />
        </label>
        <label>
          Session
          <input
            aria-label="Overview 세션"
            value={value.sessionId}
            onChange={(event) => update("sessionId", event.target.value)}
          />
        </label>
        <label>
          Release
          <input
            aria-label="Overview 릴리스"
            value={value.release}
            onChange={(event) => update("release", event.target.value)}
          />
        </label>
        <label>
          Environment
          <input
            aria-label="Overview 환경"
            value={value.environment}
            onChange={(event) => update("environment", event.target.value)}
          />
        </label>
        <label>
          User
          <input
            aria-label="Overview 사용자"
            value={value.userId}
            onChange={(event) => update("userId", event.target.value)}
          />
        </label>
      </div>
      <fieldset>
        <legend>Feedback score (최대 4개)</legend>
        {scores.map((score) => (
          <label key={score.score_config_id} className="overview-choice">
            <input
              type="checkbox"
              checked={value.scoreIds.includes(score.score_config_id)}
              disabled={
                !value.scoreIds.includes(score.score_config_id) &&
                value.scoreIds.length >= 4
              }
              onChange={() => toggle("scoreIds", score.score_config_id, 4)}
            />
            {score.name}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Tools</legend>
        {availableTools.map((tool) => (
          <label key={tool.name} className="overview-choice">
            <input
              type="checkbox"
              checked={value.toolNames.includes(tool.name)}
              onChange={() => toggle("toolNames", tool.name)}
            />
            {tool.name} <span>({tool.count})</span>
          </label>
        ))}
      </fieldset>
      <div className="overview-filter-actions">
        <button className="primary-button" type="submit">
          적용
        </button>
        <button className="text-button" type="button" onClick={onReset}>
          초기화
        </button>
      </div>
    </form>
  );
}

export function OverviewView({
  value,
  onUrlStateChange,
}: {
  value: OverviewUrlState;
  onUrlStateChange: (value: OverviewUrlState) => void;
}) {
  const requestKey = JSON.stringify(value);
  const [draft, setDraft] = useState(value);
  const [retryRevision, setRetryRevision] = useState(0);
  const stateKey = `${requestKey}:${retryRevision}`;
  const [state, setState] = useState<State>({
    status: "loading",
    key: stateKey,
  });
  const [scores, setScores] = useState<ScoreConfig[]>([]);
  useEffect(() => {
    void getScores()
      .then((response) => setScores(response.items))
      .catch(() => setScores([]));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void getDashboard(dashboardQuery(value), controller.signal)
      .then((data) => setState({ status: "success", key: stateKey, data }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState({ status: "error", key: stateKey });
      });
    return () => controller.abort();
  }, [stateKey, value]);
  const currentState =
    state.key === stateKey ? state : { status: "loading" as const };
  const tools =
    currentState.status === "success" ? currentState.data.available_tools : [];
  const summary =
    currentState.status === "success"
      ? `${currentState.data.totals.trace_count} requests · ${currentState.data.bucket}`
      : null;
  return (
    <main className="overview-page">
      <header className="overview-heading">
        <div>
          <h1>Overview</h1>
          <p>선택 기간의 runtime 변화를 확인합니다.</p>
        </div>
        {summary !== null && <span className="record-count">{summary}</span>}
      </header>
      <Filters
        value={draft}
        scores={scores}
        availableTools={tools}
        onChange={setDraft}
        onApply={() => onUrlStateChange(draft)}
        onReset={() => {
          const reset = defaultOverviewUrlState();
          setDraft(reset);
          onUrlStateChange(reset);
        }}
      />
      {currentState.status === "loading" && (
        <div className="state-card" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <p>Overview를 불러오는 중입니다…</p>
        </div>
      )}
      {currentState.status === "error" && (
        <div className="state-card state-card-error" role="alert">
          <div>
            <strong>Overview를 불러오지 못했습니다</strong>
            <p>서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setRetryRevision((current) => current + 1)}
          >
            다시 시도
          </button>
        </div>
      )}
      {currentState.status === "success" && (
        <DashboardPanels response={currentState.data} />
      )}
    </main>
  );
}

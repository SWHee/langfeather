import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { getDashboard, getTraces } from "../api/client";
import type {
  DashboardMetricBucket,
  DashboardQuery,
  DashboardResponse,
  TraceListItem,
} from "../api/types";
import {
  ColumnHeaderCell,
  deferState,
  EmptyBlock,
  ErrorBlock,
  formatDuration,
  fromLocalInput,
  relativeTime,
  sortRows,
  StatusDot,
  toLocalInput,
  useReorderableColumns,
  type ReorderableColumnDef,
} from "../components";
import { useLocale, useT, type Translate } from "../i18n/context";
import { previewText } from "../preview";
import {
  resolveOverviewWindow,
  type OverviewRange,
  type OverviewUrlState,
} from "../url";

type ChartKey =
  "traceCount" | "latency" | "errorRate" | "llmCalls" | "toolCalls";

type ChartSeries = {
  label: string;
  color: string;
  values: Array<number | null>;
};

type ChartSpec = {
  id: ChartKey;
  title: string;
  unit: string;
  decimals?: number;
  series: ChartSeries[];
  emptyMessage?: string;
};

type CardLayout = { id: ChartKey; span: number };

const INITIAL_LAYOUT: CardLayout[] = [
  { id: "traceCount", span: 12 },
  { id: "latency", span: 6 },
  { id: "errorRate", span: 6 },
  { id: "llmCalls", span: 6 },
  { id: "toolCalls", span: 6 },
];

const ALLOWED_SPANS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

// Server-internal aggregation key. It is never a tool the user invoked, so it
// must not reach the Tool Calls legend or line.
const OTHERS_TOOL_KEY = "__others__";

const RECENT_TRACE_COLUMNS: ReorderableColumnDef[] = [
  { id: "status", label: "상태", width: 100 },
  { id: "started", label: "수집", width: 115 },
  { id: "trace_id", label: "Trace ID", width: 212 },
  { id: "input", label: "Input", width: 275 },
  { id: "output", label: "Output", width: 275 },
  { id: "latency", label: "Latency", width: 152, align: "end" },
  { id: "count", label: "# Observations", width: 208, align: "end" },
];

const RECENT_TRACE_SORT_VALUES: Record<
  string,
  (trace: TraceListItem) => string | number
> = {
  status: (trace) => trace.status,
  started: (trace) => trace.started_at,
  trace_id: (trace) => trace.trace_id,
  input: (trace) => previewText(trace.input_preview),
  output: (trace) => previewText(trace.output_preview),
  latency: (trace) => trace.duration_us,
  count: (trace) => trace.observation_count,
};

function overviewQuery(
  state: OverviewUrlState,
  bounds: { from: string; to: string },
): DashboardQuery {
  return {
    from: bounds.from,
    to: bounds.to,
    timezone: state.timezone,
    bucket: state.bucket,
    query: state.query || undefined,
    tag: state.tag || undefined,
    session_id: state.sessionId || undefined,
    release: state.release || undefined,
    environment: state.environment || undefined,
    user_id: state.userId || undefined,
    score_id: state.scoreIds.length ? state.scoreIds : undefined,
    tool_name: state.toolNames.length ? state.toolNames : undefined,
  };
}

function toolColor(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === "retriever") return "var(--blue)";
  if (normalized === "search") return "var(--series-3)";
  if (normalized === "http") return "var(--series-2)";
  return "var(--accent)";
}

function specsFor(response: DashboardResponse): ChartSpec[] {
  const buckets = response.buckets;
  const values = (select: (bucket: DashboardMetricBucket) => number | null) =>
    buckets.map(select);
  const toolNames = [
    ...new Set(buckets.flatMap((bucket) => Object.keys(bucket.tool_calls))),
  ]
    .filter((name) => name !== OTHERS_TOOL_KEY)
    .slice(0, 3);
  const toolCallTotal = buckets.reduce(
    (total, bucket) =>
      total +
      Object.entries(bucket.tool_calls).reduce(
        (sum, [name, count]) =>
          name === OTHERS_TOOL_KEY ? sum : sum + (count ?? 0),
        0,
      ),
    0,
  );
  return [
    {
      id: "traceCount",
      title: "Trace Count",
      unit: "건",
      series: [
        {
          label: "Success",
          color: "var(--green)",
          values: values((bucket) => bucket.requests.completed),
        },
        {
          label: "Error",
          color: "var(--red)",
          values: values((bucket) => bucket.requests.failed),
        },
      ],
    },
    {
      id: "latency",
      title: "Latency",
      unit: "ms",
      series: [
        {
          label: "p50",
          color: "var(--series-1)",
          values: values((bucket) =>
            bucket.latency_us.p50 === null
              ? null
              : bucket.latency_us.p50 / 1_000,
          ),
        },
        {
          label: "p95",
          color: "var(--series-3)",
          values: values((bucket) =>
            bucket.latency_us.p95 === null
              ? null
              : bucket.latency_us.p95 / 1_000,
          ),
        },
        {
          label: "p99",
          color: "var(--series-2)",
          values: values((bucket) =>
            bucket.latency_us.p99 === null
              ? null
              : bucket.latency_us.p99 / 1_000,
          ),
        },
      ],
    },
    {
      id: "errorRate",
      title: "Error Rate",
      unit: "%",
      decimals: 2,
      series: [
        {
          label: "Error rate",
          color: "var(--red)",
          values: values((bucket) =>
            bucket.error.rate === null ? null : bucket.error.rate * 100,
          ),
        },
      ],
    },
    {
      id: "llmCalls",
      title: "LLM Calls",
      unit: "건",
      series: [
        {
          label: "LLM",
          color: "var(--series-1)",
          values: values((bucket) => bucket.llm_calls),
        },
      ],
    },
    {
      id: "toolCalls",
      title: "Tool Calls",
      unit: "건",
      series:
        toolCallTotal === 0
          ? []
          : toolNames.map((name) => ({
              label: name,
              color: toolColor(name),
              values: values((bucket) => bucket.tool_calls[name] ?? 0),
            })),
      emptyMessage: "해당 기간에 tool 호출이 없습니다.",
    },
  ];
}

function linePath(
  values: Array<number | null>,
  min: number,
  max: number,
): string {
  const width = 100;
  const height = 100;
  const available = values.length - 1 || 1;
  return values.reduce<string>((path, value, index) => {
    if (value === null) return path;
    const x = (index / available) * width;
    const y = height - ((value - min) / (max - min || 1)) * height;
    return `${path}${path === "" || values[index - 1] === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }, "");
}

function formatValue(
  value: number | null,
  spec: ChartSpec,
  t: Translate,
  locale: string,
): string {
  if (value === null) return t("값 없음");
  const raw = spec.decimals
    ? value.toFixed(spec.decimals)
    : Math.round(value).toLocaleString(locale);
  // 단위는 번역 대상이다. 영어에서는 "건"에 해당하는 접미어를 쓰지 않는다.
  return `${raw}${t(spec.unit)}`;
}

function timelineLabel(
  value: string,
  locale: string,
  detailed = false,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(
    locale,
    detailed
      ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { month: "numeric", day: "numeric" },
  ).format(date);
}

const PERIOD_PRESETS: ReadonlyArray<{
  range: OverviewRange;
  label: string;
}> = [
  { range: "1h", label: "1시간" },
  { range: "24h", label: "24시간" },
  { range: "7d", label: "최근 7일" },
  { range: "30d", label: "30일" },
];

/** polling 주기. 초 단위로 두드릴 정도는 아니고, 얼어붙지도 않을 정도. */
const POLL_INTERVAL_MS = 30_000;

function ChartCard({
  spec,
  buckets,
  span,
  editing,
  focus,
  onFocusChange,
  onResizeStart,
  onDragStart,
  onDrop,
}: {
  spec: ChartSpec;
  buckets: DashboardMetricBucket[];
  span: number;
  editing: boolean;
  focus: number | null;
  onFocusChange: (focus: number | null) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [pointerY, setPointerY] = useState<number | null>(null);
  const all = spec.series
    .flatMap((series) => series.values)
    .filter((value): value is number => value !== null);
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) * 1.12 : 1;
  const pointCount = buckets.length;
  const focusedBucket = focus === null ? null : buckets[focus];
  const focusX =
    focus === null || pointCount < 2 ? 50 : (focus / (pointCount - 1)) * 100;

  // The tooltip rides the crosshair, so it is placed in percentages of the
  // chart box: a fraction needs no conversion out of viewport pixels.
  const tooltipFlipped = focusX > 62;
  const tooltipTop =
    pointerY === null ? 18 : Math.min(80, Math.max(20, pointerY));

  const setPointFromOffset = (offsetX: number, width: number) => {
    if (pointCount === 0) return;
    onFocusChange(
      Math.max(
        0,
        Math.min(
          pointCount - 1,
          Math.round((offsetX / Math.max(1, width)) * (pointCount - 1)),
        ),
      ),
    );
  };

  return (
    <article
      className={`traffic-card span-${span}`}
      data-chart={spec.id}
      data-span={span}
      onDragOver={(event) => {
        if (editing) event.preventDefault();
      }}
      onDrop={(event) => {
        if (editing) {
          event.preventDefault();
          onDrop();
        }
      }}
    >
      <header
        className="traffic-card-head"
        draggable={editing}
        onDragStart={onDragStart}
      >
        <div className="card-title">
          {editing ? (
            <span className="drag-grip" aria-hidden="true">
              ⠿⠿
            </span>
          ) : null}
          <div>
            <h3>{spec.title}</h3>
          </div>
        </div>
      </header>
      <div className="chart-frame">
        {all.length === 0 ? (
          <div className="chart-empty">
            {spec.emptyMessage !== undefined
              ? t(spec.emptyMessage)
              :
              t("이 기간에 표시할 {title} 데이터가 없습니다.", {title: spec.title})}
          </div>
        ) : (
          <>
            <div className="chart-yaxis" aria-hidden="true">
              {[20, 40, 60, 80].map((line) => (
                <span key={line} style={{ top: `${line}%` }}>
                  {formatValue(max - (line / 100) * (max - min), spec, t, locale)}
                </span>
              ))}
            </div>
            <div
              className="chart-area"
              tabIndex={0}
              role="img"
              aria-label={t("{title} 시계열. 화살표 키로 시점 이동", {title: spec.title})}
              onMouseMove={(event) => {
                // clientX and getBoundingClientRect share one coordinate
                // space; clientWidth does not follow any scaling applied to
                // the page, so measuring against it skews the ratio.
                const rect = event.currentTarget.getBoundingClientRect();
                setPointFromOffset(event.clientX - rect.left, rect.width);
                setPointerY(((event.clientY - rect.top) / rect.height) * 100);
              }}
              onMouseLeave={() => {
                setPointerY(null);
                onFocusChange(null);
              }}
              onFocus={() => onFocusChange(Math.floor(pointCount / 2))}
              onBlur={() => {
                setPointerY(null);
                onFocusChange(null);
              }}
              onKeyDown={(event) => {
                if (pointCount === 0) return;
                const current = focus ?? Math.floor(pointCount / 2);
                if (event.key === "ArrowRight")
                  onFocusChange(Math.min(pointCount - 1, current + 1));
                else if (event.key === "ArrowLeft")
                  onFocusChange(Math.max(0, current - 1));
                else if (event.key === "Home") onFocusChange(0);
                else if (event.key === "End") onFocusChange(pointCount - 1);
                else return;
                event.preventDefault();
              }}
            >
              <svg
                className="signal-chart"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {[20, 40, 60, 80].map((line) => (
                  <line
                    key={line}
                    x1="0"
                    x2="100"
                    y1={line}
                    y2={line}
                    className="chart-grid"
                  />
                ))}
                {spec.series.map((series, index) => (
                  <path
                    key={series.label}
                    d={linePath(series.values, min, max)}
                    fill="none"
                    // stroke는 presentation attribute라 var()가 해석되지 않는다.
                    // style로 넘겨야 token이 적용된다.
                    style={{ stroke: series.color }}
                    strokeWidth="2"
                    // 색만으로 구분하지 않는다. 두 번째 series부터 파선을 섞어
                    // 색을 구분하지 못해도 읽을 수 있게 한다.
                    strokeDasharray={
                      index === 0 ? undefined : index === 1 ? "6 4" : "2 3"
                    }
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {focus !== null ? (
                  <line
                    x1={focusX}
                    x2={focusX}
                    y1="0"
                    y2="100"
                    className="chart-crosshair"
                  />
                ) : null}
              </svg>
              {focusedBucket ? (
                <div
                  className="chart-tooltip"
                  role="status"
                  style={{
                    left: `${focusX}%`,
                    top: `${tooltipTop}%`,
                    transform: tooltipFlipped
                      ? "translate(calc(-100% - 15px), -50%)"
                      : "translate(15px, -50%)",
                  }}
                >
                  <span className="tooltip-time">
                    {timelineLabel(focusedBucket.started_at, locale, true)}
                  </span>
                  {spec.series.map((series) => (
                    <span key={series.label} style={{ color: series.color }}>
                      ● <span className="tooltip-label">{series.label}</span>{" "}
                      <b>
                        {formatValue(series.values[focus ?? 0] ?? null, spec, t, locale)}
                      </b>
                      <br />
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div className="chart-legend">
        {spec.series.length ? (
          spec.series.map((series) => (
            <span className="legend-item" key={series.label}>
              <i className="legend-dot" style={{ background: series.color }} />
              {series.label}
            </span>
          ))
        ) : (
          <span
            className="legend-item"
            aria-hidden="true"
            style={{ visibility: "hidden" }}
          >
            <i className="legend-dot" />
            placeholder
          </span>
        )}
      </div>
      {editing ? (
        <span
          className="resize-handle"
          onPointerDown={onResizeStart}
          aria-hidden="true"
        />
      ) : null}
    </article>
  );
}

export function OverviewView({
  state,
  onChange,
  selectedTraceId,
  onOpenTrace,
}: {
  state: OverviewUrlState;
  onChange: (state: OverviewUrlState) => void;
  selectedTraceId: string | null;
  onOpenTrace: (traceId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [draft, setDraft] = useState(state);
  const recentColumns = useReorderableColumns(RECENT_TRACE_COLUMNS);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [recent, setRecent] = useState<TraceListItem[]>([]);
  const sortedRecent = useMemo(
    () => sortRows(recent, recentColumns.sort, RECENT_TRACE_SORT_VALUES),
    [recent, recentColumns.sort],
  );
  const [recentError, setRecentError] = useState<string | null>(null);
  // 상대 range일 때만 도는 polling tick. 두 fetch effect가 이 값을 의존성으로
  // 받아 30초마다 재조회한다. URL이나 history는 건드리지 않는다.
  const [tick, setTick] = useState(0);
  const hasDashboardRef = useRef(false);
  const editing = true;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layout, setLayout] = useState(INITIAL_LAYOUT);
  const [currentChart, setCurrentChart] = useState<ChartKey>("traceCount");
  const [chartAnnouncement, setChartAnnouncement] = useState("");
  const [sharedFocus, setSharedFocus] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => toLocalInput(state.from));
  const [customTo, setCustomTo] = useState(() => toLocalInput(state.to));
  const boardRef = useRef<HTMLDivElement>(null);
  const chartHighlightTimer = useRef<number | null>(null);
  const recentTraceTrigger = useRef<HTMLTableRowElement | null>(null);
  const lastRecentTraceId = useRef<string | null>(null);
  const dragged = useRef<ChartKey | null>(null);
  const resize = useRef<{
    id: ChartKey;
    startX: number;
    startSpan: number;
  } | null>(null);

  useEffect(() => {
    deferState(() => setDraft(state));
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    const bounds = resolveOverviewWindow(state);
    deferState(() => {
      if (controller.signal.aborted) return;
      // 이미 그려진 대시보드가 있으면(=polling 재조회) loading 화면으로 갈아
      // 끼우지 않는다. 30초마다 전체 보드가 깜빡이면 그 자체가 방해다.
      setLoading(!hasDashboardRef.current);
      setDashboardError(null);
      setSharedFocus(null);
    });
    void getDashboard(overviewQuery(state, bounds), controller.signal)
      .then((response) => {
        hasDashboardRef.current = true;
        setDashboard(response);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setDashboardError("Overview 데이터를 불러오지 못했습니다.");
        setDashboard(null);
        hasDashboardRef.current = false;
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [state, retry, tick]);

  useEffect(() => {
    const controller = new AbortController();
    const bounds = resolveOverviewWindow(state);
    deferState(() => {
      if (!controller.signal.aborted) setRecentError(null);
    });
    void getTraces(
      {
        limit: 20,
        query: state.query || undefined,
        tag: state.tag || undefined,
        session_id: state.sessionId || undefined,
        from: bounds.from,
        to: bounds.to,
      },
      controller.signal,
    )
      .then((response) => setRecent(response.items))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setRecent([]);
        setRecentError("최근 Trace를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [state, tick]);

  useEffect(() => {
    if (state.range === null) return;
    const id = window.setInterval(() => {
      setTick((value) => value + 1);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [state.range]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = resize.current;
      const board = boardRef.current;
      if (!current || !board) return;
      const column = (board.getBoundingClientRect().width - 11 * 16) / 12;
      const raw = Math.round(
        (current.startSpan * column + event.clientX - current.startX) / column,
      );
      const next = ALLOWED_SPANS.reduce(
        (closest, candidate) =>
          Math.abs(candidate - raw) < Math.abs(closest - raw)
            ? candidate
            : closest,
        4,
      );
      setLayout((items) =>
        items.map((item) =>
          item.id === current.id ? { ...item, span: next } : item,
        ),
      );
    };
    const end = () => {
      resize.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, []);

  useEffect(() => {
    if (selectedTraceId !== null) {
      lastRecentTraceId.current = selectedTraceId;
      return;
    }
    const fallback = Array.from(
      document.querySelectorAll<HTMLTableRowElement>("[data-recent-trace-id]"),
    ).find((row) => row.dataset.recentTraceId === lastRecentTraceId.current);
    (recentTraceTrigger.current ?? fallback)?.focus();
  }, [recent, selectedTraceId]);

  useEffect(() => {
    return () => {
      if (chartHighlightTimer.current !== null) {
        window.clearTimeout(chartHighlightTimer.current);
      }
    };
  }, []);

  const specs = useMemo(
    () => (dashboard ? specsFor(dashboard) : []),
    [dashboard],
  );
  const byId = useMemo(
    () => new Map(specs.map((spec) => [spec.id, spec])),
    [specs],
  );

  const apply = () => {
    onChange(draft);
    setFiltersOpen(false);
  };
  const quickPeriod = (range: OverviewRange) => {
    const bounds = resolveOverviewWindow({ ...draft, range });
    const next: OverviewUrlState = { ...draft, range, ...bounds };
    setDraft(next);
    onChange(next);
    setCustomOpen(false);
  };
  const applyCustomPeriod = () => {
    const from = fromLocalInput(customFrom);
    const to = fromLocalInput(customTo);
    if (!from || !to) return;
    const next: OverviewUrlState = { ...draft, range: null, from, to };
    setDraft(next);
    onChange(next);
    setCustomOpen(false);
  };
  const reset = () => {
    const bounds = resolveOverviewWindow({ ...state, range: "7d" });
    const next: OverviewUrlState = {
      ...state,
      range: "7d",
      ...bounds,
      bucket: "auto",
      query: "",
      tag: "",
      sessionId: "",
      release: "",
      environment: "",
      userId: "",
      scoreIds: [],
      toolNames: [],
    };
    setDraft(next);
    onChange(next);
  };
  const reorder = (target: ChartKey) => {
    const source = dragged.current;
    if (!source || source === target) return;
    setLayout((items) => {
      const from = items.findIndex((item) => item.id === source);
      const to = items.findIndex((item) => item.id === target);
      if (from < 0 || to < 0) return items;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      if (!moved) return items;
      next.splice(to, 0, moved);
      return next;
    });
  };
  const jumpToChart = (chartId: ChartKey) => {
    const card = boardRef.current?.querySelector<HTMLElement>(
      `[data-chart="${chartId}"]`,
    );
    if (!card) return;

    setCurrentChart(chartId);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    card.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });

    if (chartHighlightTimer.current !== null) {
      window.clearTimeout(chartHighlightTimer.current);
    }
    chartHighlightTimer.current = window.setTimeout(
      () => {
        card.classList.remove("chart-highlight");
        void card.offsetWidth;
        card.classList.add("chart-highlight");
        const title = card.querySelector("h3")?.textContent ?? "";
        setChartAnnouncement(t("{title} 차트로 이동", {title}));
      },
      reducedMotion ? 0 : 260,
    );
  };

  return (
    <>
      <main className="page overview-page" id="lf-main" tabIndex={-1}>
        <header className="page-head overview-head">
          <div>
            <h1>Overview</h1>
          </div>
        </header>
        <section className="filter-bar" aria-label={t("Overview 필터")}>
          <span className="filter-label">{t("그룹: 전체")}</span>
          <button
            className="lf-btn"
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {t("필터")}
          </button>
          <span className="filter-spacer" />
          <div className="period-picker">
            <div className="period-group" role="group" aria-label={t("조회 기간")}>
              {PERIOD_PRESETS.map((preset) => (
                <button
                  key={preset.range}
                  type="button"
                  aria-pressed={state.range === preset.range}
                  onClick={() => quickPeriod(preset.range)}
                >
                  {t(preset.label)}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={state.range === null}
                aria-expanded={customOpen}
                onClick={() => {
                  setCustomFrom(toLocalInput(state.from));
                  setCustomTo(toLocalInput(state.to));
                  setCustomOpen((open) => !open);
                }}
              >
                {t("커스텀")}
              </button>
            </div>
            {customOpen ? (
              <div className="period-custom-popover">
                <label>
                  {t("시작")}
                  <input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                  />
                </label>
                <label>
                  {t("종료")}
                  <input
                    type="datetime-local"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                  />
                </label>
                <button
                  className="lf-btn is-primary"
                  type="button"
                  onClick={applyCustomPeriod}
                >
                  {t("적용")}
                </button>
              </div>
            ) : null}
          </div>
          {filtersOpen ? (
            <div className="overview-filter-popover">
              <div className="overview-filter-grid">
                <label>
                  {t("검색")}
                  <input
                    value={draft.query}
                    onChange={(event) =>
                      setDraft({ ...draft, query: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t("태그")}
                  <input
                    value={draft.tag}
                    onChange={(event) =>
                      setDraft({ ...draft, tag: event.target.value })
                    }
                  />
                </label>
                <label>
                  Session
                  <input
                    value={draft.sessionId}
                    onChange={(event) =>
                      setDraft({ ...draft, sessionId: event.target.value })
                    }
                  />
                </label>
                <label>
                  Release
                  <input
                    value={draft.release}
                    onChange={(event) =>
                      setDraft({ ...draft, release: event.target.value })
                    }
                  />
                </label>
                <label>
                  Environment
                  <input
                    value={draft.environment}
                    onChange={(event) =>
                      setDraft({ ...draft, environment: event.target.value })
                    }
                  />
                </label>
                <label>
                  User ID
                  <input
                    value={draft.userId}
                    onChange={(event) =>
                      setDraft({ ...draft, userId: event.target.value })
                    }
                  />
                </label>
                <label>
                  Bucket
                  <select
                    value={draft.bucket}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        bucket: event.target
                          .value as OverviewUrlState["bucket"],
                      })
                    }
                  >
                    <option value="auto">auto</option>
                    <option value="minute">minute</option>
                    <option value="hour">hour</option>
                    <option value="day">day</option>
                    <option value="week">week</option>
                    <option value="month">month</option>
                  </select>
                </label>
              </div>
              <div className="popover-actions">
                <button className="lf-btn" type="button" onClick={reset}>
                  {t("초기화")}
                </button>
                <button
                  className="lf-btn is-primary"
                  type="button"
                  onClick={apply}
                >
                  {t("적용")}
                </button>
              </div>
            </div>
          ) : null}
        </section>
        {dashboard ? (
          <SummaryMetrics
            totals={dashboard.totals}
            t={t}
            locale={locale}
          />
        ) : null}
        <section className="traffic-section" aria-label="Traffic charts">
          <nav className="chart-navigator" aria-label={t("Chart 바로가기")}>
            {INITIAL_LAYOUT.map(({ id }) => (
              <button
                key={id}
                type="button"
                data-chart-jump={id}
                aria-current={currentChart === id ? "true" : "false"}
                onClick={() => jumpToChart(id)}
              >
                {id === "traceCount"
                  ? "Trace Count"
                  : id === "latency"
                    ? "Latency"
                    : id === "errorRate"
                      ? "Error Rate"
                      : id === "llmCalls"
                        ? "LLM Calls"
                        : "Tool Calls"}
              </button>
            ))}
          </nav>
          <div
            className={`traffic-board${editing ? " layout-editing" : ""}`}
            ref={boardRef}
          >
            {loading ? (
              <div className="traffic-card span-12">
                <LoadingChart />
              </div>
            ) : dashboardError ? (
              <div className="traffic-card span-12">
                <ErrorBlock
                  message={t(dashboardError)}
                  onRetry={() => setRetry((value) => value + 1)}
                />
              </div>
            ) : dashboard ? (
              layout.map(({ id, span }) => {
                const spec = byId.get(id);
                return spec ? (
                  <ChartCard
                    key={id}
                    spec={spec}
                    buckets={dashboard.buckets}
                    span={span}
                    editing={editing}
                    focus={sharedFocus}
                    onFocusChange={setSharedFocus}
                    onResizeStart={(event) => {
                      resize.current = {
                        id,
                        startX: event.clientX,
                        startSpan: span,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onDragStart={() => {
                      dragged.current = id;
                    }}
                    onDrop={() => reorder(id)}
                  />
                ) : null;
              })
            ) : null}
          </div>
        </section>
        <section className="recent-section" aria-labelledby="recent-title">
          <div className="trace-table-wrap">
            <header className="trace-table-head">
              <h2 id="recent-title">{t("최근 Trace")}</h2>
            </header>
            {recentError ? (
              <ErrorBlock message={t(recentError)} />
            ) : recent.length === 0 ? (
              <EmptyBlock>{t("조건에 맞는 Trace가 없습니다.")}</EmptyBlock>
            ) : (
              <table className="trace-table">
                <colgroup>
                  {recentColumns.order.map((id) => (
                    <col key={id} style={{ width: recentColumns.widths[id] }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {recentColumns.order.map((id) => {
                      const def = RECENT_TRACE_COLUMNS.find(
                        (c) => c.id === id,
                      )!;
                      return (
                        <ColumnHeaderCell
                          key={id}
                          id={id}
                          label={t(def.label)}
                          align={def.align}
                          columns={recentColumns}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedRecent.map((trace) => {
                    const cell: Record<string, ReactNode> = {
                      status: <StatusDot status={trace.status} />,
                      started: relativeTime(trace.started_at, t),
                      trace_id: trace.trace_id,
                      input: previewText(trace.input_preview),
                      output: previewText(trace.output_preview),
                      latency: formatDuration(trace.duration_us),
                      count: trace.observation_count,
                    };
                    const cellClass: Record<string, string> = {
                      started: "relative-time",
                      trace_id: "trace-id mono",
                      input: "payload-cell",
                      output: "payload-cell",
                      latency: "metric is-end",
                      count: "metric is-end",
                    };
                    return (
                      <tr
                        className="overview-trace-row"
                        tabIndex={0}
                        key={trace.trace_id}
                        data-recent-trace-id={trace.trace_id}
                        role="button"
                        aria-label={t("{id} 상세 열기", {id: trace.trace_id})}
                        aria-selected={selectedTraceId === trace.trace_id}
                        onClick={(event) => {
                          recentTraceTrigger.current = event.currentTarget;
                          lastRecentTraceId.current = trace.trace_id;
                          onOpenTrace(trace.trace_id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            recentTraceTrigger.current = event.currentTarget;
                            lastRecentTraceId.current = trace.trace_id;
                            onOpenTrace(trace.trace_id);
                          }
                        }}
                      >
                        {recentColumns.order.map((id) => (
                          <td key={id} className={cellClass[id]}>
                            {cell[id]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
      <p
        className="sr-only"
        id="chartAnnounce"
        role="status"
        aria-live="polite"
      >
        {chartAnnouncement}
      </p>
    </>
  );
}

/**
 * 기획서: "상단에 총 요청 · p95 · 오류율 · LLM 호출 4개 수치를 mono 큰 글씨로
 * 먼저 보여주고, 그 아래 차트 보드를 둔다. 요약이 먼저, 상세가 나중이다."
 *
 * 기획서는 22px/600을 적었지만 Stage A가 정한 type scale에는 22px가 없고
 * font-weight는 400/700만 쓴다. 24px/700으로 맞췄다.
 */
function SummaryMetrics({
  totals,
  t,
  locale,
}: {
  totals: DashboardResponse["totals"];
  t: Translate;
  locale: string;
}) {
  const p95 = totals.latency_us.p95;
  const items: Array<{ label: string; value: string }> = [
    {
      label: t("총 요청"),
      value: totals.trace_count.toLocaleString(locale),
    },
    {
      label: "p95",
      value: p95 === null ? "—" : formatDuration(p95),
    },
    {
      label: t("오류율"),
      value:
        totals.error.rate === null
          ? "—"
          : `${(totals.error.rate * 100).toFixed(2)}%`,
    },
    {
      label: t("LLM 호출 수"),
      value: totals.llm_calls.toLocaleString(locale),
    },
  ];
  return (
    <section className="summary-metrics" aria-label={t("요약 수치")}>
      {items.map((item) => (
        <article className="summary-metric" key={item.label}>
          <span className="summary-metric-label">{item.label}</span>
          <strong className="summary-metric-value">{item.value}</strong>
        </article>
      ))}
    </section>
  );
}

function LoadingChart() {
  const t = useT();
  return (
    <p className="lf-state" role="status">
      {t("Overview를 불러오는 중…")}
    </p>
  );
}

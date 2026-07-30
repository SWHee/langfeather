import { useMemo, useState } from "react";

export type LineChartSeries = {
  id: string;
  label: string;
  color: string;
  values: Array<number | null>;
};

type Point = { x: number; y: number; value: number; index: number };

function pointsFor(values: Array<number | null>, maximum: number): Point[][] {
  const width = 620;
  const height = 180;
  const pad = 18;
  const groups: Point[][] = [];
  let current: Point[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) groups.push(current);
      current = [];
      return;
    }
    current.push({
      x: pad + (index * (width - pad * 2)) / Math.max(values.length - 1, 1),
      y: height - pad - (value / Math.max(maximum, 1)) * (height - pad * 2),
      value,
      index,
    });
  });
  if (current.length) groups.push(current);
  return groups;
}

export function LineChart({
  title,
  labels,
  series,
  valueFormatter = (value) => String(value),
}: {
  title: string;
  labels: string[];
  series: LineChartSeries[];
  valueFormatter?: (value: number) => string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const visible = series.filter((item) => !hidden.has(item.id));
  const maximum = useMemo(
    () =>
      Math.max(
        1,
        ...visible.flatMap((item) =>
          item.values.filter((value) => value !== null),
        ),
      ),
    [visible],
  );
  const hasValues = visible.some((item) =>
    item.values.some((value) => value !== null),
  );
  const axisStep = Math.max(1, Math.ceil(labels.length / 6));

  if (!hasValues) {
    return (
      <p className="overview-partial-empty">
        이 기간에는 표시할 데이터가 없습니다.
      </p>
    );
  }

  return (
    <div className="line-chart" aria-label={`${title} 추세 그래프`}>
      <div className="chart-legend" aria-label={`${title} series 표시`}>
        {series.map((item) => (
          <button
            key={item.id}
            className="chart-legend-item"
            type="button"
            aria-pressed={!hidden.has(item.id)}
            onClick={() =>
              setHidden((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })
            }
          >
            <span style={{ background: item.color }} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>
      <svg viewBox="0 0 620 180" role="img" aria-label={`${title} line chart`}>
        <line x1="18" x2="602" y1="162" y2="162" className="chart-axis" />
        {labels.map(
          (label, index) =>
            (index % axisStep === 0 || index === labels.length - 1) && (
              <text
                key={`${label}-${index}`}
                x={18 + (index * (602 - 18)) / Math.max(labels.length - 1, 1)}
                y="178"
                textAnchor={
                  index === 0
                    ? "start"
                    : index === labels.length - 1
                      ? "end"
                      : "middle"
                }
                className="chart-axis-label"
              >
                {label}
              </text>
            ),
        )}
        {visible.flatMap((item) =>
          pointsFor(item.values, maximum).map((group, groupIndex) => (
            <polyline
              key={`${item.id}-${groupIndex}`}
              fill="none"
              stroke={item.color}
              strokeWidth="2.5"
              points={group.map((point) => `${point.x},${point.y}`).join(" ")}
            />
          )),
        )}
        {visible.flatMap((item) =>
          pointsFor(item.values, maximum).flatMap((group) =>
            group.map((point) => (
              <circle
                key={`${item.id}-${point.index}`}
                role="img"
                aria-label={`${item.label} ${labels[point.index] ?? ""} ${valueFormatter(point.value)}`}
                cx={point.x}
                cy={point.y}
                r="4"
                fill={item.color}
                tabIndex={0}
                onMouseEnter={() => setHovered(point.index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(point.index)}
                onBlur={() => setHovered(null)}
              />
            )),
          ),
        )}
      </svg>
      {hovered !== null && (
        <p className="chart-tooltip" role="status">
          {labels[hovered]} ·{" "}
          {visible
            .map((item) => {
              const value = item.values[hovered];
              return `${item.label}: ${value === null ? "값 없음" : valueFormatter(value)}`;
            })
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

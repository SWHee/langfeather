import { useMemo, useState } from "react";

import type { ObservationSummary } from "../api/types";
import { formatDuration } from "../components";
import { buildRuntimeGraph, runtimeKindLabel } from "./runtimeGraph";

const NODE_WIDTH = 172;
const NODE_HEIGHT = 108;
const NODE_HEADER_HEIGHT = 32;
const NODE_RADIUS = 10;

function statusLabel(status: ObservationSummary["status"]): string {
  return status === "completed"
    ? "완료"
    : status === "failed"
      ? "실패"
      : "취소";
}

export function RuntimeGraphView({
  observations,
  selectedObservationId,
  onSelect,
}: {
  observations: ObservationSummary[];
  selectedObservationId: string | null;
  onSelect: (observationId: string | null) => void;
}) {
  const graph = useMemo(() => buildRuntimeGraph(observations), [observations]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const maxX = Math.max(
    420,
    ...graph.nodes.map((node) => node.position.x + NODE_WIDTH + 12),
  );
  const maxY = Math.max(
    300,
    ...graph.nodes.map((node) => node.position.y + NODE_HEIGHT + 12),
  );
  const width = maxX / zoom;
  const height = maxY / zoom;
  const viewX = (maxX - width) / 2 + pan.x;
  const viewY = (maxY - height) / 2 + pan.y;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  if (graph.nodes.length === 0)
    return <p className="graph-empty">실행 관측값이 없습니다.</p>;

  return (
    <div className="runtime-graph">
      <div className="graph-canvas">
        <div className="graph-toolbar" aria-label="그래프 확대 축소">
          <button
            type="button"
            aria-label="확대"
            onClick={() => setZoom((value) => Math.min(3, value * 1.25))}
          >
            +
          </button>
          <button
            type="button"
            aria-label="축소"
            onClick={() => setZoom((value) => Math.max(0.65, value / 1.25))}
          >
            −
          </button>
          <button
            type="button"
            aria-label="초기화"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            ⟳
          </button>
        </div>
        <svg
          className={`execution-graph${panning ? " is-panning" : ""}`}
          viewBox={`${viewX} ${viewY} ${width} ${height}`}
          role="img"
          aria-label="trace 실행 흐름 그래프"
          onPointerDown={(event) => {
            if ((event.target as Element).closest("[data-observation]")) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setPanning({
              x: event.clientX,
              y: event.clientY,
              panX: pan.x,
              panY: pan.y,
            });
          }}
          onPointerMove={(event) => {
            if (!panning) return;
            setPan({
              x:
                panning.panX -
                ((event.clientX - panning.x) * maxX) /
                  (event.currentTarget.clientWidth * zoom),
              y:
                panning.panY -
                ((event.clientY - panning.y) * maxY) /
                  (event.currentTarget.clientHeight * zoom),
            });
          }}
          onPointerUp={() => setPanning(null)}
        >
          {graph.edges.map((edge) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return null;
            const fromX = source.position.x + NODE_WIDTH / 2;
            const fromY = source.position.y + NODE_HEIGHT;
            const toX = target.position.x + NODE_WIDTH / 2;
            const toY = target.position.y;
            return (
              <line
                className={`runtime-edge ${edge.relation === "dispatch" ? "is-dispatch" : ""}`}
                key={edge.id}
                x1={fromX}
                x2={toX}
                y1={fromY}
                y2={toY}
              />
            );
          })}
          {graph.nodes.map((node, index) => {
            const active = selectedObservationId === node.id;
            const root = node.observation.parent_observation_id === null;
            const failed = node.observation.status === "failed";
            const clipId = `node-clip-${node.id}`;
            const order = String(index + 1).padStart(2, "0");
            return (
              <g
                className={`graph-node${active ? " is-active" : ""}`}
                data-observation={node.id}
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`${order}. ${node.observation.name} ${node.displayKind} 상세 보기`}
                onClick={() => onSelect(active ? null : node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(active ? null : node.id);
                  }
                }}
              >
                <defs>
                  <clipPath id={clipId}>
                    <rect
                      x={node.position.x}
                      y={node.position.y}
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={NODE_RADIUS}
                    />
                  </clipPath>
                </defs>
                <rect
                  className={`runtime-node-body${failed ? " is-failed" : ""}`}
                  x={node.position.x}
                  y={node.position.y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={NODE_RADIUS}
                />
                <rect
                  className={`runtime-node-header${root ? " is-root" : ""}${failed ? " is-failed" : ""}`}
                  x={node.position.x}
                  y={node.position.y}
                  width={NODE_WIDTH}
                  height={NODE_HEADER_HEIGHT}
                  clipPath={`url(#${clipId})`}
                />
                <text
                  className="runtime-node-header-label"
                  x={node.position.x + 12}
                  y={node.position.y + NODE_HEADER_HEIGHT / 2 + 4}
                >
                  <tspan className="runtime-node-order">{order}</tspan>
                  <tspan className="runtime-node-kind" dx="6">
                    {runtimeKindLabel(node.observation.kind)}
                  </tspan>
                </text>
                <text
                  className="runtime-node-name"
                  x={node.position.x + 12}
                  y={node.position.y + NODE_HEADER_HEIGHT + 30}
                >
                  {node.observation.name}
                </text>
                <text
                  className={`runtime-node-status is-${node.observation.status}`}
                  x={node.position.x + 12}
                  y={node.position.y + NODE_HEIGHT - 12}
                >
                  {statusLabel(node.observation.status)}
                </text>
                <text
                  className="runtime-node-latency"
                  x={node.position.x + NODE_WIDTH - 12}
                  y={node.position.y + NODE_HEIGHT - 12}
                  textAnchor="end"
                >
                  {formatDuration(node.observation.duration_us)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

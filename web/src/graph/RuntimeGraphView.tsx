import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {useMemo, useState} from "react";

import type {ObservationSummary, TraceStatus} from "../api/types";
import {formatDuration} from "../components";
import {useT, type Translate} from "../i18n/context";
import {
  buildRuntimeGraph,
  isNotableRuntimeKind,
  runtimeKindLabel,
  type RuntimeGraphDetail,
  type RuntimeGraphEdge,
  type RuntimeGraphNode,
} from "./runtimeGraph";

const STATUS_LABEL: Record<TraceStatus, string> = {
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

const EDGE_STYLE: Record<
  RuntimeGraphEdge["relation"],
  {stroke: string; dash?: string}
> = {
  callback: {stroke: "var(--graph-edge)"},
  dispatch: {stroke: "var(--violet)", dash: "5 4"},
  join: {stroke: "var(--graph-edge)"},
};

interface RuntimeNodeData extends Record<string, unknown> {
  graphNode: RuntimeGraphNode;
}

type RuntimeFlowNode = Node<RuntimeNodeData, "runtimeObservation">;

function RuntimeObservationNode({data, selected}: NodeProps<RuntimeFlowNode>) {
  const t = useT();
  const {graphNode} = data;
  const {observation} = graphNode;

  return (
    <div
      className="runtime-node"
      data-kind={graphNode.displayKind}
      data-status={observation.status}
      data-selected={selected}
    >
      <Handle className="runtime-handle" type="target" position={Position.Top} />
      <div className="runtime-node-heading">
        <span className="runtime-sequence">
          {String(observation.sequence + 1).padStart(2, "0")}
        </span>
        {isNotableRuntimeKind(observation.kind) && (
          <span className="runtime-kind">
            {runtimeKindLabel(observation.kind)}
          </span>
        )}
        {graphNode.childKinds.map(({kind, count}) => (
          <span className="runtime-child-kind" data-kind={kind} key={kind}>
            {runtimeKindLabel(kind)}
            {count > 1 && <em>{count}</em>}
          </span>
        ))}
      </div>
      <strong>{observation.name}</strong>
      <div className="runtime-node-meta">
        <span className="runtime-node-status">
          <span aria-hidden="true" />
          {t(STATUS_LABEL[observation.status])}
        </span>
        <span>{formatDuration(observation.duration_us)}</span>
      </div>
      {graphNode.displayKind === "generic" && (
        <span className="raw-kind">kind: {observation.kind}</span>
      )}
      <Handle
        className="runtime-handle"
        type="source"
        position={Position.Bottom}
      />
    </div>
  );
}

const NODE_TYPES = {
  runtimeObservation: RuntimeObservationNode,
};

function nodeAriaLabel(graphNode: RuntimeGraphNode, t: Translate): string {
  const {observation} = graphNode;
  return [
    // observation 이름과 ID는 사용자 데이터다. 번역하지 않는다.
    t("실행 노드 {name}", {name: observation.name}),
    t("순서 {n}", {n: observation.sequence + 1}),
    t(STATUS_LABEL[observation.status]),
    ...graphNode.childKinds.map(({kind, count}) =>
      t("하위 {kind} {count}개", {kind: runtimeKindLabel(kind), count}),
    ),
    `ID ${observation.observation_id}`,
  ].join(", ");
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
  // 요약은 root의 직계와 dispatch만 그린다. LangGraph 앱에서 실제 llm과 tool
  // 실행은 그보다 깊이 있어, 전체로 바꾸지 않으면 kind별 renderer에 닿을 수 없다.
  const t = useT();
  const [detail, setDetail] = useState<RuntimeGraphDetail>("summary");
  const model = useMemo(
    () => buildRuntimeGraph(observations, detail),
    [observations, detail],
  );
  const nodes = useMemo<RuntimeFlowNode[]>(
    () =>
      model.nodes.map((graphNode) => ({
        id: graphNode.id,
        type: "runtimeObservation",
        position: graphNode.position,
        data: {graphNode},
        // No width/height: React Flow measures the rendered card instead, so the
        // handles (and the edges that end on them) sit on its real edges even
        // when the kind badges wrap to a second line.
        selected: graphNode.id === selectedObservationId,
        draggable: false,
        connectable: false,
        selectable: true,
        focusable: true,
        ariaRole: "button",
        ariaLabel: nodeAriaLabel(graphNode, t),
        domAttributes: {
          "aria-pressed": graphNode.id === selectedObservationId,
        },
      })),
    [model.nodes, selectedObservationId, t],
  );
  const edges = useMemo<Edge[]>(
    () =>
      model.edges.map((edge) => {
        const {stroke, dash} = EDGE_STYLE[edge.relation];
        return {
          ...edge,
          type: "smoothstep",
          focusable: false,
          selectable: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: 16,
            height: 16,
          },
          style: {stroke, strokeDasharray: dash, strokeWidth: 1.6},
        };
      }),
    [model.edges],
  );

  if (observations.length === 0) {
    return <p className="graph-empty">{t("실행 관측값이 없습니다.")}</p>;
  }

  return (
    <div
      className="runtime-graph"
      role="group"
      aria-label={t("실제 실행 경로 그래프")}
      data-testid="runtime-graph"
    >
      <div className="graph-detail-toggle" role="group" aria-label={t("그래프 상세 수준")}>
        <button
          className={detail === "summary" ? "selected" : undefined}
          type="button"
          aria-pressed={detail === "summary"}
          onClick={() => setDetail("summary")}
        >
          {t("요약")}
        </button>
        <button
          className={detail === "all" ? "selected" : undefined}
          type="button"
          aria-pressed={detail === "all"}
          onClick={() => setDetail("all")}
        >
          {t("전체")}
        </button>
      </div>
      <ReactFlow<RuntimeFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable={false}
        fitView
        fitViewOptions={{padding: 0.16, maxZoom: 0.92}}
        minZoom={0.3}
        maxZoom={1.5}
        panOnScroll
        zoomOnDoubleClick={false}
        onNodeClick={(_event, node) => {
          onSelect(node.id === selectedObservationId ? null : node.id);
        }}
        proOptions={{hideAttribution: true}}
      >
        <Background
          color="var(--line)"
          gap={22}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          aria-label={t("그래프 확대와 축소")}
        />
      </ReactFlow>
    </div>
  );
}

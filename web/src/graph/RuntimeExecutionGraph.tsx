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
import {
  buildRuntimeGraph,
  type RuntimeGraphDetail,
  type RuntimeGraphNode,
  type RuntimeNodeKind,
} from "./runtimeGraph";

const STATUS_LABEL: Record<TraceStatus, string> = {
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

const KIND_LABEL: Record<RuntimeNodeKind, string> = {
  chain: "체인",
  llm: "LLM",
  retriever: "검색",
  tool: "도구",
  function: "함수",
  http: "HTTP",
  runnable: "Runnable",
  custom: "사용자 실행",
  generic: "기타 실행",
};

interface RuntimeNodeData extends Record<string, unknown> {
  graphNode: RuntimeGraphNode;
}

type RuntimeFlowNode = Node<RuntimeNodeData, "runtimeObservation">;

function formatDuration(durationUs: number): string {
  if (durationUs < 1_000) {
    return `${durationUs} µs`;
  }
  if (durationUs < 1_000_000) {
    return `${(durationUs / 1_000).toFixed(0)} ms`;
  }
  return `${(durationUs / 1_000_000).toFixed(2)} s`;
}

function RuntimeObservationNode({
  data,
  selected,
}: NodeProps<RuntimeFlowNode>) {
  const {graphNode} = data;
  const {observation} = graphNode;

  return (
    <div
      className="runtime-node"
      data-kind={graphNode.displayKind}
      data-status={observation.status}
      data-selected={selected}
    >
      <Handle
        className="runtime-handle"
        type="target"
        position={Position.Top}
      />
      <div className="runtime-node-heading">
        <span className="runtime-sequence">
          {String(observation.sequence + 1).padStart(2, "0")}
        </span>
        <span className="runtime-kind">
          {KIND_LABEL[graphNode.displayKind]}
        </span>
        {graphNode.isParallel && (
          <span className="parallel-chip">동시 실행</span>
        )}
      </div>
      <strong>{observation.name}</strong>
      <div className="runtime-node-meta">
        <span className="runtime-node-status">
          <span aria-hidden="true" />
          {STATUS_LABEL[observation.status]}
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

function nodeAriaLabel(graphNode: RuntimeGraphNode): string {
  const {observation} = graphNode;
  return [
    `실행 노드 ${observation.name}`,
    `순서 ${observation.sequence + 1}`,
    STATUS_LABEL[observation.status],
    `ID ${observation.observation_id}`,
  ].join(", ");
}

export function RuntimeExecutionGraph({
  observations,
  selectedObservationId,
  onSelect,
}: {
  observations: ObservationSummary[];
  selectedObservationId: string | null;
  onSelect: (observationId: string) => void;
}) {
  const [detail, setDetail] = useState<RuntimeGraphDetail>("summary");
  const summaryModel = useMemo(
    () => buildRuntimeGraph(observations, "summary"),
    [observations],
  );
  const model = useMemo(
    () => buildRuntimeGraph(observations, detail),
    [detail, observations],
  );
  const nodes = useMemo<RuntimeFlowNode[]>(
    () =>
      model.nodes.map((graphNode) => ({
        id: graphNode.id,
        type: "runtimeObservation",
        position: graphNode.position,
        data: {graphNode},
        width: 184,
        height: graphNode.displayKind === "generic" ? 112 : 92,
        selected: graphNode.id === selectedObservationId,
        draggable: false,
        connectable: false,
        selectable: true,
        focusable: true,
        ariaRole: "button",
        ariaLabel: nodeAriaLabel(graphNode),
        domAttributes: {
          "aria-pressed": graphNode.id === selectedObservationId,
        },
      })),
    [model.nodes, selectedObservationId],
  );
  const edges = useMemo<Edge[]>(
    () =>
      model.edges.map((edge) => ({
        ...edge,
        type: "smoothstep",
        focusable: false,
        selectable: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.relation === "dispatch" ? "#7c3aed" : "#94a3b8",
          width: 16,
          height: 16,
        },
        style: {
          stroke: edge.relation === "dispatch" ? "#7c3aed" : "#94a3b8",
          strokeDasharray: edge.relation === "dispatch" ? "5 4" : undefined,
          strokeWidth: 1.6,
        },
      })),
    [model.edges],
  );

  return (
    <div className="runtime-graph-shell">
      <div className="graph-mode-toggle" role="group" aria-label="그래프 상세 수준">
        <button
          className={detail === "summary" ? "selected" : undefined}
          type="button"
          aria-pressed={detail === "summary"}
          onClick={() => setDetail("summary")}
        >
          Node View ({summaryModel.nodes.length})
        </button>
        <button
          className={detail === "all" ? "selected" : undefined}
          type="button"
          aria-pressed={detail === "all"}
          onClick={() => setDetail("all")}
        >
          Runnable View ({observations.length})
        </button>
      </div>
      <div
        className="runtime-graph"
        role="group"
        aria-label="실제 실행 경로 그래프"
        data-testid="runtime-graph"
      >
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
          onSelect(node.id);
        }}
        proOptions={{hideAttribution: true}}
      >
        <Background
          color="#d9e4dc"
          gap={22}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          aria-label="그래프 확대와 축소"
        />
      </ReactFlow>
      </div>
    </div>
  );
}

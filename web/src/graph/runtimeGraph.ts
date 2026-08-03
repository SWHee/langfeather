import type {ObservationSummary} from "../api/types";

const HORIZONTAL_GAP = 280;
const VERTICAL_GAP = 196;
const CANVAS_PADDING = 32;

const KNOWN_KINDS = new Set([
  "chain",
  "llm",
  "retriever",
  "tool",
  "function",
  "http",
  "runnable",
  "custom",
]);

export type RuntimeNodeKind =
  | "chain"
  | "llm"
  | "retriever"
  | "tool"
  | "function"
  | "http"
  | "runnable"
  | "custom"
  | "generic";

export interface RuntimeGraphNode {
  id: string;
  observation: ObservationSummary;
  position: {x: number; y: number};
  displayKind: RuntimeNodeKind;
  isParallel: boolean;
}

export interface RuntimeGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: "callback" | "dispatch";
}

export interface RuntimeGraph {
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
}

export type RuntimeGraphDetail = "summary" | "all";

function timestampUs(value: string): number {
  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) {
    return 0;
  }
  const fractionalMatch = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const fraction = fractionalMatch?.[1]?.padEnd(6, "0").slice(0, 6) ?? "";
  const subMillisecondUs =
    fraction.length === 0 ? 0 : Number.parseInt(fraction.slice(3), 10);
  return parsedMs * 1_000 + subMillisecondUs;
}

function compareObservations(
  left: ObservationSummary,
  right: ObservationSummary,
): number {
  const startedDifference =
    timestampUs(left.started_at) - timestampUs(right.started_at);
  return startedDifference === 0
    ? left.sequence - right.sequence
    : startedDifference;
}

function intervalsOverlap(
  left: ObservationSummary,
  right: ObservationSummary,
): boolean {
  const leftStart = timestampUs(left.started_at);
  const leftEnd = timestampUs(left.ended_at);
  const rightStart = timestampUs(right.started_at);
  const rightEnd = timestampUs(right.ended_at);
  return leftStart < rightEnd && rightStart < leftEnd;
}

function groupRuntimeRows(
  observations: ObservationSummary[],
): ObservationSummary[][] {
  const siblings = new Map<string | null, ObservationSummary[]>();

  for (const observation of observations) {
    const siblingsForParent =
      siblings.get(observation.parent_observation_id) ?? [];
    siblingsForParent.push(observation);
    siblings.set(observation.parent_observation_id, siblingsForParent);
  }

  const rows: ObservationSummary[][] = [];
  for (const siblingsForParent of siblings.values()) {
    const orderedSiblings = [...siblingsForParent].sort(compareObservations);
    let currentRow: ObservationSummary[] = [];
    let commonOverlapEnd = Number.NEGATIVE_INFINITY;

    for (const observation of orderedSiblings) {
      const startsBeforeCommonEnd =
        timestampUs(observation.started_at) < commonOverlapEnd;
      const overlapsCurrentRow =
        currentRow.length > 0 &&
        startsBeforeCommonEnd &&
        currentRow.every((item) => intervalsOverlap(item, observation));

      if (!overlapsCurrentRow) {
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        currentRow = [observation];
        commonOverlapEnd = timestampUs(observation.ended_at);
      } else {
        currentRow.push(observation);
        commonOverlapEnd = Math.min(
          commonOverlapEnd,
          timestampUs(observation.ended_at),
        );
      }
    }

    if (currentRow.length > 0) {
      rows.push(currentRow);
    }
  }

  return rows
    .map((row) => [...row].sort(compareObservations))
    .sort((left, right) => {
      const firstDifference = compareObservations(left[0]!, right[0]!);
      if (firstDifference !== 0) {
        return firstDifference;
      }
      return (
        Math.min(...left.map((item) => item.sequence)) -
        Math.min(...right.map((item) => item.sequence))
      );
    });
}

function runtimeKind(kind: string): RuntimeNodeKind {
  return KNOWN_KINDS.has(kind) ? (kind as RuntimeNodeKind) : "generic";
}

const RUNTIME_KIND_LABELS: Record<RuntimeNodeKind, string> = {
  chain: "Chain",
  llm: "LLM",
  retriever: "Retriever",
  tool: "Tool",
  function: "Function",
  http: "Http",
  runnable: "Runnable",
  custom: "Custom",
  generic: "Generic",
};

export function runtimeKindLabel(kind: string): string {
  return RUNTIME_KIND_LABELS[runtimeKind(kind)];
}

export function buildRuntimeGraph(
  observations: ObservationSummary[],
  detail: RuntimeGraphDetail = "all",
): RuntimeGraph {
  const root = observations.find(
    (observation) => observation.parent_observation_id === null,
  );
  const visibleObservations =
    detail === "summary" && root !== undefined
      ? observations.filter(
          (observation) =>
            observation.observation_id === root.observation_id ||
            observation.parent_observation_id === root.observation_id ||
            (observation.dispatch_count ?? 0) > 0,
        )
      : observations;
  const observationsById = new Map(
    visibleObservations.map((observation) => [
      observation.observation_id,
      observation,
    ]),
  );
  const rows = groupRuntimeRows(visibleObservations);
  const positions = new Map<string, {x: number; y: number}>();

  rows.forEach((row, rowIndex) => {
    const firstParentId = row[0]?.parent_observation_id ?? null;
    const parentPosition =
      firstParentId === null ? undefined : positions.get(firstParentId);
    const rowCenterX = parentPosition?.x ?? 0;
    const laneCenter = (row.length - 1) / 2;

    row.forEach((observation, laneIndex) => {
      positions.set(observation.observation_id, {
        x: rowCenterX + (laneIndex - laneCenter) * HORIZONTAL_GAP,
        y: rowIndex * VERTICAL_GAP,
      });
    });
  });

  const minimumX = Math.min(
    0,
    ...[...positions.values()].map(({x}) => x),
  );
  const xOffset = CANVAS_PADDING - minimumX;
  const parallelIds = new Set(
    rows
      .filter((row) => row.length > 1)
      .flatMap((row) => row.map((observation) => observation.observation_id)),
  );

  const nodes = visibleObservations
    .map((observation) => {
      const position = positions.get(observation.observation_id) ?? {
        x: 0,
        y: 0,
      };
      return {
        id: observation.observation_id,
        observation,
        position: {x: position.x + xOffset, y: position.y + CANVAS_PADDING},
        displayKind: runtimeKind(observation.kind),
        isParallel: parallelIds.has(observation.observation_id),
      };
    })
    .sort((left, right) =>
      compareObservations(left.observation, right.observation),
    );

  const edges: RuntimeGraphEdge[] = [];
  for (const observation of visibleObservations) {
    const dispatchSource = observation.dispatch_source_observation_id;
    if (dispatchSource !== undefined && dispatchSource !== null) {
      if (observationsById.has(dispatchSource)) {
        edges.push({
          id: `${dispatchSource}=>${observation.observation_id}`,
          source: dispatchSource,
          target: observation.observation_id,
          relation: "dispatch",
        });
      }
      continue;
    }
    const parent = observation.parent_observation_id;
    if (parent !== null && observationsById.has(parent)) {
      edges.push({
          id: `${parent}->${observation.observation_id}`,
          source: parent,
          target: observation.observation_id,
          relation: "callback",
        });
    }
  }

  return {nodes, edges};
}

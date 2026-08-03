import type {ObservationSummary} from "../api/types";

const HORIZONTAL_GAP = 280;
const VERTICAL_GAP = 164;
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

export interface RuntimeChildKind {
  kind: RuntimeNodeKind;
  count: number;
}

export interface RuntimeGraphNode {
  id: string;
  observation: ObservationSummary;
  position: {x: number; y: number};
  displayKind: RuntimeNodeKind;
  isParallel: boolean;
  /**
   * Notable kinds (LLM, retriever, tool, …) found among the descendants this
   * node stands in for but that the current detail level does not draw.
   */
  childKinds: RuntimeChildKind[];
}

export interface RuntimeGraphEdge {
  id: string;
  source: string;
  target: string;
  /**
   * "join" marks the fan-in edges drawn from each branch of a parallel row to
   * the single sibling that runs after it, so a fan-out reads as a diamond
   * instead of leaving the merge point implicit.
   */
  relation: "callback" | "dispatch" | "join";
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

interface RuntimeRowLink {
  source: string;
  target: string;
  relation: "callback" | "join";
}

/**
 * Links each row of siblings to the row of the same parent that ran before it,
 * so a run reads as a flow — step to step, one step fanning out, branches
 * merging back — instead of every sibling hanging off the shared parent.
 *
 * Two rows that are both parallel have no single sensible link, so those keep
 * their parent edges.
 */
function collectRowLinks(
  rows: ObservationSummary[][],
  excludedTargetIds: Set<string>,
): RuntimeRowLink[] {
  const previousRowByParent = new Map<string | null, ObservationSummary[]>();
  const links: RuntimeRowLink[] = [];

  for (const row of rows) {
    const parentId = row[0]?.parent_observation_id ?? null;
    const previousRow = previousRowByParent.get(parentId);
    previousRowByParent.set(parentId, row);
    if (previousRow === undefined) {
      continue;
    }

    if (previousRow.length > 1) {
      const target = row.length === 1 ? row[0] : undefined;
      if (target === undefined || excludedTargetIds.has(target.observation_id)) {
        continue;
      }
      const branchesEnd = Math.max(
        ...previousRow.map((branch) => timestampUs(branch.ended_at)),
      );
      if (timestampUs(target.started_at) < branchesEnd) {
        continue;
      }
      for (const branch of previousRow) {
        links.push({
          source: branch.observation_id,
          target: target.observation_id,
          relation: "join",
        });
      }
      continue;
    }

    const source = previousRow[0]!;
    for (const target of row) {
      if (excludedTargetIds.has(target.observation_id)) {
        continue;
      }
      links.push({
        source: source.observation_id,
        target: target.observation_id,
        relation: "callback",
      });
    }
  }

  return links;
}

/**
 * The dispatch source to draw an edge from, or null when the observation is not
 * the entry of a dispatched branch. LangGraph inherits
 * dispatch_source_observation_id onto every descendant of such a branch, so only
 * the entry — where it differs from the parent's — counts.
 */
function dispatchEntrySource(
  observation: ObservationSummary,
  allObservationsById: Map<string, ObservationSummary>,
): string | null {
  const dispatchSource = observation.dispatch_source_observation_id;
  if (dispatchSource === undefined || dispatchSource === null) {
    return null;
  }
  const parentId = observation.parent_observation_id;
  const parentDispatchSource =
    parentId === null
      ? null
      : (allObservationsById.get(parentId)?.dispatch_source_observation_id ??
        null);
  return dispatchSource === parentDispatchSource ? null : dispatchSource;
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

/**
 * Kinds worth advertising on a node badge, in display order. "chain" and
 * "runnable" are left out: nearly every drawn node is one, so the badge would
 * carry no information.
 */
const NOTABLE_KIND_ORDER: RuntimeNodeKind[] = [
  "llm",
  "retriever",
  "tool",
  "http",
  "function",
  "custom",
  "generic",
];

export function isNotableRuntimeKind(kind: string): boolean {
  return NOTABLE_KIND_ORDER.includes(runtimeKind(kind));
}

/**
 * Badges describing what an observation actually did: its own kind when that is
 * notable, otherwise the notable kinds of everything it ran underneath it. Lets
 * a panel header say "LLM ×2, Retriever" instead of a meaningless "Chain".
 */
export function observationKindBadges(
  observations: ObservationSummary[],
  observationId: string,
): RuntimeChildKind[] {
  const self = observations.find(
    (observation) => observation.observation_id === observationId,
  );
  if (self === undefined) {
    return [];
  }
  if (isNotableRuntimeKind(self.kind)) {
    return [{kind: runtimeKind(self.kind), count: 1}];
  }
  const allObservationsById = new Map(
    observations.map((observation) => [observation.observation_id, observation]),
  );
  return (
    collectChildKinds(
      observations,
      allObservationsById,
      new Set([observationId]),
    ).get(observationId) ?? []
  );
}

function nearestVisibleAncestorId(
  observation: ObservationSummary,
  allObservationsById: Map<string, ObservationSummary>,
  visibleIds: Set<string>,
): string | null {
  const seen = new Set<string>([observation.observation_id]);
  let parentId = observation.parent_observation_id;
  while (parentId !== null && !seen.has(parentId)) {
    if (visibleIds.has(parentId)) {
      return parentId;
    }
    seen.add(parentId);
    parentId = allObservationsById.get(parentId)?.parent_observation_id ?? null;
  }
  return null;
}

/**
 * Rolls the notable kinds of every hidden observation up to the nearest drawn
 * ancestor, so a collapsed "chain" node can still advertise that an LLM call or
 * a retrieval happened inside it.
 */
function collectChildKinds(
  observations: ObservationSummary[],
  allObservationsById: Map<string, ObservationSummary>,
  visibleIds: Set<string>,
): Map<string, RuntimeChildKind[]> {
  const countsByHost = new Map<string, Map<RuntimeNodeKind, number>>();

  for (const observation of observations) {
    if (visibleIds.has(observation.observation_id)) {
      continue;
    }
    const kind = runtimeKind(observation.kind);
    if (!NOTABLE_KIND_ORDER.includes(kind)) {
      continue;
    }
    const hostId = nearestVisibleAncestorId(
      observation,
      allObservationsById,
      visibleIds,
    );
    if (hostId === null) {
      continue;
    }
    const counts = countsByHost.get(hostId) ?? new Map<RuntimeNodeKind, number>();
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    countsByHost.set(hostId, counts);
  }

  return new Map(
    [...countsByHost].map(([hostId, counts]) => [
      hostId,
      NOTABLE_KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
        kind,
        count: counts.get(kind)!,
      })),
    ]),
  );
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
  const allObservationsById = new Map(
    observations.map((observation) => [observation.observation_id, observation]),
  );
  const childKindsByHost = collectChildKinds(
    observations,
    allObservationsById,
    new Set(observationsById.keys()),
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
        childKinds: childKindsByHost.get(observation.observation_id) ?? [],
      };
    })
    .sort((left, right) =>
      compareObservations(left.observation, right.observation),
    );

  const dispatchEntryIds = new Set(
    visibleObservations
      .filter(
        (observation) =>
          dispatchEntrySource(observation, allObservationsById) !== null,
      )
      .map((observation) => observation.observation_id),
  );
  const rowLinks = collectRowLinks(rows, dispatchEntryIds);
  const linkedTargetIds = new Set(rowLinks.map(({target}) => target));

  const edges: RuntimeGraphEdge[] = [];
  for (const observation of visibleObservations) {
    const dispatchSource = dispatchEntrySource(observation, allObservationsById);
    if (dispatchSource !== null) {
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
    // An observation the flow already reaches through its preceding row would
    // only gain a parent edge cutting back across that row.
    if (linkedTargetIds.has(observation.observation_id)) {
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

  for (const {source, target, relation} of rowLinks) {
    edges.push({
      id: `${source}${relation === "join" ? "~>" : "->"}${target}`,
      source,
      target,
      relation,
    });
  }

  return {nodes, edges};
}

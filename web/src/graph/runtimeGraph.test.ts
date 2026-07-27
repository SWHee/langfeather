import {describe, expect, it} from "vitest";
import type {ObservationSummary} from "../api/types";
import {buildRuntimeGraph} from "./runtimeGraph";

function observation(
  overrides: Partial<ObservationSummary> & {
    observation_id: string;
    sequence: number;
    name: string;
  },
): ObservationSummary {
  return {
    trace_id: "tr_runtime",
    parent_observation_id: "obs_root",
    kind: "runnable",
    started_at: "2026-07-25T03:00:01.000Z",
    ended_at: "2026-07-25T03:00:02.000Z",
    duration_us: 1_000_000,
    time_to_first_token_us: null,
    status: "completed",
    model: null,
    ...overrides,
  };
}

const runtimeObservations: ObservationSummary[] = [
  observation({
    observation_id: "obs_root",
    parent_observation_id: null,
    sequence: 0,
    name: "student-graph",
    kind: "chain",
    started_at: "2026-07-25T03:00:00.000Z",
    ended_at: "2026-07-25T03:00:06.000Z",
  }),
  observation({
    observation_id: "obs_parallel_a",
    sequence: 1,
    name: "lookup",
    kind: "retriever",
    started_at: "2026-07-25T03:00:01.000Z",
    ended_at: "2026-07-25T03:00:03.000Z",
  }),
  observation({
    observation_id: "obs_parallel_b",
    sequence: 2,
    name: "lookup",
    kind: "tool",
    started_at: "2026-07-25T03:00:02.000Z",
    ended_at: "2026-07-25T03:00:04.000Z",
  }),
  observation({
    observation_id: "obs_repeat_1",
    sequence: 3,
    name: "revise",
    started_at: "2026-07-25T03:00:04.000Z",
    ended_at: "2026-07-25T03:00:04.500Z",
  }),
  observation({
    observation_id: "obs_repeat_2",
    sequence: 4,
    name: "revise",
    kind: "future-kind",
    started_at: "2026-07-25T03:00:05.000Z",
    ended_at: "2026-07-25T03:00:05.500Z",
  }),
];

describe("runtime execution graph", () => {
  it("creates only confirmed parent-child edges", () => {
    const graph = buildRuntimeGraph(runtimeObservations);

    expect(graph.edges).toEqual([
      {
        id: "obs_root->obs_parallel_a",
        source: "obs_root",
        target: "obs_parallel_a",
        relation: "callback",
      },
      {
        id: "obs_root->obs_parallel_b",
        source: "obs_root",
        target: "obs_parallel_b",
        relation: "callback",
      },
      {
        id: "obs_root->obs_repeat_1",
        source: "obs_root",
        target: "obs_repeat_1",
        relation: "callback",
      },
      {
        id: "obs_root->obs_repeat_2",
        source: "obs_root",
        target: "obs_repeat_2",
        relation: "callback",
      },
    ]);
    expect(
      graph.edges.find(
        (edge) =>
          edge.source === "obs_parallel_a" &&
          edge.target === "obs_parallel_b",
      ),
    ).toBeUndefined();
    expect(
      graph.edges.find(
        (edge) =>
          edge.source === "obs_repeat_1" && edge.target === "obs_repeat_2",
      ),
    ).toBeUndefined();
  });

  it("keeps repeated names as separate observation instances", () => {
    const graph = buildRuntimeGraph(runtimeObservations);
    const repeats = graph.nodes.filter(
      ({observation: item}) => item.name === "revise",
    );

    expect(repeats.map(({id}) => id)).toEqual([
      "obs_repeat_1",
      "obs_repeat_2",
    ]);
    expect(repeats[0]?.position.y).toBeLessThan(repeats[1]!.position.y);
  });

  it("places only timestamp-overlapping siblings on the same row", () => {
    const graph = buildRuntimeGraph(runtimeObservations);
    const parallelA = graph.nodes.find(({id}) => id === "obs_parallel_a")!;
    const parallelB = graph.nodes.find(({id}) => id === "obs_parallel_b")!;
    const sequential = graph.nodes.find(({id}) => id === "obs_repeat_1")!;

    expect(parallelA.isParallel).toBe(true);
    expect(parallelB.isParallel).toBe(true);
    expect(parallelA.position.y).toBe(parallelB.position.y);
    expect(parallelA.position.x).not.toBe(parallelB.position.x);
    expect(sequential.isParallel).toBe(false);
    expect(sequential.position.y).toBeGreaterThan(parallelA.position.y);
  });

  it("does not merge siblings through a transitive-only overlap", () => {
    const chainedOverlap = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_a",
        sequence: 1,
        name: "A",
        started_at: "2026-07-25T03:00:01.000Z",
        ended_at: "2026-07-25T03:00:02.000Z",
      }),
      observation({
        observation_id: "obs_b",
        sequence: 2,
        name: "B",
        started_at: "2026-07-25T03:00:01.500Z",
        ended_at: "2026-07-25T03:00:03.500Z",
      }),
      observation({
        observation_id: "obs_c",
        sequence: 3,
        name: "C",
        started_at: "2026-07-25T03:00:03.000Z",
        ended_at: "2026-07-25T03:00:04.000Z",
      }),
    ];

    const graph = buildRuntimeGraph(chainedOverlap);
    const nodeA = graph.nodes.find(({id}) => id === "obs_a")!;
    const nodeB = graph.nodes.find(({id}) => id === "obs_b")!;
    const nodeC = graph.nodes.find(({id}) => id === "obs_c")!;

    expect(nodeA.position.y).toBe(nodeB.position.y);
    expect(nodeC.position.y).toBeGreaterThan(nodeB.position.y);
    expect(nodeC.isParallel).toBe(false);
  });

  it("preserves microsecond interval overlap when assigning parallel rows", () => {
    const microsecondSiblings = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_micro_a",
        sequence: 1,
        name: "micro-a",
        started_at: "2026-07-25T03:00:01.000100Z",
        ended_at: "2026-07-25T03:00:01.000200Z",
      }),
      observation({
        observation_id: "obs_micro_b",
        sequence: 2,
        name: "micro-b",
        started_at: "2026-07-25T03:00:01.000150Z",
        ended_at: "2026-07-25T03:00:01.000250Z",
      }),
    ];

    const graph = buildRuntimeGraph(microsecondSiblings);
    const nodeA = graph.nodes.find(({id}) => id === "obs_micro_a")!;
    const nodeB = graph.nodes.find(({id}) => id === "obs_micro_b")!;

    expect(nodeA.position.y).toBe(nodeB.position.y);
    expect(nodeA.isParallel).toBe(true);
    expect(nodeB.isParallel).toBe(true);
  });

  it("renders an unknown observation kind through the generic node contract", () => {
    const graph = buildRuntimeGraph(runtimeObservations);

    expect(
      graph.nodes.find(({id}) => id === "obs_repeat_2")?.displayKind,
    ).toBe("generic");
  });

  it("does not create an edge for a missing parent", () => {
    const orphan = observation({
      observation_id: "obs_orphan",
      parent_observation_id: "obs_not_returned",
      sequence: 0,
      name: "orphan",
    });

    expect(buildRuntimeGraph([orphan]).edges).toEqual([]);
  });

  it("folds nested internal Runnables into top-level workflow stages", () => {
    const nestedObservations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_planner",
        sequence: 1,
        name: "planner",
      }),
      observation({
        observation_id: "obs_planner_parser",
        parent_observation_id: "obs_planner",
        sequence: 2,
        name: "PydanticToolsParser",
      }),
      observation({
        observation_id: "obs_checker",
        sequence: 3,
        name: "checker",
      }),
      observation({
        observation_id: "obs_checker_llm",
        parent_observation_id: "obs_checker",
        sequence: 4,
        name: "ChatModel",
        kind: "llm",
      }),
    ];

    const graph = buildRuntimeGraph(nestedObservations, "summary");

    expect(graph.nodes.map(({id}) => id)).toEqual([
      "obs_root",
      "obs_planner",
      "obs_checker",
    ]);
    expect(graph.edges).toEqual([
      {
        id: "obs_root->obs_planner",
        source: "obs_root",
        target: "obs_planner",
        relation: "callback",
      },
      {
        id: "obs_root->obs_checker",
        source: "obs_root",
        target: "obs_checker",
        relation: "callback",
      },
    ]);
  });

  it("replaces a callback parent with explicit Send dispatch evidence", () => {
    const observations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_retriever",
        sequence: 1,
        name: "retriever",
      }),
      observation({
        observation_id: "obs_dispatch",
        parent_observation_id: "obs_retriever",
        sequence: 2,
        name: "dispatch_policies",
        dispatch_count: 2,
      }),
      observation({
        observation_id: "obs_checker_a",
        sequence: 3,
        name: "policy_checker",
        dispatch_source_observation_id: "obs_dispatch",
      }),
      observation({
        observation_id: "obs_checker_b",
        sequence: 4,
        name: "policy_checker",
        dispatch_source_observation_id: "obs_dispatch",
      }),
    ];

    const graph = buildRuntimeGraph(observations, "summary");

    expect(graph.nodes.map(({id}) => id)).toEqual([
      "obs_root",
      "obs_retriever",
      "obs_dispatch",
      "obs_checker_a",
      "obs_checker_b",
    ]);
    expect(graph.edges).toContainEqual({
      id: "obs_dispatch=>obs_checker_a",
      source: "obs_dispatch",
      target: "obs_checker_a",
      relation: "dispatch",
    });
    expect(graph.edges).not.toContainEqual({
      id: "obs_root->obs_checker_a",
      source: "obs_root",
      target: "obs_checker_a",
      relation: "callback",
    });
  });
});

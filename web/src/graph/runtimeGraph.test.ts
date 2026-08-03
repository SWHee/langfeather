import {describe, expect, it} from "vitest";
import type {ObservationSummary} from "../api/types";
import {buildRuntimeGraph, observationKindBadges} from "./runtimeGraph";

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
  it("chains siblings into a flow instead of hanging each one off the parent", () => {
    const graph = buildRuntimeGraph(runtimeObservations);

    expect(graph.edges).toEqual([
      // Only the first row of siblings comes off the parent…
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
      // …obs_repeat_1 runs after both parallel lookups, so it is their merge
      // point, and obs_repeat_2 continues the flow from obs_repeat_1.
      {
        id: "obs_parallel_a~>obs_repeat_1",
        source: "obs_parallel_a",
        target: "obs_repeat_1",
        relation: "join",
      },
      {
        id: "obs_parallel_b~>obs_repeat_1",
        source: "obs_parallel_b",
        target: "obs_repeat_1",
        relation: "join",
      },
      {
        id: "obs_repeat_1->obs_repeat_2",
        source: "obs_repeat_1",
        target: "obs_repeat_2",
        relation: "callback",
      },
    ]);
    // Observations that ran at the same time are never linked to each other.
    expect(
      graph.edges.find(
        (edge) =>
          edge.source === "obs_parallel_a" &&
          edge.target === "obs_parallel_b",
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

  it("only draws a dispatch edge at the entry of a dispatched branch, not on every inherited descendant", () => {
    // LangGraph carries dispatch_source_observation_id onto every observation inside a
    // dispatched branch (not just its entry point) -- mirrors a real trace shape.
    const observations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_dispatch",
        sequence: 1,
        name: "dispatch_policies",
        kind: "chain",
        dispatch_count: 3,
      }),
      observation({
        observation_id: "obs_checker_a",
        sequence: 2,
        name: "policy_checker",
        kind: "chain",
        dispatch_source_observation_id: "obs_dispatch",
      }),
      observation({
        observation_id: "obs_checker_a_node",
        parent_observation_id: "obs_checker_a",
        sequence: 3,
        name: "policy_checker_node",
        kind: "chain",
        dispatch_source_observation_id: "obs_dispatch",
      }),
      observation({
        observation_id: "obs_checker_a_seq",
        parent_observation_id: "obs_checker_a_node",
        sequence: 4,
        name: "RunnableSequence",
        dispatch_source_observation_id: "obs_dispatch",
      }),
      observation({
        observation_id: "obs_checker_b",
        sequence: 5,
        name: "policy_checker",
        kind: "chain",
        dispatch_source_observation_id: "obs_dispatch",
      }),
    ];

    const graph = buildRuntimeGraph(observations);
    const dispatchEdges = graph.edges.filter(
      (edge) => edge.relation === "dispatch",
    );

    expect(dispatchEdges).toEqual([
      {
        id: "obs_dispatch=>obs_checker_a",
        source: "obs_dispatch",
        target: "obs_checker_a",
        relation: "dispatch",
      },
      {
        id: "obs_dispatch=>obs_checker_b",
        source: "obs_dispatch",
        target: "obs_checker_b",
        relation: "dispatch",
      },
    ]);
    expect(graph.edges).toContainEqual({
      id: "obs_checker_a->obs_checker_a_node",
      source: "obs_checker_a",
      target: "obs_checker_a_node",
      relation: "callback",
    });
    expect(graph.edges).toContainEqual({
      id: "obs_checker_a_node->obs_checker_a_seq",
      source: "obs_checker_a_node",
      target: "obs_checker_a_seq",
      relation: "callback",
    });
  });

  it("rolls notable hidden descendants up as child kinds on the nearest drawn node", () => {
    const observations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_answer",
        sequence: 1,
        name: "answer_node",
        kind: "chain",
      }),
      observation({
        observation_id: "obs_answer_inner",
        parent_observation_id: "obs_answer",
        sequence: 2,
        name: "RunnableSequence",
        kind: "runnable",
      }),
      observation({
        observation_id: "obs_answer_llm",
        parent_observation_id: "obs_answer_inner",
        sequence: 3,
        name: "ChatOpenAI",
        kind: "llm",
      }),
      observation({
        observation_id: "obs_answer_llm_retry",
        parent_observation_id: "obs_answer_inner",
        sequence: 4,
        name: "ChatOpenAI",
        kind: "llm",
      }),
      observation({
        observation_id: "obs_answer_search",
        parent_observation_id: "obs_answer",
        sequence: 5,
        name: "vector_search",
        kind: "retriever",
      }),
    ];

    const graph = buildRuntimeGraph(observations, "summary");
    const answer = graph.nodes.find(({id}) => id === "obs_answer")!;
    const root = graph.nodes.find(({id}) => id === "obs_root")!;

    expect(graph.nodes.map(({id}) => id)).toEqual(["obs_root", "obs_answer"]);
    // "chain"/"runnable" carry no signal, so only the LLM and retriever surface.
    expect(answer.childKinds).toEqual([
      {kind: "llm", count: 2},
      {kind: "retriever", count: 1},
    ]);
    expect(root.childKinds).toEqual([]);
  });

  it("draws join edges from every parallel branch into the observation that follows them", () => {
    const observations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_branch_a",
        sequence: 1,
        name: "search_docs",
        started_at: "2026-07-25T03:00:01.000Z",
        ended_at: "2026-07-25T03:00:03.000Z",
      }),
      observation({
        observation_id: "obs_branch_b",
        sequence: 2,
        name: "search_web",
        started_at: "2026-07-25T03:00:01.500Z",
        ended_at: "2026-07-25T03:00:02.500Z",
      }),
      observation({
        observation_id: "obs_merge",
        sequence: 3,
        name: "rerank",
        started_at: "2026-07-25T03:00:03.500Z",
        ended_at: "2026-07-25T03:00:04.000Z",
      }),
    ];

    const graph = buildRuntimeGraph(observations, "all");

    expect(graph.edges).toContainEqual({
      id: "obs_branch_a~>obs_merge",
      source: "obs_branch_a",
      target: "obs_merge",
      relation: "join",
    });
    expect(graph.edges).toContainEqual({
      id: "obs_branch_b~>obs_merge",
      source: "obs_branch_b",
      target: "obs_merge",
      relation: "join",
    });
    // The merge node reaches the root through its branches, so the parent edge
    // that would cut across the parallel row is dropped.
    expect(
      graph.edges.filter(({target}) => target === "obs_merge"),
    ).toHaveLength(2);
  });

  it("fans out from the observation that ran before a parallel row", () => {
    const observations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_plan",
        sequence: 1,
        name: "plan",
        started_at: "2026-07-25T03:00:00.500000Z",
        ended_at: "2026-07-25T03:00:01.000000Z",
      }),
      observation({
        observation_id: "obs_branch_a",
        sequence: 2,
        name: "search_docs",
        started_at: "2026-07-25T03:00:01.200000Z",
        ended_at: "2026-07-25T03:00:02.000000Z",
      }),
      observation({
        observation_id: "obs_branch_b",
        sequence: 3,
        name: "search_web",
        started_at: "2026-07-25T03:00:01.400000Z",
        ended_at: "2026-07-25T03:00:02.200000Z",
      }),
    ];

    const graph = buildRuntimeGraph(observations, "all");

    expect(graph.edges).toEqual([
      {
        id: "obs_root->obs_plan",
        source: "obs_root",
        target: "obs_plan",
        relation: "callback",
      },
      {
        id: "obs_plan->obs_branch_a",
        source: "obs_plan",
        target: "obs_branch_a",
        relation: "callback",
      },
      {
        id: "obs_plan->obs_branch_b",
        source: "obs_plan",
        target: "obs_branch_b",
        relation: "callback",
      },
    ]);
  });

  it("keeps the parent edge when the row after a parallel row is parallel too", () => {
    const observations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_branch_a",
        sequence: 1,
        name: "search_docs",
        started_at: "2026-07-25T03:00:01.000Z",
        ended_at: "2026-07-25T03:00:02.000Z",
      }),
      observation({
        observation_id: "obs_branch_b",
        sequence: 2,
        name: "search_web",
        started_at: "2026-07-25T03:00:01.500Z",
        ended_at: "2026-07-25T03:00:02.500Z",
      }),
      observation({
        observation_id: "obs_next_a",
        sequence: 3,
        name: "grade_docs",
        started_at: "2026-07-25T03:00:03.000Z",
        ended_at: "2026-07-25T03:00:04.000Z",
      }),
      observation({
        observation_id: "obs_next_b",
        sequence: 4,
        name: "grade_web",
        started_at: "2026-07-25T03:00:03.500Z",
        ended_at: "2026-07-25T03:00:04.500Z",
      }),
    ];

    const graph = buildRuntimeGraph(observations, "all");

    expect(graph.edges.some(({relation}) => relation === "join")).toBe(false);
    expect(graph.edges).toContainEqual({
      id: "obs_root->obs_next_a",
      source: "obs_root",
      target: "obs_next_a",
      relation: "callback",
    });
  });

  it("summarises an observation by its own notable kind, else by its descendants", () => {
    const observations = [
      runtimeObservations[0]!,
      observation({
        observation_id: "obs_answer",
        sequence: 1,
        name: "answer_node",
        kind: "chain",
      }),
      observation({
        observation_id: "obs_answer_inner",
        parent_observation_id: "obs_answer",
        sequence: 2,
        name: "RunnableSequence",
        kind: "runnable",
      }),
      observation({
        observation_id: "obs_answer_llm",
        parent_observation_id: "obs_answer_inner",
        sequence: 3,
        name: "ChatOpenAI",
        kind: "llm",
      }),
      observation({
        observation_id: "obs_answer_search",
        parent_observation_id: "obs_answer",
        sequence: 4,
        name: "vector_search",
        kind: "retriever",
      }),
    ];

    expect(observationKindBadges(observations, "obs_answer_llm")).toEqual([
      {kind: "llm", count: 1},
    ]);
    expect(observationKindBadges(observations, "obs_answer")).toEqual([
      {kind: "llm", count: 1},
      {kind: "retriever", count: 1},
    ]);
    expect(observationKindBadges(observations, "obs_answer_inner")).toEqual([
      {kind: "llm", count: 1},
    ]);
    expect(observationKindBadges(observations, "obs_missing")).toEqual([]);
  });

  it("reports no child kinds when every observation is drawn", () => {
    const graph = buildRuntimeGraph(runtimeObservations, "all");

    expect(graph.nodes.every(({childKinds}) => childKinds.length === 0)).toBe(
      true,
    );
  });
});

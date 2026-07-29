import type {Experiment, ExperimentStatus} from "../api/types";

export type EvaluatorDataType = "boolean" | "number";

export interface EvaluatorStat {
  evaluatorKey: string;
  dataType: EvaluatorDataType;
  caseCount: number;
  scoredCount: number;
  errorCount: number;
  missingCount: number;
  targetFailedCount: number;
  value: number | null;
  delta: number | null;
}

export interface ExperimentComparison {
  experimentId: string;
  name: string;
  status: ExperimentStatus;
  startedAt: string;
  caseCount: number;
  completedCaseCount: number;
  failedCaseCount: number;
  stats: Map<string, EvaluatorStat>;
}

function aggregateEvaluator(
  experiment: Experiment,
  evaluatorKey: string,
  dataType: EvaluatorDataType,
): EvaluatorStat {
  let scoredCount = 0;
  let errorCount = 0;
  let missingCount = 0;
  let total = 0;

  for (const experimentCase of experiment.cases) {
    const result = experimentCase.evaluator_results.find(
      ({evaluator_key: key}) => key === evaluatorKey,
    );

    if (result?.error_message !== null && result?.error_message !== undefined) {
      errorCount += 1;
    } else if (result === undefined || result.value === null) {
      missingCount += 1;
    } else {
      scoredCount += 1;
      if (dataType === "boolean") {
        total += result.value === true ? 1 : 0;
      } else if (typeof result.value === "number") {
        total += result.value;
      }
    }
  }

  return {
    evaluatorKey,
    dataType,
    caseCount: experiment.cases.length,
    scoredCount,
    errorCount,
    missingCount,
    targetFailedCount: experiment.cases.filter(
      ({status}) => status === "failed",
    ).length,
    value: scoredCount === 0 ? null : total / scoredCount,
    delta: null,
  };
}

export function compareExperiments(
  experiments: readonly Experiment[],
): ExperimentComparison[] {
  const comparisons = experiments.map((experiment) => {
    const stats = new Map<string, EvaluatorStat>();

    for (const evaluator of experiment.evaluators) {
      stats.set(
        evaluator.key,
        aggregateEvaluator(experiment, evaluator.key, evaluator.data_type),
      );
    }

    return {
      experimentId: experiment.experiment_id,
      name: experiment.name,
      status: experiment.status,
      startedAt: experiment.started_at,
      caseCount: experiment.case_count,
      completedCaseCount: experiment.completed_case_count,
      failedCaseCount: experiment.failed_case_count,
      stats,
    };
  });

  const baseline = comparisons[0];
  if (baseline === undefined) {
    return comparisons;
  }

  for (const comparison of comparisons.slice(1)) {
    for (const [evaluatorKey, stat] of comparison.stats) {
      const baselineStat = baseline.stats.get(evaluatorKey);
      stat.delta =
        stat.value === null ||
        baselineStat === undefined ||
        baselineStat.value === null ||
        baselineStat.dataType !== stat.dataType
          ? null
          : stat.value - baselineStat.value;
    }
  }

  return comparisons;
}

export function hasDatasetRevisionMismatch(
  experiments: readonly Pick<Experiment, "dataset_revision">[],
): boolean {
  const baselineRevision = experiments[0]?.dataset_revision;
  return (
    baselineRevision !== undefined &&
    experiments.some(
      ({dataset_revision: revision}) => revision !== baselineRevision,
    )
  );
}

import type { ExperimentCaseStatus, ExperimentStatus } from "../api/types";

export const EXPERIMENT_STATUS_LABEL: Record<ExperimentStatus, string> = {
  running: "실행 중",
  completed: "완료",
  cancelled: "취소",
};

export const CASE_STATUS_LABEL: Record<ExperimentCaseStatus, string> = {
  pending: "대기",
  completed: "완료",
  failed: "실패",
};

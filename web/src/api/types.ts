export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {[key: string]: JsonValue};

export type TraceStatus = "completed" | "failed" | "cancelled";

export interface Trace {
  trace_id: string;
  name: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  status: TraceStatus;
  input: JsonValue;
  output: JsonValue;
  error: JsonValue;
  session_id: string | null;
  user_id: string | null;
  release: string | null;
  environment: string | null;
  tags: string[];
  metadata: {[key: string]: JsonValue};
}

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  provider?: string | null;
  raw: {[key: string]: JsonValue};
}

export interface Observation {
  observation_id: string;
  trace_id: string;
  parent_observation_id: string | null;
  sequence: number;
  name: string;
  kind: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  time_to_first_token_us: number | null;
  status: TraceStatus;
  input: JsonValue;
  output: JsonValue;
  error: JsonValue;
  model: string | null;
  usage: Usage | null;
  metadata: {[key: string]: JsonValue};
}

export interface TraceListItem {
  trace_id: string;
  name: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  status: TraceStatus;
  session_id: string | null;
  user_id: string | null;
  release: string | null;
  environment: string | null;
  tags: string[];
  observation_count: number;
  input_preview: string;
}

export interface TraceListResponse {
  items: TraceListItem[];
  next_cursor: string | null;
}

export interface TraceQuery {
  cursor?: string;
  limit?: number;
  status?: TraceStatus;
  from?: string;
  to?: string;
  tag?: string;
  session_id?: string;
  query?: string;
}

export interface ObservationSummary {
  observation_id: string;
  trace_id: string;
  parent_observation_id: string | null;
  sequence: number;
  name: string;
  kind: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  time_to_first_token_us: number | null;
  status: TraceStatus;
  model: string | null;
  dispatch_count?: number;
  dispatch_source_observation_id?: string | null;
}

export interface TraceDetail {
  trace_id: string;
  name: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  status: TraceStatus;
  session_id: string | null;
  user_id: string | null;
  release: string | null;
  environment: string | null;
  tags: string[];
  observation_count: number;
  observations: ObservationSummary[];
  feedback: Feedback[];
  previous_trace_id?: string | null;
  next_trace_id?: string | null;
}

export interface CompletedEnvelope {
  schema_version: 1;
  trace: Trace;
  observations: Observation[];
}

export interface Feedback {
  feedback_id: string;
  trace_id: string;
  name: string;
  value: boolean | number | string;
  comment: string | null;
  metadata: {[key: string]: JsonValue};
  created_at: string;
  updated_at: string;
}

export interface FeedbackPatch {
  value?: boolean | number | string;
  comment?: string | null;
  metadata?: {[key: string]: JsonValue};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStatus(value: unknown): value is TraceStatus {
  return value === "completed" || value === "failed" || value === "cancelled";
}

function isTrace(value: unknown): value is Trace {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.trace_id, 128) &&
    isNonEmptyString(value.name, 255) &&
    typeof value.started_at === "string" &&
    typeof value.ended_at === "string" &&
    isNonNegativeInteger(value.duration_us) &&
    isStatus(value.status) &&
    isNullableString(value.session_id) &&
    isNullableString(value.user_id) &&
    isNullableString(value.release) &&
    isNullableString(value.environment) &&
    Array.isArray(value.tags)
  );
}

function isObservation(value: unknown): value is Observation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.observation_id, 128) &&
    isNonEmptyString(value.trace_id, 128) &&
    (value.parent_observation_id === null ||
      isNonEmptyString(value.parent_observation_id, 128)) &&
    isNonNegativeInteger(value.sequence) &&
    isNonEmptyString(value.name, 255) &&
    isNonEmptyString(value.kind, 255) &&
    typeof value.started_at === "string" &&
    typeof value.ended_at === "string" &&
    isNonNegativeInteger(value.duration_us) &&
    (value.time_to_first_token_us === null ||
      isNonNegativeInteger(value.time_to_first_token_us)) &&
    isStatus(value.status)
  );
}

export function isCompletedEnvelope(value: unknown): value is CompletedEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const trace = value.trace;
  if (
    value.schema_version !== 1 ||
    !isTrace(trace) ||
    !Array.isArray(value.observations) ||
    value.observations.length === 0 ||
    !value.observations.every(isObservation)
  ) {
    return false;
  }

  const observations = value.observations;
  const roots = observations.filter(
    (observation) => observation.parent_observation_id === null,
  );
  const ids = new Set(observations.map((observation) => observation.observation_id));
  const sequences = new Set(
    observations.map((observation) => observation.sequence),
  );
  return (
    roots.length === 1 &&
    roots[0]?.status === trace.status &&
    observations.every(
      (observation) =>
        observation.trace_id === trace.trace_id &&
        (observation.parent_observation_id === null ||
          ids.has(observation.parent_observation_id)),
    ) &&
    ids.size === observations.length &&
    sequences.size === observations.length
  );
}

export function isFeedback(value: unknown): value is Feedback {
  if (!isRecord(value)) {
    return false;
  }
  const feedbackValue = value.value;
  return (
    isNonEmptyString(value.feedback_id, 128) &&
    isNonEmptyString(value.trace_id, 128) &&
    isNonEmptyString(value.name, 255) &&
    (typeof feedbackValue === "boolean" ||
      (typeof feedbackValue === "number" && Number.isFinite(feedbackValue)) ||
      typeof feedbackValue === "string") &&
    isNullableString(value.comment) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

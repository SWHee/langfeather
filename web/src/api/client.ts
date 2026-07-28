import type {
  Annotation,
  AnnotationQueue,
  AnnotationQueueCreateRequest,
  AnnotationQueueItem,
  AnnotationQueueListResponse,
  Observation,
  ScoreConfig,
  ScoreCreateRequest,
  ScoreListResponse,
  TraceMemo,
  TraceDetail,
  TraceQuery,
  TraceListResponse,
} from "./types";

const API_BASE_PATH = "/api/v1";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`LangFeather API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_PATH}${path}`, {
    headers: {Accept: "application/json"},
    signal,
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return (await response.json()) as T;
}

async function mutateJson<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE_PATH}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function traceQueryPath(query: TraceQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return suffix === "" ? "/traces" : `/traces?${suffix}`;
}

export function getTraces(
  query: TraceQuery = {},
  signal?: AbortSignal,
): Promise<TraceListResponse> {
  return getJson<TraceListResponse>(traceQueryPath(query), signal);
}

export function getTrace(
  traceId: string,
  signal?: AbortSignal,
): Promise<TraceDetail> {
  return getJson<TraceDetail>(
    `/traces/${encodeURIComponent(traceId)}`,
    signal,
  );
}

export function getObservation(
  observationId: string,
  signal?: AbortSignal,
): Promise<Observation> {
  return getJson<Observation>(
    `/observations/${encodeURIComponent(observationId)}`,
    signal,
  );
}

export function getSessionTraces(
  sessionId: string,
  query: Omit<TraceQuery, "session_id"> = {},
  signal?: AbortSignal,
): Promise<TraceListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return getJson<TraceListResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/traces${
      suffix === "" ? "" : `?${suffix}`
    }`,
    signal,
  );
}

export function getScores(
  includeArchived = false,
  signal?: AbortSignal,
): Promise<ScoreListResponse> {
  return getJson<ScoreListResponse>(
    `/scores${includeArchived ? "?include_archived=true" : ""}`,
    signal,
  );
}

export function createScore(request: ScoreCreateRequest): Promise<ScoreConfig> {
  return mutateJson<ScoreConfig>("/scores", "POST", request);
}

export function updateScore(
  scoreConfigId: string,
  patch: Partial<ScoreCreateRequest>,
): Promise<ScoreConfig> {
  return mutateJson<ScoreConfig>(
    `/scores/${encodeURIComponent(scoreConfigId)}`,
    "PATCH",
    patch,
  );
}

export function deleteScore(scoreConfigId: string): Promise<void> {
  return mutateJson<void>(
    `/scores/${encodeURIComponent(scoreConfigId)}`,
    "DELETE",
  );
}

export function archiveScore(scoreConfigId: string): Promise<ScoreConfig> {
  return mutateJson<ScoreConfig>(
    `/scores/${encodeURIComponent(scoreConfigId)}/archive`,
    "POST",
    {},
  );
}

export function putAnnotation(
  traceId: string,
  scoreConfigId: string,
  value: Annotation["value"],
): Promise<Annotation> {
  return mutateJson<Annotation>(
    `/traces/${encodeURIComponent(traceId)}/annotations/${encodeURIComponent(scoreConfigId)}`,
    "PUT",
    {value},
  );
}

export function deleteAnnotation(
  traceId: string,
  scoreConfigId: string,
): Promise<void> {
  return mutateJson<void>(
    `/traces/${encodeURIComponent(traceId)}/annotations/${encodeURIComponent(scoreConfigId)}`,
    "DELETE",
  );
}

export function putTraceMemo(
  traceId: string,
  content: string,
): Promise<TraceMemo | null> {
  return mutateJson<TraceMemo | null>(
    `/traces/${encodeURIComponent(traceId)}/memo`,
    "PUT",
    {content},
  );
}

export function getAnnotationQueues(
  signal?: AbortSignal,
): Promise<AnnotationQueueListResponse> {
  return getJson<AnnotationQueueListResponse>("/annotation-queues", signal);
}

export function getAnnotationQueue(
  queueId: string,
  signal?: AbortSignal,
): Promise<AnnotationQueue> {
  return getJson<AnnotationQueue>(
    `/annotation-queues/${encodeURIComponent(queueId)}`,
    signal,
  );
}

export function createAnnotationQueue(
  request: AnnotationQueueCreateRequest,
): Promise<AnnotationQueue> {
  return mutateJson<AnnotationQueue>("/annotation-queues", "POST", request);
}

export function updateAnnotationQueue(
  queueId: string,
  patch: {
    name?: string;
    description?: string | null;
    score_config_ids?: string[];
  },
): Promise<AnnotationQueue> {
  return mutateJson<AnnotationQueue>(
    `/annotation-queues/${encodeURIComponent(queueId)}`,
    "PATCH",
    patch,
  );
}

export function addAnnotationQueueItems(
  queueId: string,
  traceIds: string[],
): Promise<AnnotationQueue> {
  return mutateJson<AnnotationQueue>(
    `/annotation-queues/${encodeURIComponent(queueId)}/items`,
    "POST",
    {trace_ids: traceIds},
  );
}

export function deleteAnnotationQueueItem(
  queueId: string,
  itemId: string,
): Promise<void> {
  return mutateJson<void>(
    `/annotation-queues/${encodeURIComponent(queueId)}/items/${encodeURIComponent(itemId)}`,
    "DELETE",
  );
}

export function deleteAnnotationQueue(queueId: string): Promise<void> {
  return mutateJson<void>(
    `/annotation-queues/${encodeURIComponent(queueId)}`,
    "DELETE",
  );
}

export function editAnnotationQueueItem(
  queueId: string,
  itemId: string,
): Promise<AnnotationQueueItem> {
  return mutateJson<AnnotationQueueItem>(
    `/annotation-queues/${encodeURIComponent(queueId)}/items/${encodeURIComponent(itemId)}/edit`,
    "POST",
    {},
  );
}

export function completeAnnotationQueueItem(
  queueId: string,
  itemId: string,
  annotations: Array<{
    score_config_id: string;
    value: Annotation["value"];
  }>,
  memo?: string,
): Promise<AnnotationQueueItem> {
  return mutateJson<AnnotationQueueItem>(
    `/annotation-queues/${encodeURIComponent(queueId)}/items/${encodeURIComponent(itemId)}/complete`,
    "POST",
    {
      annotations,
      ...(memo === undefined ? {} : {memo}),
    },
  );
}

export function deleteTrace(traceId: string): Promise<void> {
  return mutateJson<void>(
    `/traces/${encodeURIComponent(traceId)}`,
    "DELETE",
  );
}

export function resetAllData(): Promise<void> {
  return mutateJson<void>("/admin/reset", "POST", {confirmation: "RESET"});
}

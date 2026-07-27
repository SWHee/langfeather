import type {
  Feedback,
  FeedbackPatch,
  Observation,
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
  method: "POST" | "PATCH" | "DELETE",
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

export function createFeedback(feedback: Feedback): Promise<Feedback> {
  return mutateJson<Feedback>("/feedback", "POST", feedback);
}

export function updateFeedback(
  feedbackId: string,
  patch: FeedbackPatch,
): Promise<Feedback> {
  return mutateJson<Feedback>(
    `/feedback/${encodeURIComponent(feedbackId)}`,
    "PATCH",
    patch,
  );
}

export function deleteFeedback(feedbackId: string): Promise<void> {
  return mutateJson<void>(
    `/feedback/${encodeURIComponent(feedbackId)}`,
    "DELETE",
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

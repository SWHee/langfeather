import type { JsonValue } from "../api/types";

export function preview(value: JsonValue | null): string {
  if (value === null) {
    return "—";
  }
  const raw = JSON.stringify(value);
  return raw.length > 100 ? `${raw.slice(0, 97)}…` : raw;
}

export function duration(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value < 1_000) {
    return `${value} µs`;
  }
  return value < 1_000_000
    ? `${Math.round(value / 1_000)} ms`
    : `${(value / 1_000_000).toFixed(2)} s`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

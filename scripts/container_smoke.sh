#!/usr/bin/env bash

set -euo pipefail

project_name="langfeather-phase5-smoke"
base_url="http://127.0.0.1:4319"

cleanup() {
  docker compose -p "$project_name" down -v --remove-orphans >/dev/null 2>&1 || true
}

wait_for_health() {
  for _attempt in $(seq 1 20); do
    if curl --fail --silent --show-error "$base_url/api/v1/health" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  docker compose -p "$project_name" logs langfeather
  return 1
}

trap cleanup EXIT
docker compose -p "$project_name" up -d --build
wait_for_health
curl --fail --silent --show-error "$base_url/traces/deep-link" \
  | grep -q '<div id="root"></div>'

if docker run --rm --entrypoint node langfeather:dev --version >/dev/null 2>&1; then
  echo "Node runtime is unexpectedly present in the final image" >&2
  exit 1
fi

payload='{"items":[{"schema_version":1,"trace":{"trace_id":"tr_container_01","name":"container-smoke","started_at":"2026-07-26T12:00:00.000000Z","ended_at":"2026-07-26T12:00:01.000000Z","duration_us":1000000,"status":"completed","input":{"question":"does persistence work?"},"output":{"answer":"yes"},"error":null,"session_id":null,"tags":[],"metadata":{}},"observations":[{"observation_id":"obs_container_01","trace_id":"tr_container_01","parent_observation_id":null,"sequence":0,"name":"container-smoke","kind":"runnable","started_at":"2026-07-26T12:00:00.000000Z","ended_at":"2026-07-26T12:00:01.000000Z","duration_us":1000000,"time_to_first_token_us":null,"status":"completed","input":{"question":"does persistence work?"},"output":{"answer":"yes"},"error":null,"model":null,"usage":null,"metadata":{}}]}]}'
curl --fail --silent --show-error \
  -H "Content-Type: application/json" \
  --data "$payload" \
  "$base_url/api/v1/traces/batch" >/dev/null

docker compose -p "$project_name" restart langfeather
wait_for_health
curl --fail --silent --show-error \
  "$base_url/api/v1/traces/tr_container_01" >/dev/null

docker compose -p "$project_name" down
docker compose -p "$project_name" up -d --no-build
wait_for_health
curl --fail --silent --show-error \
  "$base_url/api/v1/traces/tr_container_01" >/dev/null

docker run --rm --network "${project_name}_default" langfeather:dev \
  python -c 'from urllib.request import urlopen; urlopen("http://langfeather:4319/api/v1/health", timeout=5).read()'

echo "container smoke passed"

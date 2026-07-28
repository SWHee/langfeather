#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_dir}/.." && pwd)"

cd "${repository_root}"

if [[ -n "$(git status --short)" ]]; then
  echo "변경 중인 파일이 있습니다. git status --short를 확인하세요."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "origin remote가 없습니다. 자신의 fork를 origin으로 등록하세요."
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "upstream remote가 없습니다. 원본 저장소를 upstream으로 등록하세요."
  exit 1
fi

git switch main
git fetch upstream --prune
git merge --ff-only upstream/main
git push origin main

local_main="$(git rev-parse main)"
origin_main="$(git rev-parse origin/main)"
upstream_main="$(git rev-parse upstream/main)"

printf 'main:          %s\n' "${local_main}"
printf 'origin/main:   %s\n' "${origin_main}"
printf 'upstream/main: %s\n' "${upstream_main}"

if [[ "${local_main}" != "${origin_main}" || "${local_main}" != "${upstream_main}" ]]; then
  echo "동기화 후 커밋이 일치하지 않습니다."
  exit 1
fi

echo "원본, 자신의 fork, 로컬 main이 모두 최신 상태입니다."

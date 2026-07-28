#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_dir}/.." && pwd)"

usage() {
  echo "사용법:"
  echo "  $0 <브랜치명>"
  echo "  $0 <브랜치명> -r"
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 2
fi

branch_name="$1"
delete_origin=false

if [[ $# -eq 2 ]]; then
  if [[ "$2" != "-r" ]]; then
    usage
    exit 2
  fi
  delete_origin=true
fi

case "${branch_name}" in
  main | master | develop | development)
    echo "보호 브랜치 '${branch_name}'는 삭제할 수 없습니다."
    exit 1
    ;;
esac

cd "${repository_root}"

if [[ -n "$(git status --short)" ]]; then
  echo "변경 중인 파일이 있습니다. git status --short를 확인하세요."
  exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/${branch_name}"; then
  echo "로컬 브랜치 '${branch_name}'를 찾을 수 없습니다."
  exit 1
fi

"${script_dir}/sync.sh"

if ! git merge-base --is-ancestor "${branch_name}" upstream/main; then
  echo "'${branch_name}'가 upstream/main에 병합된 것으로 확인되지 않습니다."
  echo "Squash merge 여부와 PR 상태를 직접 확인한 뒤 별도로 정리하세요."
  exit 1
fi

delete_target="로컬 브랜치"
if [[ "${delete_origin}" == true ]]; then
  delete_target="로컬 브랜치와 origin 브랜치"
fi

if ! read -r -p "'${branch_name}' ${delete_target}를 삭제할까요? [y/N] " confirmation; then
  echo "삭제를 취소했습니다."
  exit 0
fi

if [[ ! "${confirmation}" =~ ^[yY]$ ]]; then
  echo "삭제를 취소했습니다."
  exit 0
fi

git branch -d -- "${branch_name}"

if [[ "${delete_origin}" == true ]]; then
  if git ls-remote --exit-code --heads origin "refs/heads/${branch_name}" >/dev/null 2>&1; then
    git push origin --delete "${branch_name}"
  else
    echo "origin에 '${branch_name}' 브랜치가 없어 원격 삭제를 건너뜁니다."
  fi
fi

echo "병합된 작업 브랜치 정리가 완료됐습니다."

# Release 운영 안내

제품 version은 SDK, server, web package, Git tag, GitHub Release에 같은 SemVer를
사용합니다. HTTP `schema_version`과 Alembic migration revision은 product version과
별개입니다.

## tag 전 확인

1. `CHANGELOG.md`의 `Unreleased`가 사용자 영향 기준으로 정리됐는지 확인합니다.
2. SDK/server/web의 version과 `uv.lock`이 일치하는지 확인합니다.
3. 다음 gate를 실행합니다.

```bash
uv lock --check
make lint
make typecheck
make test
make contract-check
make build
make smoke
bash scripts/container_smoke.sh
```

4. SDK wheel/sdist에 README와 LICENSE가, server artifact에 LICENSE가 포함됐는지 확인합니다.
5. 새 virtualenv에서 SDK wheel과 `langchain` extra를 설치해 import와 최소 tracing을 확인합니다.
6. PyPI SDK wheel/sdist와 GHCR image를 새 환경에서 실제 install/pull해 최소 trace가
   저장되는지 확인합니다.

## publish 순서

`vX.Y.Z` tag push는 `.github/workflows/release.yml`을 실행합니다. workflow는 검증,
SDK build, PyPI publish, multi-architecture GHCR publish, 공개 artifact smoke, GitHub
Release 생성을 순서대로 수행합니다.

PyPI에는 첫 tag 전에 Pending Trusted Publisher를 한 번 설정합니다.

- project: `langfeather`
- owner: `SungjinWi99`
- repository: `langfeather`
- workflow: `release.yml`
- environment: `pypi`

PyPI publish job만 `id-token: write` OIDC를 사용합니다. GHCR publish는 repository의
`GITHUB_TOKEN`과 `packages: write` 권한을 사용하며 PyPI token은 저장하지 않습니다.
workflow가 만든 container package는 public repository의 visibility를 상속합니다. workflow의
anonymous image pull 검증이 실패하면 GitHub Packages settings에서 repository 연결과
visibility를 확인합니다.

workflow가 성공한 뒤 PyPI project, `ghcr.io/sungjinwi99/langfeather:X.Y.Z`, GitHub
Release가 모두 public인지 확인합니다. local tag나 build 성공만으로 publication 완료라고
쓰지 않습니다.

## changelog 규칙

변경 이력은 사용자나 기여자가 upgrade 여부를 판단하는 문서입니다. source diff를
나열하지 말고 `추가됨`, `변경됨`, `수정됨`, `제거됨`, `알려진 제약` 중 필요한 항목만
사용합니다. tag 전 변경은 `Unreleased`에 둡니다.

# Local deployment

`0.3.0`은 개인 PC에서 실행하는 local-first prototype입니다. FastAPI, SQLite, UI는
하나의 container로 실행하고 기본적으로 `127.0.0.1:4319`에만 bind합니다.

## 공개 collector image 사용

```bash
docker pull ghcr.io/sungjinwi99/langfeather:0.3.0
docker run -d --name langfeather \
  -p 127.0.0.1:4319:4319 \
  -v langfeather-data:/data \
  ghcr.io/sungjinwi99/langfeather:0.3.0
```

trace data는 Docker `langfeather-data` volume에 저장됩니다. service만 멈추려면
`docker stop langfeather`를 사용합니다. data까지 의도적으로 지우려면 container를
삭제한 뒤 `docker volume rm langfeather-data`를 실행합니다.

## Repository 개발 환경

repository의 `compose.yaml`은 source를 build하는 개발용입니다.

```bash
docker compose up -d --build
```

public EC2 exposure와 team access는 현재 지원하지 않습니다. HTTPS, login, ingest token은
`0.4.0` team deployment를 설계할 때 별도 security contract로 추가합니다.

# LangFeather

[English README](README_EN.md)

> 제한된 개발 환경에서 LangGraph 챗봇의 실제 실행 흐름을 확인하는 경량 observability 도구

LangFeather는 LangGraph/LangChain application의 Runnable, LLM, retriever, tool 실행과
원본 input/output, error, latency를 local UI에서 확인하게 합니다. LangSmith의 hosted
service·trace quota와 무거운 self-hosted stack 사이에서, 필요한 debugging 기능만 작은
stack으로 제공하는 것이 목표입니다.

## 현재 상태

`0.3.1`은 local-first, single-project, single-user prototype입니다. collector는 자신의
PC에서 실행하고 기본적으로 `127.0.0.1:4319`에만 열립니다. login, cloud collector,
team sharing, public EC2 deployment는 아직 지원하지 않습니다.

trace payload는 자동 redaction, truncation, sampling 없이 local SQLite에 저장됩니다.
secret이나 production data를 넣지 마세요.

## 빠른 시작

collector를 실행합니다.

```bash
docker run -d --name langfeather \
  -p 127.0.0.1:4319:4319 \
  -v langfeather-data:/data \
  ghcr.io/sungjinwi99/langfeather:0.3.1
```

브라우저에서 <http://127.0.0.1:4319>를 연 뒤 Python SDK를 설치합니다.

```bash
pip install "langfeather[langchain]"
```

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")
graph = langfeather.wrap_runnable(compiled_graph, name="my-langgraph-app")
result = graph.invoke(
    {"question": "검색 결과를 요약해줘"},
    {"configurable": {"thread_id": "example-session"}},
)
langfeather.flush(timeout=2)
```

`compiled_graph`는 기존 `StateGraph.compile()` 결과입니다. 자세한 설치와 적용 방법은
[시작하기](docs/getting-started.md)를 참고하세요.

## 문서

- [시작하기](docs/getting-started.md)
- [LangGraph tracing 가이드](docs/guides/tracing-langgraph.md)
- [Monitoring과 평가](docs/guides/monitoring-and-evaluation.md)
- [문제 해결](docs/guides/troubleshooting.md)
- [SDK 문서](sdk/python/README.md)
- [기여하기](CONTRIBUTING.md)
- [변경 이력](CHANGELOG.md)

제품의 현재 범위와 기술 계약은 [specs](specs/)에 있습니다. AI와 함께 기여할 때는
[.agents 안내](.agents/README.md)부터 읽으세요.

## 피드백과 기여

`0.3.1`은 실제 LangGraph project에서 사용해 보며 설치·적용 경험과 필요한 기능을
확인하는 단계입니다. bug, 설치/적용 경험, 기능 제안은
[GitHub Issues](https://github.com/SungjinWi99/LangFeather/issues)에 남겨주세요.

작은 기능은 AI를 활용해 PR로 기여할 수 있습니다. 관련 spec, focused test, 변경 범위를
확인하는 방법은 [기여 가이드](CONTRIBUTING.md)에 있습니다.

## License

LangFeather는 [Apache License 2.0](LICENSE)으로 배포됩니다.

# LangFeather

[English README](README_EN.md)

> **Python LangChain·LangGraph 프로젝트를 위한 local-first tracing 도구**
> Application을 실행한 뒤, 실제 실행 경로와 각 단계의 원본 input/output을 내
> 컴퓨터의 browser에서 확인하세요.

LangFeather는 RAG 또는 agent application을 만드는 사용자와 개인 개발자를 위한
가벼운 tracing 도구입니다. Collector, SQLite database, UI가 모두 local machine에
있으므로 cloud account를 만들거나 trace를 hosted observability service로 보내지
않고 graph를 디버깅할 수 있습니다.

![LangFeather trace detail 화면](artifacts/ui-redesign-desktop.png)

## 할 수 있는 일

- Top-level LangChain/LangGraph Runnable을 한 줄로 감싸고 callback에 나타난
  Runnable, LLM, retriever, tool 호출을 확인합니다.
- 순차·병렬·조건 분기·loop·fallback·streaming·실패·취소 실행을 runnable example으로
  비교합니다.
- 집계 metric만 보는 대신 nested JSON을 포함한 원본 diagnostic payload를 확인합니다.
- `@observe`, `span()`으로 일반 Python 코드를 추적하거나 `wrap_asgi()`로 ASGI
  request를 root trace로 만듭니다.
- 같은 LangGraph `thread_id`의 trace를 이동하고, custom score와 trace 메모로
  평가하며, 고정 annotation queue를 관리합니다.
- 검토한 trace input을 dataset으로 고정하고, local Python target/evaluator로
  experiment를 실행해 같은 dataset revision의 결과를 비교합니다.
- SQLite backup을 내보내거나 local trace data를 삭제합니다.

LangFeather는 수집한 callback evidence가 뒷받침하는 runtime 관계만 표시합니다.
정적 graph나 관찰되지 않은 edge를 추론하지 않습니다.

## 시작 전 알아둘 점

이 도구는 local, single-user 학습 및 debugging 용도입니다. Hosted service가 아니며
login, team sharing, cloud deployment, production delivery guarantee를 제공하지
않습니다.

**저장된 trace는 민감하게 다루세요.** LangFeather는 debugging을 위해 전체 trace
payload를 저장하며 application data를 자동 redaction, truncation, sampling하지
않습니다. Shared demo database에 실제 secret이나 production data를 넣지 마세요.
기본 Docker mapping은 `127.0.0.1:4319`에만 bind됩니다.

Local technical gate는 완료됐지만 Phase 6 release hardening은 진행 중입니다. Public
package release와 license 결정도 아직 완료되지 않았습니다. Package release가
안내되기 전에는 PyPI의 `pip install langfeather`를 전제하지 말고 source checkout에서
example을 실행하세요.

첫 release baseline은 **0.1.0**입니다. Publication 상태와 변경 내역은
[CHANGELOG.md](CHANGELOG.md)에서 확인합니다.

## Quick start: 첫 trace 보기

### 1. Clone하고 개발 환경 준비하기

필요 사항: Git, Docker Desktop, Python 3.10 이상, Node.js 24,
[`uv`](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/SungjinWi99/langfeather.git
cd langfeather
make setup
```

`make setup`은 project-managed Python 3.12 environment, Python workspace
dependency, web dependency를 설치합니다. 처음에는 몇 분 걸릴 수 있습니다.

### 2. Local collector와 UI 시작하기

가장 간단한 all-in-one 실행 방법입니다.

```bash
docker compose up -d --build
```

[http://127.0.0.1:4319](http://127.0.0.1:4319)를 엽니다. Data는 Docker의
`langfeather-data` volume에 저장되며 container를 재시작해도 유지됩니다.

### 3. 두 node LangGraph example 실행하기

위에서 시작한 Docker collector를 사용합니다. 다른 terminal에서 실행하세요.

```bash
LANGFEATHER_ENDPOINT=http://127.0.0.1:4319 \
  uv run python examples/langgraph_quickstart/app.py
```

Browser를 새로고침하고 `quickstart` trace를 선택한 뒤 `draft_answer`와
`finalize_answer`를 클릭하세요. Inspector에서 각각의 원본 input/output을 볼 수
있습니다.

Data를 지우지 않고 local service만 멈추려면 다음을 실행합니다.

```bash
docker compose stop
```

Container와 local trace volume을 의도적으로 제거하려면 다음을 실행합니다.

```bash
docker compose down -v
```

## 기존 LangGraph 프로젝트에 적용하기

먼저 LangFeather 저장소에서 local collector를 실행합니다.

```bash
docker compose up -d --build
```

Application을 host에서 실행하면 endpoint는 `http://127.0.0.1:4319`입니다.
LangFeather와 같은 Docker Compose network에서 application container를 실행하면
`http://langfeather:4319`를 사용합니다.

Public PyPI release 전에는 프로젝트의 dependency manager로 SDK source package를
설치합니다. 아래 GitHub 주소는 실제 public 주소로 바꿉니다.

```bash
pip install "langfeather[langchain] @ git+https://github.com/SungjinWi99/langfeather.git#subdirectory=sdk/python"
```

`StateGraph.compile()`의 결과, 즉 실제로 호출되는 compiled graph를 **한 번만**
감쌉니다. Node, state schema, prompt, checkpointer, `thread_id`, 기존 streaming과
예외 처리는 바꾸지 않습니다.

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")

dataset = langfeather.get_or_create_dataset(
    name="rag-regression",
    description="검토가 끝난 사례",
)
graph = langfeather.wrap_runnable(compiled_graph, name="my-langgraph-app")

result = graph.invoke(
    {"question": "Explain retrieval"},
    {"configurable": {"thread_id": "quickstart-session"}},
)
langfeather.flush(timeout=2)
```

`invoke`, `ainvoke`, `stream`, `astream`을 지원합니다. Streaming에서는 기존처럼
chunk를 전달하고 iterator를 끝까지 소비합니다. CLI/script가 끝나기 전 `flush()`를
호출하면 trace 전송 완료를 확인할 수 있습니다. UI에서 새 trace, root graph, 내부
node의 input/output이 보이는지 검증하세요.

Coding agent에는 아래 prompt를 그대로 줄 수 있습니다.

```text
내 기존 LangGraph 프로젝트에 LangFeather를 적용해줘.
먼저 StateGraph.compile() 결과와 실제 invoke/ainvoke/stream/astream 호출 위치를
찾아라. 실제 호출되는 compiled graph를 한 번만 langfeather.wrap_runnable()으로
감싸고, 기존 node, state schema, prompt, checkpointer, config, thread_id,
streaming, 예외 처리, dependency 버전은 바꾸지 마라.

LangFeather endpoint는 [http://127.0.0.1:4319 또는 Docker service 주소]다.
기존 테스트 또는 실제 실행 경로를 사용해 결과와 streaming chunk가 동일한지
확인하고, UI에서 root graph와 내부 node trace가 보이는지 검증해라. 마지막에
변경 파일, 설치 명령, 실행 명령, 검증 결과, 남은 제약을 보고해라.
```

SDK API 세부 사항은 [Python SDK 문서](sdk/python/README.md)를 참고하세요.
일반 Python 코드에는 `@langfeather.observe` 또는 `langfeather.span()`, ASGI
application에는 `langfeather.wrap_asgi(app)`를 사용할 수 있습니다.

## Dataset과 experiment로 regression 확인하기

trace 상세의 `…` 메뉴에서 **Add to Dataset**을 선택하면 해당 trace의 input을
example으로 추가합니다. 이때 trace output을 정답으로 자동 저장하지 않으므로,
`Datasets`에서 dataset을 열어 expected output을 직접 검토·입력하세요. Dataset을
만든 뒤에는 아래처럼 application과 같은 Python process에서 experiment를 실행할
수 있습니다.

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")

def answer(case: dict[str, str]) -> str:
    return "청년" if case["question"] == "지원 대상은?" else "확인 필요"

run = langfeather.evaluate(
    dataset=dataset.dataset_id,
    name="baseline-after-retrieval-change",
    target=answer,
    evaluators=[langfeather.exact_match()],
    target_metadata={"git_sha": "abc123"},
)
print(run.completed_case_count, run.failed_case_count)
```

case별 target 실행은 trace로 남고, dataset 상세의 `Experiments` tab에서 output,
evaluator 결과, 연결 trace와 같은 dataset revision의 다른 experiment를 비교할 수
있습니다. 상세 규칙과 custom evaluator 예시는
[Dataset, Experiment, Evaluator guide](docs/DATASET_EXPERIMENT_EVALUATION.md)를
참고하세요.

## Example 선택하기

| 확인하려는 내용 | 시작할 문서 |
| --- | --- |
| 첫 두 node LangGraph trace | [LangGraph quickstart](examples/langgraph_quickstart/README.md) |
| 병렬 branch, loop, fallback, streaming, 실패, 취소 | [Runtime fidelity examples](examples/langgraph_runtime_fidelity/README.md) |
| 일반 Python 함수, span, ASGI request | [Generic capture example](examples/generic_capture/README.md) |
| SDK 설정, stream lifecycle, serializer 동작 | [Python SDK 문서](sdk/python/README.md) |
| Dataset 작성, local experiment 실행, evaluator 작성 | [Dataset, Experiment, Evaluator guide](docs/DATASET_EXPERIMENT_EVALUATION.md) |
| Local API/database 운영 | [Server reference](server/README.md) |

![LangFeather mobile trace list](artifacts/ui-redesign-mobile.png)

## 유용한 명령

`make setup` 후 repository root에서 실행합니다.

```bash
make lint            # Python과 web lint
make typecheck       # Python과 TypeScript type check
make test            # SDK, server, integration, web test
make contract-check  # Generated API schema가 commit됐는지 확인
make build           # 두 Python package와 web app build
make smoke           # Import와 web build smoke check
```

Docker Desktop이 있다면 전체 Docker distribution 검사도 실행할 수 있습니다.

```bash
bash scripts/container_smoke.sh
```

## 기여 문서

역할에 맞는 문서부터 읽으세요.

| 문서 | 사용할 때 |
| --- | --- |
| [Contributing guide](docs/CONTRIBUTING.md) | Bug를 report하거나 focused contribution을 준비할 때 |
| [Changelog](CHANGELOG.md) | Release별 user-visible change를 확인할 때 |
| [Release guide](docs/RELEASING.md) | Version, tag, GitHub Release를 준비할 때 |
| [Product requirements](docs/PRODUCT_REQUIREMENTS.md) | Target user, scope, acceptance criteria를 확인할 때 |
| [Decisions](docs/DECISIONS.md) | Locked 또는 deliberately out-of-scope 결정을 확인할 때 |
| [Architecture](docs/ARCHITECTURE.md) | SDK/server/web 경계와 runtime flow를 확인할 때 |
| [Data contract](docs/DATA_CONTRACT.md) | Trace, observation, score, annotation, HTTP shape를 바꿀 때 |
| [Score and annotation queue design](docs/SCORE_ANNOTATION_QUEUE_DESIGN.md) | Custom score와 annotation queue의 UX/상태 규칙을 확인할 때 |
| [Dataset, experiment, evaluator guide](docs/DATASET_EXPERIMENT_EVALUATION.md) | Regression dataset과 local Python evaluation loop를 사용할 때 |
| [Known issues](docs/KNOWN_ISSUES.md) | 문서화된 limitation을 조사할 때 |
| [Agent rules](AGENTS.md) | Coding agent로 repository를 수정할 때 |

## 프로젝트 경계

LangFeather v1은 의도적으로 작게 유지합니다.

- Python SDK만 지원; Python 3.10+
- FastAPI + SQLite + SQLAlchemy + Alembic server
- Vite + React + TypeScript + React Flow UI
- Local Docker container 하나, Uvicorn worker 하나, SQLite writer 하나
- Custom versioned JSON API; v1에서는 OpenTelemetry 제외
- Best-effort bounded in-memory delivery; client disk spool 없음

Cloud hosting, authentication, multi-project workspace, JavaScript SDK, cost
calculation, prompt management, server-side evaluator 실행, managed LLM judge,
automatic payload redaction과 retention은 범위 밖입니다. Dataset과 experiment는
지원하지만 target과 evaluator는 사용자 Python process에서 실행합니다. 전체
rationale은 [docs/DECISIONS.md](docs/DECISIONS.md)를 참고하세요.

## Backup과 reset

UI는 일관된 SQLite backup을 내려받을 수 있고, `RESET`을 입력하면 trace,
observation, score, annotation, memo, annotation queue, dataset, experiment
data를 모두 초기화할 수 있습니다. Backup에는 raw payload가 들어 있으므로 안전한
local 위치에 보관하세요.

Restore는 의도적으로 offline-only입니다. 먼저 server를 멈춘 후 backup directory를
Compose container에 mount합니다.

```bash
docker compose stop langfeather
docker compose run --rm --no-deps -v "$PWD:/backup" langfeather \
  langfeather-server restore /backup/langfeather-backup.db
docker compose up -d langfeather
```

Restore command는 SQLite integrity와 migration compatibility를 확인한 뒤 atomic
replace를 수행하며, 기존 database의 safety copy를 보존합니다.

## 상태와 roadmap

Phase 0–5 local technical gate는 구현됐습니다. 다음 Phase는 package/image
publication, compatibility matrix, clean-install verification, resource benchmark,
최종 license 결정을 포함한 release hardening입니다. 세부 상태와 acceptance gate는
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)에 있습니다.

## License

Open-source license는 아직 선택되지 않았습니다. 이 repository를 재사용 가능하게
공개하기 전에 maintainer가 `LICENSE`를 선택해 추가해야 합니다. License가 없으면
기본 copyright 상태상 다른 사람이 code를 reuse하거나 modify할 권한이 없습니다.

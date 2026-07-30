# 전송과 제약

LangFeather SDK의 trace 전송은 application의 흐름을 보호하기 위한 **best-effort**
기능입니다. 이 문서는 전달 보장 범위와 운영 시 알아야 할 제한을 설명합니다.

## 전송 방식

terminal trace envelope는 bounded in-memory queue에 들어가고, daemon background
sender가 collector의 `/api/v1/traces/batch`로 batch 전송합니다. SDK를 import하거나
`configure()`만 호출해도 sender thread나 network I/O가 시작되지는 않습니다. 첫
terminal trace를 보낼 때 sender가 시작됩니다.

기본값은 다음과 같습니다.

| 설정 | 기본값 | 의미 |
| --- | ---: | --- |
| `queue_capacity` | 256 | memory에서 기다릴 최대 trace 수 |
| `batch_size` | 20 | 한 HTTP 요청에 묶는 최대 trace 수 |
| `request_timeout` | 0.5초 | 요청 한 번의 timeout |
| `retry_count` | 1 | 최초 요청 뒤 추가 retry 횟수 |
| `retry_backoff` | 0.05초 | retry 사이의 base delay |
| `shutdown_timeout` | 2초 | `flush()`/`shutdown()` 기본 대기 시간 |

필요할 때만 process 시작 시 한 번 설정하세요.

```python
import langfeather

langfeather.configure(
    endpoint="http://127.0.0.1:4319",
    queue_capacity=512,
    batch_size=50,
    request_timeout=1.0,
    retry_count=2,
    shutdown_timeout=5.0,
)
```

endpoint는 absolute HTTP(S) URL이어야 합니다. `endpoint`를 생략하면
`LANGFEATHER_ENDPOINT`, 그 다음 `http://127.0.0.1:4319`를 사용합니다.

## 실패했을 때

network error와 HTTP `408`, `429`, `5xx`는 retry 대상입니다. 그 외 HTTP 오류는 retry
하지 않습니다. 전송·serialization·callback 계측 오류는 warning으로 남고 application
반환값, stream chunk, 예외 instance나 traceback을 바꾸지 않습니다.

queue가 가득 차면 SDK는 가장 오래 기다리던 trace를 버리고 warning을 기록합니다.
client disk spool은 제공하지 않습니다. 따라서 아래 상황에서는 trace가 유실될 수
있습니다.

- collector가 꺼져 있거나 endpoint가 잘못된 경우
- queue가 지속적으로 포화되는 경우
- process가 강제 종료되거나 timeout 전에 종료되는 경우
- retry가 모두 실패한 경우

이는 v1의 의도된 경계입니다. LangFeather는 application 성능과 장애 격리를 우선하며,
무손실 전달을 제공하지 않습니다.

## `flush()`와 `shutdown()`

CLI, batch job처럼 process가 바로 끝나는 경우에는 종료 전에 `flush()`를 호출하세요.

```python
try:
    run_job()
finally:
    delivered = langfeather.flush(timeout=2)
    if not delivered:
        logger.warning("Some LangFeather traces may be lost")
```

`flush()`는 **호출 시점까지 SDK가 받아들인** envelope가 sender에서 처리될 때까지
기다립니다. 이후 새로 생긴 trace는 기다리지 않으며, `True`여도 collector가 server
database에 commit했다는 end-to-end durability 보장은 아닙니다.

`shutdown()`은 새 envelope 수락을 멈춘 뒤 bounded flush와 sender thread 종료를
시도합니다. timeout이면 `False`를 반환하고 pending trace가 유실될 수 있습니다.
같은 process에서 shutdown 뒤 다시 추적하려면 `configure()`를 명시적으로 다시
호출하세요.

## streaming memory 제한

Runnable wrapper와 `@observe`로 감싼 generator는 terminal output을 만들기 위해
소비한 chunk를 memory에 모읍니다. chunk는 원형 그대로 호출자에게 전달됩니다.
그러나 끝나지 않는 stream, 매우 큰 chunk, 장시간 stream은 process memory를 계속
사용할 수 있습니다.

stream을 더 이상 사용하지 않을 때는 iterator를 정상적으로 끝까지 소비하거나
`close()`/`aclose()`로 닫으세요. 시작한 stream을 닫으면 cancelled로 기록됩니다.
생성만 하고 소비하지 않은 stream은 관측되지 않습니다.

## payload 보안 경계

SDK는 trace payload를 자동 redaction, truncation, summarization, sampling하지
않습니다. debugging data에는 prompt, model output, tool input/output처럼 민감할 수
있는 값이 포함될 수 있습니다. local database와 backup을 보호하고, 실제 secret은
application 수준에서 trace로 들어오지 않도록 관리하세요.

ASGI wrapper는 request·response header를 기록하지 않지만, route 진단 정보와 response
body는 기록합니다. 자세한 계측 범위는 [계측하기](instrumentation.md)를 참고하세요.

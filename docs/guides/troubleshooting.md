# 문제 해결

## UI에 trace가 보이지 않음

1. collector가 실행 중인지 `http://127.0.0.1:4319/api/v1/health`에서 확인합니다.
2. SDK endpoint가 collector 주소와 같은지 확인합니다.
3. 짧게 끝나는 script라면 종료 전에 `langfeather.flush(timeout=2)`를 호출합니다.
4. application warning log에 queue overflow나 delivery failure가 있는지 봅니다.

collector가 꺼져 있거나 전송이 실패해도 application은 계속 실행됩니다. 이는
best-effort delivery의 의도된 경계이며 trace는 유실될 수 있습니다.

## stream이 끝나지 않음

stream은 소비를 시작한 뒤 종료, 실패, 취소될 때 terminal trace가 만들어집니다. 매우
크거나 끝나지 않는 stream은 chunk aggregate 때문에 memory를 많이 사용할 수 있습니다.
더 이상 쓰지 않는 stream은 `close()` 또는 `aclose()`로 닫으세요.

## Docker port 충돌

기본 `4319`가 이미 사용 중이면 해당 collector를 중지하거나, 현재 compose 설정을
바꾸기 전에 어떤 서비스가 포트를 사용 중인지 확인합니다. 다른 service를 임의로
종료하지 마세요.

## 도움 요청

재현 가능한 최소 code, 실행 명령, LangFeather version, error log를 포함해
[GitHub Issues](https://github.com/SungjinWi99/LangFeather/issues)에 남겨주세요.
trace payload에는 민감한 값을 넣지 마세요.

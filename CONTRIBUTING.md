# 기여하기

LangFeather는 수강생이 AI와 함께 작은 개선을 안전하게 기여할 수 있게 하는 것을
중요하게 생각합니다. bug, 설치/적용 경험, 기능 제안은 먼저
[GitHub Issues](https://github.com/SungjinWi99/langfeather/issues)에 남겨주세요.

## PR 전 확인

1. [제품 정의](specs/product.md)와 관련 spec을 읽습니다.
2. 현재 지원 범위인지 확인합니다. team deployment, login, multi-project는 아직
   기능 요청이 아니라 roadmap입니다.
3. 기존 test와 비슷한 구현을 찾습니다.

## 작은 변경 흐름

```text
issue 확인 → focused test → 작은 구현 → 검증 → PR
```

AI와 작업한다면 [.agents 안내](.agents/README.md)와
[작업 흐름](.agents/workflow.md)을 먼저 제공하세요. UI 변경에는
[디자인 계약](.agents/design.md)을 함께 적용합니다.

## 검증

변경한 package의 focused test를 먼저 실행합니다. release 또는 여러 package에 영향을
주는 변경은 다음을 사용합니다.

```bash
make lint
make typecheck
make test
make contract-check
make build
make smoke
```

PR에는 목적, 사용자에게 달라지는 동작, 실행한 검증과 결과, 남은 제약을 적습니다.
실행하지 않은 검증을 통과했다고 쓰지 마세요.

## 데이터와 보안

trace payload에는 민감한 값이 포함될 수 있습니다. issue, PR, screenshot, test fixture에
실제 secret·개인 정보·production payload를 올리지 마세요.

## License

기여물은 [Apache License 2.0](LICENSE) 조건으로 배포됩니다.

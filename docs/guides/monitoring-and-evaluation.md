# Monitoring과 평가

## Overview

Overview는 선택 기간과 공통 trace filter를 기준으로 같은 대상 trace 집합을 집계합니다.
요청 수, latency p50/p95/p99, error rate, LLM 호출, tool별 호출, feedback score 추이를
봅니다. error rate는 `failed / (completed + failed + cancelled)`입니다.

데이터가 없는 시간 bucket에서 요청 수와 LLM/tool 호출 수 같은 count는 `0`으로
표시합니다. 반면 표본이 필요한 latency, error rate, feedback value와 categorical
option rate는 `null`로 표시합니다. 표본이 있고 계산 결과가 실제로 0인 경우에는
`null`이 아니라 `0`을 표시합니다.

Overview는 monitoring 화면입니다. chart click으로 trace 화면을 자동 전환하지 않으며,
상단 navigation으로 Traces debugging workspace를 엽니다.

## Score와 annotation

trace를 검토하면서 boolean, finite number, categorical score와 공유 memo를 기록할 수
있습니다. annotation queue는 자동으로 trace를 모으지 않습니다. 사용자가 trace를
명시적으로 queue에 넣고 완료를 표시합니다.

## Dataset과 experiment

검토한 trace의 input을 dataset example으로 추가한 뒤 expected output을 직접 확인합니다.
그 다음 application과 같은 Python process에서 target/evaluator를 실행합니다. server는
결과를 저장할 뿐 evaluator 코드를 실행하지 않습니다.

자세한 SDK API 예제와 snapshot 규칙은
[평가 가이드](../../sdk/python/docs/evaluation.md)를 참고하세요.

from __future__ import annotations

from dataclasses import dataclass

import langfeather


@dataclass(slots=True)
class Answer:
    text: str


@langfeather.observe(name="generic-python")
def answer_question(question: str) -> Answer:
    with langfeather.span("normalize_question", input=question) as current_span:
        normalized = question.strip()
        current_span.set_output(normalized)
    return Answer(text=f"답변: {normalized}")


def main() -> None:
    langfeather.configure()
    print(answer_question("  LangGraph 실행 순서를 보여줘  "))
    langfeather.flush(timeout=2)


if __name__ == "__main__":
    main()

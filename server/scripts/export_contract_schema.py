from __future__ import annotations

import json
from pathlib import Path

from langfeather_server.contracts import (
    CompletedEnvelopeContract,
    FeedbackContract,
)


def main() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    output_path = repository_root / "tests" / "fixtures" / "schema" / "v1.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "completed_envelope": CompletedEnvelopeContract.model_json_schema(),
        "feedback": FeedbackContract.model_json_schema(),
    }
    output_path.write_text(
        f"{json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()


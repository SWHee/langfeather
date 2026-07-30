from __future__ import annotations

import os

import langfeather


def main() -> None:
    endpoint = os.environ.get("LANGFEATHER_ENDPOINT", "http://127.0.0.1:4319")
    langfeather.configure(endpoint=endpoint)
    with langfeather.span(
        "release-package-smoke",
        input={"source": "published-sdk"},
    ) as operation:
        operation.set_output({"stored": True})
    if not langfeather.flush(timeout=5):
        raise RuntimeError("the published SDK did not finish the release smoke delivery")


if __name__ == "__main__":
    main()

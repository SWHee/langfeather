from __future__ import annotations

import langfeather


def test_sdk_imports_without_optional_dependencies() -> None:
    assert langfeather.__version__ == "0.3.1"
    assert callable(langfeather.observe)
    assert callable(langfeather.span)
    assert callable(langfeather.current_context)
    assert callable(langfeather.use_context)
    assert callable(langfeather.wrap_asgi)

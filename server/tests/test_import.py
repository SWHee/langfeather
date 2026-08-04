from __future__ import annotations

import langfeather_server


def test_server_package_imports() -> None:
    assert langfeather_server.__version__ == "0.3.2"

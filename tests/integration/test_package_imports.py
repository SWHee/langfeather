from __future__ import annotations

import langfeather
import langfeather_server


def test_workspace_packages_import_together() -> None:
    assert langfeather.__version__ == langfeather_server.__version__


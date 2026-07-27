from __future__ import annotations

import sys
from pathlib import Path

# The runtime-fidelity fixtures are executable examples rather than an installed
# workspace package. Make the repository root importable when pytest is launched
# through its console script, whose sys.path starts at `.venv/bin`.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

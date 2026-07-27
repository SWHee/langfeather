from __future__ import annotations

import langfeather
import langfeather_server


def main() -> None:
    print(f"langfeather={langfeather.__version__}")
    print(f"langfeather-server={langfeather_server.__version__}")


if __name__ == "__main__":
    main()


from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from langfeather_server.restore import RestoreError, restore_database


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="langfeather-server")
    commands = parser.add_subparsers(dest="command", required=True)
    restore = commands.add_parser(
        "restore",
        help="restore a validated SQLite backup while the server is stopped",
    )
    restore.add_argument("backup", type=Path)
    restore.add_argument(
        "--database-url",
        help="SQLite URL to restore (defaults to LANGFEATHER_DATABASE_URL)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    if arguments.command == "restore":
        try:
            result = restore_database(
                arguments.backup,
                database_url=arguments.database_url,
            )
        except RestoreError as error:
            parser.error(str(error))
        print(f"restored {result.database_path}")
        if result.safety_copy is not None:
            print(f"previous database saved to {result.safety_copy}")
        return 0
    parser.error("unknown command")


if __name__ == "__main__":
    raise SystemExit(main())

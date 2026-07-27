# Changelog

All notable user-visible changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and release numbers
follow Semantic Versioning while LangFeather remains in the `0.x` series.

## [Unreleased]

### Added

- Nothing yet.

### Changed

- Nothing yet.

### Fixed

- Nothing yet.

## [0.1.0] - 2026-07-27

Initial local-first release baseline. GitHub/PyPI/GHCR publication remains a
separate Phase 6 release-hardening step.

### Added

- Python SDK with `wrap_runnable()`, `@observe`, `span()`, and ASGI capture.
- LangChain/LangGraph callback capture for runtime-visible Runnable, LLM,
  retriever, and tool executions.
- FastAPI, SQLite, Alembic local collector with trace inspection, feedback,
  backup, reset, and offline restore.
- React runtime graph and lazy input/output inspector.
- Docker Compose local installation and runnable LangGraph examples.

### Fixed

- LangGraph `Send` fan-out now renders only explicitly evidenced dispatch
  edges, without inferring callback parent relationships.

### Known limitations

- Local, single-user installation only; no authentication or cloud collector.
- Trace delivery is bounded in-memory best effort.
- Raw diagnostic payloads are retained locally without automatic redaction.

[Unreleased]: https://github.com/<OWNER>/<REPOSITORY>/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<OWNER>/<REPOSITORY>/releases/tag/v0.1.0

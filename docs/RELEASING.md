# Release and Versioning Guide

LangFeather uses one product version for the Python SDK, server, web package,
Git tag, and GitHub Release. The first public baseline is `0.1.0`.

## Version boundaries

Three numbers have different purposes and must not be changed together by
default.

| Boundary | Current value | Change it when… |
| --- | --- | --- |
| Product release | `0.1.0` | user-visible SDK/server/web release changes |
| HTTP envelope schema | `schema_version=1` | the versioned JSON envelope is intentionally incompatible |
| SQLite migration | Alembic revision | database structure changes |

The server reports product and supported schema versions through `/health`.
Database restore validates the Alembic revision independently.

## `0.x` release rules

- `0.1.1`: backward-compatible bug fixes, documentation, or internal changes.
- `0.2.0`: a new user-visible capability or any intentional breaking SDK/API
  behavior change while the project is pre-1.0.
- `1.0.0`: only after Phase 6 release hardening is complete and the supported
  installation and compatibility policy is explicit.

For now, a matching SDK and server release is the supported installation.
`schema_version=1` alone is not a promise that arbitrary old/new package pairs
are supported; add verified combinations to the compatibility matrix before
making that promise.

## Prepare a release

1. Select the next version and add its user-visible entries under
   `## [Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md).
2. Replace the version consistently in:
   - root `pyproject.toml`
   - `sdk/python/pyproject.toml` and `sdk/python/src/langfeather/__init__.py`
   - `server/pyproject.toml` and `server/src/langfeather_server/__init__.py`
   - `web/package.json` and `web/package-lock.json`
   - version assertions and release fixtures
3. Refresh `uv.lock` with the project-local cache and confirm the workspace
   package versions changed without unrelated dependency updates.
4. Run:

   ```bash
   make lint
   make typecheck
   make test
   make contract-check
   make build
   make smoke
   ```

5. Run the Docker smoke test when Docker Desktop is available:

   ```bash
   bash scripts/container_smoke.sh
   ```

6. Create the commit, tag it as `vX.Y.Z`, and create a GitHub Release using the
   corresponding changelog section. Publish PyPI/GHCR artifacts only after
   their ownership, license, and repository paths are confirmed.

## Changelog rules

Write for a user or developer deciding whether to upgrade, not for a source
diff reader. Use only the headings that have entries: `Added`, `Changed`,
`Fixed`, `Removed`, `Security`, and `Known limitations`. Keep an item in
`Unreleased` until the Git tag is created.

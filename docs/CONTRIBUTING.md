# Contributing to LangFeather

Thanks for helping make local LLM debugging easier for users. LangFeather is
currently preparing for its first public release, so small, reproducible,
well-tested contributions are especially valuable.

## Before opening an issue or change

1. Read the [README](../README.md), [known issues](KNOWN_ISSUES.md), and
   [locked decisions](DECISIONS.md).
2. Check whether the behavior is within the v1 local-first scope.
3. Reproduce it with the smallest example possible. Do not include raw traces,
   API keys, private prompts, backups, or personal data in an issue.

## Development setup

```bash
make setup
make lint
make typecheck
make test
```

Use the runnable examples under [`examples/`](../examples/) to demonstrate a
trace behavior. The root [README](../README.md) explains the local Docker path.

## Keep your fork current

Register the original repository once:

```bash
git remote add upstream https://github.com/SungjinWi99/langfeather.git
```

Before starting a branch, confirm `git status --short` is empty and sync all
three `main` branches:

```bash
git status --short
./scripts/sync.sh
git switch -c your-branch-name
```

After a pull request is merged, remove its local branch. Add `-r` to remove the
same branch from your fork as well. Replace `your-branch-name` with the branch
you actually used:

```bash
git status --short

# Delete the local branch only.
./scripts/cleanup.sh your-branch-name

# Or delete both the local branch and the branch on your fork.
./scripts/cleanup.sh your-branch-name -r
```

Both scripts stop on uncommitted changes. `cleanup.sh` also refuses protected
or unmerged branches and asks for confirmation before deletion.

## Make a focused change

- Read [`AGENTS.md`](../AGENTS.md) before editing. It is the repository's
  authority for package boundaries and verification.
- Keep SDK, server, and web independently usable. They communicate through the
  versioned JSON contract, not runtime imports.
- Add or update a focused test first when fixing behavior.
- Add an Alembic migration for every SQLite schema change.
- Update the canonical fixture, all consumers, integration tests, and contract
  documentation together when changing the API/data shape.
- Do not add cloud hosting, authentication, a JavaScript SDK, OpenTelemetry,
  client disk spooling, payload redaction/truncation, pricing, datasets, or
  evaluator execution without an approved decision change.

## Verify your work

Run the commands that cover your change:

```bash
make lint
make typecheck
make test
make contract-check
make build
make smoke
```

For Docker or browser changes, also run:

```bash
bash scripts/container_smoke.sh
```

State exactly which commands you ran and their results in a pull request. If a
check is blocked locally, explain why and include the focused evidence you do
have.

## Pull request checklist

- [ ] The change has one clear purpose and no unrelated formatting/dependency churn.
- [ ] Tests cover the changed public behavior.
- [ ] Documentation matches the implementation.
- [ ] No credentials, private payloads, databases, or backups are included.
- [ ] Contract changes update every consumer and integration coverage.
- [ ] The verification commands and known limitations are included in the PR.

Release versioning and the pre-publication checklist are documented in
[`docs/RELEASING.md`](RELEASING.md). Do not change `schema_version` or an
Alembic revision solely because the product version changes.

## License status

The project has not selected a public license yet. Please do not submit a
contribution assuming a particular reuse or contribution license until the
maintainer adds `LICENSE` and contribution terms.

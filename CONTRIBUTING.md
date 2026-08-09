# Contributing to Mobile Spec Brain

Thanks for contributing. This project treats source evidence as the durable truth, so a good change is small,
reproducible, and easy to trace.

## Before you start

1. Check existing issues and the [architecture](docs/architecture.md) and [decision](docs/decisions) documents.
2. Keep one behavior change per pull request where practical.
3. Commit the reviewable `.spec-brain/` source files, but never generated `spec/` views, source exports containing
   credentials, or access tokens.

## Local checks

```sh
pnpm install
pnpm check
pnpm test
```

`pnpm check` runs `prettier --check`, the build, `tsc --noEmit`, and ESLint. `pnpm test` builds the workspace before
running tests. Run `pnpm format` to apply formatting. Add or update a focused test whenever behavior changes.

## Code style

Formatting is Prettier's, not a matter of taste, and it is enforced in CI. ESLint additionally caps statements per
line: this codebase previously accumulated single lines over a thousand characters long, which made review and
`git blame` useless. Keep one statement per line and let Prettier wrap.

## Protocol changes

The record vocabulary is deliberately open-world. Do not add a closed enum merely because a mobile domain currently
has a familiar list of concepts. New records must preserve these boundaries:

- Every claim references evidence that already exists.
- Every observation carries a citation that the CLI can independently re-read and re-hash.
- Citation structure stays closed; `kind`, `observation`, `predicate`, and `object` stay open.
- Unknown concepts are candidates in `concepts.json`, not silently promoted domain truth.
- Every mutation appends an event.

Changing the evidence ID derivation, the citation schema, or the record layout changes how existing `.spec-brain/`
directories are read. Bump `SCHEMA_VERSION` in `packages/storage/src/file-store.ts` so extraction cache keys do not
collide across the change, and say so in the pull request.

Read [ADR-006](docs/decisions/ADR-006-open-semantic-graph.md) before changing the open vocabulary or file protocol,
and [ADR-007](docs/decisions/ADR-007-no-derived-index.md) before proposing a derived index.

## Pull requests

Explain what changed, why it changed, and which checks you ran. Include a CLI JSON example when you change command
output or a persisted model. Keep generated build output out of commits.

# Contributing to Mobile Spec Brain

Thanks for contributing. This project treats source evidence as the durable truth, so a good change is small, reproducible, and easy to trace.

## Before you start

1. Check existing issues and the architecture documents.
2. Keep one behavior change per pull request where practical.
3. Commit the reviewable `.spec-brain/` source files, but never `.spec-brain/.index/`, generated `spec/` views, source exports containing credentials, or access tokens.

## Local checks

```sh
pnpm install
pnpm check
pnpm test
```

`pnpm test` builds the workspace before running tests. Add or update a focused test whenever behavior changes.

## Semantic-model changes

The core is deliberately open-world. Do not add a closed enum merely because a mobile domain currently has a familiar list of concepts. New records must preserve these boundaries:

- `Entity`, `Claim`, and `Relation` records need stable IDs.
- Every persisted graph assertion needs existing Evidence references.
- A mutation must pass the allowed-operation and actor policy checks and append an event.
- Unknown concepts are candidates, not silently promoted domain truth.

Read [ADR-006](docs/decisions/ADR-006-open-semantic-graph.md) before changing the open vocabulary or file protocol.

## Pull requests

Explain what changed, why it changed, and which checks you ran. Include a CLI JSON example when you change command output or a persisted model. Keep generated build output out of commits.

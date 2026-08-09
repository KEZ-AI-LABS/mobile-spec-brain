<p align="center">
  <img src="docs/assets/mobile-spec-brain-mark.svg" width="104" alt="Mobile Spec Brain mark" />
</p>

<h1 align="center">Mobile Spec Brain</h1>

<p align="center">
  Evidence-first semantic infrastructure for keeping Android, iOS, design, and API delivery aligned.
</p>

<p align="center">
  <a href="https://github.com/KEZ-AI-LABS/mobile-spec-brain/actions/workflows/ci.yml"><img src="https://github.com/KEZ-AI-LABS/mobile-spec-brain/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/KEZ-AI-LABS/mobile-spec-brain"><img src="https://img.shields.io/badge/runtime-Node.js%2022-242938?logo=nodedotjs" alt="Node.js 22" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/package%20manager-pnpm-F69220?logo=pnpm" alt="pnpm" /></a>
  <a href="docs/decisions/ADR-006-open-semantic-graph.md"><img src="https://img.shields.io/badge/model-open%20semantic%20graph-7C3AED" alt="Open semantic graph" /></a>
</p>

## The problem

Mobile product knowledge rarely lives in one place. API contracts, Android and iOS code, Figma documents, and decisions evolve independently; a polished wiki cannot prove which source supports a statement or whether it is still current.

Mobile Spec Brain keeps the raw source and its Evidence immutable, then derives a queryable semantic graph and read-only views. It reports drift without turning AI output into an editable source of truth.

> **Meaning is flexible. Integrity is strict.**

```text
OpenAPI / Android / iOS / Figma
             │
             ▼
  Immutable raw revisions + Evidence
             │
             ▼
 Entity · Claim · Relation semantic graph
             │
             ├── parity findings
             ├── governed proposals
             └── read-only wiki views
```

## Why it is different

| Instead of | Mobile Spec Brain does |
| --- | --- |
| A fixed list of product fields | Stores open-world `Entity`, `Claim`, and `Relation` records. |
| Trusting an LLM-generated spec | Requires existing Evidence, policy checks, and an append-only event for every accepted mutation. |
| Treating missing code as proof of absence | Preserves `UNKNOWN` when the available Evidence cannot decide. |
| A hand-edited wiki as the database | Renders a read-only view that can always be traced back to Evidence. |

Unknown entity types, predicates, and relation types are registered as `DISCOVERED_CONCEPT` candidates. A mobile domain pack may recognize them later, but it never constrains the semantic core.

## Quick start

**Requirements:** Node.js 22+ and pnpm 10+.

```sh
pnpm install
pnpm mobile-spec-brain init
pnpm mobile-spec-brain doctor
pnpm test
```

`init` creates a local `.mobile-spec-brain/` workspace. It contains generated state only and is intentionally ignored by Git.

Configure the local sources in `.mobile-spec-brain/config.json`:

```json
{
  "version": 1,
  "profiles": ["mobile-generic"],
  "sources": [
    { "id": "api", "type": "OPENAPI", "path": "./openapi.json" },
    { "id": "android", "type": "ANDROID", "path": "../android" },
    { "id": "ios", "type": "IOS", "path": "../ios" }
  ]
}
```

## Everyday workflow

```sh
# Inspect source changes without writing graph records.
pnpm mobile-spec-brain sync --plan --json

# Persist the Evidence-backed graph.
pnpm mobile-spec-brain sync --json

# Check Android/iOS coverage against the OpenAPI contract.
pnpm mobile-spec-brain check --json

# Inspect a feature, claim, or its source Evidence.
pnpm mobile-spec-brain feature transfer --json
pnpm mobile-spec-brain claim exposes_api --json
pnpm mobile-spec-brain evidence evidence:example --json

# Render the read-only wiki.
pnpm mobile-spec-brain wiki --json
```

To make a governed change, submit a JSON proposal that references Evidence already in the workspace. The supported low-level operations are `entity.propose`, `claim.propose`, `claim.supersede`, `relation.propose`, `evidence.attach`, and `evidence.invalidate`.

```sh
pnpm mobile-spec-brain propose --file proposal.json --json
```

## Project map

| Area | Responsibility |
| --- | --- |
| [`packages/core`](packages/core) | Pure domain contracts, semantic graph, validation, safety, ACL, and invalidation. |
| [`packages/storage`](packages/storage) | SQLite schema, Evidence joins, events, and policy-checked mutation application. |
| [`packages/api-parity`](packages/api-parity) | OpenAPI, Android, and iOS extraction and parity findings. |
| [`packages/figma-adapter`](packages/figma-adapter) | Figma snapshot adapter. |
| [`apps/cli`](apps/cli) | Local workspace CLI. |
| [`docs`](docs) | Architecture, decisions, security, and operating model. |

## Trust boundaries

- Raw revisions and Evidence are immutable historical inputs.
- AI can propose semantic meaning; it has no direct database, filesystem, or wiki-write access.
- A proposal must use an allowed operation, a permitted actor, and one or more existing Evidence IDs.
- Source ACLs must flow to all derived records and any permitted model context.

Read [the architecture](docs/architecture.md), [data model](docs/data-model.md), [security model](docs/security-model.md), and [ADR-006](docs/decisions/ADR-006-open-semantic-graph.md) for the complete model.

## Development

```sh
pnpm check
pnpm test
```

`pnpm test` builds workspace dependencies first, so tests never accidentally consume stale generated output.

Before opening a change, read [CONTRIBUTING.md](CONTRIBUTING.md). To report a security concern, follow [SECURITY.md](SECURITY.md).

## Status

This is an actively developed pre-release project. The repository currently proves local extraction, semantic persistence, parity checks, and CLI workflows through automated checks. It does not claim production rollout, hosted synchronization, or human-review operations that have not been demonstrated.

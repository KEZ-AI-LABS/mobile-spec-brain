# Mobile Spec Brain

AI-native, evidence-first specification infrastructure for mobile product development.

Mobile Spec Brain synchronizes source evidence, derives explainable specifications, and reports drift across Android, iOS, design, and APIs without treating generated specifications as editable source data.

## Current milestone

The repository contains the Phase 1 foundation: typed domain contracts, append-only events, a SQLite migration, deterministic invalidation primitives, adapter contracts, and a CLI shell. It deliberately does not claim that Figma, Android, iOS, or OpenAPI synchronization is implemented yet.

## Quick start

```sh
pnpm install
pnpm specweave init
pnpm specweave doctor
pnpm test
```

`init` creates a local `.specweave/` workspace with a SQLite database and a configuration template. Configure local sources to run the first vertical slice:

```json
{
  "sources": [
    { "id": "api", "type": "OPENAPI", "path": "./openapi.json" },
    { "id": "android", "type": "ANDROID", "path": "../android" },
    { "id": "ios", "type": "IOS", "path": "../ios" }
  ]
}
```

`specweave check --json` runs API parity. It reports a missing code match as `UNKNOWN`, never as an unsupported “not implemented” assertion.

To submit a human/agent proposal, use a JSON file with an allowed semantic operation and one or more existing Evidence IDs:

```sh
pnpm specweave propose --file proposal.json --json
```

Generate the read-only materialized wiki with `pnpm specweave wiki --json`. Generated files live in `.specweave/wiki/` and are replaced on the next render.

See [the architecture](docs/architecture.md), [the data model](docs/data-model.md), and [the preserved build brief](docs/master-build-prompt.md).

# Mobile Spec Brain

AI-native, evidence-first semantic infrastructure for mobile product development.

Mobile Spec Brain synchronizes source evidence, derives explainable claims, and reports drift across Android, iOS, design, and APIs without treating generated output as editable source data.

## Current milestone

The foundation stores an open semantic graph: entities, claims, and relations. Mobile concepts such as `feature` and `api_operation` are a typed projection over that graph, not the boundary of what the system can represent. Every graph record is tied to immutable Evidence; new AI-discovered types and predicates are stored as `DISCOVERED_CONCEPT` candidates until governed separately.

## Quick start

```sh
pnpm install
pnpm mobile-spec-brain init
pnpm mobile-spec-brain doctor
pnpm test
```

`init` creates a local `.mobile-spec-brain/` workspace with a SQLite database and a configuration template. Configure local sources to run the first vertical slice:

```json
{
  "sources": [
    { "id": "api", "type": "OPENAPI", "path": "./openapi.json" },
    { "id": "android", "type": "ANDROID", "path": "../android" },
    { "id": "ios", "type": "IOS", "path": "../ios" }
  ]
}
```

`mobile-spec-brain check --json` runs API parity. It reports a missing code match as `UNKNOWN`, never as an unsupported “not implemented” assertion.

To submit a human/agent proposal, use a JSON file with an allowed low-level semantic operation (`entity.propose`, `claim.propose`, `claim.supersede`, `relation.propose`, `evidence.attach`, or `evidence.invalidate`) and one or more existing Evidence IDs:

```sh
pnpm mobile-spec-brain propose --file proposal.json --json
```

Inspect a claim with `pnpm mobile-spec-brain claim <claim-id-or-predicate> --json`. Generate the read-only materialized wiki with `pnpm mobile-spec-brain wiki --json`. Generated files live in `.mobile-spec-brain/wiki/` and are replaced on the next render.

See [the architecture](docs/architecture.md), [the data model](docs/data-model.md), [the semantic-graph decision](docs/decisions/ADR-006-open-semantic-graph.md), and [the preserved build brief](docs/master-build-prompt.md).

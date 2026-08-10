# Mobile Spec Brain

Mobile Spec Brain turns an AI analysis of a project into cited, reviewable specification state. The AI explores the
configured project sources and returns one fixed analysis bundle. The CLI independently re-reads every citation,
validates the bundle, and applies it only after explicit human confirmation.

`.spec-brain/` is the committed source of truth. `.spec-brain/spec/` is a generated view and is ignored.

## Project-wide workflow

```sh
pnpm install
pnpm build
pnpm spec-brain init
pnpm spec-brain analysis contract

# An AI explores the project and writes project-analysis.json.
pnpm spec-brain analysis validate --file project-analysis.json
# A human reviews the bundle before applying it.
pnpm spec-brain analysis ingest --file project-analysis.json --confirm-human

pnpm spec-brain verify --check
pnpm spec-brain spec render transfer
```

The user does not configure a code scope or register every feature. `filesRead` records what the AI actually inspected;
every cited path must appear there. It is audit metadata, not a cache boundary. Feature discovery, file selection, and
semantic interpretation belong to the AI. Citation verification, persistence, drift checks, and projection remain
deterministic.

For large repositories, an agent may internally divide its work or use Git changes to refresh affected features. A
partial analysis must still describe excluded or unavailable sources in the bundle. The CLI never treats an optional
focus hint as proof that the rest of the project was analyzed.

## Analysis bundle

One bundle contains:

- repository and extractor provenance;
- every path the AI actually read and every source it deliberately excluded;
- optional cited project-profile updates;
- automatically discovered features;
- cited evidence and claims referring to local evidence keys;
- all fixed coverage sections: `product`, `design`, `api`, `implementation`, and `navigation`.

Coverage status is explicit: `ANALYZED`, `UNKNOWN`, `NOT_APPLICABLE`, or `SOURCE_UNAVAILABLE`. Completeness is computed
from these protocol sections, not from however many claims the AI happened to emit. Missing API or design knowledge
therefore cannot produce a misleading 100% result. `ANALYZED` and `NOT_APPLICABLE` both require supporting evidence;
the other statuses require an explicit reason.

Never assemble a citation hash by hand. Use:

```sh
pnpm spec-brain cite src/Transfer.kt 12 15
```

`cite`, analysis validation, and verification share the same range reader. Paths that leave a registered source root,
including symbolic-link escapes, are rejected.

## Verification and history

`verify` is read-only by default:

```sh
pnpm spec-brain verify          # JSON report, exit 0
pnpm spec-brain verify --check  # read-only CI gate, exit 1 on current drift
pnpm spec-brain verify --write  # explicitly persist calculated state transitions
```

A clean verification writes no event and leaves Git clean. Drift is determined from evidence used by current claims
or current coverage. Stale evidence referenced only by superseded historical claims remains visible as historical
drift but does not block CI.

## Commands

| Command                                           | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `init`                                            | Create `.spec-brain/`                              |
| `analysis contract`                               | Print the project-analysis bundle contract         |
| `analysis validate --file <bundle>`               | Validate schemas, references, paths, and citations |
| `analysis ingest --file <bundle> --confirm-human` | Apply one reviewed project analysis                |
| `cite <path> <start> <end>`                       | Build a verified citation                          |
| `profile read\|propose`                           | Read or propose the cited project profile          |
| `evidence record\|query\|invalidate`              | Low-level evidence operations                      |
| `claim propose\|supersede`                        | Low-level claim operations                         |
| `graph query`                                     | Query current claims and their evidence            |
| `verify [--check\|--write]`                       | Inspect or explicitly persist drift state          |
| `coverage`                                        | Count effective evidence and claim states          |
| `spec render <feature> [--section <name>]`        | Render deterministic JSON and Markdown             |

The low-level evidence and claim commands remain available for repair and advanced workflows. Normal team adoption
uses one reviewable analysis bundle instead of manually assembling several JSON files.

## Verification of this repository

```sh
pnpm check
pnpm test
```

See [the team workflow](docs/workflow.md), [architecture](docs/architecture.md), and
[analysis protocol decision](docs/decisions/ADR-008-project-wide-analysis-bundles.md). The end-to-end behavior is
recorded in the [KMP team pilot](docs/verification/2026-08-10-project-wide-kmp-pilot.md).

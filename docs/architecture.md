# Architecture

Mobile Spec Brain separates project interpretation from deterministic trust enforcement.

```text
configured project sources
        ↓
AI project exploration and feature discovery
        ↓
project analysis bundle
        ↓
schema, reference, containment, and citation validation
        ↓ human confirmation
committed .spec-brain records
        ↓
read-only verification and materialized specs
```

## Canonical files

- `profile.json` — cited project conventions, proposed or human-approved.
- `sources.json` — roots citations may address.
- `evidence/<shard>/<id>.json` — content-addressed cited observations.
- `claims/<feature>/<id>.json` — current and superseded assertions backed by evidence.
- `features/<feature>/coverage.json` — fixed protocol coverage and its evidence.
- `analyses/<analysis-id>.json` — immutable provenance for an ingested project analysis.
- `concepts.json` — discovered open-vocabulary concepts.
- `events/<iso>-<uuid>.json` — mutation history. Read-only checks do not append events.
- `spec/` — generated JSON and Markdown, ignored by Git.

There is no extraction cache and no derived index. Evidence identity already makes identical observations idempotent.
An analysis ID is a content hash of the complete submitted bundle and is used for audit and duplicate-ingest detection,
never to skip validation of a different proposal.

## Project exploration boundary

The CLI does not contain Android, iOS, Retrofit, navigation, or product-domain scanners. An external AI explores all
configured project sources, selects the files that matter, discovers features, and emits a single structured bundle.

The bundle's `filesRead` and `excluded` fields make the analysis boundary reviewable after the fact. They do not limit
which citations may be submitted and do not determine cache validity. Large-project chunking, search, and Git-diff
planning remain agent implementation details.

## Closed trust boundary

Citation structure is closed: source, relative path, inclusive line range, content hash, and revision. Semantic kinds,
observations, predicates, and objects remain open JSON. Before any mutation, the CLI validates the complete bundle,
including local evidence references and every citation.

`analysis ingest` requires `--confirm-human`. It may approve a cited profile included in the reviewed bundle, write
idempotent evidence, create immutable claims, update fixed feature coverage, record analysis provenance, and append one
analysis event.

## Fixed protocol coverage

Every discovered feature declares `product`, `design`, `api`, `implementation`, and `navigation` as one of:

- `ANALYZED`
- `UNKNOWN`
- `NOT_APPLICABLE`
- `SOURCE_UNAVAILABLE`

Completeness is the ratio of `ANALYZED` and `NOT_APPLICABLE` sections whose evidence is current. The result no longer
depends on the number of claims emitted by an AI. Complete statuses require supporting evidence; incomplete statuses
require a reviewable reason.

## Read-only verification

Verification computes effective evidence and claim states in memory. `verify` reports, `verify --check` gates CI, and
neither writes files. `verify --write` is the explicit state-materialization command and writes only real transitions;
a clean application appends no event.

Only evidence reachable from current claims or feature coverage can block CI. Evidence used exclusively by
`SUPERSEDED` claims is reported under historical stale/orphaned fields without making current specifications fail.

## Packages

- `@mobile-spec-brain/core` — schemas, stable serialization, hashing, and deterministic spec projection.
- `@mobile-spec-brain/storage` — source containment, bundle ingestion, file records, verification, and atomic writes.
- `@mobile-spec-brain/cli` — command parsing and JSON/Markdown output; protocol rules remain in core and storage.

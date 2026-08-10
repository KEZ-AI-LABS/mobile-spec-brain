# Data model

## Analysis bundle

An analysis bundle is the only normal project-ingestion unit. It records repository and extractor provenance, paths
actually read, explicit exclusions, optional cited profile entries, discovered features, fixed protocol coverage,
keyed evidence, and claim proposals. Local evidence keys let an AI produce one reviewable document without predicting
content-addressed evidence IDs.

The bundle is parsed and all references and citations are validated before mutation. Its content hash becomes an
`analysis_<sha256>` audit ID, not a cache key for a different proposal.

## Citation and evidence

Citation is closed: `sourceId`, `path`, inclusive line `range`, SHA-256 `contentHash`, and `revision` are required.
Everything semantic remains open: evidence `kind`, observation fields, claim predicate/object, and concepts.

An evidence ID is `ev_<sha256>` over `{ citation, kind, observation }`. Identical observations are idempotent; distinct
interpretations of the same lines remain distinct. Persisted states are `ACTIVE`, `STALE`, `ORPHANED`, and
`INVALIDATED`.

## Claims and history

A claim references existing evidence IDs. A current claim is effectively `NEEDS_REVIEW` when any dependency is not
active. A later claim may declare `supersedes`; the prior claim becomes `SUPERSEDED`, but its evidence remains valid
historical provenance. Historical stale evidence does not block current CI.

## Feature coverage

Every analyzed feature has `product`, `design`, `api`, `implementation`, and `navigation` coverage. Each section is
`ANALYZED`, `UNKNOWN`, `NOT_APPLICABLE`, or `SOURCE_UNAVAILABLE` and may reference supporting evidence. Completeness is
computed from these five sections and their current evidence, not from claim count.

## Serialization

All JSON is recursively key-sorted, two-space indented, and atomically written. `analysis ingest` appends one audit
event for the reviewed bundle. Read-only verification does not mutate records or history.

# Architecture

The committed `.spec-brain/` directory is Mobile Spec Brain's only source of truth. It has a small, reviewable file
protocol:

- `profile.json` — a cited project profile, proposed by an agent and approved by a human.
- `sources.json` — source roots that citations may address.
- `evidence/<shard>/<id>.json` — one observation per record, immutable except for its verification state.
- `claims/<feature>/<id>.json` — open-world claims backed by existing evidence IDs.
- `concepts.json` — discovered vocabulary candidates.
- `events/<iso>-<uuid>.json` — append-only mutation and verification history.
- `extractions/<cache-key>.json` — one cache decision for an AI scope/extractor input.
- `spec/` — generated views, ignored by Git and rebuilt by `spec render`.

There is no derived index; queries read the JSON records directly. See
[ADR-007](decisions/ADR-007-no-derived-index.md).

## Packages

- `@mobile-spec-brain/core` — the closed citation schema, the open record schemas, stable serialization, and the
  deterministic claim-to-spec projection. No I/O beyond hashing.
- `@mobile-spec-brain/storage` — the `.spec-brain/` file protocol: containment checks, citation verification, record
  reads and atomic writes.
- `@mobile-spec-brain/cli` — argument parsing and JSON output. It holds no protocol rules of its own.

## Evidence identity

An evidence ID is `ev_<sha256>` over the citation, the observation `kind`, and the observation body. Two different
observations about the same lines are therefore two records, while re-recording an identical observation is
idempotent. Identity deliberately excludes confidence, authority, and extractor metadata so that re-running the same
extractor at a different temperature does not fork the record set.

## The external extraction boundary

The CLI never scans Kotlin, Swift, Retrofit, navigation conventions, or product-specific names. `extract --scope
--file` is the boundary: it accepts cited observations, derives a key from the scoped content plus extractor, model,
prompt, and schema versions, then either reuses the matching extraction record or independently re-reads and re-hashes
every submitted range.

Scope hashing walks the scope with symbolic links skipped and `.git`, `node_modules`, `dist`, and `.spec-brain`
excluded, reading file bytes so binary content contributes faithfully.

## Verification

`verify` re-reads every citation. Content that no longer matches its hash becomes `STALE`; a citation whose file or
source is gone becomes `ORPHANED`; a human may mark a record `INVALIDATED`. Active claims depending on any
non-active evidence are downgraded to `NEEDS_REVIEW`. `INVALIDATED` is never cleared by verification.

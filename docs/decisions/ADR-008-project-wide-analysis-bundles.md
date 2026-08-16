# ADR-008: Project-wide analysis bundles

## Context

The first AI boundary required `extract --scope <path>`. The CLI hashed that path and reused an extraction record before
validating a newly submitted proposal. In a real KMP feature, an observation cited a shared domain file outside the
feature scope. Changing that file left the scope hash unchanged, so a new valid proposal returned stale cached evidence.

The cache ran after the external AI had already performed its analysis, so it saved no model call. It also forced users
to choose a project partition even though feature discovery and relevant-file selection are AI responsibilities.

The same pilot showed three related adoption failures: read-only CI verification appended events, superseding a claim
could not clear drift caused only by its historical evidence, and claim-count completeness reported 100% while entire
protocol sections were unavailable.

## Decision

- Replace scoped extraction with a project-wide analysis bundle.
- Treat `filesRead` and `excluded` as auditable analysis metadata, never as a correctness boundary.
- Remove extraction caching. Content-addressed evidence provides idempotency; an analysis content hash is audit identity
  only, and every different proposal is fully validated.
- Require fixed product/design/API/implementation/navigation coverage for every discovered feature.
- Make verification read-only by default and expose explicit `--check` and `--write` modes.
- Gate drift only on evidence reachable from current claims or current feature coverage. Preserve stale evidence used
  only by superseded claims as historical information.
- Let one reviewed bundle carry optional profile changes, evidence, claims, and coverage so teams do not manually stitch
  several JSON files together.

## Consequences

Initial analysis may be expensive, but that cost belongs to the AI agent and can be internally chunked. Incremental
refresh uses Git changes and existing citation relationships rather than a caller-selected scope hash.

The persisted protocol moves from extraction cache records to immutable analysis-run records and feature coverage.
Existing `.spec-brain/extractions/` directories are legacy and no longer read. Current evidence and claim files remain
readable.

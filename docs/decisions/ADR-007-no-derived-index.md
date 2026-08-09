# ADR-007: No derived index

## Context

[ADR-006](ADR-006-open-semantic-graph.md) established `.spec-brain/` as the
canonical state and described SQLite as a discardable `.index/` lookup cache.

That cache was written by `reindex` and never read. Every query path —
`evidence query`, `graph query`, `coverage`, `spec render` — scanned the JSON
records directly. The index therefore bought no lookup speed while costing a
native dependency (`better-sqlite3`), a build step for contributors, and a
persistent invitation to treat a derived artifact as authoritative.

## Decision

The derived index and the `reindex` command are removed. Queries read the
committed JSON records.

At repository scale a full scan of `.spec-brain/` is a few milliseconds to a few
hundred milliseconds, which a per-invocation CLI can absorb. Redundant scans
within a single command are avoided by loading sources and the profile once and
threading them through, rather than by adding a second store.

## Consequences

`better-sqlite3` is gone, so `pnpm install` no longer compiles a native module.
There is one representation of the truth and no staleness window between the
records and an index derived from them.

If profiling later shows a real bottleneck, an index may return — but it must
have a read path from the start, and this ADR should be superseded rather than
quietly contradicted.

# Architecture

## Invariant

**Synchronize evidence; derive specifications.** Raw revisions are immutable historical inputs. Evidence, specs, findings, and the generated wiki are rebuildable materializations.

## Current boundary

The foundation separates the following layers so source-specific work cannot leak into resolution or policy:

```text
SourceAdapter -> ChangeSet -> Raw revisions / blocks -> Evidence -> Specs -> Findings
                                      |                    |         |
                                      +-> append-only events+---------+
```

- `@mobile-spec-brain/core` owns pure domain models, validation, hashing, adapter contracts, invalidation, and the event-store contract.
- `@mobile-spec-brain/storage` owns SQLite schema migrations and persistence adapters.
- `@mobile-spec-brain/cli` owns command parsing and workspace wiring; it contains no resolution logic.

## First vertical slice

The next implementation slice is OpenAPI plus local Android/iOS repositories. It will produce API-operation and deterministic implementation evidence, then run API parity rules. Figma follows after that slice is tested end-to-end.

## Safety boundaries

LLM output is never a mutation. Future semantic extraction will return a schema-validated proposal that is verified against immutable evidence and policy before an append-only event is committed. The current code exposes no generic write API for specifications or evidence.

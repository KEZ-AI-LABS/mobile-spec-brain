# Architecture

## Invariant

**Meaning is flexible. Integrity is strict.** Raw revisions are immutable historical inputs. Evidence-backed entities, claims, relations, findings, and the generated wiki are rebuildable materializations.

## Current boundary

The foundation separates the following layers so source-specific work cannot leak into resolution or policy:

```text
SourceAdapter -> ChangeSet -> Raw revisions / blocks -> Evidence -> Semantic graph -> Findings / Wiki
                                      |                    |              |
                                      +-> append-only events+--------------+
```

The semantic graph has three open-world primitives:

- `Entity(id, type, attributes)` identifies a thing without restricting its type to a predefined list.
- `Claim(subject, predicate, object, qualifiers, evidence)` records an evidence-backed assertion.
- `Relation(from, type, to, evidence)` records a typed graph edge.

An extractor can introduce a previously unseen entity type, predicate, or relation type. Storage registers it as a `DISCOVERED_CONCEPT`; governed domain packs may later promote it. The mobile/API pack is only a convenient fast path that projects API evidence into `feature`, `api_operation`, and `exposes_api` graph records.

- `@mobile-spec-brain/core` owns pure domain models, validation, hashing, adapter contracts, invalidation, and the event-store contract.
- `@mobile-spec-brain/storage` owns SQLite schema migrations and persistence adapters.
- `@mobile-spec-brain/cli` owns command parsing and workspace wiring; it contains no resolution logic.

## Domain packs and views

Domain packs may supply known concepts, extractors, rules, and wiki views, but they cannot weaken graph integrity. A “specification” is a selected valid set of Claims, not a separately stored fixed object. The built-in wiki is a deterministic read-only view; an AI composer may later propose alternate grouping or narrative, never write arbitrary files or database records directly.

## Safety boundaries

LLM output is never a mutation. Semantic extraction returns a schema-validated proposal that is verified against immutable Evidence and policy before an append-only event is committed. The only permitted mutation vocabulary is intentionally low-level: entity/claim/relation proposals, claim supersession, evidence attachment or invalidation, decisions, and conflict resolution.

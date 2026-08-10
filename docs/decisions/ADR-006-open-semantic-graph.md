# ADR-006: Keep semantic vocabulary open in a file-backed protocol

## Decision

`.spec-brain/` is the canonical project state. Evidence kinds, observations, claim predicates, objects, and discovered concepts remain open-world JSON values. Citation structure is deliberately closed and verified.

A deterministic spec view is derived from committed claims and evidence.

Project analysis is submitted as the fixed envelope defined by
[ADR-008](ADR-008-project-wide-analysis-bundles.md). The envelope closes provenance, coverage, and local-reference
structure while evidence kinds and claim semantics remain open.

> The original decision also described SQLite as a discardable `.index/` lookup cache. That index was never read and
> has since been removed; see [ADR-007](ADR-007-no-derived-index.md).

## Consequences

New brownfield conventions do not require a schema migration or a concept-specific command. They can be proposed as
cited observations and registered as `DISCOVERED_CONCEPT`. Consumers preserve unknown values rather than silently
guessing them. Fixed coverage prevents the open vocabulary from turning omissions into false completeness.

This trades some fixed-domain convenience for reviewable Git state and broad project portability.

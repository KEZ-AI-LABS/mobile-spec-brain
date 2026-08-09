# ADR-006: Use an open semantic graph as the canonical model

## Status

Accepted.

## Context

A fixed mobile specification schema is useful for known checks, but it would make the model's vocabulary the limit of the product's vocabulary. Mobile projects have product-specific concepts, constraints, and relationships that cannot be safely enumerated in advance.

## Decision

The canonical model is an Evidence-backed graph of `Entity`, `Claim`, and `Relation` records. Types and predicates are open strings. Newly observed names are registered as `DISCOVERED_CONCEPT` candidates. Mobile/API concepts are domain-pack projections, not core tables.

All persisted graph records require Evidence joins, confidence/authority where applicable, state, and an append-only event. Agents may propose only narrow semantic mutations; policy and human review remain the write boundary.

## Consequences

The system can represent unknown product semantics without a schema migration. Typed mobile views remain easy to query and validate. Consumers must treat unknown concepts as candidates until a domain pack or governance policy recognizes them.

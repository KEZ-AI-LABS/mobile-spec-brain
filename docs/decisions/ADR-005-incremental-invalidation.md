# ADR-005: Dependency-driven invalidation

Changes invalidate only reachable downstream graph nodes. Full rebuilds are explicit administrative operations, not the default sync behavior.

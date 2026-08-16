# ADR-005: Dependency-driven invalidation

Changes invalidate only current coverage and current claims reachable from changed evidence. Evidence referenced only
by superseded claims remains historical and cannot block the current CI gate. AI refresh planning may use Git changes
and citation relationships, but no caller-selected extraction scope participates in correctness.

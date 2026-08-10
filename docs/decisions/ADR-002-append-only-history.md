# ADR-002: Append-only mutation history

Reviewed mutations create events. Evidence and claims retain historical identity; supersession is represented by a new
claim and a state transition on the prior claim. Explicit `verify --write` may materialize calculated state transitions.

Read-only operations do not append events. In particular, `verify` and `verify --check` must leave a clean checkout
clean, so CI observation cannot become a mutation merely because it inspected the repository.

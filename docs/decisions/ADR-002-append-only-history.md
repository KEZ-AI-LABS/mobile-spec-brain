# ADR-002: Append-only mutation history

Mutations create events; they do not rewrite historical records. Reversal is a new event. This supports audit, replay, and trustworthy diagnosis.

# Spec resolution

Specs are materialized views, not editable records. Resolution will consider authority, extraction confidence, freshness, lifecycle, and temporal validity independently. When evidence is insufficient or contradictory without a policy winner, the valid answer is `UNKNOWN`.

Authority is profile-configured by specification domain. It is intentionally not a universal hard-coded hierarchy.

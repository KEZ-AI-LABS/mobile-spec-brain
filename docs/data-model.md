# Data model

Stable identifiers are opaque strings. Display names and source paths are attributes, never identity.

The initial migration creates workspaces, sources, source entities, raw revisions, raw blocks, evidence, sync cursors, extractor cache, policies, events, semantic concepts, semantic entities, claims, relations, findings, and their evidence joins.

`semantic_entities.type`, `claims.predicate`, and `semantic_relations.type` are strings rather than closed enums. Unknown names are persisted in `semantic_concepts` with state `DISCOVERED_CONCEPT`. This lets extraction discover product-specific concepts while keeping references, evidence joins, confidence, authority, state, and events strictly validated.

Raw revisions and events are append-only. Source deletion is represented with `DELETED_AT_SOURCE`; derived records are superseded, deprecated, or invalidated rather than hard-deleted.

Every entity, claim, and relation is connected to one or more Evidence IDs. Evidence retains provenance fields (`sourceEntityId`, `rawBlockId`, revision, extractor version, and range), so a renderer can answer why an assertion exists.

# Data model

Stable identifiers are opaque strings. Display names and source paths are attributes, never identity.

The initial migration creates the durable entities required by the foundation: workspaces, sources, source entities, raw revisions, raw blocks, evidence, features, specs, spec revisions, edges, findings, sync cursors, extractor cache, policies, and events.

Raw revisions and events are append-only. Source deletion is represented with `DELETED_AT_SOURCE`; derived records are superseded, deprecated, or invalidated rather than hard-deleted.

Every evidence and spec value retains provenance fields (`sourceEntityId`, `rawBlockId`, revision, extractor version, and range) so a future renderer can answer why a value exists.
